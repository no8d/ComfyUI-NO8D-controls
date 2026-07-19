# Changelog

All notable changes to ComfyUI-NO8D-controls will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.3] - 2026-07-19

### Changed

- Added light and full Patreon project-support links before and after the node overview in both English and Chinese documentation.

## [1.1.2] - 2026-07-19

### Changed

- Made `NO8D-Load-images` automatically select the first image in each newly imported file-picker, drag-and-drop, or clipboard batch.

## [1.1.1] - 2026-07-19

### Changed

- Moved the `NO8D-Krea2 Style Selector` section to the beginning of the node overview in both English and Chinese documentation.

## [1.1.0] - 2026-07-19

### Added

- Added `NO8D-Krea2 Style Selector` with 285 visual style presets grouped into four categories, localized display names, keyboard and mouse paging, and canonical English prompt output.
- Added `NO8D Image Grid` with autogrow image inputs, horizontal, vertical, and grid layouts, crop alignment, spacing, and background controls.
- Added `NO8D Image Title` with per-image batch titles, outside, inside, and center positions, bar opacity and height, typography, color, and alignment controls.

### Changed

- Unified NO8D custom-node controls around a shared blue-accent UI theme and expanded English and Chinese node-title and widget localization.

## [1.0.11] - 2026-07-17

### Changed

- Replaced the bundled example with the latest default NO8D-controls workflow while removing local save paths and private LoRA references from the public file.

## [1.0.10] - 2026-07-17

### Changed

- Moved the fixed-prompt field from `NO8D-Prompt` to `NO8D-Prompt-view`, where it is prepended whenever text is emitted; connected legacy workflows migrate the saved value automatically.
- Expanded the default weight range for new `NO8D-LoRA stack` entries from `-1..1` to `-2..2`.

### Fixed

- Prevented `NO8D-Prompt-view` from duplicating a fixed prefix across auto, edit, and Send flows while keeping cache signatures and visible editor text consistent.
- Kept localized Prompt combo options compatible with mutable and function-backed ComfyUI option sources, including bilingual rule, length, and output-language values.

## [1.0.9] - 2026-07-15

### Fixed

- Removed the A/B preview's intermediate composite canvas so full-resolution images draw directly onto the node canvas, preventing black previews with large source images.

## [1.0.8] - 2026-07-15

### Changed

- Changed `NO8D-Load-images` to output only explicitly selected thumbnails: selecting all outputs all images, while selecting none returns an empty list; removed the per-image eye enable/disable control.

### Fixed

- Removed the A/B preview's 1024-pixel source downsampling so the comparison canvas always renders from the full-resolution images returned by ComfyUI.

## [1.0.7] - 2026-07-14

### Added

- Added an `image_a` output and an auto-output switch to `NO8D-A/B preview`; disabling the switch blocks only the connected downstream branch while keeping comparison previews active.
- Added original image-dimension badges for both sides of `NO8D-A/B preview`, with automatic spacing for the list page badge.
- Added clipboard image paste support to `NO8D-Load-images`; focus the preview and press `Ctrl+V` to append copied images through ComfyUI's standard upload flow.
- Added a persistent eye badge to every `NO8D-Load-images` thumbnail so individual images can be excluded from node output without removing them.
- Changed `NO8D-Load-images` thumbnail double-click from queueing a single-image run to opening the original image through ComfyUI's native `/view` endpoint.

### Fixed

- Allowed active Generate brush, eraser, and lasso strokes to continue beyond the image and node bounds through ComfyUI's captured custom-widget drag, while still requiring strokes to start inside the image; off-canvas geometry is clipped when calculating feather size so distant pointer movement cannot inflate the visible feather region.
- Kept the A/B preview auto-output switch above the flexible comparison canvas even when ComfyUI creates the native switch widget after the custom preview widget.
- Moved A/B image dimensions into a dedicated footer so resolution labels never cover comparison image content.
- Made every Generate execution publish its own ComfyUI-native internal `PreviewImage`, restricted canvas updates to execution events whose `display_node` is the Generate node, and removed downstream preview traversal so resized, cropped, comparison, or multi-output images cannot randomly replace the mask canvas; pointer and overlay mapping now use the fixed mask-base dimensions.
- Restricted Generate inpaint activation to actual canvas mask content; selecting a brush, lasso, or eraser alone no longer uploads an empty mask or changes normal generation into inpainting.
- Kept the original base image fixed for the lifetime of a Generate mask session: execution results now update only the visible preview and no longer become the next inpaint base, allowing repeated seeds to produce candidates from identical inputs and fixed seeds to remain deterministic/cacheable.
- Split Generate mask visualization from execution strength: the canvas retains a clear 100% core/50% feather-ring diagnostic overlay, while the uploaded sampling/compositing mask now uses a 32-level linear 1-to-0 falloff; core extraction uses a 0.99 native threshold so `VAEEncodeForInpaint` does not clear the feather region.
- Strengthened native inpainting without switching to an empty latent by blending the regular VAE-encoded image with a core-cleared `VAEEncodeForInpaint` latent; original-latent retention now scales smoothly from 100% at denoise 0 to 30% at denoise 1, while the gradient execution mask remains authoritative for sampling and compositing.
- Made Generate numeric fields select their complete value when clicked or focused, including seed, sampling parameters, brush size, feather, and mask opacity editors.
- Updated Generate mask editor presets to 30/60/90% feather and 20/40/60% preview opacity while retaining the full manual slider ranges.
- Grouped connected brush and eraser strokes into independent painted regions and based feather width on each region's short side, so repeatedly painted large areas no longer retain a feather ring limited to one brush radius; outer-mask construction now expands painted strokes and contracts erased strokes to preserve the 50% transition on both operations.
- Based lasso feather width on the selection's own short-side size instead of the unrelated brush size, making 100% feather extend outward by half of the lasso's short side.
- Kept Generate feather geometry anchored to the original stroke path: brush/eraser feathering now changes only stroke width, and lasso feathering expands only its boundary instead of scaling the entire shape around its bounding-box center.
- Changed Generate mask feathering from a gradual falloff to a uniform 50% mask-strength ring around the 100% core, keeping canvas preview and the uploaded execution mask identical.
- Replaced the nine fixed Prompt style presets with four evidence-driven umbrella categories—realistic photography, anime illustration, hand-drawn art, and digital art—so the model selects and describes the best-supported subtype from the image or text, with legacy workflow migration.
- Constrained automatic style inference to the same four umbrella categories and added a final specificity audit so vague style labels cannot substitute for an evidence-based subtype.
- Added a mandatory image-output contract for camera elevation/view direction, camera-to-subject front/side/rear relationship, viewer-relative subject placement and depth, lens perspective, and multi-subject left/right and front/back arrangement.
- Extended the camera-to-subject output contract to every text expansion and non-photographic style, using an intentionally designed virtual viewpoint when no reference image is available.
- Added a single-request structured visual-analysis envelope for natural prompts, requiring normalized subject placement, evidence-based camera elevation, lens perspective, and multi-subject depth layout before the model writes the final paragraph; the node strips the worksheet and outputs only the prompt.
- Versioned the prompt pipeline in ComfyUI's change signature so rule updates invalidate previously cached node results.
- Expanded structured composition analysis from a single subject anchor to key-part anchors, dominant axis, visible extent, frame occupancy, and per-secondary-subject coordinates, preventing diagonal/full-body layouts from collapsing into false centered medium shots.
- Prevented visual reverse prompting from guessing named character identities from costume colors alone.
- Upscaled small vision inputs to a 768-pixel long edge and capped image-analysis temperature at 0.1 for more stable spatial evidence extraction.
- Replaced model-authored camera prose with deterministic natural-language rendering from structured key anchors, visible body extent, camera direction, lens class, frame occupancy, and secondary-subject coordinates, so contradictory labels such as full-body `medium shot` or diagonal `centered` framing cannot survive downstream.
- Added separate Text model and Vision model selectors to the Prompt API manager. Existing `*-Thinking` text-model configurations migrate image prompting to an available sibling `*-Instruct` model while preserving the selected text model.
- Stopped retrying an identical request after a read timeout, avoiding two consecutive 120-second waits for slow Thinking-model responses.
- Resized oversized inpaint canvas images and soft masks to the incoming latent's native image dimensions with ComfyUI `ImageScale`, `MaskToImage`, and `ImageToMask` nodes before VAE encoding, preventing 2x decode VAEs from making inpaint sampling operate on four times the intended image area.
- Kept manually entered `NO8D-Prompt-view` text when running the workflow with an empty upstream value, including when ComfyUI's execution callback temporarily supplies an empty array before the actual display result.
- Defined explicit `NO8D-Prompt-view` display/output rules: non-empty upstream text always refreshes the editor, empty upstream preserves the editor, auto only controls normal downstream output, and Send always emits the editor text.
- Preserved detected camera elevation, viewing direction, lens perspective, camera roll, and perspective strength during image reverse prompting instead of normalizing unusual low-angle or ultra-wide references to conventional framing.
- Removed upward-angle prompt anchoring by replacing low-angle-heavy examples with a mutually exclusive, evidence-based downward/level/upward classification and a final contradiction check.
- Added explicit camera-to-subject azimuth, optical-axis direction, subject orientation, and viewer-relative frame placement analysis for both human and non-human subjects, with safeguards against left/right coordinate confusion.
- Aligned prompt length caps with open-source Krea 2 ranges: 256 output tokens for Standard and 512 for Detailed, while placing essential subject and spatial relationships first.
- Made automatic shot-scale inference reproduce the connected image's observed framing while keeping manual shot-scale overrides independent from the other camera geometry properties.
- Made `NO8D-Generate` enter inpaint mode only while its serialized mask is active, preventing cleared or legacy mask filenames from silently triggering another inpaint pass.
- Persisted editable mask strokes and inversion state so saved workflows restore the same visible mask instead of retaining hidden server-side mask files.
- Invalidated stale mask/base-image uploads after clear, preview replacement, newer edits, or node removal so older asynchronous work cannot overwrite current canvas state.
- Reused identical Generate base/mask uploads through content-addressed filenames without deleting assets that queued prompts or saved workflows may still reference.
- Made inpaint activation automatic only while the canvas retains mask content; selecting a mask tool alone keeps normal generation active.
- Preserved grayscale feathering through the native `VAEEncode` and `SetLatentNoiseMask` path so `DifferentialDiffusion` receives the soft mask instead of a rounded binary mask.
- Removed the Generate seed-control queue-hook override and delegated randomize/fixed timing entirely to ComfyUI's native `control_after_generate` widget.
- Separated Prompt-view's displayed upstream result from its serialized manual draft so an execution callback no longer causes one unnecessary downstream cache miss.
- Added a minimal internal packed-RGB normalizer so Krea2/Wan VAE 12-channel decoded output reaches native ComfyUI preview/compositing as a standard RGB `IMAGE`.
- Resolved Generate-owned preview events directly through ComfyUI display-node IDs and nested subgraph paths.

## [1.0.6] - 2026-07-10

### Fixed

- Matched custom DOM widget bypass/never/ghost visuals to ComfyUI's native node-mode opacity and bypass color rules.
- Synchronized bypass styling for `NO8D-Generate`, `NO8D-Load-images`, `NO8D-LoRA stack`, `NO8D-Prompt`, `NO8D-Prompt-view`, and `NO8D save` custom controls.
- Marked `NO8D-Generate` internal decode adapter nodes as deprecated/internal and hid them from frontend node registration/search.
- Reduced persistent LoRA stack backend memory retention by avoiding long-lived loaded-LoRA state caches on the node instance.

## [1.0.5] - 2026-07-10

### Fixed

- Kept `NO8D-Generate` as an output-capable node so it can still run standalone with its own preview for mask painting.
- Skipped the internal `PreviewImage` expansion only when the image output already reaches a downstream preview/save node, avoiding duplicate preview work while preserving standalone preview behavior.
- Avoided retaining unconnected `NO8D-Generate` image/latent/mask outputs, reducing GPU tensor retention when only the built-in canvas preview is needed.
- Split the normal decode adapter path so non-inpaint generations no longer allocate an unused full-size mask tensor.
- Reduced Generate and A/B preview display-cache size to lower browser GPU/shared-memory pressure.
- Kept the `NO8D-Generate` canvas preview synchronized by accepting preview images emitted from downstream preview/output nodes.

## [1.0.3] - 2026-07-10

### Fixed

- Fixed `NO8D-Prompt-view` clearing manually edited prompt text when an auto-output run received an empty upstream text value.
- Made prompt view UI refresh use the actual displayed/output text instead of always mirroring the upstream input.

## [1.0.2] - 2026-07-10

### Fixed

- Reduced frontend preview memory retention in `NO8D-Generate` by releasing stale image, canvas, mask overlay, editor, and timer resources when previews are replaced or nodes are removed.
- Reduced persistent mask preview memory by keeping only display-sized overlay canvases while preserving full-resolution mask export.
- Added cleanup for `NO8D-A/B preview` images, native preview references, and render caches when nodes are removed.

## [1.0.1] - 2026-07-09

### Fixed

- Fixed `NO8D-Prompt-view` returning an empty string when the visible prompt text was used as downstream output in auto mode.

## [1.0.0] - 2026-07-08

### Added

- Initial public GitHub release preparation.
- `NO8D-LoRA stack` for ordered LoRA loading and weight control.
- `NO8D-Generate` for native KSampler generation and canvas mask editing.
- `NO8D-A/B preview` for session-based image comparison.
- Chinese and English interface text.
