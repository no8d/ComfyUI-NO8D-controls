# Changelog

All notable changes to ComfyUI-NO8D-controls will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
