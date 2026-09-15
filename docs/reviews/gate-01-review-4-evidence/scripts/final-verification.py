from pathlib import Path
import datetime,hashlib,html,importlib.util,json,re,subprocess,socket

root=Path.cwd()
ev=root/'docs/reviews/gate-01-review-4-evidence'
snap=json.loads((ev/'snapshot.json').read_text())
expected={'00_START_HERE.md','00_START_HERE.html','CODEX_REVIEW_HANDOFF.md',
          'docs/ai-ecommerce-assistant/12_PROGRESS.md','prompts/P08_FIX.md'}
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
changed=[f for f,h in snap.items() if not (root/f).is_file() or sha(root/f)!=h]
assert set(changed)==expected,changed
app=[f for f in snap if f.startswith('ai-ecommerce-assistant/')]
assert len(app)==83
assert not set(app).intersection(changed)
def before(f):
    return subprocess.check_output(['git','show','HEAD:'+f],text=True)
progress=(root/'docs/ai-ecommerce-assistant/12_PROGRESS.md').read_text()
oldprogress=before('docs/ai-ecommerce-assistant/12_PROGRESS.md')
anchor=re.search(r'^## TASK-001 .*$',oldprogress,re.M).group(0)
assert oldprogress[oldprogress.index(anchor):] in progress
assert before('CODEX_REVIEW_HANDOFF.md') in (root/'CODEX_REVIEW_HANDOFF.md').read_text()
assert before('prompts/P08_FIX.md') in (root/'prompts/P08_FIX.md').read_text()
assert progress.count('<!-- PRODUCT_OS_STATE_BEGIN -->')==1
assert progress.count('<!-- PRODUCT_OS_STATE_END -->')==1
rows=re.findall(r'^\| TASK-(\d{3}) \| [^\n]+$',progress,re.M)
assert len(rows)==len(set(rows))==30
future=re.findall(r'^\| TASK-(\d{3}) \| [^|]+ \| (\w+) \|',progress,re.M)
assert all(status=='TODO' for n,status in future if int(n)>=5)
assert sum(int(n)>=5 for n,status in future)==26
spec=importlib.util.spec_from_file_location('product_os','/Users/yuyuyu/Documents/AI-Workspace/tools/product_os.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
cfg,state,prompt=module.read_state(root)
assert state['current_task']=='TASK-004'
assert state['next_owner']=='ZCode' and state['checkpoint']=='YES'
assert state['next_prompt']=='prompts/P08_FIX.md'
assert 'REVIEW_4 BLOCKED' in state['review']
home=(root/'00_START_HERE.md').read_text()
homehtml=(root/'00_START_HERE.html').read_text()
mdprompt=re.search(r'```text\n(.*?)\n```',home,re.S).group(1)
htmlprompt=html.unescape(re.search(r'<textarea id="next-prompt"[^>]*>(.*?)</textarea>',homehtml,re.S).group(1))
assert mdprompt==prompt and htmlprompt==prompt
for key in ['stage','current_task','status','next_action','next_owner','acceptance','checkpoint','review','updated_at']:
    assert state[key] in home,key
    assert state[key] in html.unescape(homehtml),key
control=Path('/Users/yuyuyu/Documents/AI-Workspace/00_CONTROL_CENTER')
center=(control/'PROJECTS.md').read_text()
centerhtml=html.unescape((control/'index.html').read_text())
for key in ['stage','current_task','status','next_action','next_owner','updated_at']:
    assert state[key] in center,key
    assert state[key] in centerhtml,key
assert '00_START_HERE.md' in center and '00_START_HERE.html' in centerhtml
reportpath=root/'docs/reviews/CODEX_REVIEW_GATE_01_REVIEW_4_2026-09-14.md'
report=reportpath.read_text()
sections=re.findall(r'^## (\d+)\.',report,re.M)
assert sections==[str(i) for i in range(1,16)],sections
links=[]
for target in re.findall(r'\]\((.*?)\)',report):
    if not target.startswith('/'):continue
    m=re.match(r'^(.*?)(?::(\d+))?$',target)
    path=Path(m.group(1));assert path.exists(),target
    if m.group(2):assert int(m.group(2))<=len(path.read_text().splitlines()),target
    links.append(target)
sync=json.loads((ev/'product-os-sync.log').read_text())
assert not sync['errors'] and sync['updated']==1,sync
head=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
assert head=='858c20ab9645b494840b219f0b39b01c39023291'
assert subprocess.check_output(['git','rev-parse','main'],text=True).strip()=='2a983cc55f136abbb49c5d02b55c1cb82b6547cc'
diff=subprocess.run(['git','diff','--check'],capture_output=True,text=True)
assert diff.returncode==0,diff.stdout+diff.stderr
listeners={}
for port in [3000,3002,3003,55470,3301,55480]:
    with socket.socket() as s:
        s.settimeout(.2);listeners[str(port)]=s.connect_ex(('127.0.0.1',port))==0
assert not any(listeners.values()),listeners
history={}
for name in ['gate-01-evidence','gate-01-review-2-evidence','gate-01-formal-evidence','gate-01-review-3-evidence','gate-01-r4-evidence']:
    files=[f for f in snap if f.startswith('docs/reviews/'+name+'/')]
    history[name]={'files':len(files),'mismatches':[f for f in files if f in changed]}
    assert not history[name]['mismatches']
pointer=Path('/tmp/aiea-r4-review-active')
result={'at':datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
        'head':head,'tracked_files_checked':len(snap),'application_files_unchanged':len(app),
        'changed_tracked_files':changed,'history_evidence':history,
        'progress_history_preserved':True,'handoff_history_preserved':True,'p08_history_preserved':True,
        'task_rows':len(rows),'future_tasks_todo':26,'state_blocks':1,
        'report_sections':len(sections),'valid_report_local_links':len(links),
        'source_state':{key:state[key] for key in ['current_task','status','stage','next_owner','next_prompt','checkpoint','review','updated_at']},
        'product_os_sync':sync,'home_md_prompt_matches':True,'home_html_prompt_matches':True,
        'control_md_matches':True,'control_html_matches':True,'git_diff_check_exit':diff.returncode,
        'listeners':listeners,'temporary_directory_removed':not pointer.exists(),
        'no_business_edit_commit_push_merge_deploy':True}
(ev/'final-verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['at','application_files_unchanged','changed_tracked_files','future_tasks_todo','report_sections','product_os_sync','temporary_directory_removed']},ensure_ascii=False))
