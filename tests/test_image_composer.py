from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

import numpy as np
from PIL import Image
import torch


class _Input:
    def __init__(self, input_id, **kwargs):
        self.id = input_id
        for name, value in kwargs.items():
            setattr(self, name, value)


class _Routes:
    def __init__(self):
        self.posts = {}

    def post(self, path):
        def decorate(handler):
            self.posts[path] = handler
            return handler

        return decorate


def _load_module(input_directory):
    class _PreviewImage:
        last_image = None

        def __init__(self, image, **_kwargs):
            type(self).last_image = image

        def as_dict(self):
            return {"images": [{"filename": "preview.png", "subfolder": "", "type": "temp"}]}

    class _NodeOutput:
        def __init__(self, *values, ui=None):
            self.result = values
            self.ui = ui

    io = types.SimpleNamespace(
        ComfyNode=object,
        NodeOutput=_NodeOutput,
        Image=types.SimpleNamespace(Output=_Input),
        Int=types.SimpleNamespace(Output=_Input),
        String=types.SimpleNamespace(Input=_Input),
        Schema=lambda **kwargs: types.SimpleNamespace(**kwargs),
    )
    comfy_api = types.ModuleType("comfy_api")
    versioned = types.ModuleType("comfy_api.v0_0_2")
    versioned.io = io
    versioned.ui = types.SimpleNamespace(PreviewImage=_PreviewImage)
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_input_directory = lambda: str(input_directory)
    aiohttp = types.ModuleType("aiohttp")
    aiohttp.web = types.SimpleNamespace(
        Response=lambda **kwargs: types.SimpleNamespace(**kwargs),
        json_response=lambda data, **kwargs: types.SimpleNamespace(data=data, **kwargs),
    )
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=_Routes()))
    names = ("comfy_api", "comfy_api.v0_0_2", "folder_paths", "aiohttp", "server")
    replacements = (comfy_api, versioned, folder_paths, aiohttp, server)
    previous = {name: sys.modules.get(name) for name in names}
    for name, replacement in zip(names, replacements):
        sys.modules[name] = replacement
    try:
        path = Path(__file__).resolve().parents[1] / "image_composer.py"
        spec = importlib.util.spec_from_file_location("no8d_image_composer_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module._test_preview_class = _PreviewImage
        module._test_routes = server.PromptServer.instance.routes
        return module
    finally:
        for name, old_module in previous.items():
            if old_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_module


def _save(path, color, mode="RGBA"):
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new(mode, (4, 4), color).save(path)


def _ref(filename, subfolder=""):
    return {"filename": filename, "subfolder": subfolder, "type": "input"}


def _layer(source, **overrides):
    layer = {
        "id": "layer-1",
        "name": "Layer 1",
        "source": source,
        "x": 4,
        "y": 4,
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "blend_mode": "normal",
        "visible": True,
    }
    layer.update(overrides)
    return layer


class ImageComposerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.input_directory = Path(self.temporary.name)
        self.composer = _load_module(self.input_directory)

    def tearDown(self):
        self.temporary.cleanup()

    def compose(self, *layers, ratio="1:1", short_side=8):
        return self.composer.compose_project(
            {"ratio": ratio, "short_side": short_side, "layers": list(layers)}
        )

    def test_canvas_size_uses_ratio_short_side_and_aligns_to_eight(self):
        self.assertEqual(self.composer.calculate_canvas_size("3:2", 1024), (1536, 1024))
        self.assertEqual(self.composer.calculate_canvas_size("2:3", 1024), (1024, 1536))
        self.assertEqual(self.composer.calculate_canvas_size("16:9", 1001), (1776, 1000))

    def test_empty_layers_return_black_canvas(self):
        output, width, height = self.compose(ratio="3:2", short_side=16)
        self.assertEqual((width, height), (24, 16))
        self.assertEqual(tuple(output.shape), (1, 16, 24, 3))
        self.assertTrue(torch.equal(output, torch.zeros_like(output)))

    def test_loads_input_file_from_subfolder(self):
        _save(self.input_directory / "album" / "red.png", (255, 0, 0, 255))
        output, _, _ = self.compose(_layer(_ref("red.png", "album")))
        self.assertTrue(torch.equal(output[0, 3, 3], torch.tensor([1.0, 0.0, 0.0])))

    def test_file_reference_rejects_non_input_and_path_escape(self):
        _save(self.input_directory / "safe.png", (255, 0, 0, 255))
        for invalid in (
            {"filename": "safe.png", "subfolder": "", "type": "output"},
            _ref("../safe.png"),
            _ref("safe.png", "../outside"),
            _ref(str((self.input_directory / "safe.png").resolve())),
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                self.composer._resolve_image_ref(invalid)

    def test_cutout_source_takes_priority(self):
        _save(self.input_directory / "source.png", (255, 0, 0, 255))
        _save(self.input_directory / "cutout.png", (0, 255, 0, 255))
        output, _, _ = self.compose(
            _layer(_ref("source.png"), cutout_source=_ref("cutout.png"))
        )
        self.assertTrue(torch.equal(output[0, 3, 3], torch.tensor([0.0, 1.0, 0.0])))

    def test_eraser_mask_removes_opaque_pixels(self):
        _save(self.input_directory / "red.png", (255, 0, 0, 255))
        mask = np.zeros((4, 4, 4), dtype=np.uint8)
        mask[0:2, :, :] = 255
        Image.fromarray(mask, "RGBA").save(self.input_directory / "mask.png")
        output, _, _ = self.compose(
            _layer(_ref("red.png"), cutout_source=_ref("red.png"), eraser_mask=_ref("mask.png"))
        )
        self.assertTrue(torch.equal(output[0, 2, 3], torch.zeros(3)))
        self.assertTrue(torch.equal(output[0, 4, 3], torch.tensor([1.0, 0.0, 0.0])))

    def test_scale_rotation_opacity_and_blend_modes(self):
        source = np.zeros((2, 4, 4), dtype=np.uint8)
        source[0, :, :] = (255, 0, 0, 255)
        source[1, :, :] = (0, 255, 0, 255)
        Image.fromarray(source, "RGBA").save(self.input_directory / "stripes.png")
        _save(self.input_directory / "blue.png", (0, 0, 255, 255))
        for mode in ("multiply", "screen", "overlay"):
            output, _, _ = self.compose(
                _layer(_ref("blue.png"), id="base"),
                _layer(
                    _ref("stripes.png"),
                    id="top",
                    scale=2,
                    rotation=90,
                    opacity=0.5,
                    blend_mode=mode,
                ),
            )
            self.assertTrue(torch.isfinite(output).all())
            self.assertGreater(output.sum().item(), 0)
        rotated, _, _ = self.compose(_layer(_ref("stripes.png"), rotation=90))
        self.assertGreater(rotated[0, :, :, 0].sum().item(), 0)
        self.assertGreater(rotated[0, :, :, 1].sum().item(), 0)

    def test_schema_has_only_layout_state_and_no_image_input(self):
        schema = self.composer.NO8DImageComposer.define_schema()
        self.assertEqual([item.id for item in schema.inputs], ["layout_json"])
        self.assertTrue(schema.inputs[0].socketless)
        self.assertEqual([item.id for item in schema.outputs], ["image", "width", "height"])

    def test_execute_returns_preview_image_ui(self):
        result = self.composer.NO8DImageComposer.execute(
            json.dumps({"ratio": "1:1", "short_side": 8, "layers": []})
        )
        self.assertEqual(result.ui["images"][0]["filename"], "preview.png")
        self.assertEqual(result.result[1:], (8, 8))
        self.assertEqual(tuple(self.composer._test_preview_class.last_image.shape), (1, 8, 8, 3))

    def test_remove_background_route_is_registered_with_test_stub(self):
        self.assertIn(
            "/no8d/image-composer/remove-background",
            self.composer._test_routes.posts,
        )

    def test_missing_rembg_has_clear_error(self):
        with mock.patch.dict(sys.modules, {"rembg": None}):
            with self.assertRaisesRegex(RuntimeError, "未安装 rembg"):
                self.composer._remove_background_sync(b"not-an-image")

    def test_frontend_uses_hidden_state_and_free_canvas_navigation(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        self.assertIn('layout.type = "converted-widget"', source)
        self.assertIn('event.code !== "Space"', source)
        self.assertIn('mode: "marquee"', source)
        self.assertIn('input.type = "range"', source)

    def test_frontend_selection_uses_visible_alpha_bounds(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        self.assertIn("function contentBounds(layer)", source)
        self.assertIn("getImageData", source)
        self.assertIn("function selectionRect(layer)", source)

    def test_locked_layer_still_renders_and_hidden_layer_does_not(self):
        _save(self.input_directory / "red.png", (255, 0, 0, 255))
        locked, _, _ = self.compose(_layer(_ref("red.png"), locked=True))
        hidden, _, _ = self.compose(_layer(_ref("red.png"), visible=False))
        self.assertTrue(torch.equal(locked[0, 3, 3], torch.tensor([1.0, 0.0, 0.0])))
        self.assertTrue(torch.equal(hidden, torch.zeros_like(hidden)))

    def test_horizontal_and_vertical_mirroring(self):
        pixels = np.zeros((4, 4, 4), dtype=np.uint8)
        pixels[0, 0] = (255, 0, 0, 255)
        Image.fromarray(pixels, "RGBA").save(self.input_directory / "corner.png")
        output, _, _ = self.compose(
            _layer(_ref("corner.png"), flip_horizontal=True, flip_vertical=True)
        )
        self.assertTrue(torch.equal(output[0, 5, 5], torch.tensor([1.0, 0.0, 0.0])))
        self.assertTrue(torch.equal(output[0, 2, 2], torch.zeros(3)))

    def test_stroke_uses_alpha_silhouette_and_custom_color(self):
        pixels = np.zeros((4, 4, 4), dtype=np.uint8)
        pixels[1, 1] = (255, 0, 0, 255)
        Image.fromarray(pixels, "RGBA").save(self.input_directory / "dot.png")
        output, _, _ = self.compose(
            _layer(_ref("dot.png"), cutout_source=_ref("dot.png"), stroke_enabled=True, stroke_width=1, stroke_color="#00ff00")
        )
        self.assertTrue(torch.equal(output[0, 3, 3], torch.tensor([1.0, 0.0, 0.0])))
        self.assertTrue(torch.equal(output[0, 3, 4], torch.tensor([0.0, 1.0, 0.0])))
        self.assertTrue(torch.equal(output[0, 0, 0], torch.zeros(3)))

    def test_stroke_and_eraser_are_inactive_without_cutout(self):
        _save(self.input_directory / "red.png", (255, 0, 0, 255))
        _save(self.input_directory / "mask.png", (255, 255, 255, 255))
        output, _, _ = self.compose(_layer(_ref("red.png"), stroke_enabled=True, stroke_width=2, eraser_mask=_ref("mask.png")))
        self.assertTrue(torch.equal(output[0, 3, 3], torch.tensor([1.0, 0.0, 0.0])))
        self.assertTrue(torch.equal(output[0, 1, 1], torch.zeros(3)))

    def test_stroke_switch_disables_saved_width(self):
        _save(self.input_directory / "red.png", (255, 0, 0, 255))
        output, _, _ = self.compose(_layer(_ref("red.png"), cutout_source=_ref("red.png"), stroke_enabled=False, stroke_width=2))
        self.assertTrue(torch.equal(output[0, 1, 1], torch.zeros(3)))

    def test_frontend_editor_scopes_paste_and_keyboard_shortcuts(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        self.assertIn('window.addEventListener("paste", pasteHandler, true)', source)
        self.assertIn('window.removeEventListener("paste", pasteHandler, true)', source)
        self.assertIn('event.stopImmediatePropagation(); addFiles(files)', source)
        self.assertIn('event.key === "Delete"', source)
        self.assertIn('event.shiftKey ? 10 : 1', source)
        self.assertIn('event.key.toLowerCase() === "l"', source)

    def test_frontend_cutout_tools_follow_activation_and_visibility(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        self.assertIn('visible.setAttribute("aria-pressed"', source)
        self.assertIn('event.key.toLowerCase() === "v"', source)
        self.assertIn('no8d-composer-mirror', source)
        self.assertIn('makeButton("自动抠像"', source)
        self.assertNotIn('画笔选择主体', source)
        self.assertNotIn('复位抠像', source)
        self.assertNotIn('eraserReset', source)
        self.assertIn('makeSwitch("描边", layer.stroke_enabled, !layer.cutout_source', source)
        self.assertIn('makeSwitch("橡皮擦", eraserMode, !layer.cutout_source', source)
        self.assertIn('context.arc(pointerPosition.x, pointerPosition.y, brushSize', source)

    def test_frontend_eraser_is_exclusive_and_history_keeps_twenty_steps(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        eraser_branch = source.split('if (eraserMode) {', 1)[1].split('if (handle && active)', 1)[0]
        self.assertIn('active?.cutout_source', eraser_branch)
        self.assertIn('interaction = { mode: "erase"', eraser_branch)
        self.assertTrue(eraser_branch.rstrip().endswith('return;\n        }'))
        self.assertIn('if (undoStack.length > 20) undoStack.shift()', source)
        self.assertIn('redoStack.push(current); restoreHistory(previous)', source)
        self.assertIn('历史记录（${undoStack.length}/20 步）', source)
        self.assertIn('window.addEventListener("keydown", keyHandler, true)', source)
        self.assertIn('event.key.toLowerCase() === "y" || event.shiftKey', source)
        self.assertIn('role", "switch"', source)
        self.assertIn('no8d-composer-stroke', source)

    def test_frontend_editor_follows_comfyui_language(self):
        source = (
            Path(__file__).resolve().parents[1] / "web" / "image_composer.js"
        ).read_text(encoding="utf-8")
        self.assertIn('import { no8dLocale, t } from "./no8d_i18n.js"', source)
        self.assertIn('"打开图层合成器": "Open Image Composer"', source)
        self.assertIn('"自动抠像": "Auto cutout"', source)
        self.assertIn('button.textContent = composerText("打开图层合成器")', source)
        self.assertIn('openEditorRefresh?.()', source)
        self.assertIn('window.addEventListener("languagechange", () => refreshComposerLocale(true))', source)
        self.assertIn('setInterval(() => refreshComposerLocale(), 1000)', source)


if __name__ == "__main__":
    unittest.main()
