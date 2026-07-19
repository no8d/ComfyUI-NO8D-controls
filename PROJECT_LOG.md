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
  - 节点：英文 `NO8D-LoRA stack`，中文 `NO8D-LoRA 堆栈`
  - 功能：多 LoRA 堆叠、排序、启用/关闭、权重范围、触发词输出。

- `prompt_plus.py` + `web/prompt_plus_i18n.js` + `web/prompt_view.js`
  - 节点：英文 `NO8D-Prompt` / `NO8D-Prompt-view`，中文 `NO8D-提示词` / `NO8D-提示词预览`
  - 功能：文本扩写、图像反推、文本 + 图像融合、固定提示词前缀、提示词预览与发送。

- `image_loader.py` + `web/image_loader_i18n.js`
  - 节点：英文 `NO8D-Load-images`，中文 `NO8D-图像载入`
  - 功能：多图载入、缩略图选择、拖动排序、仅选中图输出、未选中时不输出、list 输出。

- `generate.py` + `web/generate.js`
  - 节点：英文 `NO8D-Generate`，中文 `NO8D-生成`
  - 功能：采样参数面板、图像预览、遮罩绘制、局部重绘、list 输入执行。
  - 输出：仅输出最终图像；不再输出 latent/mask，避免局部重绘后 image-space composite 与 latent 输出语义不一致。
  - 遮罩：执行完成后只更新可见预览并保留当前遮罩，不回写本次遮罩会话的 `base_image_file`；同一遮罩下每次都从固定原底图生成候选。清空遮罩并重新绘制时，才以当前预览建立新的底图会话。
  - 遮罩持久化：工作流保存笔画、反转和底图坐标；重载后可恢复可见且可继续编辑的遮罩。旧版仅保存文件名但没有笔画的数据会按无遮罩处理，避免隐藏重绘。
  - 异步一致性：清除、替换预览、继续绘制或删除节点时使旧上传任务失效，旧任务不得回写当前遮罩状态。
  - 遮罩坐标：开始绘制时固定 `mask_base_width/height`，后续即使生成结果替换预览图，保留的遮罩仍按原底图坐标显示和提交，避免后台运行完成后遮罩漂移。
  - 越界绘制：笔迹必须从图像内开始；按住指针后由 ComfyUI `CanvasPointer` 持续路由拖动，画笔、橡皮擦和套索可越过图像及节点边界，最终遮罩按底图边界自然裁切。羽化尺寸只统计画布内可见包围范围，避免远距离越界移动放大羽化。
  - 预览归属：每次执行都由展开图中的 ComfyUI 原生 `PreviewImage` 发布本节点最终图像，前端仅接受 `display_node` 属于当前 Generate 节点的事件；不再从下游保存、缩放、裁切、对比或多输出节点反向借用图片。鼠标输入与遮罩覆盖层统一按固定底图尺寸换算。
  - 羽化：画布仅作区域观察，保持清晰的 100% 实心区、统一 50% 羽化环和 0% 外部显示；后台执行遮罩独立生成 32 级线性 `1 → 0` 渐变，并用于 `SetLatentNoiseMask`、`DifferentialDiffusion` 和最终合成。外圈保持笔迹坐标不变；套索按自身包围盒短边计算，相连的画笔或橡皮笔迹按各自绘制区域的包围盒短边计算，不相连区域及不同工具互不影响。100% 时宽度等于对应区域短边的一半；外围层对添加笔迹向外扩张、对橡皮笔迹向内收缩。
  - 重绘激活：仅在画布存在遮罩内容时自动启用；单纯选择画笔/套索/橡皮工具仍保持普通生成，不设置额外的局部重绘模式下拉框。
  - 软遮罩扩散：使用原生 `VAEEncode + SetLatentNoiseMask + DifferentialDiffusion`，保留上传遮罩的灰度羽化信息；最终继续用同一软遮罩合成。
  - 重绘强度：使用原生 `ThresholdMask(0.99) + VAEEncodeForInpaint + LatentBlend` 将普通底图 latent 与仅清除精确实心区内容的 latent 混合；原图 latent 占比为 `1 - 0.7 × denoise`，因此 denoise 1 时保留 30%、混入 70% 清除 latent。随后由 `SetLatentNoiseMask` 覆盖回连续渐变执行遮罩，羽化区不参与内容清除。
  - 重绘分辨率：从输入 latent 的张量形状和 ComfyUI 空间压缩元数据取得原始图像尺寸；2× VAE 画布在编码前通过原生 `ImageScale + MaskToImage + ImageToMask` 缩回该尺寸，采样完成后再用原始软遮罩合成到完整画布，避免四倍面积采样。
  - 解码兼容：局部内部节点只负责把 Krea2/Wan VAE 的 12 通道打包 RGB 解包为标准 ComfyUI `IMAGE`，采样、重绘、预览与合成仍使用原生节点。
  - 上传生命周期：底图和遮罩使用内容寻址文件名复用相同内容；不自动删除仍可能被队列或保存工作流引用的 input 资产。
  - 缓存一致性：Prompt-view 自动回显的上游文本与手动草稿分离，回显不会改写 `edited_text` 并触发下一轮无意义重算。
  - 种子确定性：锁定种子且提示词、遮罩和参数不变时，序列化输入保持完全一致，重复运行应直接命中 ComfyUI 缓存；随机种子可从同一原底图生成不同候选。
  - 后端通过 `GraphBuilder` 展开为 ComfyUI 原生采样、解码和图像合成链路，不再插入自定义解码适配节点。

- `compare_slider_preview.py` + `web/compare_slider_preview.js`
  - 节点：英文 `NO8D-A/B preview`，中文 `NO8D-A/B 对比`
  - 功能：左侧 `image_a`，右侧 `image_b`；单输入时当前图与历史图对比；list 结果分页对比。

- `save_image_text_dataset.py` + `web/save_i18n.js`
  - 节点：英文 `NO8D save`，中文 `NO8D-图文保存`
  - 功能：保存图像与文本，支持可排序命名规则。

- `empty_latent.py` + `web/empty_latent_i18n.js`
  - 节点：英文 `NO8D-Empty latent`，中文 `NO8D-空 latent`
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
- 仅输出明确选中的图像；全选时输出全部图像。
- 没有选中图像时返回空 list，不再回退输出全部图像。
- 每次文件选择、拖拽或粘贴导入后，默认选中本批次第一张图像；追加导入时不误选旧列表首图。
- 双击缩略图只打开原图，不触发工作流或单图输出。
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
- `web/node_titles_i18n.js` 统一处理节点菜单显示名和画布标题，内部 class 名不变，显示名按语言环境切换。
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

- A/B preview 直接把 ComfyUI 返回的原尺寸图像裁剪绘制到节点画布，不再创建 1024 长边降采样缓存或中间合成画布。
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
- 示例工作流放在 `examples/NO8D-controls-example.json`。公开前需要移除本地绝对路径、私有 LoRA 文件、临时预览图和本地图像选择。
