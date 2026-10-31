# Nodes 2.0 compatibility

Nodes 2.0 takes priority when its rendering contract differs from the classic canvas.
The implementation uses ComfyUI's native DOM widgets and legacy canvas bridge;
it does not modify ComfyUI core or require a separate Vue build.

## Implementation

- Generate, comparison and image-size widgets explicitly redraw through `triggerDraw`.
- Canvas drawing uses layout pixels rather than zoomed screen pixels, with an explicit CSS height.
- Pointer down, drag and release use the actual widget canvas coordinates.
- Generate hover, resize cursors and floating editors use the Vue widget canvas.
- Generate redraw traverses nested subgraphs.
- Image-size source previews restore from workflow properties or cached node outputs.
- Bypass styles follow the native mode setter, retaining the original tracked setter.
- The Prompt View send button is excluded from workflow widget values.

Canvas rows follow ComfyUI's native Vue widget grid. Generate's sampler panel uses the native content-sized contract so the canvas receives surplus height. A ResizeObserver requests redraws after height-only changes. Drawing measures the allocated row without writing its height or overriding grid CSS. Finite intrinsic canvas sizes prevent legacy measurement feedback; they do not fix the rendered Vue row height. Classic mode retains its flexible layout.

## Verification

Target frontend: **1.55.18**. This is a tested version, not a claim that every
past or future frontend release has been verified.

Automated checks:

```text
python -m unittest discover -s tests -p "test_*.py" -q
node --test tests/nodes2_widgets.test.mjs
node tests/generate_nodes2.test.mjs
node --check <each web JavaScript file>
git diff --check
```

Live checks include the public-node UI inventory, image import, style-library
paging, adding a LoRA row, compositor image import/save/reopen, prompt text/seed
save/reload, Generate transform editor/cursor/brush, image-size mode switching,
and comparison resizing. A real image workflow runs LoadImage → Image Size →
A/B Preview / Image Title → PreviewImage. Repeated executions succeed, and a
horizontal crop drag preserves the vertical coordinate.

The checks do not exercise paid prompt APIs or model sampling. Those backend
operations are outside this frontend compatibility change. Existing frontend
`Unknown message type assets.seed.*` messages originate in ComfyUI's asset
protocol and are tracked separately from NO8D compatibility errors.
The installed KJNodes also reports that its optional PatchTritonVAE cannot load
without Triton. No dependencies or code belonging to that extension were changed.

Latest height regression: A/B node 670 to 960 layout pixels; preview row 522 to
812 pixels, backing canvas 1044 to 1624 pixels. Generate and Image Size were also
checked growing and shrinking. Zoom changes preserve layout coordinates.

A connected local workflow additionally verifies image grid, title, prompt merge/view,
PNG plus caption/metadata saving, compositor output, and empty latent saving.
The saved image is 664 x 272 and its caption matches both connected source strings.
Python regression coverage: 307 tests. Canvas regression coverage: 9 tests.

## GitHub integration check - 2026-10-31

The live checks above are prior recorded checks, not a new UI acceptance run.
This integration passed 328 Python tests using the Desktop Python environment
and 18 Node.js test entries. Live model sampling and a new Desktop UI pass
were not performed during this GitHub synchronization.
