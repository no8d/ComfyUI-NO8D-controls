from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = (
    ROOT / "examples" / "NO8D-controls-example.json",
    ROOT / "examples" / "NO8D-Prompt-libraries.json",
)


class ExampleWorkflowTests(unittest.TestCase):
    def test_links_reference_existing_nodes_and_matching_slots(self):
        for path in WORKFLOWS:
            with self.subTest(workflow=path.name):
                workflow = json.loads(path.read_text(encoding="utf-8"))
                nodes = {node["id"]: node for node in workflow["nodes"]}
                links = {link[0]: link for link in workflow["links"]}

                for link_id, source_id, source_slot, target_id, target_slot, _kind in workflow["links"]:
                    self.assertIn(source_id, nodes)
                    self.assertIn(target_id, nodes)
                    self.assertIn(
                        link_id,
                        nodes[source_id]["outputs"][source_slot].get("links") or [],
                    )
                    self.assertEqual(
                        nodes[target_id]["inputs"][target_slot]["link"],
                        link_id,
                    )

                for node in nodes.values():
                    for input_slot in node.get("inputs") or []:
                        if input_slot.get("link") is not None:
                            self.assertIn(input_slot["link"], links)
                    for output_slot in node.get("outputs") or []:
                        for link_id in output_slot.get("links") or []:
                            self.assertIn(link_id, links)

    def test_examples_use_the_native_loader_lora_stack_schema(self):
        for path in WORKFLOWS:
            with self.subTest(workflow=path.name):
                workflow = json.loads(path.read_text(encoding="utf-8"))
                stacks = [
                    node for node in workflow["nodes"]
                    if node["type"] == "NO8DLoraStack"
                ]
                self.assertTrue(stacks)
                for stack in stacks:
                    self.assertEqual(stack.get("inputs"), [])
                    self.assertEqual(len(stack["widgets_values"]), 5)
                    self.assertEqual(stack["widgets_values"][2], "None")
                    self.assertEqual(stack["widgets_values"][3], "[]")

    def test_examples_exclude_private_loras_and_expression_libraries(self):
        forbidden = (
            "Krea2-CivitAI",
            "expression_prompt_libraries",
            "aggression_hostility",
            "disgust_aversion",
            "joy_playfulness",
            "surprise_fear",
        )
        for path in WORKFLOWS:
            with self.subTest(workflow=path.name):
                source = path.read_text(encoding="utf-8")
                for value in forbidden:
                    self.assertNotIn(value, source)

    def test_default_workflow_uses_the_new_empty_latent_widget_order(self):
        workflow = json.loads(WORKFLOWS[0].read_text(encoding="utf-8"))
        node = next(
            node for node in workflow["nodes"]
            if node["type"] == "NO8DEmptyLatent"
        )

        self.assertEqual(
            node["widgets_values"],
            ["9:16", "768", True, 0, 0, 1],
        )

    def test_prompt_libraries_workflow_contains_the_public_guide(self):
        workflow = json.loads(WORKFLOWS[1].read_text(encoding="utf-8"))
        notes = [
            node for node in workflow["nodes"]
            if node["type"] == "MarkdownNote"
        ]

        self.assertTrue(notes)
        self.assertIn(
            "no8d-prompt-164632304",
            notes[0]["widgets_values"][0],
        )


if __name__ == "__main__":
    unittest.main()
