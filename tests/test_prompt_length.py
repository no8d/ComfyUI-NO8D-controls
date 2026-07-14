from __future__ import annotations

import unittest

from test_prompt_camera_geometry import prompt_plus


class PromptLengthTests(unittest.TestCase):
    def test_standard_mode_uses_256_token_limit(self):
        self.assertEqual(prompt_plus._max_tokens_for_length("标准"), 256)
        self.assertEqual(prompt_plus._max_tokens_for_length("Standard"), 256)
        self.assertIn("approximately 256 tokens", prompt_plus._LENGTH_PRESET_RULES["标准"])
        self.assertIn("Aim close to 256 tokens", prompt_plus._LENGTH_PRESET_RULES["标准"])
        self.assertIn("hard maximum of 256 output tokens", prompt_plus._LENGTH_PRESET_RULES["标准"])

    def test_detailed_mode_uses_512_token_limit(self):
        self.assertEqual(prompt_plus._max_tokens_for_length("详细"), 512)
        self.assertEqual(prompt_plus._max_tokens_for_length("Detailed"), 512)
        self.assertIn("approximately 512 tokens", prompt_plus._LENGTH_PRESET_RULES["详细"])
        self.assertIn("Aim close to 512 tokens", prompt_plus._LENGTH_PRESET_RULES["详细"])
        self.assertIn("hard maximum of 512 output tokens", prompt_plus._LENGTH_PRESET_RULES["详细"])

    def test_natural_request_reserves_hidden_analysis_tokens(self):
        self.assertEqual(prompt_plus._max_tokens_for_request("标准", prompt_plus._RULE_NATURAL), 2048)
        self.assertEqual(prompt_plus._max_tokens_for_request("详细", prompt_plus._RULE_NATURAL), 2304)
        self.assertEqual(prompt_plus._max_tokens_for_request("标准", "json结构"), 256)

    def test_both_modes_put_spatial_relationships_before_secondary_details(self):
        for mode in ("标准", "详细"):
            with self.subTest(mode=mode):
                rule = prompt_plus._LENGTH_PRESET_RULES[mode]
                self.assertIn("camera-to-subject relationship", rule)
                self.assertIn("frame placement", rule)

    def test_rendered_prompt_is_limited_without_cutting_its_camera_prefix(self):
        prefix = "Editorial photography; the camera is at subject eye level relative to the woman. "
        text = prefix + ("A richly detailed neon-lit brick room with tactile materials and warm atmosphere. " * 80)
        limited = prompt_plus._limit_prompt_to_approx_tokens(text, 256)
        self.assertTrue(limited.startswith(prefix))
        self.assertLessEqual(prompt_plus._approx_prompt_tokens(limited), 256)
        self.assertRegex(limited, r"[.!?]$")

    def test_detailed_limit_retains_more_than_standard_limit(self):
        text = "A cinematic scene with layered spatial detail and atmospheric lighting. " * 100
        standard = prompt_plus._limit_prompt_to_approx_tokens(text, 256)
        detailed = prompt_plus._limit_prompt_to_approx_tokens(text, 512)
        self.assertGreater(len(detailed), len(standard))


if __name__ == "__main__":
    unittest.main()
