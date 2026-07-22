"""Composable prompt merging node for ComfyUI."""

from __future__ import annotations

import re
from collections.abc import Mapping

from comfy_api.v0_0_2 import io


_PORT_INDEX = re.compile(r"(\d+)$")


def _port_order(item: tuple[str, object]) -> tuple[int, str]:
    """Keep Autogrow prompt ports in their visible numeric order."""
    name = str(item[0])
    match = _PORT_INDEX.search(name)
    return (int(match.group(1)) if match else 0, name)


def merge_prompts(prompts: Mapping[str, object]) -> str:
    """Join non-empty prompt inputs in the order of their input ports."""
    parts = []
    for _, value in sorted(prompts.items(), key=_port_order):
        if value is None:
            continue
        text = str(value).strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


class NO8DPromptMerge(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        template = io.Autogrow.TemplatePrefix(
            io.String.Input("prompt", display_name="提示词", default="", multiline=True),
            prefix="prompt_",
            min=2,
            max=50,
        )
        return io.Schema(
            node_id="NO8DPromptMerge",
            display_name="NO8D-Prompt Merge",
            category="NO8D-control",
            description="Merge prompt inputs in port order and output one prompt string.",
            inputs=[io.Autogrow.Input("prompts", template=template)],
            outputs=[io.String.Output(display_name="prompt")],
        )

    @classmethod
    def execute(cls, prompts: Mapping[str, object]) -> io.NodeOutput:
        return io.NodeOutput(merge_prompts(prompts))


NODE_CLASS_MAPPINGS = {"NO8DPromptMerge": NO8DPromptMerge}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DPromptMerge": "NO8D-Prompt Merge"}
