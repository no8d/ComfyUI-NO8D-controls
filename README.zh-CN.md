# ComfyUI-NO8D-control

[English](./README.md) | 简体中文

ComfyUI-NO8D-control 是一套面向 ComfyUI 的 LoRA 控制、局部重绘和 A/B 图片对比节点组。

它适用于普通 LoRA 和 Slider LoRA 工作流，目标是让用户更直观地观察 LoRA、权重、遮罩、seed 和局部编辑参数对同一张图像的影响。

![ComfyUI-NO8D-control 工作流总览](docs/images/workflow-overview.svg)

节点组包含三个节点：

- `NO8D-LoRA stack`
- `NO8D-Inpainting`
- `NO8D-A/B preview`

三个节点位于 ComfyUI 的 `NO8D-control` 分类中。

## 安装

进入 ComfyUI 的 `custom_nodes` 目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/NO8D/ComfyUI-NO8D-control.git
```

安装后重启 ComfyUI，并强制刷新浏览器页面。

本节点组使用 ComfyUI 已有的 Python 与前端环境，不需要单独构建前端。

## 基本工作流

```text
Checkpoint Loader: MODEL
          │
          ▼
NO8D-LoRA stack
          │ MODEL
          ▼
NO8D-Inpainting ── IMAGE ──► NO8D-A/B preview
```

同时将工作流中的 `positive`、`negative`、`VAE` 和 `LATENT` 连接到 `NO8D-Inpainting`。

不需要 LoRA 时，可以直接把原始 `MODEL` 连接到 `NO8D-Inpainting`。

## 节点介绍

### NO8D-LoRA stack

`NO8D-LoRA stack` 只负责 LoRA 加载和 LoRA 权重控制。

![NO8D-LoRA stack 示意图](docs/images/stack-node.svg)

功能：

- 添加多个 LoRA。
- 按列表顺序应用 LoRA。
- 通过滑条或数字框调节权重。
- 为每个 LoRA 设置自定义最小值和最大值。
- 临时启用或关闭单个 LoRA。
- 一键反选所有 LoRA 的启用状态。
- 拖动排序手柄调整应用顺序。
- LoRA 设置区采用手风琴结构，同一时间最多展开一个。

禁用、选择 `None` 或权重为 `0` 的条目不会加载。已加载的 LoRA 文件会在当前节点实例中缓存；从列表移除后，对应缓存也会释放。

本节点同时支持普通 LoRA 和 Slider LoRA。NO8D 训练并发布了大量 Slider LoRA，可以在这里获取：

[huggingface.co/NO8D](https://huggingface.co/NO8D)

这些 Slider LoRA 很适合配合 `NO8D-LoRA stack` 快速探索权重变化。

### NO8D-Inpainting

`NO8D-Inpainting` 负责采样、图像预览、遮罩绘制和连续局部编辑。

它本身不加载 LoRA。LoRA 变化应来自上游的 `NO8D-LoRA stack` 或其它 ComfyUI 模型节点。

![NO8D-Inpainting 示意图](docs/images/inpainting-node.svg)

采样控制：

- Sampler 与 Scheduler
- Steps
- CFG
- Seed 锁定/随机
- Denoise

遮罩工具：

- 画笔
- 套索
- 画笔大小
- 羽化大小
- 遮罩颜色
- 降噪强度
- 反转遮罩
- 清除遮罩

默认值：

| 项目 | 默认值 |
|---|---:|
| 画笔显示尺寸 | `10` |
| 羽化 | `30` |
| 遮罩颜色 | `#66ccff` |
| 未激活遮罩时 Denoise | `1.0` |
| 激活遮罩后 Denoise | `0.75` |

锁定 seed 只表示随机源保持不变。输入图像、LoRA、遮罩或采样参数发生变化时，ComfyUI 仍需要重新采样；所有相关内容不变时，节点会复用当前编辑结果，避免无意义的重复 GPU 运算。

连续编辑逻辑：

```text
A
└─ 眼睛遮罩 + 眼睛 LoRA → B
   └─ 清除遮罩，接受 B
      └─ 耳朵遮罩 + 耳朵 LoRA → C
```

“清除遮罩”表示接受当前结果，并把它作为下一轮编辑的底图。因此 C 会在 B 的基础上修改耳朵，而不是回到原始 A。

在清除遮罩之前，更改 LoRA 权重会始终基于同一个 base 重新计算当前遮罩区域，不会把权重 `2` 隐式叠加在权重 `1` 的结果上。

历史图最多显示 8 张，并使用 ComfyUI 的预览引用，不会在节点目录中保存永久图片。

### NO8D-A/B preview

`NO8D-A/B preview` 用于快速比较当前图像与上一张或选中的历史图像。

![NO8D-A/B preview 示意图](docs/images/ab-preview-node.svg)

功能：

- 拖动中间分割线查看差异。
- 交换 A/B 两侧图像。
- 保留最多 8 张当前会话历史图。
- 历史图居中排列。
- 使用 ComfyUI 临时预览图片，不自动写入永久输出目录。

## 与 ComfyUI 的交互边界

本节点组尽量让自定义行为保持在最小范围内，把 ComfyUI 已有能力交还给 ComfyUI。

- 不覆盖 ComfyUI 的全局队列或画布方法。
- 空格拖动画布、滚轮、右键菜单和全局快捷键尽量交还 ComfyUI。
- `NO8D-Inpainting` 只有在遮罩工具激活，且用户在预览窗口绘制遮罩时才接管鼠标输入。
- `NO8D-LoRA stack` 只在按钮、滑条、输入框和排序手柄等真实控件上接管交互。
- 输入框聚焦时，`Ctrl/Cmd + Enter` 仍可触发 ComfyUI 运行。

## 注意事项

- LoRA 权重对模型差值的调节是线性的，但扩散采样和最终视觉变化不保证线性。
- 当前编辑状态保存在运行中的节点实例内，重启 ComfyUI 后不会保留内存中的 base/edited 历史。
- `NO8D-A/B preview` 只保留当前会话中的临时历史图。
- 后端节点 ID 已保持稳定，避免影响已有工作流。

## 截图

当前 README 使用保存在 `docs/images/` 中的轻量 SVG 示意图。之后如果需要替换成真实 ComfyUI 截图，也可以把图片放在同一目录，并用标准 Markdown 图片语法引用。

## 反馈

NO8D 并不是专业的软件开发者。本节点组是在 Codex 的帮助下，通过实际使用、反复调试和多轮 ComfyUI 实机测试逐步完成的。

如果你在使用中遇到 bug、行为不清晰、兼容问题，或者任何觉得不对劲的地方，欢迎告诉 NO8D。能够复现的问题描述、截图或工作流会非常有帮助。

欢迎通过 [GitHub Issues](https://github.com/NO8D/ComfyUI-NO8D-control/issues) 提交可复现的问题和功能建议。参与代码贡献前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 鸣谢

感谢 [ComfyUI](https://github.com/comfyanonymous/ComfyUI) 及其社区提供的节点系统、采样、预览和扩展机制。本节点组建立在这些原生能力之上。

`NO8D-Inpainting` 的早期构思和开发受到 [shootthesound/ComfyUI-Angelo](https://github.com/shootthesound/ComfyUI-Angelo) 的启发，感谢原作者带来的思路与参考。

感谢 Patreon 社区成员 **Wylmquest** 在开发过程中提出建议，帮助节点组持续改进。

欢迎加入 [NO8D 的 Patreon 社区](https://patreon.com/no8d?utm_medium=unknown&utm_source=join_link&utm_campaign=creatorshare_creator&utm_content=copyLink)，支持开发、反馈问题、提出建议，或交流 LoRA 控制和局部重绘工作流。

## 许可证

本项目采用 [MIT License](./LICENSE)。
