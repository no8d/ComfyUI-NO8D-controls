# ComfyUI-NO8D-control

[English](./README.md) | 简体中文

![ComfyUI-NO8D-control](docs/images/no8d-control-banner.png)

ComfyUI-NO8D-control 是一套 ComfyUI 自定义节点，为 ComfyUI 图像生成提供更大的可控性和便利性。



## 节点

- `NO8D-LoRA stack`
- `NO8D-Inpainting`
- `NO8D-A/B preview`
- `NO8D-Prompt-plus`
- `NO8D-Batch-Prompt-plus`
- `NO8D-Prompt-view`

## NO8D-LoRA Stack

`NO8D-LoRA stack` 负责 LoRA 加载和 LoRA 权重控制，不需要 CLIP 输入。

![NO8D-LoRA stack 示意图](docs/images/stack-node.png)

功能：

- 在一个节点里添加多个 LoRA。
- 按列表顺序应用 LoRA。
- 通过滑条或数字框调整每个 LoRA 权重。
- 为每个 LoRA 滑条设置自定义最小值和最大值。
- 临时启用或关闭单个 LoRA。
- 一键反选所有 LoRA 的启用状态。
- 通过拖拽手柄调整 LoRA 顺序。



[huggingface.co/NO8D](https://huggingface.co/NO8D)

## NO8D-Inpainting

`NO8D-Inpainting` 集成了 KSampler 风格采样、图像预览、遮罩绘制和有限的局部编辑历史。

![NO8D-Inpainting 示意图](docs/images/inpainting-node.png)

控制项：

- 采样器和调度器
- Steps 和 CFG
- 随机种子锁定或随机
- 画笔和套索遮罩工具
- 画笔大小、羽化、遮罩颜色和降噪强度
- 反转遮罩和清除遮罩
- 会话历史缩略图

清除遮罩表示接受当前编辑结果，并把它作为下一次局部编辑的底图。在清除遮罩之前，修改 LoRA 权重或采样参数会基于同一张底图重新计算当前遮罩区域。

历史记录只保存在当前会话中，并使用 ComfyUI 的预览引用，不会向本仓库写入永久图像。

## NO8D-A/B Preview

`NO8D-A/B preview` 用于比较当前图像与上一张图像，或与选中的会话历史图像进行对比。

![NO8D-A/B preview 示意图](docs/images/ab-preview-node.png)

功能：

- 拖动分割线对比两张图像。
- 交换 A/B 两侧。
- 保留最多 8 张会话历史图像。
- 在当前浏览器会话内恢复最近历史。
- 使用 ComfyUI 临时预览图像，不自动写入永久文件。

## NO8D-Prompt-Plus

`NO8D-Prompt-plus` 使用已配置的 OpenAI-compatible API 生成正向提示词。

![NO8D-Prompt-plus 示意图](docs/images/prompt-plus-node.png)

输入：

- `text`：可选文本输入，用于提示词扩写。
- `image`：可选图像输入，用于图像反推。
- `prompt_rules`：选择撰写规则。
- `seed`：控制生成提示词的变化。
- `extra_rules`：当前节点的附加规则。
- `style_preset`：选择提示词风格。可选项包括业余摄影、专业摄影、影视摄影、日式动漫、美式动漫、插画艺术、油画艺术、3d写实、3d卡通。

节点内部不再提供用户提示词文本框。请使用 `NO8D-Prompt-view`、其他文本节点，或任何兼容的文本输出作为 `text` 输入。

内置规则类型：

- `自然语言`：输出一段流畅的现代英文正向提示词。
- `json结构`：输出可读的结构化英文 JSON。

如果同时连接文本和图像，图像会作为视觉依据，文本会作为用户意图、修正或强调。

图像反推时，节点会先压缩输入图像再发送到 API，以减少请求体积和等待时间。

## NO8D-Batch-Prompt-Plus

`NO8D-Batch-Prompt-plus` 使用同一套提示词规则、风格、长度和 API 设置，对输入的图片批次逐张反推 caption。

输入：

- `images`：图片批次输入。
- `prompt_rules`：选择撰写规则。
- `style_preset`：选择提示词风格。
- `length_preset`：选择标准或详细长度。
- `output_language`：选择返回英文或中文。
- `seed`：控制每张图反推结果的变化。
- `extra_rules`：当前节点的附加规则。

输出：

- `captions`：提示词列表，一张图对应一条 caption。可连接 ComfyUI 自带的 `Save Image-Text (to Folder)` 节点保存图片和同名 `.txt`。
- `combined`：合并后的文本，方便连接 `NO8D-Prompt-view` 或其他文本预览节点查看。

该节点没有文本输入端口，只负责图片批量反推。

## NO8D-Prompt-View

`NO8D-Prompt-view` 用于显示并可选编辑提示词文本。

![NO8D-Prompt-view 示意图](docs/images/prompt-view-node.png)

- `自动输出` 开启：自动显示并传递收到的文本。
- `自动输出` 关闭：阻断后续节点执行，直到点击 `发送`。
- `发送`：只运行下游节点并输出当前编辑后的文本，不重新运行上游扩写节点。

这个节点也可以作为简单的手动文本输入节点使用。

## 提示词 API 设置

提示词 API 设置位于 ComfyUI 设置面板中，不需要在每个节点里重复填写。

打开 ComfyUI 设置，找到 `NO8D-control / Prompt`。

可用设置：

- 规则管理器：编辑内置提示词撰写规则，或新增自定义规则。
- 默认提示词 API：选择默认服务。
- API 管理器：添加、编辑、删除、验证并选择 OpenAI-compatible API 服务。
- 模型列表：验证 API 后，从可搜索的模型列表中选择一个模型。

配置文件保存在 ComfyUI 用户目录：

```text
default/no8d-control/config/prompt_api.json
```

这是本地用户配置，不应提交到仓库。


## 安装

将仓库克隆到 ComfyUI 的 `custom_nodes` 目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/NO8D/ComfyUI-NO8D-control.git
```

安装后重启 ComfyUI，并强制刷新浏览器页面。

本节点组使用 ComfyUI 已有的 Python 和前端扩展环境，不需要额外构建前端。
## 反馈

NO8D 不是专业软件开发者。本节点组是在 Codex 的帮助下，通过实际测试、反复调试和真实 ComfyUI 工作流中的多轮迭代完成的。

欢迎通过 [GitHub Issues](https://github.com/NO8D/ComfyUI-NO8D-control/issues) 提交可复现的问题和功能建议。参与代码贡献前，请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

你也可以通过 [NO8D Patreon 社区](https://patreon.com/no8d?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink) 支持 NO8D，并交流 LoRA 控制、Slider LoRA 和局部重绘工作流。

## 鸣谢

感谢 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 及其社区提供节点系统、采样工具、预览流程和扩展机制。

`NO8D-Inpainting` 的早期想法和方向受到 [shootthesound/ComfyUI-Angelo](https://github.com/shootthesound/ComfyUI-Angelo) 启发，感谢原作者提供的思路。

感谢 Patreon 社区成员 **Wylmquest** 在开发过程中提出建议。

## 许可

本项目使用 [MIT License](./LICENSE)。
