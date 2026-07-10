# Changelog

All notable changes to ComfyUI-NO8D-controls will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
