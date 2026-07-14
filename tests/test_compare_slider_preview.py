from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest


class _ExecutionBlocker:
    def __init__(self, message):
        self.message = message


class _PreviewImage:
    saved = []

    def save_images(self, images, filename_prefix):
        self.saved.append((images, filename_prefix))
        return {
            "ui": {
                "images": [
                    {
                        "filename": f"{filename_prefix}.png",
                        "subfolder": "",
                        "type": "temp",
                    }
                ]
            }
        }


def _load_compare_module():
    nodes = types.ModuleType("nodes")
    nodes.PreviewImage = _PreviewImage
    execution = types.ModuleType("comfy_execution")
    graph = types.ModuleType("comfy_execution.graph")
    graph.ExecutionBlocker = _ExecutionBlocker

    module_names = ("nodes", "comfy_execution", "comfy_execution.graph")
    previous_modules = {name: sys.modules.get(name) for name in module_names}
    sys.modules["nodes"] = nodes
    sys.modules["comfy_execution"] = execution
    sys.modules["comfy_execution.graph"] = graph
    try:
        path = pathlib.Path(__file__).resolve().parents[1] / "compare_slider_preview.py"
        spec = importlib.util.spec_from_file_location("no8d_compare_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous in previous_modules.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


COMPARE = _load_compare_module()


class CompareSliderPreviewTests(unittest.TestCase):
    def setUp(self):
        _PreviewImage.saved.clear()

    def test_node_exposes_auto_switch_and_image_a_output(self):
        inputs = COMPARE.NO8DABPreview.INPUT_TYPES()

        self.assertTrue(inputs["optional"]["auto_output"][1]["default"])
        self.assertEqual(COMPARE.NO8DABPreview.RETURN_TYPES, ("IMAGE",))
        self.assertEqual(COMPARE.NO8DABPreview.RETURN_NAMES, ("image_a",))

    def test_auto_output_on_passes_image_a_and_preserves_both_previews(self):
        image_a = object()
        image_b = object()

        result = COMPARE.NO8DABPreview().preview(
            auto_output=True,
            image_a=image_a,
            image_b=image_b,
        )

        self.assertIs(result["result"][0], image_a)
        self.assertEqual(len(result["ui"]["a_images"]), 1)
        self.assertEqual(len(result["ui"]["b_images"]), 1)
        self.assertEqual(
            _PreviewImage.saved,
            [
                (image_a, "NO8DABPreview_A"),
                (image_b, "NO8DABPreview_B"),
            ],
        )

    def test_legacy_call_without_switch_value_defaults_to_auto_output(self):
        image_a = object()

        result = COMPARE.NO8DABPreview().preview(image_a=image_a)

        self.assertIs(result["result"][0], image_a)

    def test_auto_output_off_blocks_downstream_but_keeps_preview(self):
        image_a = object()

        result = COMPARE.NO8DABPreview().preview(auto_output=False, image_a=image_a)

        output = result["result"][0]
        self.assertIsInstance(output, _ExecutionBlocker)
        self.assertIsNone(output.message)
        self.assertEqual(len(result["ui"]["a_images"]), 1)

    def test_auto_output_on_without_image_a_blocks_downstream(self):
        image_b = object()

        result = COMPARE.NO8DABPreview().preview(auto_output=True, image_b=image_b)

        self.assertIsInstance(result["result"][0], _ExecutionBlocker)
        self.assertEqual(len(result["ui"]["b_images"]), 1)


if __name__ == "__main__":
    unittest.main()
