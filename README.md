# ComfyUI-NO8D-controls

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-NO8D%2FComfyUI--NO8D--controls-181717?logo=github)](https://github.com/no8d/ComfyUI-NO8D-controls)

English | [简体中文](./README.zh-CN.md)

This custom node pack provides an end-to-end optimization solution covering the entire workflow from image loading to image generation. It redesigns key nodes for image generation, LoRA stacking, prompt generation, and more to simplify ComfyUI workflow construction, improve generation efficiency across nodes, and significantly lower the barrier to building and using workflows.

![ComfyUI-NO8D-controls](docs/images/no8d-control-banner-readme.jpg)

## Installation

Clone the repository into `ComfyUI/custom_nodes`:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/no8d/ComfyUI-NO8D-controls.git
```

Restart ComfyUI and hard-refresh the browser page. No frontend build step is required.

An example workflow is included at [examples/NO8D-controls-example.json](examples/NO8D-controls-example.json).

## Nodes

All nodes are available under the `NO8D-control` or `NO8D-controls` category.

### NO8D-LoRA stack

Manage multiple LoRAs in one node and apply them to a model without a CLIP input.

![NO8D-LoRA stack](docs/images/stack-node-readme.jpg)

- Add, remove, enable, disable, and reorder LoRAs.
- Adjust strength and custom slider ranges.
- Merge trigger words from enabled LoRAs into one text output.

### NO8D-Prompt

Expand text, analyze a reference image, or combine both into a complete positive prompt through a configured API.

![NO8D-Prompt](docs/images/prompt-plus-node.png)

- Supports text-only, image-only, and text-plus-image input.
- Provides style, shot-scale, prompt-length, and fixed-prefix controls.
- Allows separate text and vision model selection.

### NO8D-Prompt-view

Display and edit prompt text before sending it downstream.

![NO8D-Prompt-view](docs/images/prompt-view-node.png)

- Automatically displays incoming prompt text.
- Supports manual editing and one-click downstream sending.
- Can temporarily stop automatic text output without losing the editor content.

### NO8D-Load-images

Load and organize one or more local images as a ComfyUI list output.

![NO8D-Load-images](docs/images/load-images-node.png)

- Add images by file picker, drag-and-drop, or clipboard paste.
- Select, reorder, and preview individual images.
- Sends only selected images downstream; selecting all outputs all images, while selecting none produces no output.

### NO8D-Generate

Combine ComfyUI sampling controls, image preview, and mask-based inpainting in one compact node.

![NO8D-Generate](docs/images/generate-node.png)

- Controls sampler, scheduler, steps, CFG, denoise, and seed.
- Supports brush, lasso, eraser, feather, opacity, invert, and clear tools.
- Automatically uses inpainting when the canvas contains a mask.
- Outputs the final generated image.

### NO8D-A/B preview

Compare two image streams with an interactive split preview.

![NO8D-A/B preview](docs/images/ab-preview-node.png)

- Displays image A and image B with their original dimensions.
- Supports list-page switching and single-stream history comparison.
- Can pass image A downstream or disable that output branch.

### NO8D save

Save images and matching captions for image-text datasets.

![NO8D save](docs/images/save-node.png)

- Builds filenames from fixed text, source filename, date/time, and size class.
- Supports drag-to-reorder filename parts.
- Saves caption text alongside each image.

### NO8D-Empty latent

Create empty latents using common model-family and aspect-ratio presets.

![NO8D-Empty latent](docs/images/empty-latent-node-readme.jpg)

- Supports SD/SDXL, SD3/Flux/Krea2, and Flux2 presets.
- Provides portrait and landscape aspect ratios.
- Outputs the latent together with its calculated width and height.

## Prompt API configuration

Configure API services, models, and prompt rules from the NO8D prompt settings panel. OpenAI-compatible and local compatible APIs are supported. API keys remain in the local ComfyUI environment and should not be committed.

## License

MIT. See [LICENSE](./LICENSE).
