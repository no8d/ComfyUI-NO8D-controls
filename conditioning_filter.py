"""Focused conditioning filters for composable ComfyUI workflows."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any


def remove_krea2_reference_latents(conditioning: Sequence[Sequence[Any]]) -> list[list[Any]]:
    """Copy conditioning entries without Ostris Krea2 reference latents."""
    filtered = []
    for entry in conditioning:
        if len(entry) != 2:
            raise ValueError("Each CONDITIONING entry must contain a tensor and metadata.")
        tensor, metadata = entry
        cleaned_metadata = dict(metadata)
        cleaned_metadata.pop("reference_latents", None)
        filtered.append([tensor, cleaned_metadata])
    return filtered


class NO8DRemoveKrea2ReferenceLatents:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"conditioning": ("CONDITIONING",)}}

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "remove"
    CATEGORY = "NO8D-control"
    DESCRIPTION = (
        "Remove Krea2 Ostris Edit reference latents while preserving the encoded "
        "prompt, visual-language conditioning, and other metadata."
    )

    def remove(self, conditioning):
        return (remove_krea2_reference_latents(conditioning),)


NODE_CLASS_MAPPINGS = {
    "NO8DRemoveKrea2ReferenceLatents": NO8DRemoveKrea2ReferenceLatents,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DRemoveKrea2ReferenceLatents": "NO8D-Remove Krea2 Reference Latents",
}
