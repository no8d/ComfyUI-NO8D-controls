from __future__ import annotations

import unittest

from test_prompt_camera_geometry import prompt_plus


class PromptViewTests(unittest.TestCase):
    def test_fixed_text_belongs_only_to_prompt_view_node(self):
        prompt_inputs = prompt_plus.NO8DBatchPromptPlus.INPUT_TYPES()["required"]
        view_inputs = prompt_plus.NO8DPromptView.INPUT_TYPES()["required"]
        self.assertNotIn("fixed_text", prompt_inputs)
        self.assertIn("fixed_text", view_inputs)

    def test_run_with_upstream_and_auto_on_outputs_upstream(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            edited_text="manual draft",
            text="upstream prompt",
            unique_id="preview-test",
        )
        self.assertEqual(result["result"], ("upstream prompt",))
        self.assertEqual(result["ui"]["edited_text"], ["upstream prompt"])

    def test_auto_output_prefixes_upstream_with_fixed_text(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            fixed_text="atmospheric photography",
            edited_text="manual draft",
            text="upstream prompt",
            unique_id="preview-fixed-auto-test",
        )
        self.assertEqual(result["result"], ("atmospheric photography.\nupstream prompt",))
        self.assertEqual(result["ui"]["edited_text"], ["atmospheric photography.\nupstream prompt"])

    def test_run_with_upstream_and_auto_off_displays_upstream_and_outputs_empty(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            edited_text="manual draft",
            text="upstream prompt",
            unique_id="preview-test",
        )
        self.assertEqual(result["result"], ("",))
        self.assertEqual(result["ui"]["edited_text"], ["upstream prompt"])

    def test_auto_off_keeps_output_empty_even_with_fixed_text(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            fixed_text="atmospheric photography",
            edited_text="manual draft",
            text="upstream prompt",
            unique_id="preview-fixed-edit-test",
        )
        self.assertEqual(result["result"], ("",))
        self.assertEqual(result["ui"]["edited_text"], ["atmospheric photography.\nupstream prompt"])

    def test_run_without_upstream_and_auto_on_outputs_editor(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            edited_text="manual draft",
            text="",
            unique_id="preview-test",
        )
        self.assertEqual(result["result"], ("manual draft",))

    def test_auto_output_prefixes_editor_when_upstream_is_missing(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            fixed_text="atmospheric photography",
            edited_text="manual draft",
            text="",
            unique_id="preview-fixed-editor-test",
        )
        self.assertEqual(result["result"], ("atmospheric photography.\nmanual draft",))

    def test_auto_output_can_emit_fixed_text_alone(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            fixed_text="atmospheric photography",
            edited_text="",
            text="",
            unique_id="preview-fixed-only-test",
        )
        self.assertEqual(result["result"], ("atmospheric photography.",))
        self.assertEqual(result["ui"]["edited_text"], ["atmospheric photography."])

    def test_fixed_text_is_not_duplicated_when_editor_already_contains_it(self):
        combined = "atmospheric photography.\nmanual draft"
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            fixed_text="atmospheric photography",
            edited_text=combined,
            text="",
            unique_id="preview-fixed-idempotent-test",
        )
        self.assertEqual(result["result"], (combined,))
        self.assertEqual(result["ui"]["edited_text"], [combined])

    def test_bypassed_upstream_empty_list_outputs_editor(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            edited_text="manual draft",
            text=[],
            unique_id="preview-bypass-test",
        )
        self.assertEqual(result["result"], ("manual draft",))
        self.assertEqual(result["ui"]["edited_text"], ["manual draft"])

    def test_bypassed_upstream_nested_empty_values_outputs_editor(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=True,
            edited_text="manual draft",
            text=[None, ""],
            unique_id="preview-bypass-empty-test",
        )
        self.assertEqual(result["result"], ("manual draft",))

    def test_auto_off_cache_key_tracks_upstream_for_editor_refresh(self):
        first = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=False,
            edited_text="manual draft",
            text="first upstream prompt",
            unique_id="preview-cache-test",
        )
        second = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=False,
            edited_text="manual draft",
            text="second upstream prompt",
            unique_id="preview-cache-test",
        )
        self.assertNotEqual(first, second)

    def test_auto_cache_key_ignores_inactive_editor_draft(self):
        first = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=True,
            edited_text="first inactive draft",
            text="same upstream prompt",
            unique_id="preview-auto-cache-test",
        )
        second = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=True,
            edited_text="second inactive draft",
            text="same upstream prompt",
            unique_id="preview-auto-cache-test",
        )
        self.assertEqual(first, second)

    def test_auto_cache_key_tracks_editor_when_upstream_is_empty(self):
        first = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=True,
            edited_text="first fallback prompt",
            text="",
            unique_id="preview-fallback-cache-test",
        )
        second = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=True,
            edited_text="second fallback prompt",
            text="",
            unique_id="preview-fallback-cache-test",
        )
        self.assertNotEqual(first, second)

    def test_send_cache_key_tracks_editor_and_send_sequence(self):
        first = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=False,
            edited_text="sent prompt",
            send_seq="123",
            text="upstream prompt",
            unique_id="preview-send-cache-test",
        )
        same = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=True,
            edited_text="sent prompt",
            send_seq="123",
            text="different upstream prompt",
            unique_id="preview-send-cache-test",
        )
        second_send = prompt_plus.NO8DPromptView.IS_CHANGED(
            auto_output=False,
            edited_text="sent prompt",
            send_seq="124",
            text="upstream prompt",
            unique_id="preview-send-cache-test",
        )
        self.assertEqual(first, same)
        self.assertNotEqual(first, second_send)

    def test_run_without_upstream_and_auto_off_outputs_empty(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            edited_text="manual draft",
            text="",
            unique_id="preview-test",
        )
        self.assertEqual(result["result"], ("",))
        self.assertEqual(result["ui"]["edited_text"], ["manual draft"])

    def test_send_outputs_editor_regardless_of_auto_or_upstream(self):
        for auto_output, upstream in ((True, "upstream prompt"), (False, "")):
            with self.subTest(auto_output=auto_output, upstream=upstream):
                result = prompt_plus.NO8DPromptView().view(
                    auto_output=auto_output,
                    edited_text="sent manual prompt",
                    send_seq="123",
                    text=upstream,
                    unique_id="preview-send-test",
                )
                self.assertEqual(result["result"], ("sent manual prompt",))

    def test_send_prefixes_editor_with_fixed_text(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            fixed_text="atmospheric photography",
            edited_text="sent manual prompt",
            send_seq="123",
            text="upstream prompt",
            unique_id="preview-fixed-send-test",
        )
        self.assertEqual(result["result"], ("atmospheric photography.\nsent manual prompt",))
        self.assertEqual(result["ui"]["edited_text"], ["atmospheric photography.\nsent manual prompt"])

    def test_send_does_not_duplicate_visible_fixed_text(self):
        combined = "atmospheric photography.\nsent manual prompt"
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            fixed_text="atmospheric photography",
            edited_text=combined,
            send_seq="123",
            text="upstream prompt",
            unique_id="preview-fixed-send-idempotent-test",
        )
        self.assertEqual(result["result"], (combined,))

    def test_send_can_emit_fixed_text_alone(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            fixed_text="atmospheric photography",
            edited_text="",
            send_seq="123",
            text="upstream prompt",
            unique_id="preview-fixed-send-only-test",
        )
        self.assertEqual(result["result"], ("atmospheric photography.",))

    def test_send_with_empty_editor_outputs_empty(self):
        result = prompt_plus.NO8DPromptView().view(
            auto_output=False,
            edited_text="",
            send_seq="123",
            text="upstream prompt",
            unique_id="preview-send-empty-test",
        )
        self.assertEqual(result["result"], ("",))


if __name__ == "__main__":
    unittest.main()
