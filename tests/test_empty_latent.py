import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


PACKAGE_DIR = Path(__file__).resolve().parents[1]


class _NativeCoreEmptyLatent:
    calls = []

    def generate(self, width, height, batch_size=1):
        self.calls.append((width, height, batch_size))
        return ({"native": "sd"},)


nodes_stub = types.ModuleType("nodes")
nodes_stub.MAX_RESOLUTION = 16384
nodes_stub.EmptyLatentImage = _NativeCoreEmptyLatent

module_spec = importlib.util.spec_from_file_location(
    "_test_empty_latent_module", PACKAGE_DIR / "empty_latent.py"
)
empty_latent = importlib.util.module_from_spec(module_spec)
with patch.dict(sys.modules, {"nodes": nodes_stub}):
    module_spec.loader.exec_module(empty_latent)


class TestNO8DEmptyLatent(unittest.TestCase):
    def setUp(self):
        _NativeCoreEmptyLatent.calls.clear()

    def test_delegates_to_native_core_node(self):
        latent, width, height = empty_latent.NO8DEmptyLatent().generate(
            "2:3", "512", batch_size=2
        )

        self.assertEqual((width, height), (512, 768))
        self.assertEqual(latent, {"native": "sd"})
        self.assertEqual(_NativeCoreEmptyLatent.calls, [(512, 768, 2)])

    def test_inverted_ratio_swaps_final_orientation(self):
        latent, width, height = empty_latent.NO8DEmptyLatent().generate(
            "9:16", "768", invert_ratio=True, batch_size=3
        )
        self.assertEqual((width, height), (1368, 768))
        self.assertEqual(latent, {"native": "sd"})
        self.assertEqual(_NativeCoreEmptyLatent.calls, [(1368, 768, 3)])

    def test_manual_short_and_long_sides_follow_portrait_orientation(self):
        _, width, height = empty_latent.NO8DEmptyLatent().generate(
            "4:5",
            "512",
            manual_short_side=801,
            manual_long_side=1001,
        )

        self.assertEqual((width, height), (800, 1000))

    def test_manual_short_and_long_sides_follow_landscape_orientation(self):
        _, width, height = empty_latent.NO8DEmptyLatent().generate(
            "4:5",
            "512",
            invert_ratio=True,
            manual_short_side=801,
            manual_long_side=1001,
        )

        self.assertEqual((width, height), (1000, 800))

    def test_single_manual_short_side_uses_aspect_ratio(self):
        _, width, height = empty_latent.NO8DEmptyLatent().generate(
            "4:5", "512", manual_short_side=800
        )

        self.assertEqual((width, height), (800, 1000))

    def test_single_manual_long_side_uses_aspect_ratio(self):
        _, width, height = empty_latent.NO8DEmptyLatent().generate(
            "4:5", "512", invert_ratio=True, manual_long_side=1000
        )

        self.assertEqual((width, height), (1000, 800))

    def test_input_order_matches_ui_contract(self):
        required = empty_latent.NO8DEmptyLatent.INPUT_TYPES()["required"]

        self.assertEqual(
            list(required),
            [
                "aspect_ratio",
                "short_side",
                "invert_ratio",
                "manual_short_side",
                "manual_long_side",
                "batch_size",
            ],
        )


if __name__ == "__main__":
    unittest.main()
