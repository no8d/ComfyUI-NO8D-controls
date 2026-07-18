from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest

import torch


class _NoopType:
    def __init__(self, *args, **kwargs):
        if args:
            self.id = args[0]
        for name, value in kwargs.items():
            setattr(self, name, value)


def _load_module():
    io = types.SimpleNamespace(
        ComfyNode=object,
        NodeOutput=lambda value: value,
        Autogrow=types.SimpleNamespace(TemplatePrefix=_NoopType, Input=_NoopType),
        Image=types.SimpleNamespace(Input=_NoopType, Output=_NoopType),
        Combo=types.SimpleNamespace(Input=_NoopType),
        Int=types.SimpleNamespace(Input=_NoopType),
        String=types.SimpleNamespace(Input=_NoopType),
        Color=types.SimpleNamespace(Input=_NoopType),
        Schema=_NoopType,
    )
    comfy_api = types.ModuleType("comfy_api")
    versioned = types.ModuleType("comfy_api.v0_0_2")
    versioned.io = io
    names = ("comfy_api", "comfy_api.v0_0_2")
    previous = {name: sys.modules.get(name) for name in names}
    sys.modules["comfy_api"] = comfy_api
    sys.modules["comfy_api.v0_0_2"] = versioned
    try:
        path = pathlib.Path(__file__).resolve().parents[1] / "image_grid.py"
        spec = importlib.util.spec_from_file_location("no8d_image_grid_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old_module in previous.items():
            if old_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_module


GRID = _load_module()


def _image(width, height, color):
    result = torch.zeros((1, height, width, 3), dtype=torch.float32)
    for channel, value in enumerate(color):
        result[..., channel] = value
    return result


DEFAULTS = {
    "layout": "横向",
    "crop_mode": "none",
    "columns": 0,
    "spacing": 10,
    "background_color": "#646464",
}

TITLE_DEFAULTS = {
    "title_bar_color": "#000000",
    "title_bar_opacity": 60,
    "title_position": "底部",
    "title_bar_height": 25,
    "font_size": 12,
    "text_padding": 4,
    "text_color": "#FFFFFF",
    "text_align": "居中",
}


def _compose(images, **overrides):
    return GRID.compose_grid(images, **(DEFAULTS | overrides))


class ImageGridTests(unittest.TestCase):
    def test_english_ui_values_are_accepted_by_the_backend(self):
        first = _image(40, 20, (1, 0, 0))
        second = _image(40, 20, (0, 1, 0))
        grid = _compose(
            [first, second],
            layout="Horizontal",
            crop_mode="Standard crop",
            spacing=0,
        )
        titled = GRID.add_titles(
            first,
            titles="Title",
            **(
                TITLE_DEFAULTS
                | {
                    "title_position": "Inside top",
                    "text_align": "Center",
                }
            ),
        )
        self.assertEqual(tuple(grid.shape), (1, 20, 40, 3))
        self.assertEqual(tuple(titled.shape), tuple(first.shape))

    def test_visual_color_defaults_use_no8d_accent(self):
        grid_schema = GRID.NO8DImageGrid.define_schema()
        title_schema = GRID.NO8DImageTitle.define_schema()
        grid_color = next(item for item in grid_schema.inputs if item.id == "background_color")
        title_color = next(item for item in title_schema.inputs if item.id == "title_bar_color")
        self.assertEqual(grid_schema.display_name, "NO8D-Image Grid")
        self.assertEqual(title_schema.display_name, "NO8D-Image Title")
        self.assertEqual(grid_color.default, GRID.NO8D_ACCENT_COLOR)
        self.assertEqual(title_color.default, GRID.NO8D_ACCENT_COLOR)

    def test_node_defaults_match_the_reference_configuration(self):
        grid_inputs = {item.id: item for item in GRID.NO8DImageGrid.define_schema().inputs}
        title_inputs = {item.id: item for item in GRID.NO8DImageTitle.define_schema().inputs}
        self.assertEqual(grid_inputs["spacing"].default, 4)
        self.assertEqual(title_inputs["titles"].default, "image-01")
        self.assertEqual(title_inputs["title_bar_opacity"].default, 60)
        self.assertEqual(title_inputs["title_position"].default, "图内底部")
        self.assertEqual(title_inputs["title_bar_height"].default, 10)
        self.assertEqual(title_inputs["font_size"].default, 36)
        self.assertEqual(title_inputs["text_padding"].default, 4)
        self.assertEqual(title_inputs["text_color"].default, "#FFFFFF")
        self.assertEqual(title_inputs["text_align"].default, "居中")

    def test_title_position_options_use_the_expected_names_and_order(self):
        schema = GRID.NO8DImageTitle.define_schema()
        position = next(item for item in schema.inputs if item.id == "title_position")
        self.assertEqual(
            position.options,
            ["图外顶部", "图内顶部", "中部", "图内底部", "图外底部"],
        )

    def test_horizontal_uses_first_image_height(self):
        output = _compose([_image(100, 50, (1, 0, 0)), _image(30, 60, (0, 1, 0))])
        self.assertEqual(tuple(output.shape), (1, 70, 155, 3))

    def test_vertical_uses_first_image_width(self):
        output = _compose(
            [_image(100, 50, (1, 0, 0)), _image(50, 100, (0, 1, 0))], layout="纵向"
        )
        self.assertEqual(tuple(output.shape), (1, 280, 120, 3))

    def test_grid_uses_first_image_cells_and_darkened_fill(self):
        output = _compose(
            [_image(100, 50, (1, 0, 0)), _image(50, 100, (0, 1, 0)), _image(20, 20, (0, 0, 1))],
            layout="网格",
        )
        self.assertEqual(tuple(output.shape), (1, 130, 230, 3))
        self.assertTrue(
            torch.allclose(output[0, 20, 120], torch.tensor([0.3137] * 3), atol=0.01)
        )

    def test_standard_crop_uses_first_image_size_and_opposite_halves(self):
        output = _compose(
            [_image(100, 50, (1, 0, 0)), _image(40, 80, (0, 1, 0))],
            crop_mode="标准裁切",
            spacing=0,
        )
        self.assertEqual(tuple(output.shape), (1, 50, 100, 3))
        self.assertGreater(output[0, 25, 20, 0].item(), 0.9)
        self.assertGreater(output[0, 25, 80, 1].item(), 0.9)

    def test_crop_mode_requires_exactly_two_images(self):
        with self.assertRaisesRegex(ValueError, "正好两张"):
            _compose([_image(20, 10, (1, 0, 0))], crop_mode="居左裁切")

    def test_crop_alignment_selects_matching_regions_from_both_images(self):
        first = torch.zeros((1, 20, 40, 3))
        second = torch.zeros((1, 20, 40, 3))
        first[:, :, :20, 0] = 1.0
        first[:, :, 20:, 2] = 1.0
        second[:, :, :20, 1] = 1.0
        second[:, :, 20:, 0] = 1.0

        left = _compose([first, second], crop_mode="居左裁切", spacing=0)
        right = _compose([first, second], crop_mode="居右裁切", spacing=0)

        self.assertGreater(left[0, 10, 5, 0].item(), 0.9)
        self.assertGreater(left[0, 10, 25, 1].item(), 0.9)
        self.assertGreater(right[0, 10, 5, 2].item(), 0.9)
        self.assertGreater(right[0, 10, 25, 0].item(), 0.9)

    def test_crop_mode_draws_internal_margin_and_center_spacing(self):
        output = _compose(
            [_image(40, 20, (1, 0, 0)), _image(40, 20, (0, 1, 0))],
            crop_mode="标准裁切",
            spacing=4,
            background_color="#0000FF",
        )
        self.assertEqual(tuple(output.shape), (1, 28, 52, 3))
        self.assertGreater(output[0, 1, 1, 2].item(), 0.9)
        self.assertGreater(output[0, 10, 25, 2].item(), 0.9)
        self.assertGreater(output[0, 10, 5, 0].item(), 0.9)
        self.assertGreater(output[0, 10, 30, 1].item(), 0.9)

    def test_vertical_crop_places_images_top_and_bottom(self):
        output = _compose(
            [_image(40, 20, (1, 0, 0)), _image(40, 20, (0, 1, 0))],
            layout="纵向",
            crop_mode="标准裁切",
            spacing=2,
            background_color="#0000FF",
        )
        self.assertEqual(tuple(output.shape), (1, 26, 44, 3))
        self.assertGreater(output[0, 4, 20, 0].item(), 0.9)
        self.assertGreater(output[0, 18, 20, 1].item(), 0.9)
        self.assertGreater(output[0, 12, 20, 2].item(), 0.9)

    def test_single_column_grid_crop_uses_vertical_split(self):
        output = _compose(
            [_image(40, 20, (1, 0, 0)), _image(40, 20, (0, 1, 0))],
            layout="网格",
            columns=1,
            crop_mode="标准裁切",
            spacing=0,
        )
        self.assertGreater(output[0, 4, 20, 0].item(), 0.9)
        self.assertGreater(output[0, 15, 20, 1].item(), 0.9)

    def test_image_batches_are_flattened_in_order(self):
        batch = torch.cat([_image(20, 10, (1, 0, 0)), _image(20, 10, (0, 1, 0))])
        output = _compose([batch, _image(20, 10, (0, 0, 1))], spacing=0)
        self.assertEqual(tuple(output.shape), (1, 10, 60, 3))
        self.assertGreater(output[0, 5, 5, 0].item(), 0.9)
        self.assertGreater(output[0, 5, 25, 1].item(), 0.9)
        self.assertGreater(output[0, 5, 45, 2].item(), 0.9)

    def test_empty_title_does_not_add_a_bar(self):
        source = _image(40, 20, (1, 0, 0))
        plain = GRID.add_titles(source, titles="", **TITLE_DEFAULTS)
        titled = GRID.add_titles(
            source, titles="A", **(TITLE_DEFAULTS | {"title_bar_opacity": 100})
        )
        self.assertGreater(plain[0, 15, 5, 0].item(), 0.9)
        self.assertLess(titled[0, 22, 5, 0].item(), 0.1)

    def test_percentage_values_accept_display_strings_and_legacy_numbers(self):
        source = _image(40, 20, (1, 0, 0))
        string_values = GRID.add_titles(
            source,
            titles="A",
            **(
                TITLE_DEFAULTS
                | {"title_bar_opacity": "100%", "title_bar_height": "25%"}
            ),
        )
        legacy_numbers = GRID.add_titles(
            source,
            titles="A",
            **(TITLE_DEFAULTS | {"title_bar_opacity": 100, "title_bar_height": 25}),
        )
        self.assertTrue(torch.equal(string_values, legacy_numbers))

    def test_titles_keep_batch_shape_and_support_independent_lines(self):
        source = torch.cat([_image(40, 20, (1, 0, 0)), _image(40, 20, (0, 1, 0))])
        output = GRID.add_titles(
            source, titles="第一张\n", **(TITLE_DEFAULTS | {"title_bar_opacity": 100})
        )
        self.assertEqual(tuple(output.shape), (2, 25, 40, 3))
        self.assertLess(output[0, 22, 1, 0].item(), 0.1)
        self.assertGreater(output[1, 15, 5, 1].item(), 0.9)

    def test_top_and_bottom_titles_extend_the_canvas(self):
        source = _image(40, 20, (1, 0, 0))
        top = GRID.add_titles(
            source,
            titles="A",
            **(TITLE_DEFAULTS | {"title_position": "顶部", "title_bar_height": 40}),
        )
        bottom = GRID.add_titles(
            source,
            titles="A",
            **(TITLE_DEFAULTS | {"title_position": "底部", "title_bar_height": 40}),
        )
        self.assertEqual(tuple(top.shape), (1, 28, 40, 3))
        self.assertEqual(tuple(bottom.shape), (1, 28, 40, 3))
        self.assertLess(top[0, 2, 2, 0].item(), 0.8)
        self.assertGreater(top[0, 12, 2, 0].item(), 0.9)
        self.assertGreater(bottom[0, 12, 2, 0].item(), 0.9)
        self.assertLess(bottom[0, 25, 2, 0].item(), 0.8)

    def test_middle_title_is_an_overlay_and_keeps_the_canvas_size(self):
        source = _image(40, 20, (1, 0, 0))
        output = GRID.add_titles(
            source,
            titles="A",
            **(
                TITLE_DEFAULTS
                | {"title_position": "中间", "title_bar_opacity": 100, "title_bar_height": 40}
            ),
        )
        self.assertEqual(tuple(output.shape), tuple(source.shape))
        self.assertGreater(output[0, 1, 2, 0].item(), 0.9)
        self.assertLess(output[0, 10, 2, 0].item(), 0.1)

    def test_inner_top_and_bottom_overlay_inside_the_source(self):
        source = _image(40, 20, (1, 0, 0))
        settings = TITLE_DEFAULTS | {
            "title_bar_opacity": 100,
            "title_bar_height": 25,
        }
        inner_top = GRID.add_titles(
            source, titles="A", **(settings | {"title_position": "图内顶部"})
        )
        inner_bottom = GRID.add_titles(
            source, titles="A", **(settings | {"title_position": "图内底部"})
        )
        self.assertEqual(tuple(inner_top.shape), tuple(source.shape))
        self.assertEqual(tuple(inner_bottom.shape), tuple(source.shape))
        self.assertLess(inner_top[0, 1, 1, 0].item(), 0.1)
        self.assertGreater(inner_top[0, 10, 1, 0].item(), 0.9)
        self.assertGreater(inner_bottom[0, 5, 1, 0].item(), 0.9)
        self.assertLess(inner_bottom[0, 18, 1, 0].item(), 0.1)

    def test_invalid_color_reports_the_expected_format(self):
        with self.assertRaisesRegex(ValueError, "#RRGGBB"):
            _compose([_image(20, 10, (1, 0, 0))], background_color="red")


if __name__ == "__main__":
    unittest.main()
