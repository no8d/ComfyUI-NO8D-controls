# Changelog

All notable changes to ComfyUI-NO8D-controls will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.4] - 2026-07-10

### Fixed

- Changed `NO8D-Generate` to behave like native sampler/decode nodes instead of an output node, so it only runs when its outputs feed a real output node such as `PreviewImage`, `NO8D-A/B preview`, or save nodes.
- Removed the internal `PreviewImage` expansion from `NO8D-Generate` to avoid duplicate preview work when native ComfyUI preview/save nodes are already present.
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
