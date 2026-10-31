import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import image_loader
from PIL import Image
import numpy as np


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

    def test_default_does_not_crop_image(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            Image.new("RGB", (19, 17), "red").save(base / "source.png")
            with patch.object(image_loader, "_base_directory", return_value=base):
                images, = image_loader.NO8DLoadImages().load(
                    "[]", '[{"name":"source.png"}]'
                )
        self.assertEqual(tuple(images[0].shape[1:3]), (17, 19))

    def test_center_crops_to_nearest_common_ratio_and_selected_multiple(self):
        pixels = np.zeros((27, 35, 3), dtype=np.uint8)
        pixels[1:25, 1:33] = (255, 0, 0)
        with TemporaryDirectory() as directory:
            base = Path(directory)
            Image.fromarray(pixels).save(base / "source.png")
            with patch.object(image_loader, "_base_directory", return_value=base), patch.object(
                image_loader, "_upscale_for_crop", side_effect=lambda image: image
            ):
                images, = image_loader.NO8DLoadImages().load(
                    "[]", '[{"name":"source.png"}]', "8"
                )
        image = images[0]
        self.assertEqual(tuple(image.shape[1:3]), (24, 32))
        self.assertTrue(np.allclose(image.numpy()[0, :, :, 0], 1.0))
        self.assertTrue(np.allclose(image.numpy()[0, :, :, 1:], 0.0))

    def test_small_images_choose_the_common_ratio_with_most_actual_pixels(self):
        portrait = Image.new("RGB", (41, 62), "red")
        landscape = Image.new("RGB", (62, 41), "blue")
        self.assertEqual(
            image_loader._center_crop_to_multiple(portrait, 8).size,
            (40, 40),
        )
        self.assertEqual(
            image_loader._center_crop_to_multiple(landscape, 8).size,
            (40, 40),
        )

    def test_common_ratio_and_multiple_are_both_exact(self):
        image = Image.new("RGB", (1025, 769), "red")
        cropped = image_loader._center_crop_to_multiple(image, 64)
        self.assertEqual(cropped.size, (1024, 768))
        self.assertEqual(cropped.width % 64, 0)
        self.assertEqual(cropped.height % 64, 0)
        self.assertEqual(cropped.width * 3, cropped.height * 4)

    def test_small_portrait_uses_actual_aligned_area_instead_of_ideal_ratio_area(self):
        pixels = np.arange(160 * 125 * 3, dtype=np.uint8).reshape(160, 125, 3)
        image = Image.fromarray(pixels)
        cropped = image_loader._center_crop_to_multiple(image, 16)
        self.assertEqual(cropped.size, (96, 144))
        np.testing.assert_array_equal(np.asarray(cropped), pixels[8:152, 14:110])
        # Verify the largest legal area, including the transposed landscape case.
        for size in [(125, 160), (160, 125), (1280, 720)]:
            with self.subTest(size=size):
                result = image_loader._center_crop_to_multiple(Image.new("RGB", size), 16)
                areas = [w * h for w in range(16, size[0] + 1, 16)
                         for h in range(16, size[1] + 1, 16)
                         if any(w * rh == h * rw for rw, rh in image_loader._COMMON_ASPECT_RATIOS)]
                self.assertEqual(result.width * result.height, max(areas))

    def test_all_supported_common_ratios_remain_unchanged_when_aligned(self):
        expected = {
            (1, 1), (4, 5), (5, 4), (3, 4), (4, 3),
            (2, 3), (3, 2), (9, 16), (16, 9), (2, 1), (1, 2),
        }
        self.assertEqual(set(image_loader._COMMON_ASPECT_RATIOS), expected)
        for ratio_width, ratio_height in expected:
            with self.subTest(ratio=(ratio_width, ratio_height)):
                size = (ratio_width * 64, ratio_height * 64)
                image = Image.new("RGB", size, "red")
                self.assertEqual(
                    image_loader._center_crop_to_multiple(image, 8).size,
                    size,
                )

    def test_small_images_are_upscaled_before_multiple_crop(self):
        with TemporaryDirectory() as directory:
            base = Path(directory)
            Image.new("RGB", (32, 63), "red").save(base / "source.png")
            with patch.object(image_loader, "_base_directory", return_value=base):
                images, = image_loader.NO8DLoadImages().load(
                    "[]", '[{"name":"source.png"}]', "64"
                )
        height, width = images[0].shape[1:3]
        self.assertGreater(width * height, 32 * 63)
        self.assertEqual(width % 64, 0)
        self.assertEqual(height % 64, 0)

    def test_upscale_threshold_and_aspect_ratio(self):
        image = Image.new("RGB", (125, 160), "red")
        enlarged = image_loader._upscale_for_crop(image)
        self.assertEqual(enlarged.size, (884, 1132))
        self.assertGreaterEqual(enlarged.width * enlarged.height, 1_000_000)
        self.assertLess(abs(enlarged.width / enlarged.height - 125 / 160), 0.001)
        for size in [(1000, 1000), (2000, 1000)]:
            original = Image.new("RGB", size)
            self.assertIs(image_loader._upscale_for_crop(original), original)

    def test_uses_exact_portrait_ratio_for_small_images(self):
        image = Image.new("RGB", (64, 128), "red")
        self.assertEqual(
            image_loader._center_crop_to_multiple(image, 64).size,
            (64, 128),
        )

    def test_crop_multiple_participates_in_change_fingerprint(self):
        with patch.object(image_loader, "_ref_to_path", return_value=Path("missing.png")):
            no_crop = image_loader.NO8DLoadImages.IS_CHANGED("[]", '[{"name":"source.png"}]', "none")
            crop_8 = image_loader.NO8DLoadImages.IS_CHANGED("[]", '[{"name":"source.png"}]', "8")
        self.assertNotEqual(no_crop, crop_8)


if __name__ == "__main__":
    unittest.main()
