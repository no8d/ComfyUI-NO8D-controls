from __future__ import annotations

import importlib.util
import pathlib
import sys
import types
import unittest


class _NoopType:
    def __init__(self, *args, **kwargs):
        self.args = args
        self.kwargs = kwargs


def _load_module():
    io = types.SimpleNamespace(
        ComfyNode=object,
        NodeOutput=lambda value: value,
        Autogrow=types.SimpleNamespace(TemplatePrefix=_NoopType, Input=_NoopType),
        String=types.SimpleNamespace(Input=_NoopType, Output=_NoopType),
        Schema=_NoopType,
    )
    comfy_api = types.ModuleType("comfy_api")
    versioned = types.ModuleType("comfy_api.v0_0_2")
    versioned.io = io
    names = ("comfy_api", "comfy_api.v0_0_2")
    previous = {name: sys.modules.get(name) for name in names}
    sys.modules["comfy_api"] = comfy_api
    sys.modules["comfy_api.v0_0_2"] = versioned
    try:
        path = pathlib.Path(__file__).resolve().parents[1] / "prompt_merge.py"
        spec = importlib.util.spec_from_file_location("no8d_prompt_merge_under_test", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, old_module in previous.items():
            if old_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = old_module


MERGE = _load_module()


class PromptMergeTests(unittest.TestCase):
    def test_merges_connected_inputs_by_numeric_port_order(self):
        result = MERGE.merge_prompts({"prompt_10": "ten", "prompt_2": "two", "prompt_1": "one"})
        self.assertEqual(result, "one\ntwo\nten")

    def test_ignores_empty_inputs(self):
        result = MERGE.merge_prompts({"prompt_1": "  subject  ", "prompt_2": "", "prompt_3": None, "prompt_4": "style"})
        self.assertEqual(result, "subject\nstyle")

    def test_execute_returns_the_merged_prompt(self):
        result = MERGE.NO8DPromptMerge.execute({"prompt_1": "subject", "prompt_2": "lighting"})
        self.assertEqual(result, "subject\nlighting")

    def test_node_is_registered_with_an_autogrow_input(self):
        self.assertIn("NO8DPromptMerge", MERGE.NODE_CLASS_MAPPINGS)
        schema = MERGE.NO8DPromptMerge.define_schema()
        prompts_input = schema.kwargs["inputs"][0]
        self.assertEqual(prompts_input.args[0], "prompts")


if __name__ == "__main__":
    unittest.main()
