from __future__ import annotations

import base64
import importlib.util
import sys
import types
import unittest
import os
import tempfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "krea_style_selector.py"
WEB_MODULE_PATH = ROOT / "web" / "krea_style_gallery.js"

server_stub = types.ModuleType("server")
server_stub.PromptServer = None
sys.modules.setdefault("server", server_stub)

spec = importlib.util.spec_from_file_location("krea_style_selector", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)


def sample_styles(count=3, library="test_library"):
    return [
        module._validated_style({
            "name": f"Style {index}",
            "name_zh": f"风格 {index}",
            "category": "All",
            "prompt": f"prompt {index}",
            "library": library,
        })
        for index in range(1, count + 1)
    ]


SAMPLE_PREVIEW = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class KreaStyleSelectorTests(unittest.TestCase):
    def test_missing_openpyxl_reports_the_comfyui_dependency_install_path(self):
        with mock.patch.object(module.importlib, "import_module", side_effect=ModuleNotFoundError("openpyxl")):
            with self.assertRaisesRegex(RuntimeError, r"requirements\.txt.*ComfyUI"):
                module._require_openpyxl()

    def test_requirements_declares_the_xlsx_dependency(self):
        requirements = (ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
        self.assertIn("openpyxl>=3.1,<4", requirements)

    def test_library_manager_links_to_the_prompt_libraries_tutorial(self):
        source = WEB_MODULE_PATH.read_text(encoding="utf-8")
        self.assertIn("no8d-prompt-164632304", source)
        self.assertIn('userGuide: ["使用指南", "User guide"]', source)
        self.assertIn('guideLink.target = "_blank"', source)
        self.assertIn('guideLink.rel = "noopener noreferrer"', source)

    def test_no_library_is_loaded_at_import_time(self):
        self.assertEqual(module._STYLES, ())

    def test_optional_libraries_are_bundled_as_xlsx_files(self):
        files = sorted(module._BUILTIN_LIBRARY_DIR.rglob("*.xlsx"))
        self.assertEqual(
            {path.name for path in files},
            {"photography.xlsx", "anime_illustration.xlsx", "hand_drawn_art.xlsx", "digital_art.xlsx"},
        )
        self.assertFalse(any(module._BUILTIN_LIBRARY_DIR.glob("*.csv")))

    def test_new_node_is_empty_until_a_library_is_imported(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                self.assertEqual(module._all_styles(), ())
                self.assertEqual(module.NO8DKreaStyleSelector().select_style("", "", False), ([],))
                required = module.NO8DKreaStyleSelector.INPUT_TYPES()["required"]
                self.assertEqual(required["style"][1]["default"], "")
                self.assertEqual(required["library"][1]["default"], "")
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_node_exposes_only_the_selected_prompt(self):
        self.assertEqual(module.NO8DKreaStyleSelector.RETURN_TYPES, ("STRING",))
        self.assertEqual(module.NO8DKreaStyleSelector.RETURN_NAMES, ("prompt",))
        self.assertEqual(module.NO8DKreaStyleSelector.OUTPUT_IS_LIST, (True,))

    def test_multi_selection_outputs_an_ordered_prompt_list(self):
        items = sample_styles(3)
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                imported = []
                for item in items:
                    imported.append(module._validated_style({
                        "name": item["name"],
                        "name_zh": item["name_zh"],
                        "category": "All",
                        "prompt": item["prompt"],
                        "library": "test_library",
                    }))
                module._write_user_payload({"version": 3, "styles": imported})
                result = module.NO8DKreaStyleSelector().select_style(
                    items[0]["name"],
                    "test_library",
                    False,
                    module.json.dumps([item["name"] for item in items]),
                )
                self.assertEqual(result, ([item["prompt"] for item in items],))
                self.assertEqual(module._read_state()["history"], [item["name"] for item in reversed(items)])
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_cleared_selection_outputs_an_empty_prompt_and_does_not_add_history(self):
        items = sample_styles(1)
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                imported = [module._validated_style({
                    "name": items[0]["name"],
                    "name_zh": items[0]["name_zh"],
                    "category": "All",
                    "prompt": items[0]["prompt"],
                    "library": "test_library",
                })]
                module._write_user_payload({"version": 3, "styles": imported})
                self.assertEqual(
                    module.NO8DKreaStyleSelector().select_style("", "test_library", False, "[]", True),
                    ([""],),
                )
                self.assertEqual(module._read_state()["history"], [])
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_output_all_returns_every_prompt_from_the_active_library(self):
        items = sample_styles(2)
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                imported = [module._validated_style({
                    "name": item["name"],
                    "name_zh": item["name_zh"],
                    "category": "All",
                    "prompt": item["prompt"],
                    "library": "test_library",
                }) for item in items]
                module._write_user_payload({"version": 3, "styles": imported})
                result = module.NO8DKreaStyleSelector().select_style(
                    "", "test_library", False, output_all=True,
                )
                self.assertEqual(result, ([item["prompt"] for item in items],))
                self.assertEqual(module._read_state()["history"], [item["name"] for item in reversed(items)])
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_search_query_limits_output_all_and_random_output(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                styles = [
                    module._validated_style({
                        "name": "Rain Portrait",
                        "name_zh": "雨中人像",
                        "category": "All",
                        "prompt": "portrait in heavy rain",
                        "library": "test_library",
                    }),
                    module._validated_style({
                        "name": "Sunny Portrait",
                        "name_zh": "晴天人像",
                        "category": "All",
                        "prompt": "portrait in bright sun",
                        "library": "test_library",
                    }),
                ]
                module._write_user_payload({"version": 3, "styles": styles})
                selector = module.NO8DKreaStyleSelector()
                self.assertEqual(
                    selector.select_style("", "test_library", False, output_all=True, search_query="雨中"),
                    (["portrait in heavy rain"],),
                )
                self.assertEqual(
                    selector.select_style("Sunny Portrait", "test_library", True, search_query="heavy rain"),
                    (["portrait in heavy rain"],),
                )
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_selected_cards_take_priority_over_output_all_and_random(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                styles = [
                    module._validated_style({
                        "name": "First", "name_zh": "第一", "category": "All", "prompt": "first prompt", "library": "test_library",
                    }),
                    module._validated_style({
                        "name": "Second", "name_zh": "第二", "category": "All", "prompt": "second prompt", "library": "test_library",
                    }),
                    module._validated_style({
                        "name": "Third", "name_zh": "第三", "category": "All", "prompt": "third prompt", "library": "test_library",
                    }),
                ]
                module._write_user_payload({"version": 3, "styles": styles})
                selected = module.json.dumps(["First", "Third"])
                selector = module.NO8DKreaStyleSelector()
                expected = (["first prompt", "third prompt"],)
                self.assertEqual(selector.select_style("First", "test_library", False, selected, output_all=True), expected)
                self.assertEqual(selector.select_style("First", "test_library", True, selected), expected)
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_backend_metadata_uses_english_as_the_canonical_locale(self):
        self.assertEqual(
            module.NODE_DISPLAY_NAME_MAPPINGS["NO8DKreaStyleSelector"],
            "NO8D-Prompt-libraries",
        )
        self.assertTrue(module.NO8DKreaStyleSelector.DESCRIPTION.startswith("Browse prompt libraries"))

    def test_node_stores_only_the_selected_style(self):
        required = module.NO8DKreaStyleSelector.INPUT_TYPES()["required"]
        self.assertEqual(tuple(required), ("style", "library", "random_mode", "selected_styles", "selection_cleared", "output_all", "search_query"))
        self.assertEqual(required["style"][0], "STRING")
        self.assertTrue(module.NO8DKreaStyleSelector.IS_CHANGED(required["style"][1]["default"], module._CATEGORIES[0], True) != module.NO8DKreaStyleSelector.IS_CHANGED(required["style"][1]["default"], module._CATEGORIES[0], True))

    def test_custom_style_round_trip_uses_separate_user_storage(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                style = module._validated_style({
                    "name": "My Test Style",
                    "name_zh": "我的测试风格",
                    "category": module._CATEGORIES[0],
                    "prompt": "a private custom prompt",
                })
                module._write_user_payload({"version": 1, "styles": [style]})
                self.assertEqual(module._user_styles()[0]["name"], "My Test Style")
                self.assertEqual(module.NO8DKreaStyleSelector().select_style("My Test Style", "custom", False), (["a private custom prompt"],))
                wildcard = Path(directory) / "wildcards" / "custom.txt"
                self.assertTrue(wildcard.is_file())
                self.assertIn("My Test Style: a private custom prompt", wildcard.read_text(encoding="utf-8"))
                self.assertTrue((Path(directory) / "metadata.json").is_file())
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_custom_style_accepts_independent_category_and_rejects_unsafe_values(self):
        base = {"name": "Custom", "name_zh": "自定义", "category": "unknown", "prompt": "prompt"}
        self.assertEqual(module._validated_style(base)["category"], "unknown")
        with self.assertRaises(ValueError):
            module._validated_style(base, style_id="../unsafe")
        base["category"] = "bad:category"
        with self.assertRaises(ValueError):
            module._validated_style(base)

    def test_wildcard_txt_and_csv_import_formats(self):
        txt = b"Anime Style: a clean anime prompt\nplain prompt without a name\n"
        rows = module._parse_import(txt, "styles.txt")
        self.assertEqual(rows[0]["name"], "Anime Style")
        self.assertEqual(rows[1]["name"], "Entry 002")
        self.assertTrue(all(row["category"] == "全部" for row in rows))
        csv_data = "name,name_zh,category,prompt\nNeon,霓虹,写实摄影,a neon prompt\n".encode("utf-8")
        rows = module._parse_import(csv_data, "styles.csv")
        self.assertEqual(rows[0]["name_zh"], "霓虹")
        self.assertEqual(rows[0]["prompt"], "a neon prompt")

    def test_xlsx_export_restores_preview_favorite_and_history(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                style = sample_styles(1, "portable")[0]
                style["preview"] = module._save_preview(style["id"], SAMPLE_PREVIEW, "image/png")
                module._write_user_payload({"version": 3, "styles": [style]})
                state = module._read_state()
                state["favorites"] = [style["name"]]
                state["history"] = [style["name"]]
                module._write_state(state)
                content = module._export_library_xlsx("portable")
                rows, previews, portable = module._parse_import_bundle(content, "portable.xlsx")
                self.assertEqual(rows[0]["name"], style["name"])
                self.assertEqual(rows[0]["name_zh"], style["name_zh"])
                self.assertEqual(len(previews), 1)
                self.assertEqual(portable["favorites"], [style["name"]])
                self.assertEqual(portable["history"], [style["name"]])
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_user_library_can_be_renamed(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                style = module._validated_style({
                    "name": "Rename Me",
                    "name_zh": "重命名测试",
                    "category": "All",
                    "prompt": "rename prompt",
                    "library": "before",
                })
                module._write_user_payload({"version": 3, "styles": [style]})
                self.assertEqual(module._rename_user_library("before", "after"), "after")
                self.assertEqual(module._user_styles()[0]["library"], "after")
                self.assertFalse((Path(directory) / "wildcards" / "before.txt").exists())
                self.assertTrue((Path(directory) / "wildcards" / "after.txt").is_file())
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_user_library_delete_removes_cards_and_related_state(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                style = module._validated_style({
                    "name": "Delete Me",
                    "name_zh": "删除测试",
                    "category": "All",
                    "prompt": "delete prompt",
                    "library": "temporary",
                })
                module._write_user_payload({"version": 3, "styles": [style]})
                state = module._read_state()
                state["favorites"] = [style["name"]]
                state["history"] = [style["name"]]
                state["overrides"][style["name"]] = {"title": "changed"}
                module._write_state(state)

                self.assertEqual(module._delete_user_library("temporary"), 1)
                self.assertEqual(module._user_styles(), ())
                self.assertFalse((Path(directory) / "wildcards" / "temporary.txt").exists())
                self.assertEqual(module._read_state(), {
                    "version": 5,
                    "favorites": [],
                    "history": [],
                    "overrides": {},
                    "library_order": [],
                })
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_single_card_export_is_an_xlsx_table(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("NO8D_KREA_USER_DIR")
            os.environ["NO8D_KREA_USER_DIR"] = directory
            try:
                style = sample_styles(1, "single_card")[0]
                style["preview"] = module._save_preview(style["id"], SAMPLE_PREVIEW, "image/png")
                module._write_user_payload({"version": 3, "styles": [style]})

                content = module._export_items_xlsx([module._user_styles()[0]], "single_card")
                self.assertTrue(content.startswith(b"PK"))
                rows, previews, _portable = module._parse_import_bundle(content, "single_card.xlsx")
                self.assertEqual([row["name"] for row in rows], [style["name"]])
                self.assertEqual(len(previews), 1)
            finally:
                if previous is None:
                    os.environ.pop("NO8D_KREA_USER_DIR", None)
                else:
                    os.environ["NO8D_KREA_USER_DIR"] = previous

    def test_google_sheet_url_is_restricted_and_keeps_gid(self):
        url = module._google_sheet_csv_url("https://docs.google.com/spreadsheets/d/abc_DEF-123/edit#gid=42")
        self.assertEqual(url, "https://docs.google.com/spreadsheets/d/abc_DEF-123/export?format=csv&gid=42")
        with self.assertRaises(ValueError):
            module._google_sheet_csv_url("https://example.com/sheet")

    def test_repeated_wildcard_prefixes_receive_stable_numbers(self):
        rows = module._parse_import(b"Expression: first\nExpression: second\n", "expressions.txt")
        self.assertEqual([row["name"] for row in rows], ["Expression 001", "Expression 002"])


if __name__ == "__main__":
    unittest.main()
