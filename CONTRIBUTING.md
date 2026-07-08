# Contributing

Thanks for helping improve ComfyUI-NO8D-controls.

## Before opening a pull request

1. Keep node responsibilities separate: Stack owns LoRA loading, Generate owns sampling and masks, and A/B preview owns comparison.
2. Prefer ComfyUI native APIs and behavior over custom replacements.
3. Avoid unrelated refactors and duplicated event logic.
4. Run the validation commands below.

## Validation

```powershell
python -m py_compile __init__.py compare_slider_preview.py generate.py slider_lora_stack.py
node --check web/no8d_comfy_events.js
node --check web/no8d_i18n.js
node --check web/compare_slider_preview.js
node --check web/generate.js
node --check web/slider_lora_stack.js
```

Please include your ComfyUI version, browser, operating system, reproduction steps, and screenshots when reporting UI problems.
