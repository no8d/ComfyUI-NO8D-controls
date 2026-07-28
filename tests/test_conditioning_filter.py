from __future__ import annotations

import importlib.util
import pathlib
import unittest


def _load_module():
    path = pathlib.Path(__file__).resolve().parents[1] / "conditioning_filter.py"
    spec = importlib.util.spec_from_file_location("no8d_conditioning_filter_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FILTER = _load_module()


class ConditioningFilterTests(unittest.TestCase):
    def test_removes_reference_latents_without_mutating_input(self):
        tensor = object()
        reference_latents = [object()]
        metadata = {
            "reference_latents": reference_latents,
            "pooled_output": object(),
            "reference_latents_method": "index_timestep_zero",
        }
        conditioning = [[tensor, metadata]]

        result = FILTER.remove_krea2_reference_latents(conditioning)

        self.assertIs(result[0][0], tensor)
        self.assertNotIn("reference_latents", result[0][1])
        self.assertIs(result[0][1]["pooled_output"], metadata["pooled_output"])
        self.assertEqual(result[0][1]["reference_latents_method"], "index_timestep_zero")
        self.assertIs(conditioning[0][1]["reference_latents"], reference_latents)
        self.assertIsNot(result[0][1], metadata)

    def test_preserves_multiple_entries_and_missing_keys(self):
        conditioning = [
            [object(), {"reference_latents": [object()], "tag": "first"}],
            [object(), {"tag": "second"}],
        ]

        result = FILTER.remove_krea2_reference_latents(conditioning)

        self.assertEqual([entry[1]["tag"] for entry in result], ["first", "second"])
        self.assertTrue(all("reference_latents" not in entry[1] for entry in result))

    def test_node_contract_and_registration(self):
        node = FILTER.NO8DRemoveKrea2ReferenceLatents()
        conditioning = [[object(), {"reference_latents": [object()]}]]

        result = node.remove(conditioning)

        self.assertEqual(FILTER.NO8DRemoveKrea2ReferenceLatents.RETURN_TYPES, ("CONDITIONING",))
        self.assertEqual(
            FILTER.NO8DRemoveKrea2ReferenceLatents.INPUT_TYPES()["required"]["conditioning"],
            ("CONDITIONING",),
        )
        self.assertNotIn("reference_latents", result[0][0][1])
        self.assertIn("NO8DRemoveKrea2ReferenceLatents", FILTER.NODE_CLASS_MAPPINGS)

    def test_rejects_malformed_conditioning_entries(self):
        with self.assertRaisesRegex(ValueError, "tensor and metadata"):
            FILTER.remove_krea2_reference_latents([[object()]])


if __name__ == "__main__":
    unittest.main()
