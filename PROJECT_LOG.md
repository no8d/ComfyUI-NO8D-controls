# NO8D-controls 项目日志

日期：2026-07-08  
项目：`ComfyUI-NO8D-controls`  
目标：记录当前节点行为、架构决策、近期修复和后续优化入口，便于之后 AI 或开发者继续维护。

## 项目定位

这是一套 ComfyUI 自定义节点，面向图像生成、局部重绘、图像批处理、提示词扩写、LoRA 控制和图文数据集整理。

核心原则：

1. 优先使用 ComfyUI 原生机制，例如 `GraphBuilder`、list 执行、图像预览状态、右键菜单、队列和节点注册。
2. 自定义前端 UI 只负责提升操作效率，不替代 ComfyUI 已有能力。
3. 批量图像处理优先使用 ComfyUI list 语义，避免手写批量循环导致执行状态、预览和内存管理出错。
4. 性能优先级高于视觉装饰。大图预览、遮罩绘制、缩略图渲染都需要控制缓存和释放。

## 当前节点结构

- `slider_lora_stack.py` + `web/slider_lora_stack.js`
  - 节点：`NO8D-LoRA stack`
  - 功能：多 LoRA 堆叠、排序、启用/关闭、权重范围、触发词输出。

- `prompt_plus.py` + `web/prompt_plus_i18n.js` + `web/prompt_view.js`
  - 节点：`NO8D-Prompt`、`NO8D-提示词预览`
  - 功能：文本扩写、图像反推、文本 + 图像融合、固定提示词前缀、提示词预览与发送。

- `image_loader.py` + `web/image_loader_i18n.js`
  - 节点：`NO8D-图像载入`
  - 功能：多图载入、缩略图选择、拖动排序、选中图输出、未选中时输出全部、list 输出。

- `generate.py` + `web/generate.js`
  - 节点：`NO8D-Generate`
  - 功能：采样参数面板、图像预览、遮罩绘制、局部重绘、list 输入执行。
  - 后端通过 `GraphBuilder` 展开为 ComfyUI 原生采样/解码链路。

- `compare_slider_preview.py` + `web/compare_slider_preview.js`
  - 节点：`NO8D-A/B preview`
  - 功能：左侧 `image_a`，右侧 `image_b`；单输入时当前图与历史图对比；list 结果分页对比。

- `save_image_text_dataset.py` + `web/save_i18n.js`
  - 节点：`NO8D-图文保存`
  - 功能：保存图像与文本，支持可排序命名规则。

- `empty_latent.py` + `web/empty_latent_i18n.js`
  - 节点：`NO8D-空 latent`
  - 功能：按模型类型、比例和短边尺寸创建 latent。

- `prompt_config.py`、`prompt_server.py`、`web/prompt_settings.js`
  - 功能：提示词 API、规则和服务配置。

## 近期关键修复和决策

### 1. NO8D-Generate 批量输入

问题：批量重绘时只输出第一张，或重复输出同一张。

决策：使用 ComfyUI list 执行，而不是 batch tensor，也不是节点内部手写循环。  
当前实现：`positive`、`latent`、`negative` 不再作为 `rawLink` 固定传入，允许 ComfyUI 按 list 语义展开；`model`、`vae` 仍保持原生链接传递。`GraphBuilder` 子图使用 ComfyUI 分配的节点 ID，避免多次执行时子图 ID 冲突。

验证标准：

- `NO8D-图像载入` 选择两张图输出到 `NO8D-Generate`。
- 下游预览应收到两张结果，而不是同一张重复两次。
- A/B preview 的分页应能看到 list 中不同图片。

### 2. NO8D-A/B preview

问题：单输入模式下历史图逻辑容易混淆；右键菜单不完全等同 ComfyUI 原生图像右键。

当前行为：

- `image_a` 固定显示左侧，`image_b` 固定显示右侧。
- 某侧没接入时，使用该输入流上一次图像作为历史图。
- 第一次运行无历史图时，缺失侧为空白。
- list 结果使用页码分页。
- 前端同步 `node.imgs` / `node.images` / `imageIndex`，尽量保留 ComfyUI 原生右键图像行为。

### 3. NO8D-图像载入

问题：`输出全部图像` 开关实际已经没有必要；拖动排序和选中输出需要统一。

当前行为：

- 移除 `output_all` 语义；旧工作流残留控件会被前端隐藏。
- 有选中图像时输出选中图像。
- 没有选中图像时输出全部图像。
- 双击单图会只运行该图。
- 输出为 list，方便下游一张一张执行。

### 4. Prompt 节点输入语义

问题：原 `文本` 输入和 `触发词` 输入容易造成职责重复。

当前行为：

- `触发词` 输入已移除。
- 原 `额外规则 / extra_rules` 在 UI 中改名为 `输入文本 / Input text`，作为用户主要文本意图。
- `固定提示词` 用于 LoRA 触发词或固定前缀。
- 文本 + 图像时，文本是主要意图，图像是视觉参考。

注意：后端字段名仍为 `extra_rules`，这是为了兼容 ComfyUI 工作流序列化和旧节点顺序；UI 标签已经改为 `输入文本`。

### 5. 语种自适应

当前实现：

- `web/no8d_i18n.js` 集中存放英文/中文文案。
- 语言判断来源包括 ComfyUI 设置、localStorage、页面语言和可见 ComfyUI UI 文案。
- 已移除周期性语言轮询。
- 节点启动时初始化语言；浏览器 `storage` 或 `languagechange` 事件发生时刷新标签。

已覆盖：

- `NO8D-Prompt`
- `NO8D-提示词预览`
- `NO8D-图像载入`
- `NO8D-空 latent`
- `NO8D-图文保存`
- `NO8D-LoRA stack`
- `NO8D-Generate`
- `NO8D-A/B preview` 的绘制文案按需调用翻译函数

验证标准：

- ComfyUI 中文界面中节点标题、输入输出、主要按钮应显示中文。
- ComfyUI 英文界面中应显示英文。
- 不应存在 `setInterval` 语言轮询。

## 性能注意事项

重点关注：

1. 大图预览不要反复解码原图。
2. Canvas 缓存需要在图像变化或遮罩变化时失效。
3. 大图缩略图应分批渲染，避免一次性创建大量 DOM 和图片。
4. 遮罩绘制交互中优先使用低成本预览，绘制结束后再提交完整 mask。
5. 删除或替换图片时释放旧 canvas / image 引用。

已做过的方向：

- A/B preview 降采样预览缓存。
- Generate 遮罩绘制缓存和延迟提交。
- Image loader 缩略图分批渲染。
- 移除语言轮询。

## 后续优化建议

优先级 P1：

- 在真实 ComfyUI 中继续验证 `NO8D-Generate` list 输入和局部重绘的组合场景。
- 验证 `NO8D-A/B preview` 在长时间连续出图时是否还有内存增长。
- 检查所有自定义输入框的快捷键透传，尤其是 `Ctrl/⌘ + Enter`。

优先级 P2：

- 为前端自定义 UI 增加更统一的事件透传工具，避免每个节点重复写 pointer/key 处理。
- 把 `web/no8d_i18n.js` 文案按节点拆分或加入缺失 key 检查脚本。
- 补一套最小工作流 JSON 作为回归测试样例。

优先级 P3：

- 给 README 增加截图和 GIF，但需要保证图片文件真实存在并跟随功能更新。
- 梳理 `NO8D-图文保存` 的命名规则，考虑更多可选变量。

## 发布前验证清单

```bash
python -m py_compile __init__.py compare_slider_preview.py empty_latent.py generate.py image_loader.py prompt_config.py prompt_plus.py prompt_server.py save_image_text_dataset.py slider_lora_stack.py
node --check web/*.js
git diff --check
```

手动验证：

1. 重启 ComfyUI，强制刷新浏览器。
2. 加载一个包含 `NO8D-图像载入 -> NO8D-Generate -> NO8D-A/B preview` 的工作流。
3. 载入多张图，选择两张运行，确认输出不是重复第一张。
4. 在 Generate 上画 mask，确认绘制不卡死且能运行局部重绘。
5. 切换 ComfyUI 语言或 localStorage 语言配置后刷新页面，确认节点标签正确。

## Git 注意事项

- 不提交本地配置目录 `config/`。
- 不提交 API key、缓存、日志和临时文件。
- `node.zip` 是本地压缩包，不应作为源码提交，除非明确需要发布压缩包。
