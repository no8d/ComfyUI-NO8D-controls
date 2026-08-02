from __future__ import annotations

import importlib.util
import pathlib
import unittest

import torch


def _load_module():
    path = pathlib.Path(__file__).resolve().parents[1] / "krea2_reference_latent_match.py"
    spec = importlib.util.spec_from_file_location("no8d_krea2_reference_match_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MATCH = _load_module()


class Krea2ReferenceLatentMatchTests(unittest.TestCase):
    def test_matches_4d_reference_grid_without_mutating_input(self):
        text_conditioning = torch.randn(1, 4, 8)
        reference = torch.randn(1, 16, 8, 6)
        metadata = {"reference_latents": [reference], "tag": "keep"}
        conditioning = [[text_conditioning, metadata]]
        target = {"samples": torch.randn(1, 16, 16, 12)}

        result = MATCH.match_krea2_reference_latents(conditioning, target)

        resized = result[0][1]["reference_latents"][0]
        self.assertEqual(tuple(resized.shape), (1, 16, 16, 12))
        self.assertEqual(resized.dtype, reference.dtype)
        self.assertIs(result[0][0], text_conditioning)
        self.assertEqual(result[0][1]["tag"], "keep")
        self.assertIs(conditioning[0][1]["reference_latents"][0], reference)
        self.assertEqual(tuple(reference.shape), (1, 16, 8, 6))
        self.assertIsNot(result[0][1], metadata)

    def test_matches_5d_wan_reference_grid_and_preserves_frames(self):
        reference = torch.randn(2, 16, 3, 8, 6)
        conditioning = [[torch.randn(1), {"reference_latents": [reference]}]]
        target = {"samples": torch.randn(2, 16, 16, 12)}

        result = MATCH.match_krea2_reference_latents(
            conditioning, target, method="bicubic"
        )

        self.assertEqual(
            tuple(result[0][1]["reference_latents"][0].shape),
            (2, 16, 3, 16, 12),
        )

    def test_reuses_reference_when_grid_already_matches(self):
        reference = torch.randn(1, 16, 8, 6)
        conditioning = [[torch.randn(1), {"reference_latents": [reference]}]]
        target = {"samples": torch.randn(1, 16, 8, 6)}

        result = MATCH.match_krea2_reference_latents(conditioning, target)

        self.assertIs(result[0][1]["reference_latents"][0], reference)

    def test_conditioning_without_references_passes_through_safely(self):
        tensor = torch.randn(1)
        metadata = {"tag": "no-reference"}
        conditioning = [[tensor, metadata]]
        target = {"samples": torch.randn(1, 16, 8, 6)}

        result = MATCH.match_krea2_reference_latents(conditioning, target)

        self.assertIs(result[0][0], tensor)
        self.assertEqual(result[0][1], metadata)
        self.assertIsNot(result[0][1], metadata)

    def test_rejects_invalid_target_and_reference_shapes(self):
        with self.assertRaisesRegex(ValueError, "target_latent"):
            MATCH.match_krea2_reference_latents([], {"samples": torch.randn(8, 6)})

        conditioning = [[torch.randn(1), {"reference_latents": [torch.randn(8, 6)]}]]
        target = {"samples": torch.randn(1, 16, 8, 6)}
        with self.assertRaisesRegex(ValueError, "4D or 5D"):
            MATCH.match_krea2_reference_latents(conditioning, target)

    def test_node_contract_and_registration(self):
        required = MATCH.NO8DMatchKrea2ReferenceLatents.INPUT_TYPES()["required"]
        self.assertEqual(required["conditioning"], ("CONDITIONING",))
        self.assertEqual(required["target_latent"], ("LATENT",))
        self.assertIn("bilinear", required["method"][0])
        self.assertIn("NO8DMatchKrea2ReferenceLatents", MATCH.NODE_CLASS_MAPPINGS)


if __name__ == "__main__":
    unittest.main()
