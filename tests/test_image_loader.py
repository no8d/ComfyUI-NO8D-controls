import unittest

import image_loader


class ImageLoaderEnabledStateTests(unittest.TestCase):
    def test_missing_enabled_field_defaults_to_enabled(self):
        refs = image_loader._resolve_image_refs(
            '[{"name":"old.png"},{"name":"on.png","enabled":true}]',
            "[]",
        )
        self.assertEqual([ref["name"] for ref in refs], ["old.png", "on.png"])

    def test_disabled_images_are_removed_after_candidate_selection(self):
        refs = image_loader._resolve_image_refs(
            '[{"name":"fallback.png","enabled":true}]',
            '[{"name":"off.png","enabled":false}]',
        )
        self.assertEqual(refs, [])

    def test_disabled_only_selection_returns_an_empty_output_list(self):
        result = image_loader.NO8DLoadImages().load(
            '[{"name":"fallback.png","enabled":true}]',
            '[{"name":"off.png","enabled":false}]',
        )
        self.assertEqual(result, ([],))

    def test_selected_enabled_images_do_not_fall_back_to_full_list(self):
        refs = image_loader._resolve_image_refs(
            '[{"name":"all.png","enabled":true}]',
            '[{"name":"selected.png","enabled":true}]',
        )
        self.assertEqual([ref["name"] for ref in refs], ["selected.png"])


if __name__ == "__main__":
    unittest.main()
