from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKAGE = "no8d_controls_test"


def _load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


package = types.ModuleType(PACKAGE)
package.__path__ = [str(ROOT)]
sys.modules[PACKAGE] = package
_load_module(f"{PACKAGE}.prompt_config", ROOT / "prompt_config.py")
prompt_plus = _load_module(f"{PACKAGE}.prompt_plus", ROOT / "prompt_plus.py")


class PromptCameraGeometryTests(unittest.TestCase):
    def _system_prompt(self, *, input_mode="image", composition="自行判断"):
        messages = prompt_plus._build_messages(
            "",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            "data:image/jpeg;base64,AA==",
            "自行判断",
            composition,
            "标准",
            "英文",
            input_mode,
        )
        return messages[0]["content"]

    def test_image_prompt_requires_angle_and_lens_evidence(self):
        system = self._system_prompt()
        self.assertIn("Camera geometry and subject relationship evidence (mandatory and direction-neutral for every image input)", system)
        self.assertIn("exactly one internal result: downward-looking, level, upward-looking, or indeterminate", system)
        self.assertIn("Lens width and camera elevation are independent", system)
        self.assertIn("Wide or ultra-wide perspective is not evidence of looking upward", system)
        self.assertIn("reject any upward-looking wording when downward evidence was selected", system)

    def test_camera_subject_and_frame_coordinates_are_independent(self):
        system = self._system_prompt()
        self.assertIn("Keep three coordinate systems separate", system)
        self.assertIn("camera's position relative to the subject", system)
        self.assertIn("subject's own facing/orientation", system)
        self.assertIn("subject's placement inside the image frame", system)
        self.assertIn("`frame-left` and `frame-right` always mean the viewer's image coordinates", system)

    def test_horizontal_camera_position_and_screen_placement_are_required(self):
        system = self._system_prompt()
        self.assertIn("front-left three-quarter", system)
        self.assertIn("front-right three-quarter", system)
        self.assertIn("view travels through the scene from frame-left to frame-right or frame-right to frame-left", system)
        self.assertIn("left / center / right and upper / middle / lower regions", system)
        self.assertIn("reject mirrored placement relative to the visible image", system)

    def test_non_human_subjects_use_object_specific_orientation_evidence(self):
        system = self._system_prompt()
        self.assertIn("people, animals, buildings, vehicles, products, plants, furniture, and other objects", system)
        self.assertIn("For a subject without a meaningful front, do not invent one", system)
        self.assertIn("rather than anthropomorphizing the object", system)

    def test_diagonal_subject_uses_endpoints_instead_of_center_label(self):
        system = self._system_prompt()
        self.assertIn("Do not reduce an extended or diagonal subject to a single center label", system)
        self.assertIn("head, torso/center mass, and legs/feet", system)
        self.assertIn("lower-left to upper-right", system)

    def test_human_shot_scale_uses_visible_body_extent(self):
        system = self._system_prompt()
        self.assertIn("Determine human shot scale from visible body extent", system)
        self.assertIn("head and most or all legs/feet are visible", system)
        self.assertIn("reserve medium shot for roughly waist-up framing", system)

    def test_character_identity_is_not_guessed_from_costume_color(self):
        system = self._system_prompt()
        self.assertIn("Do not guess a character name from costume color alone", system)

    def test_image_prompt_does_not_use_the_old_upward_angle_anchor(self):
        system = self._system_prompt()
        self.assertNotIn("Never normalize a low-angle view to eye level", system)
        self.assertNotIn("worm's-eye or very low angle, low angle / looking up", system)
        self.assertNotIn("wide shot, low angle, high angle", system)

    def test_angle_uncertainty_does_not_become_a_slight_tilt(self):
        system = self._system_prompt()
        self.assertIn('Never use "slight upward", "slight downward"', system)
        self.assertIn("choose level or omit the angle when evidence is insufficient", system)

    def test_auto_shot_scale_preserves_observed_image_framing(self):
        system = self._system_prompt()
        self.assertIn("reproduce its observed shot scale", system)
        self.assertNotIn("choose how close or far the main subject should appear based on the scene", system)

    def test_manual_shot_scale_does_not_replace_other_camera_geometry(self):
        system = self._system_prompt(composition="特写")
        self.assertIn("may change only camera distance", system)
        self.assertIn("Preserve viewing direction, lens character, camera roll, and perspective strength", system)

    def test_text_only_designs_geometry_without_claiming_image_evidence(self):
        messages = prompt_plus._build_messages(
            "a lighthouse",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            "",
            "自行判断",
            "自行判断",
            "标准",
            "英文",
            "text",
        )
        system = messages[0]["content"]
        self.assertNotIn("Camera geometry and subject relationship evidence", system)
        self.assertIn("Designed camera geometry and subject relationship", system)
        self.assertIn("mandatory for every text expansion", system)
        self.assertIn("virtual viewpoint used to construct the image", system)
        self.assertIn("Do not omit this relationship", system)
if __name__ == "__main__":
    unittest.main()
