from __future__ import annotations

import json
import io
import unittest
from unittest import mock

from test_prompt_camera_geometry import prompt_plus


class PromptStylePresetTests(unittest.TestCase):
    def test_public_style_choices_are_umbrella_categories(self):
        self.assertEqual(
            prompt_plus._STYLE_PRESETS,
            ("自行判断", "写实摄影", "动漫插图", "手绘艺术", "数字艺术"),
        )

    def test_legacy_style_choices_migrate_to_nearest_umbrella(self):
        expected = {
            "业余摄影": "写实摄影",
            "Professional photography": "写实摄影",
            "影视摄影": "写实摄影",
            "日式动漫": "动漫插图",
            "3D cartoon": "动漫插图",
            "艺术手绘": "手绘艺术",
            "数字绘画": "数字艺术",
            "油画艺术": "手绘艺术",
            "Illustration art": "数字艺术",
            "3d写实": "数字艺术",
        }
        for old_value, category in expected.items():
            with self.subTest(old_value=old_value):
                self.assertEqual(prompt_plus._normalize_style_preset(old_value), category)

    def test_each_category_infers_one_evidence_based_subtype(self):
        for category in prompt_plus._STYLE_PRESETS[1:]:
            with self.subTest(category=category):
                rule = prompt_plus._style_preset_rule(category)
                self.assertIn("upper-level style category", rule)
                self.assertIn("Choose one best-fitting subtype", rule)
                self.assertIn("do not list alternatives", rule.lower())
                self.assertIn("With an image, visual evidence determines the subtype", rule)
                self.assertIn("with text only, infer it", rule)

    def test_realistic_photography_can_choose_phone_dslr_or_cinematic(self):
        rule = prompt_plus._style_preset_rule("写实摄影")
        self.assertIn("smartphone snapshot", rule)
        self.assertIn("DSLR/mirrorless", rule)
        self.assertIn("cinematic film still", rule)
        self.assertIn("Keep rough phone images rough", rule)

    def test_selected_category_and_subtype_are_added_to_system_prompt(self):
        messages = prompt_plus._build_messages(
            "雨夜街头",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            style_preset="写实摄影",
            input_mode="text",
        )
        system = messages[0]["content"]
        self.assertIn("Treat 写实摄影 as an upper-level style category", system)
        self.assertIn("Apply the selected upper-level category and the inferred subtype", system)

    def test_auto_style_is_limited_to_four_categories_and_requires_a_subtype(self):
        messages = prompt_plus._build_messages(
            "",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            "data:image/jpeg;base64,AA==",
            "自行判断",
            "自行判断",
            "标准",
            "英文",
            "image",
        )
        system = messages[0]["content"]
        user_text = messages[1]["content"][0]["text"]
        self.assertIn("mandatory two-level style classification", system)
        self.assertIn("realistic photography, anime illustration, hand-drawn art, or digital art", system)
        self.assertIn("generic phrases by themselves", system)
        self.assertIn("atmospheric photography", system)
        self.assertIn("Mandatory style task", user_text)
        self.assertIn("exactly one of these four categories", user_text)

    def test_image_final_audit_repeats_geometry_requirements(self):
        audit = prompt_plus._final_output_audit("自行判断", "image")
        self.assertIn("answer is invalid unless", audit)
        self.assertIn("camera's vertical relationship", audit)
        self.assertIn("camera/subject front-side-rear relationship", audit)
        self.assertIn("viewer-relative spatial extent", audit)
        self.assertIn("dominant axis", audit)
        self.assertIn("left/right and front/back arrangement", audit)
        self.assertIn("first sentence combines the concrete style subtype", audit)
        self.assertIn("merely repeating camera wording supplied by the user", audit)

    def test_image_user_task_requires_concrete_camera_subject_relationship(self):
        task = prompt_plus._camera_task_instruction("image")
        self.assertIn("above, roughly level with, or below", task)
        self.assertIn("frontal, side, rear, or three-quarter relationship", task)
        self.assertIn("left/center/right and upper/middle/lower frame placement", task)
        self.assertIn("lens class and its visible perspective effect", task)
        self.assertIn("Do not replace these facts with generic phrases", task)
        self.assertIn("opening sentence of the final prompt", task)
        self.assertIn("Do not omit it when the user supplies no camera wording", task)

    def test_image_only_request_requires_lens_inference_without_text_hint(self):
        messages = prompt_plus._build_messages(
            "",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            "data:image/jpeg;base64,AA==",
            "自行判断",
            "自行判断",
            "标准",
            "英文",
            "image",
        )
        request = messages[1]["content"][0]["text"]
        self.assertIn("Input mode: image only", request)
        self.assertIn("lens class and its visible perspective effect", request)
        self.assertIn("Repeating a user-provided lens phrase alone does not satisfy", request)

    def test_natural_image_request_requires_structured_composition_analysis(self):
        messages = prompt_plus._build_messages(
            "",
            prompt_plus._RULE_NATURAL,
            "",
            0,
            "data:image/jpeg;base64,AA==",
            "自行判断",
            "自行判断",
            "标准",
            "英文",
            "image",
        )
        system = messages[0]["content"]
        self.assertIn("Natural-prompt analysis envelope", system)
        self.assertIn('"primary_subject_bbox_xyxy"', system)
        self.assertIn('"primary_subject_key_anchors"', system)
        self.assertIn('"head_or_front_xy"', system)
        self.assertIn('"legs_rear_or_far_extent_xy"', system)
        self.assertIn('"primary_subject_dominant_axis"', system)
        self.assertIn('"primary_subject_visible_extent"', system)
        self.assertIn('"primary_subject_frame_occupancy_percent"', system)
        self.assertIn('"secondary_subjects"', system)
        self.assertIn('"geometry_evidence_or_design_basis"', system)
        self.assertIn("top surfaces support a camera above/looking downward", system)
        self.assertIn("Do not call a view eye-level merely because the subject looks toward the camera", system)

    def test_natural_analysis_envelope_is_removed_from_node_output(self):
        raw = """{
          "visual_analysis": {
            "style_category": "realistic photography",
            "style_subtype": "cinematic editorial photography",
            "camera_elevation": "above",
            "view_direction": "downward"
          },
          "prompt": "A cinematic editorial photograph viewed from above, looking downward across the foreground subject."
        }"""
        cleaned = prompt_plus._clean_prompt_output(raw, prompt_plus._RULE_NATURAL)
        self.assertEqual(
            cleaned,
            "A cinematic editorial photograph viewed from above, looking downward across the foreground subject.",
        )

    def test_geometry_renderer_derives_diagonal_full_body_layout_from_evidence(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "cinematic editorial photography",
                "primary_subject": "a reclining woman",
                "primary_subject_key_anchors": {
                    "head_or_front_xy": [600, 280],
                    "center_mass_xy": [550, 500],
                    "legs_rear_or_far_extent_xy": [200, 750],
                },
                "primary_subject_visible_extent": "full_body",
                "primary_subject_frame_occupancy_percent": 70,
                "shot_scale": "medium",
                "camera_elevation": "above",
                "view_direction": "downward",
                "camera_azimuth_or_visible_side": "front three-quarter",
                "lens_class": "ultra-wide-angle",
                "secondary_subjects": [
                    {"visible_descriptor": "an orange-masked figure", "anchor_xy": [200, 250], "depth_layer": "background"},
                    {"visible_descriptor": "a red-masked figure", "anchor_xy": [800, 200], "depth_layer": "background"},
                ],
            },
            "scene_description": "She reclines on a worn leather couch while holding a pizza slice in a neon-lit brick room.",
        }
        cleaned = prompt_plus._clean_prompt_output(json.dumps(envelope), prompt_plus._RULE_NATURAL, "英文")
        self.assertIn("a full-body view", cleaned)
        self.assertNotIn("medium", cleaned)
        self.assertNotIn("centered", cleaned)
        self.assertIn("subject axis:", cleaned)
        self.assertIn("diagonal", cleaned)
        self.assertIn("upper right-of-center", cleaned)
        self.assertIn("lower left", cleaned)
        self.assertIn("foreground exaggeration", cleaned)
        self.assertIn("orange-masked figure", cleaned)

    def test_image_analysis_uses_low_temperature(self):
        self.assertEqual(prompt_plus._temperature_for_input(0.7, "image"), 0.1)
        self.assertEqual(prompt_plus._temperature_for_input(0.7, "image_text"), 0.1)
        self.assertEqual(prompt_plus._temperature_for_input(0.7, "text"), 0.7)

    def test_image_analysis_request_is_compact_and_geometry_focused(self):
        messages = prompt_plus._build_image_analysis_messages(
            "Shot with an ultra-wide-angle lens",
            "data:image/png;base64,abc",
            "自行判断",
            "自行判断",
            "标准",
            "英文",
        )
        system = messages[0]["content"]
        self.assertIn("do not write a finished prompt", system)
        self.assertIn("visible top plane", system)
        self.assertIn("clear perspective foreshortening", system)
        self.assertIn("choose level unless strong plane and perspective evidence jointly proves", system)
        self.assertIn("lens requirement never determines camera elevation", system)
        self.assertIn('"camera_elevation": "above | level | below"', system)
        self.assertIn('"view_direction": "downward | level | upward"', system)
        self.assertIn('"explicit_subject_requirement": ""', system)
        self.assertIn('do not replace "an American woman" with "a young woman"', system)

    def test_explicit_text_subject_requirement_overrides_visual_subject_label(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "outdoor fashion portrait photography",
                "explicit_subject_requirement": "an American woman",
                "primary_subject": "a young woman",
                "shot_scale": "full-body view",
                "camera_elevation": "below",
                "view_direction": "upward",
                "primary_subject_pose_and_action": "seated in grass with both knees drawn up",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertIn("relative to an American woman", rendered)
        self.assertNotIn("relative to a young woman", rendered)

    def test_empty_explicit_subject_requirement_keeps_visual_subject_label(self):
        envelope = {
            "visual_analysis": {
                "explicit_subject_requirement": "",
                "primary_subject": "a seated woman",
                "camera_elevation": "level",
                "view_direction": "level",
                "primary_subject_pose_and_action": "knees drawn up in tall grass",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertIn("relative to a seated woman", rendered)

    def test_strict_image_analysis_rejects_plain_prompt_fallback(self):
        with self.assertRaisesRegex(ValueError, "visual-analysis envelope"):
            prompt_plus._clean_prompt_output(
                "A low-angle cinematic prompt that ignored the JSON contract.",
                prompt_plus._RULE_NATURAL,
                "英文",
                True,
            )

    def test_strict_image_analysis_rejects_legacy_prompt_only_envelope(self):
        with self.assertRaisesRegex(ValueError, "visual-analysis envelope"):
            prompt_plus._clean_prompt_output(
                json.dumps({"visual_analysis": {"camera_elevation": "level"}, "prompt": "unverified"}),
                prompt_plus._RULE_NATURAL,
                "英文",
                True,
            )

    def test_partial_analysis_preserves_geometry_for_scene_only_completion(self):
        analysis = {"primary_subject": "a woman", "camera_elevation": "level"}
        raw = json.dumps({"visual_analysis": analysis})
        parsed_analysis, scene = prompt_plus._partial_analysis_envelope(raw)
        self.assertEqual(parsed_analysis, analysis)
        self.assertEqual(scene, "")

    def test_nested_scene_description_is_supported(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "editorial photography",
                "primary_subject": "a woman",
                "camera_elevation": "level",
                "view_direction": "level",
                "scene_description": "A woman sits in a neon-lit brick room.",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertIn("A woman sits in a neon-lit brick room.", rendered)

    @unittest.skipUnless(prompt_plus._repair_json is not None, "json-repair is not installed in this test interpreter")
    def test_strict_image_analysis_repairs_broken_json_syntax_before_validation(self):
        broken = """{
          "visual_analysis": {
            "style_subtype": "editorial photography",
            "primary_subject": "a woman",
            "camera_elevation": "level",
            "view_direction": "level"
          },
          "scene_description": "A woman in a neon-lit room" "holding a pizza slice."
        }"""
        cleaned = prompt_plus._clean_prompt_output(
            broken, prompt_plus._RULE_NATURAL, "英文", True
        )
        self.assertIn("editorial photography", cleaned)
        self.assertIn("neon-lit room", cleaned)

    def test_image_analysis_contract_requires_json_string_escaping(self):
        messages = prompt_plus._build_image_analysis_messages(
            "", "data:image/png;base64,abc", "自行判断", "自行判断", "标准", "英文"
        )
        self.assertIn("Escape internal double quotes", messages[0]["content"])

    def test_tight_portrait_does_not_become_high_angle_without_strong_evidence(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "studio portrait photography",
                "primary_subject": "a woman",
                "primary_subject_visible_extent": "head_and_shoulders",
                "shot_scale": "close-up",
                "camera_elevation": "above",
                "view_direction": "downward",
                "camera_azimuth_or_visible_side": "front",
                "geometry_evidence_or_design_basis": ["her shoulders and neckline are visible"],
            },
            "scene_description": "A woman poses against a warm red background.",
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertIn("at subject eye level", rendered)
        self.assertNotIn("above", rendered)
        self.assertNotIn("downward", rendered)

    def test_strong_high_angle_portrait_evidence_is_preserved(self):
        analysis = {
            "primary_subject_visible_extent": "head_and_shoulders",
            "shot_scale": "close-up",
            "camera_elevation": "above",
            "view_direction": "downward",
            "geometry_evidence_or_design_basis": [
                "a clear top plane of the head and pronounced facial foreshortening prove the camera is clearly above"
            ],
        }
        self.assertEqual(prompt_plus._validated_vertical_relation(analysis, True), ("above", "downward"))

    def test_structured_expression_is_rendered_explicitly(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "studio portrait photography",
                "primary_subject": "a woman",
                "primary_subject_expression": (
                    "eyes tightly squinted, brows pinched, nose wrinkled, mouth open with teeth visible, jaw tense"
                ),
                "shot_scale": "close-up",
                "camera_elevation": "level",
                "view_direction": "level",
            },
            "scene_description": "A woman poses against a warm red background.",
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertIn("facial expression and gaze:", rendered)
        self.assertIn("eyes tightly squinted", rendered)
        self.assertIn("mouth open with teeth visible", rendered)

    def test_compact_image_contract_requires_expression_evidence(self):
        messages = prompt_plus._build_image_analysis_messages(
            "", "data:image/png;base64,abc", "自行判断", "自行判断", "标准", "英文"
        )
        system = messages[0]["content"]
        self.assertIn('"primary_subject_expression": ""', system)
        self.assertIn("detailed eye/gaze", system)
        self.assertIn("mouth/lips/teeth", system)
        self.assertIn("Scale expression detail and priority with shot distance", system)
        self.assertIn('"primary_subject_appearance_and_clothing": ""', system)
        self.assertIn('"primary_subject_pose_and_action": ""', system)
        self.assertIn('"environment_and_spatial_context": ""', system)
        self.assertIn('"lighting_color_and_atmosphere": ""', system)
        self.assertIn("full-body/wide views prioritize complete pose", system)
        self.assertIn("head-to-upper-thigh is medium-long/cowboy", system)
        self.assertIn("Never call a thigh-up or knee-up subject a plain medium shot", system)
        self.assertIn("do not guess anatomical left/right from screen position", system)
        self.assertIn("list garment type, cut, layers, openings/straps", system)

    def test_close_expression_is_ordered_before_lens_details(self):
        envelope = {
            "visual_analysis": {
                "primary_subject": "a woman",
                "primary_subject_visible_extent": "head_and_shoulders",
                "shot_scale": "close-up",
                "primary_subject_expression": "eyes squinted and mouth open",
                "lens_class": "wide-angle",
            },
            "scene_description": "A woman poses against a red background.",
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertLess(rendered.index("facial expression and gaze"), rendered.index("wide-angle lens"))

    def test_extreme_wide_view_omits_unreadable_expression(self):
        envelope = {
            "visual_analysis": {
                "primary_subject": "a distant person",
                "shot_scale": "extreme wide shot",
                "primary_subject_expression": "eyes squinted and teeth visible",
            },
            "scene_description": "A distant person crosses a vast landscape.",
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertNotIn("facial expression and gaze", rendered)
        self.assertNotIn("teeth visible", rendered)

    def test_full_body_face_visibility_does_not_promote_fine_expression(self):
        analysis = {
            "shot_scale": "full-body view",
            "primary_subject_visible_extent": "face, torso, arms, legs, and feet all visible",
        }
        self.assertEqual(prompt_plus._expression_priority(analysis), "low")

    def test_explicit_medium_scale_is_not_promoted_by_visible_face_words(self):
        analysis = {
            "shot_scale": "medium shot",
            "primary_subject_visible_extent": "face, chest, waist, and upper thighs visible",
        }
        self.assertEqual(prompt_plus._expression_priority(analysis), "normal")

    def test_medium_scale_places_environment_and_atmosphere_before_expression(self):
        envelope = {
            "visual_analysis": {
                "primary_subject": "a woman",
                "shot_scale": "medium-long shot",
                "primary_subject_visible_extent": "head to upper thighs",
                "primary_subject_appearance_and_clothing": "fur-trimmed jacket, black cutout top, sunglasses, and hoop earrings",
                "primary_subject_pose_and_action": "leans against the overpass railing with one hand gripping it at frame-right",
                "environment_and_spatial_context": "elevated highway, receding traffic lanes, guardrail, and distant city towers",
                "lighting_color_and_atmosphere": "blue-gray dusk, cold cloud cover, warm road lights, and windswept urban atmosphere",
                "primary_subject_expression": "lips parted, jaw relaxed, eyes hidden by amber sunglasses",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        self.assertLess(rendered.index("elevated highway"), rendered.index("facial expression and gaze"))
        self.assertLess(rendered.index("blue-gray dusk"), rendered.index("facial expression and gaze"))

    def test_full_body_orders_pose_clothing_environment_and_atmosphere_before_expression(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "fashion studio photography",
                "primary_subject": "a person",
                "shot_scale": "full-body view",
                "primary_subject_visible_extent": "head-to-toe",
                "primary_subject_appearance_and_clothing": "a black sleeveless hooded top, narrow black shorts, dark sunglasses, and ankle boots",
                "primary_subject_pose_and_action": "torso leaning toward the lens, both arms extended outward with each hand gripping a separate light stand, legs close together",
                "primary_subject_expression": "lips slightly parted behind dark sunglasses",
                "environment_and_spatial_context": "studio cables and strobe heads spread across the pale floor beneath two surrounding light stands",
                "lighting_color_and_atmosphere": "cold cyan-green floor light, deep black shadows, low saturation, and a stark experimental studio atmosphere",
                "camera_elevation": "above",
                "view_direction": "downward",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        pose = rendered.index("torso leaning")
        clothing = rendered.index("black sleeveless")
        environment = rendered.index("studio cables")
        atmosphere = rendered.index("cold cyan-green")
        expression = rendered.index("facial expression and gaze")
        self.assertLess(pose, clothing)
        self.assertLess(clothing, environment)
        self.assertLess(environment, atmosphere)
        self.assertLess(atmosphere, expression)

    def test_full_body_standard_prompt_preserves_all_four_grounded_detail_groups(self):
        envelope = {
            "visual_analysis": {
                "primary_subject": "a person",
                "shot_scale": "full-body shot",
                "primary_subject_visible_extent": "head-to-toe",
                "primary_subject_appearance_and_clothing": "black sleeveless hooded top, black sunglasses, studded shorts, silver cuff bracelet, and glossy tall boots with pointed toes",
                "primary_subject_pose_and_action": "torso leaning forward, both arms extended outward with each hand gripping a separate light stand, legs close together",
                "environment_and_spatial_context": "studio cables, strobe heads, tripod light stands, and barn-door fixtures spread across a curved pale floor and backdrop",
                "lighting_color_and_atmosphere": "cool teal-cyan cast, hard directional light, sharp highlights, deep shadows, low saturation, and an experimental fashion-studio atmosphere",
                "primary_subject_expression": "lips slightly parted behind sunglasses",
                "lens_class": "ultra-wide-angle lens",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        limited = prompt_plus._limit_prompt_to_approx_tokens(rendered, 256)
        for evidence in ("torso leaning", "black sleeveless", "studio cables", "cool teal-cyan"):
            self.assertIn(evidence, limited)
        self.assertLessEqual(prompt_plus._approx_prompt_tokens(limited), 256)
        self.assertNotIn("lens lens", limited)
        self.assertIn("an ultra-wide-angle lens", limited)

    def test_full_body_standard_prompt_retains_complete_palette_tail(self):
        envelope = {
            "visual_analysis": {
                "style_subtype": "outdoor fashion portrait photography",
                "explicit_subject_requirement": "an American woman",
                "primary_subject": "a young woman",
                "primary_subject_key_anchors": {
                    "head_or_front_xy": [570, 260],
                    "center_mass_xy": [550, 520],
                    "legs_rear_or_far_extent_xy": [620, 820],
                },
                "shot_scale": "full-body view",
                "primary_subject_visible_extent": "head-to-toe full body",
                "primary_subject_frame_occupancy_percent": 55,
                "camera_elevation": "below",
                "view_direction": "upward",
                "camera_azimuth_or_visible_side": "front view with a slight three-quarter torso turn",
                "lens_class": "ultra-wide-angle",
                "primary_subject_pose_and_action": "seated on grassy dirt with both knees drawn up and bent, chin resting on one knee; one hand flat on the ground at frame-left",
                "primary_subject_appearance_and_clothing": "oversized long black shaggy faux-fur coat, sheer black tights, and white slouchy ruffled-cuff socks",
                "environment_and_spatial_context": "tall green grass and broad-leaf weeds in the foreground, dry cracked dirt beneath the subject, and an open rolling field behind her",
                "lighting_color_and_atmosphere": "soft diffused natural daylight, muted cool palette with a teal-blue sky and earthy greens and browns",
            }
        }
        rendered = prompt_plus._render_natural_prompt(envelope, "英文", True)
        limited = prompt_plus._limit_prompt_to_approx_tokens(rendered, 256)
        self.assertIn("relative to an American woman", limited)
        self.assertIn("earthy greens and browns", limited)
        self.assertNotIn("earthy.", limited)
        self.assertLessEqual(prompt_plus._approx_prompt_tokens(limited), 256)

    def test_image_and_text_modes_use_separate_configured_models(self):
        service = {"vision_model": "Qwen/Qwen3-VL-8B-Instruct"}
        text_model = "Qwen/Qwen3-VL-8B-Thinking"
        self.assertEqual(prompt_plus._model_for_input(service, text_model, "image"), service["vision_model"])
        self.assertEqual(prompt_plus._model_for_input(service, text_model, "image_text"), service["vision_model"])
        self.assertEqual(prompt_plus._model_for_input(service, text_model, "text"), text_model)

    def test_thinking_model_migrates_to_available_instruct_vision_model(self):
        data = {
            "prompt_rules": {},
            "prompt_rule_modes": {},
            "services": [{
                "id": "custom",
                "type": "openai_compatible",
                "models": [{"name": "Qwen/Qwen3-VL-8B-Thinking", "is_default": True}],
                "model_options": ["Qwen/Qwen3-VL-8B-Thinking", "Qwen/Qwen3-VL-8B-Instruct"],
            }],
        }
        normalized, changed = prompt_plus.prompt_config_manager.normalize_config(data)
        self.assertTrue(changed)
        self.assertEqual(normalized["services"][0]["vision_model"], "Qwen/Qwen3-VL-8B-Instruct")

    def test_timeout_is_not_retried_for_the_same_slow_request(self):
        with mock.patch.object(prompt_plus, "_urlopen", side_effect=TimeoutError("slow")) as urlopen:
            with self.assertRaisesRegex(RuntimeError, "request was not repeated"):
                prompt_plus._chat_completion(
                    "https://example.com/v1",
                    "",
                    "vision-model",
                    [{"role": "user", "content": "test"}],
                    0.1,
                    256,
                )
        self.assertEqual(urlopen.call_count, 1)

    def test_only_ark_uses_streaming_chat(self):
        self.assertTrue(prompt_plus._uses_streaming_chat("https://ark.cn-beijing.volces.com/api/v3"))
        self.assertFalse(prompt_plus._uses_streaming_chat("https://api.siliconflow.cn/v1"))

    def test_ark_doubao_seed_disables_deep_thinking(self):
        with mock.patch.object(prompt_plus, "_urlopen", side_effect=TimeoutError("stop")), mock.patch.object(
            prompt_plus.urllib.request, "Request", wraps=prompt_plus.urllib.request.Request
        ) as request:
            with self.assertRaises(RuntimeError):
                prompt_plus._chat_completion(
                    "https://ark.cn-beijing.volces.com/api/v3",
                    "test-key",
                    "doubao-seed-2-1-turbo-260628",
                    [{"role": "user", "content": "test"}],
                    0.1,
                    256,
                )
        payload = json.loads(request.call_args.kwargs["data"].decode("utf-8"))
        self.assertEqual(payload["thinking"], {"type": "disabled"})

    def test_non_ark_compatible_api_does_not_receive_ark_thinking_option(self):
        with mock.patch.object(prompt_plus, "_urlopen", side_effect=TimeoutError("stop")), mock.patch.object(
            prompt_plus.urllib.request, "Request", wraps=prompt_plus.urllib.request.Request
        ) as request:
            with self.assertRaises(RuntimeError):
                prompt_plus._chat_completion(
                    "https://api.siliconflow.cn/v1",
                    "test-key",
                    "Qwen/Qwen3-VL-8B-Instruct",
                    [{"role": "user", "content": "test"}],
                    0.1,
                    256,
                )
        payload = json.loads(request.call_args.kwargs["data"].decode("utf-8"))
        self.assertNotIn("thinking", payload)

    def test_verified_multimodal_providers_use_native_json_schema(self):
        for url in ("https://ark.cn-beijing.volces.com/api/v3", "https://api.siliconflow.cn/v1"):
            with self.subTest(url=url):
                response_format = prompt_plus._image_analysis_response_format(url)
                self.assertEqual(response_format["type"], "json_schema")
                schema = response_format["json_schema"]["schema"]
                self.assertEqual(schema["required"], ["visual_analysis"])
                self.assertFalse(schema["additionalProperties"])
                analysis = schema["properties"]["visual_analysis"]
                for field in (
                    "explicit_subject_requirement",
                    "primary_subject_appearance_and_clothing",
                    "primary_subject_pose_and_action",
                    "environment_and_spatial_context",
                    "lighting_color_and_atmosphere",
                ):
                    self.assertIn(field, analysis["required"])
                self.assertEqual(analysis["properties"]["primary_subject_appearance_and_clothing"]["maxLength"], 200)
                self.assertEqual(analysis["properties"]["explicit_subject_requirement"]["maxLength"], 100)
                self.assertEqual(analysis["properties"]["primary_subject_pose_and_action"]["maxLength"], 170)
                self.assertEqual(analysis["properties"]["environment_and_spatial_context"]["maxLength"], 180)
                self.assertEqual(analysis["properties"]["lighting_color_and_atmosphere"]["maxLength"], 130)

    def test_unknown_compatible_api_does_not_receive_unverified_json_schema(self):
        self.assertIsNone(prompt_plus._image_analysis_response_format("https://example.com/v1"))

    def test_scene_completion_schema_requests_only_missing_field(self):
        response_format = prompt_plus._image_analysis_response_format(
            "https://ark.cn-beijing.volces.com/api/v3",
            scene_only=True,
        )
        schema = response_format["json_schema"]["schema"]
        self.assertEqual(list(schema["properties"]), ["scene_description"])
        self.assertEqual(schema["required"], ["scene_description"])

    def test_ark_request_enables_streaming_and_joins_sse_content(self):
        response = io.BytesIO(
            b'data: {"choices":[{"delta":{"content":"first "}}]}\n\n'
            b'data: {"choices":[{"delta":{"content":"second"}}]}\n\n'
            b'data: [DONE]\n\n'
        )
        response.__enter__ = mock.Mock(return_value=response)
        response.__exit__ = mock.Mock(return_value=False)
        with mock.patch.object(prompt_plus, "_urlopen", return_value=response), mock.patch.object(
            prompt_plus.urllib.request, "Request", wraps=prompt_plus.urllib.request.Request
        ) as request:
            result = prompt_plus._chat_completion(
                "https://ark.cn-beijing.volces.com/api/v3",
                "test-key",
                "doubao-model",
                [{"role": "user", "content": "test"}],
                0.1,
                256,
            )
        payload = json.loads(request.call_args.kwargs["data"].decode("utf-8"))
        self.assertTrue(payload["stream"])
        self.assertEqual(result, "first second")

    def test_ark_timeout_names_provider_and_model_without_qwen_advice(self):
        message = prompt_plus._timeout_message(
            "https://ark.cn-beijing.volces.com/api/v3", "doubao-seed-2-1-turbo-260628"
        )
        self.assertIn("ark.cn-beijing.volces.com", message)
        self.assertIn("doubao-seed-2-1-turbo-260628", message)
        self.assertNotIn("Instruct", message)

    def test_ark_streaming_burst_retries_once_after_paced_delay(self):
        burst = io.BytesIO(
            b'data: {"error":{"code":"RequestBurstTooFast","message":"slow down","type":"TooManyRequests"}}\n\n'
        )
        success = io.BytesIO(b'data: {"choices":[{"delta":{"content":"result"}}]}\n\ndata: [DONE]\n\n')
        with mock.patch.object(prompt_plus, "_urlopen", side_effect=[burst, success]) as urlopen, mock.patch.object(
            prompt_plus.time, "sleep"
        ) as sleep:
            result = prompt_plus._chat_completion(
                "https://ark.cn-beijing.volces.com/api/v3",
                "test-key",
                "doubao-model",
                [{"role": "user", "content": "test"}],
                0.1,
                256,
            )
        self.assertEqual(result, "result")
        self.assertEqual(urlopen.call_count, 2)
        sleep.assert_called_once_with(prompt_plus._ARK_BURST_RETRY_DELAY)

    def test_streaming_error_after_content_is_not_retried(self):
        response = io.BytesIO(
            b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            b'data: {"error":{"code":"RequestBurstTooFast","message":"slow down","type":"TooManyRequests"}}\n\n'
        )
        with mock.patch.object(prompt_plus, "_urlopen", return_value=response) as urlopen, mock.patch.object(
            prompt_plus.time, "sleep"
        ) as sleep:
            with self.assertRaisesRegex(RuntimeError, "RequestBurstTooFast"):
                prompt_plus._chat_completion(
                    "https://ark.cn-beijing.volces.com/api/v3",
                    "test-key",
                    "doubao-model",
                    [{"role": "user", "content": "test"}],
                    0.1,
                    256,
                )
        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()

    def test_streaming_error_after_reasoning_is_not_retried(self):
        response = io.BytesIO(
            b'data: {"choices":[{"delta":{"reasoning_content":"analysis"}}]}\n\n'
            b'data: {"error":{"code":"RequestBurstTooFast","message":"slow down","type":"TooManyRequests"}}\n\n'
        )
        with mock.patch.object(prompt_plus, "_urlopen", return_value=response) as urlopen, mock.patch.object(
            prompt_plus.time, "sleep"
        ) as sleep:
            with self.assertRaisesRegex(RuntimeError, "RequestBurstTooFast"):
                prompt_plus._chat_completion(
                    "https://ark.cn-beijing.volces.com/api/v3",
                    "test-key",
                    "doubao-model",
                    [{"role": "user", "content": "test"}],
                    0.1,
                    256,
                )
        self.assertEqual(urlopen.call_count, 1)
        sleep.assert_not_called()

    def test_ark_batches_are_serial_instead_of_burst_parallel(self):
        self.assertFalse(
            prompt_plus._should_parallelize_requests(
                3, "https://ark.cn-beijing.volces.com/api/v3", "openai_compatible"
            )
        )
        self.assertTrue(
            prompt_plus._should_parallelize_requests(3, "https://api.siliconflow.cn/v1", "openai_compatible")
        )

    def test_small_vision_input_is_upscaled_to_target_edge(self):
        image = prompt_plus.np.zeros((400, 300, 3), dtype=prompt_plus.np.float32)
        data_url, _ = prompt_plus._image_array_to_data_url_uncached(image)
        raw = prompt_plus.base64.b64decode(data_url.split(",", 1)[1])
        with prompt_plus.Image.open(prompt_plus.io.BytesIO(raw)) as encoded:
            self.assertEqual(encoded.size, (576, 768))

    def test_text_only_must_design_camera_subject_relationship(self):
        task = prompt_plus._camera_task_instruction("text")
        self.assertIn("Design these facts explicitly from the user's intent", task)
        self.assertIn("mandatory for photographic and non-photographic styles alike", task)
        self.assertIn("Do not omit it when the user supplies no camera wording", task)

    def test_text_only_final_audit_requires_designed_geometry(self):
        audit = prompt_plus._final_output_audit("数字艺术", "text")
        self.assertIn("selected 数字艺术 category", audit)
        self.assertIn("design these relationships coherently from the user's intent", audit)
        self.assertIn("camera's vertical relationship", audit)


if __name__ == "__main__":
    unittest.main()
