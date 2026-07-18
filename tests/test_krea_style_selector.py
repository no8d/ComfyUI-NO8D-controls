from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "krea_style_selector.py"

server_stub = types.ModuleType("server")
server_stub.PromptServer = None
sys.modules.setdefault("server", server_stub)

spec = importlib.util.spec_from_file_location("krea_style_selector", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


class KreaStyleSelectorTests(unittest.TestCase):
    def test_catalog_has_four_nonempty_categories(self):
        self.assertEqual(
            module._CATEGORIES,
            ("写实摄影", "动漫插图", "手绘艺术", "数字艺术"),
        )
        counts = {
            category: sum(item["category"] == category for item in module._STYLES)
            for category in module._CATEGORIES
        }
        self.assertTrue(all(counts.values()), counts)

    def test_catalog_has_285_unique_styles(self):
        names = [item["name"] for item in module._STYLES]
        self.assertEqual(len(names), 285)
        self.assertEqual(len(names), len(set(names)))

    def test_every_style_has_prompt_and_unique_preview(self):
        previews = []
        for item in module._STYLES:
            self.assertTrue(item["prompt"].strip())
            self.assertTrue(item["name_zh"].strip())
            self.assertIn(item["category"], module._CATEGORIES)
            self.assertTrue(item["preview"].endswith(".webp"))
            previews.append(item["preview"])
        self.assertEqual(len(previews), len(set(previews)))

    def test_node_returns_catalog_values(self):
        item = module._STYLES[0]
        result = module.NO8DKreaStyleSelector().select_style(item["name"])
        self.assertEqual(result, (item["prompt"],))

    def test_node_exposes_only_the_selected_prompt(self):
        self.assertEqual(module.NO8DKreaStyleSelector.RETURN_TYPES, ("STRING",))
        self.assertEqual(module.NO8DKreaStyleSelector.RETURN_NAMES, ("prompt",))

    def test_backend_metadata_uses_english_as_the_canonical_locale(self):
        self.assertEqual(
            module.NODE_DISPLAY_NAME_MAPPINGS["NO8DKreaStyleSelector"],
            "NO8D-Krea2 Style Selector",
        )
        self.assertTrue(module.NO8DKreaStyleSelector.DESCRIPTION.startswith("Choose a Krea 2 style"))

    def test_node_stores_only_the_selected_style(self):
        required = module.NO8DKreaStyleSelector.INPUT_TYPES()["required"]
        self.assertEqual(tuple(required), ("style",))
        self.assertEqual(required["style"][0], "STRING")


if __name__ == "__main__":
    unittest.main()
