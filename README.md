# ComfyUI-NO8D-controls

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-NO8D%2FComfyUI--NO8D--controls-181717?logo=github)](https://github.com/no8d/ComfyUI-NO8D-controls)

English | [简体中文](./README.zh-CN.md)

ComfyUI-NO8D-controls is a ComfyUI custom node pack for practical image iteration. It combines LoRA stacking, prompt expansion, image loading, generation with mask painting, A/B preview, empty latent creation, and image-text dataset saving.

The project follows a native-first rule: use ComfyUI's built-in node execution, image preview, queue behavior, and graph expansion wherever possible. Custom frontend code is only used where the node needs a compact workflow-specific UI.

![ComfyUI-NO8D-controls](docs/images/no8d-control-banner-readme.jpg)

## Nodes

All nodes are registered under the `NO8D-control` or `NO8D-controls` category.

- `NO8D-LoRA stack`
- `NO8D-Prompt`
- `NO8D-Prompt-view`
- `NO8D-Load-images`
- `NO8D-Generate`
- `NO8D-A/B preview`
- `NO8D save`
- `NO8D-Empty latent`

## Installation

Clone the repository into `ComfyUI/custom_nodes`:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/no8d/ComfyUI-NO8D-controls.git
```

Restart ComfyUI after installation and hard-refresh the browser page. No frontend build step is required.

## Typical workflow

```text
Checkpoint Loader
  MODEL -> NO8D-LoRA stack -> NO8D-Generate -> IMAGE
  CLIP  -> prompt encoder chain      -> NO8D-Generate
  VAE   ----------------------------> NO8D-Generate
  latent ---------------------------> NO8D-Generate

NO8D-Generate -> NO8D-A/B preview
NO8D-Load-images -> NO8D-Prompt -> NO8D-Prompt-view / NO8D save
```

An example ComfyUI workflow is included at [examples/NO8D-controls-example.json](examples/NO8D-controls-example.json).

The example keeps the node layout and connections, but local image selections, private LoRA paths, temporary previews, and local save paths are removed so it can be shared safely. Load your own images and LoRAs after importing it.

## Node behavior

### NO8D-LoRA stack

Applies multiple LoRAs to a model without requiring a CLIP input.

![NO8D-LoRA stack](docs/images/stack-node-readme.jpg)

- Add, delete, enable, disable, and reorder LoRAs in one node.
- Adjust LoRA strength with a slider or a number box.
- Customize each slider's minimum and maximum value.
- Add trigger words per LoRA. Enabled non-zero LoRAs output their trigger words as a merged text string.
- Keyboard stepping follows ComfyUI-like behavior: arrow keys use small steps; Shift + arrow keys use larger steps.

### NO8D-Prompt

Expands short ideas, image references, or both into a complete positive prompt through the configured prompt API.

![NO8D-Prompt](docs/images/prompt-plus-node.png)

Input modes:

- Text only: use `输入文本 / Input text` as the user's idea and expand it into a structured image prompt.
- Image only: infer a usable prompt from the connected image.
- Text + image: treat the text as the user's intent and use the image as visual reference. The text has priority when there is a conflict.

`固定提示词 / Fixed prompt` is used for fixed prefixes such as LoRA trigger words. It is prepended to the generated prompt.

### NO8D-Prompt-view

Displays prompt text, allows manual editing, and can send the edited text downstream without rebuilding the whole workflow manually.

![NO8D-Prompt-view](docs/images/prompt-view-node.png)

### NO8D-Load-images

Loads one or many local images into the workflow.

![NO8D-Load-images](docs/images/load-images-node.png)

- Drag files into the node or use the folder button.
- Select one or multiple images.
- Drag thumbnails to reorder them.
- Double-click a thumbnail to run only that image.
- If images are selected, queueing the workflow outputs the selected images. If nothing is selected, queueing outputs all loaded images.
- Outputs images as a ComfyUI list so downstream nodes can process one image at a time.

### NO8D-Generate

Wraps ComfyUI sampling into a compact generation node with an editable image/mask preview.

![NO8D-Generate](docs/images/generate-node.png)

- Controls sampler, scheduler, steps, CFG, denoise, and seed.
- Supports lock/randomize seed behavior.
- Supports brush, lasso, eraser, mask feather, opacity, color, invert, and clear.
- Uses ComfyUI graph expansion internally, so list inputs can execute one image after another.
- Keeps native-style image state for right-click image actions where possible.

### NO8D-A/B preview

Compares two image streams.

![NO8D-A/B preview](docs/images/ab-preview-node.png)

- `image_a` is shown on the left.
- `image_b` is shown on the right.
- If only one side is connected, the missing side uses the previous image from the same stream. On the first run, the missing side is blank.
- When a list of images is received, the page badge can be clicked to cycle through comparisons.

### NO8D save

Saves image/caption datasets with configurable filename parts.

![NO8D save](docs/images/save-node.png)

- Supports fixed text, original filename, datetime, and size-class naming parts.
- Reorder naming parts by dragging.
- Saves captions together with generated or loaded images.

### NO8D-Empty latent

Creates empty latents for common model families and aspect ratios.

![NO8D-Empty latent](docs/images/empty-latent-node-readme.jpg)

- Supports SD/SDXL, SD3/Flux/Krea2, and Flux2 sizing presets.
- Supports common portrait ratios and inverted landscape ratios.
- Can output calculated width and height together with the latent.

## Prompt API configuration

The prompt nodes use an OpenAI-compatible or local LLM-compatible prompt API managed by the NO8D prompt settings UI.

Use the Prompt settings panel to:

- configure API services;
- validate available models;
- select the default prompt API;
- edit prompt writing rules.

API keys and local configuration are stored in the local ComfyUI environment. Do not commit private API keys.

## Language adaptation

The frontend detects ComfyUI language from available settings, local storage, document language, and visible ComfyUI UI text. The supported languages are English and Simplified Chinese.

The node UI initializes labels on startup and refreshes labels on browser `storage` and `languagechange` events. It no longer uses periodic language polling.

## Development notes

- Python nodes expose ComfyUI-compatible node classes through `NODE_CLASS_MAPPINGS`.
- Frontend extensions live in `web/` and are loaded by ComfyUI through `WEB_DIRECTORY = "./web"`.
- `NO8D-Generate` expands to native ComfyUI sampling/decoding nodes through `GraphBuilder`.
- `NO8D-Load-images` and `NO8D-Generate` are designed around ComfyUI list execution rather than manual batch loops.
- Keep custom UI small and prefer native ComfyUI behavior for queueing, previews, right-click menus, and graph execution.

## Validation

Recommended checks before publishing:

```bash
python -m py_compile __init__.py compare_slider_preview.py empty_latent.py generate.py image_loader.py prompt_config.py prompt_plus.py prompt_server.py save_image_text_dataset.py slider_lora_stack.py
node --check web/*.js
git diff --check
```

## License

MIT. See [LICENSE](./LICENSE).
