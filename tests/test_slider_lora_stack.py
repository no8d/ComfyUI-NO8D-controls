from __future__ import annotations

import importlib.util
import json
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE_DIR = Path(__file__).resolve().parents[1]


class _NativeUNETLoader:
    FUNCTION = "load_unet"
    calls = []

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "unet_name": (["model-a.safetensors"],),
                "weight_dtype": (["default", "fp8_e4m3fn"],),
            }
        }

    def load_unet(self, unet_name, weight_dtype):
        self.calls.append((unet_name, weight_dtype))
        return (["native", unet_name, weight_dtype],)


def _load_module():
    comfy = types.ModuleType("comfy")
    comfy_sd = types.ModuleType("comfy.sd")
    comfy_utils = types.ModuleType("comfy.utils")
    comfy_utils.load_torch_file = lambda path, safe_load=True: {
        "path": path,
        "safe_load": safe_load,
    }

    def load_lora_for_models(model, _clip, lora, weight, _clip_weight):
        return (model + [["lora", lora["path"], weight]], None)

    comfy_sd.load_lora_for_models = load_lora_for_models
    comfy.sd = comfy_sd
    comfy.utils = comfy_utils

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_filename_list = lambda _kind: ["detail.safetensors"]
    folder_paths.get_full_path = (
        lambda _kind, name: f"C:/models/loras/{name}"
    )

    nodes = types.ModuleType("nodes")
    nodes.UNETLoader = _NativeUNETLoader

    module_path = PACKAGE_DIR / "slider_lora_stack.py"
    spec = importlib.util.spec_from_file_location(
        "_test_slider_lora_stack_module",
        module_path,
    )
    module = importlib.util.module_from_spec(spec)
    with patch.dict(
        sys.modules,
        {
            "comfy": comfy,
            "comfy.sd": comfy_sd,
            "comfy.utils": comfy_utils,
            "folder_paths": folder_paths,
            "nodes": nodes,
        },
    ):
        spec.loader.exec_module(module)
    return module


STACK = _load_module()


class SliderLoraStackTests(unittest.TestCase):
    def setUp(self):
        _NativeUNETLoader.calls.clear()

    def test_inherits_native_unet_inputs_without_model_socket(self):
        required = STACK.NO8DLoraStack.INPUT_TYPES()["required"]

        self.assertEqual(
            list(required),
            ["unet_name", "weight_dtype", "lora_picker", "stack_json"],
        )
        self.assertNotIn("model", required)

    def test_loads_native_unet_before_applying_enabled_loras(self):
        entries = [
            {
                "name": "detail.safetensors",
                "weight": 1.0,
                "enabled": True,
                "trigger": "high detail",
            }
        ]

        model, triggers = STACK.NO8DLoraStack().run(
            "detail.safetensors",
            json.dumps(entries),
            unet_name="model-a.safetensors",
            weight_dtype="fp8_e4m3fn",
        )

        self.assertEqual(
            _NativeUNETLoader.calls,
            [("model-a.safetensors", "fp8_e4m3fn")],
        )
        self.assertEqual(
            model,
            [
                "native",
                "model-a.safetensors",
                "fp8_e4m3fn",
                ["lora", "C:/models/loras/detail.safetensors", 1.0],
            ],
        )
        self.assertEqual(triggers, "high detail")

    def test_native_loader_inputs_participate_in_cache_signature(self):
        first = STACK.NO8DLoraStack.IS_CHANGED(
            "None",
            "[]",
            unet_name="model-a.safetensors",
            weight_dtype="default",
        )
        second = STACK.NO8DLoraStack.IS_CHANGED(
            "None",
            "[]",
            unet_name="model-a.safetensors",
            weight_dtype="fp8_e4m3fn",
        )

        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
