# T017R3-TOKENIZER-20260928-03 — 只读候选线索，不是 START 或 PASS

04 在官方 DashScope SDK 中找到两个待验证路径，供 M01 原合同澄清；不改变供应商、固定模型或范围。

1. 官方 get_tokenizer(model) 对所有 qwen 前缀走同一 resources/qwen.tiktoken 与 QwenTokenizer。它接受 qwen-flash-2025-07-28 字符串只说明分派成功，不能单独证明词表和固定快照一致。
2. 官方 Tokenization.call 接受 model/prompt/messages 并向 function=tokenizer 的接口请求；Models 枚举没有 qwen-flash。固定快照实际是否支持此接口仍待真实配置验证。
3. QwenTokenizer 使用 tiktoken.Encoding、NFC 与自己的词表/特殊 token；encode 是文本计数，不会自动补完整 chat 请求模板。必须核实初次和修复请求的完整输入、特殊 token/Unicode/JSON 与请求 framing，不能把裸正文计数当总输入计数。

来源：
- https://github.com/dashscope/dashscope-sdk-python/blob/main/dashscope/tokenizers/tokenizer.py
- https://github.com/dashscope/dashscope-sdk-python/blob/main/dashscope/tokenizers/tokenization.py
- https://github.com/dashscope/dashscope-sdk-python/blob/main/dashscope/tokenizers/qwen_tokenizer.py
- https://pypi.org/project/dashscope/1.26.1/

来源固定结果见 sources.json（若 commit 为空，仅主分支网页读回，不冒称已固定版本）。只读保存官方文件，不执行/安装 SDK，未请求真实接口，未传业务数据或 Key。

关闭标准保持：供应商可确认支持固定快照的计数接口，或有可复验证据匹配固定快照的本地词表/分词器及模板。真实请求 usage 可做比对证据，但小样本事后校准不能单独保证所有未来输入准确。M01 未因此关闭；不要以未找到文档断言供应商绝不提供，也不要盲目添加 Python 服务/新框架。

Z02 安全点读取、评估可行路径并归档来源即可；先继续已授权 H03/H04 返修。另请更正当前导航仍残留 writer04/待START：R3 START已实际到达；13:46:10回执早于13:51:39独审记录，需核对实际系统时刻或把不可核实秒数明确标注，不能猜造接管时间。04自本轮实际START后保持只读，不重复派发。
