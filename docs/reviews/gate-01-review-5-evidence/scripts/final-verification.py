"""Read-only closeout QA of review documents and preserved source; no business tests."""
import datetime
import hashlib
import html
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

sys.dont_write_bytecode = True
ROOT = Path('/Users/yuyuyu/Documents/ChatGPT/产品-开发')
CONTROL = Path('/Users/yuyuyu/Documents/AI-Workspace')
EVIDENCE = ROOT / 'docs/reviews/gate-01-review-5-evidence'

def read(path):
    # A prior buffered read stalled locally; bound every individual read.
    return subprocess.run(['/bin/cat', str(path)], check=True, capture_output=True, timeout=8).stdout

def text(path):
    return read(path).decode('utf-8')

def git(*args):
    return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-C', str(ROOT), *args], check=True, capture_output=True, text=True, timeout=30).stdout.strip()

snapshot = json.loads(read(EVIDENCE / 'snapshot.json'))
changed = [name for name, digest in snapshot.items() if hashlib.sha256(read(ROOT / name)).hexdigest() != digest]
allowed = sorted(['00_START_HERE.html', '00_START_HERE.md', 'CODEX_REVIEW_HANDOFF.md', 'docs/ai-ecommerce-assistant/12_PROGRESS.md', 'prompts/P07_CODE_REVIEW.md', 'prompts/P08_FIX.md', 'prompts/README.md'])
assert sorted(changed) == allowed, changed
app_files = [p for p in snapshot if p.startswith('ai-ecommerce-assistant/')]
assert len(app_files) == 109

progress = text(ROOT / 'docs/ai-ecommerce-assistant/12_PROGRESS.md')
for token in ('PRODUCT_OS_STATE_BEGIN', 'PRODUCT_OS_STATE_END'):
    assert progress.count(token) == 1
rows = re.findall(r'^\| (TASK-\d{3}) \| [^|]+ \| (DONE|TODO|BLOCKED|IN_PROGRESS) \|', progress, re.M)
assert len(rows) == 30 and len(dict(rows)) == 30
assert all(status == ('DONE' if int(task[-3:]) <= 4 else 'TODO') for task, status in rows)

old_progress = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:docs/ai-ecommerce-assistant/12_PROGRESS.md'], check=True, capture_output=True).stdout.decode()
old_history = old_progress[old_progress.index('## TASK-001 执行记录'):]
assert old_history in progress
for name in ('CODEX_REVIEW_HANDOFF.md', 'prompts/P07_CODE_REVIEW.md', 'prompts/P08_FIX.md'):
    old = subprocess.run(['git', '-C', str(ROOT), 'show', 'HEAD:' + name], check=True, capture_output=True).stdout.decode()
    assert old in text(ROOT / name), name

spec = importlib.util.spec_from_file_location('review_product_os', CONTROL / 'tools/product_os.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cfg, state, prompt = module.read_state(ROOT)
assert state['current_task'] == 'TASK-004'
assert state['checkpoint'] == 'YES'
assert state['next_owner'] == 'Owner（用户）'
assert state['next_prompt'] == 'prompts/P09_PHASE_RELEASE.md'
assert 'PASS' in state['review'] and 'Owner未放行' in state['review']
home_md = text(ROOT / '00_START_HERE.md')
home_html = text(ROOT / '00_START_HERE.html')
control_md = text(CONTROL / '00_CONTROL_CENTER/PROJECTS.md')
control_html = text(CONTROL / '00_CONTROL_CENTER/index.html')
assert re.search(r'```text\n(.*?)\n```', home_md, re.S).group(1) == prompt
assert html.unescape(re.search(r'<textarea id="next-prompt"[^>]*>(.*?)</textarea>', home_html, re.S).group(1)) == prompt
for field in ('stage', 'status', 'current_task', 'next_owner', 'next_action', 'updated_at'):
    for surface in (home_md, home_html, control_md, control_html):
        assert state[field] in html.unescape(surface), field
for surface in (home_md, home_html):
    assert state['acceptance'] in html.unescape(surface)

report_path = ROOT / 'docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_5_2026-09-14.md'
report = text(report_path)
assert [int(n) for n in re.findall(r'^## (\d+)\.', report, re.M)] == list(range(1, 16))
for path, line in re.findall(r'\]\((/Users/[^)\n]+?)(?::(\d+))?\)', report):
    assert Path(path).is_file(), path
    if line:
        assert 1 <= int(line) <= len(text(Path(path)).splitlines())

sync = json.loads(read(EVIDENCE / 'product-os-sync.log'))
assert sync['errors'] == [] and sync['updated'] == 1
assert git('rev-parse', 'HEAD') == '32fb0d3e8ad19b691cf66006638a418ca949e2a4'
assert git('rev-parse', 'main') == '2a983cc55f136abbb49c5d02b55c1cb82b6547cc'
assert git('branch', '--show-current') == 'phase/01-foundation'
assert git('diff', '--check', '--', *allowed) == ''
result = {
    'checked_at': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).isoformat(timespec='seconds'),
    'tracked_files_checked': len(snapshot), 'application_files_unchanged': len(app_files),
    'changed_tracked_files': changed, 'history_preserved': True,
    'unique_state_block': True, 'task_rows': len(rows), 'task_001_004': 'DONE', 'task_005_030': 'TODO',
    'readback': {'project_markdown': True, 'project_html': True, 'control_markdown': True, 'control_html': True, 'exact_next_prompt': True},
    'current_task': state['current_task'], 'next_owner': state['next_owner'], 'next_prompt': state['next_prompt'],
    'checkpoint': state['checkpoint'], 'owner_release': False, 'business_updated_at': state['updated_at'],
    'report_15_sections_and_links': True, 'sync': sync, 'git_diff_check': 'PASS',
    'head_and_main_unchanged': True, 'temporary_environment_removed': not Path('/tmp/aiea-r5-review-active').exists(),
    'all_checks_passed': True
}
(EVIDENCE / 'final-verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(result, ensure_ascii=False, indent=2))
