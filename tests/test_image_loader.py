import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import image_loader
from PIL import Image


class ImageLoaderSelectionTests(unittest.TestCase):
    def test_no_selection_returns_an_empty_output_list(self):
        result = image_loader.NO8DLoadImages().load(
            '[{"name":"available.png"}]',
            "[]",
        )
        self.assertEqual(result, ([],))

    def test_execution_loads_only_explicit_output_refs(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            Image.new("RGB", (2, 2), "red").save(base / "selected-a.png")
            Image.new("RGB", (2, 2), "blue").save(base / "selected-b.png")
            with patch.object(image_loader, "_base_directory", return_value=base):
                images, = image_loader.NO8DLoadImages().load(
                    '[{"name":"unselected-and-missing.png"}]',
                    '[{"name":"selected-a.png"},{"name":"selected-b.png"}]',
                )
        self.assertEqual(len(images), 2)
        self.assertEqual(images[0].no8d_source_name, "selected-a.png")
        self.assertEqual(images[1].no8d_source_name, "selected-b.png")

    def test_legacy_enabled_fields_do_not_filter_selected_refs(self):
        output_refs = image_loader._parse_image_refs(
            '[{"name":"selected.png","enabled":false}]',
        )
        self.assertEqual([ref["name"] for ref in output_refs], ["selected.png"])


if __name__ == "__main__":
    unittest.main()
