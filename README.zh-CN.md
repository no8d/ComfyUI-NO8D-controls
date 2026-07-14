# ComfyUI-NO8D-controls

[English](./README.md) | 简体中文

一套用于 LoRA 控制、提示词扩写、图像载入、生成与局部重绘、图像对比、空 latent 创建和图文数据集保存的 ComfyUI 自定义节点。

![ComfyUI-NO8D-controls](docs/images/no8d-control-banner-readme.jpg)

## QQ 交流群

欢迎加入 **iAi互助会**，群号：`482570609`。

<p align="center">
  <img src="docs/images/qq-group-482570609.png" alt="iAi互助会 QQ 群二维码" width="360">
</p>

## 安装

把仓库克隆到 ComfyUI 的 `custom_nodes` 目录：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/no8d/ComfyUI-NO8D-controls.git
```

安装后重启 ComfyUI，并在浏览器中强制刷新页面。不需要额外构建前端。

项目内置示例工作流：[examples/NO8D-controls-example.json](examples/NO8D-controls-example.json)。

## 节点说明

所有节点位于 `NO8D-control` 或 `NO8D-controls` 分类。

### NO8D-LoRA 堆栈

在一个节点中管理多个 LoRA，并在不接入 CLIP 的情况下应用到模型。

![NO8D-LoRA 堆栈](docs/images/stack-node-readme.jpg)

- 添加、删除、启用、关闭和排序 LoRA。
- 调整权重及滑条范围。
- 合并已启用 LoRA 的触发词并输出文本。

### NO8D-提示词

通过配置好的 API 扩写文本、反推参考图，或结合文本与图像生成完整正向提示词。

![NO8D-提示词](docs/images/prompt-plus-node.png)

- 支持纯文本、纯图像和文本加图像三种输入。
- 提供风格、景别、提示词长度和固定前缀控制。
- 可分别选择文本模型和图像模型。

### NO8D-提示词预览

在发送到下游节点前显示和编辑提示词。

![NO8D-提示词预览](docs/images/prompt-view-node.png)

- 自动显示上游提示词。
- 支持手动编辑并一键发送到下游。
- 可暂停自动文本输出，同时保留编辑内容。

### NO8D-图像载入

载入并整理一张或多张本地图像，以 ComfyUI list 形式输出。

![NO8D-图像载入](docs/images/load-images-node.png)

- 支持文件选择、拖拽和剪贴板粘贴。
- 可选择、排序、预览、启用或关闭单张图像。
- 通过 list 执行把启用的图像逐张发送到下游。

### NO8D-生成

把 ComfyUI 采样控制、图像预览和遮罩局部重绘整合到一个紧凑节点中。

![NO8D-生成](docs/images/generate-node.png)

- 控制采样器、调度器、步数、CFG、降噪和种子。
- 支持画笔、套索、橡皮擦、羽化、透明度、反转和清除。
- 画布存在遮罩时自动执行局部重绘。
- 输出最终生成图像。

### NO8D-A/B 对比

通过可交互分割预览对比两路图像。

![NO8D-A/B 对比](docs/images/ab-preview-node.png)

- 显示图像 A、图像 B 及其原始尺寸。
- 支持列表翻页和单路图像历史对比。
- 可把图像 A 传递到下游，也可关闭该输出分支。

### NO8D-图文保存

保存图像和对应文本，适合制作图文数据集。

![NO8D-图文保存](docs/images/save-node.png)

- 用固定文本、原文件名、日期时间和尺寸等级组合文件名。
- 支持拖动调整命名部分的顺序。
- 为每张图像同时保存 caption 文本。

### NO8D-空 latent

按常见模型类型和画面比例创建空 latent。

![NO8D-空 latent](docs/images/empty-latent-node-readme.jpg)

- 支持 SD/SDXL、SD3/Flux/Krea2 和 Flux2 预设。
- 提供常用竖图和横图比例。
- 输出 latent 及计算后的宽度和高度。

## 提示词 API

可在 NO8D 提示词设置面板中配置 API 服务、模型和提示词规则，支持 OpenAI 兼容接口和本地兼容接口。API key 仅保存在本地 ComfyUI 环境中，请勿提交到仓库。

## 许可证

MIT。详见 [LICENSE](./LICENSE)。
