"""Match Krea2 edit reference-latent grids to a target latent."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import torch
import torch.nn.functional as F


_METHODS = ("bilinear", "bicubic", "nearest-exact", "area")


def _resize_spatial(tensor: torch.Tensor, size: tuple[int, int], method: str) -> torch.Tensor:
    if tensor.ndim not in (4, 5):
        raise ValueError("Krea2 reference latents must be 4D or 5D tensors.")
    if tuple(tensor.shape[-2:]) == size:
        return tensor

    original_dtype = tensor.dtype
    working = tensor
    restore_shape = None
    if tensor.ndim == 5:
        batch, channels, frames, height, width = tensor.shape
        working = tensor.movedim(2, 1).reshape(batch * frames, channels, height, width)
        restore_shape = (batch, frames, channels)

    interpolate_kwargs = {"size": size, "mode": method}
    if method in ("bilinear", "bicubic"):
        interpolate_kwargs["align_corners"] = False
    resized = F.interpolate(working, **interpolate_kwargs).to(dtype=original_dtype)

    if restore_shape is not None:
        batch, frames, channels = restore_shape
        resized = resized.reshape(batch, frames, channels, *size).movedim(1, 2)
    return resized


def match_krea2_reference_latents(
    conditioning: Sequence[Sequence[Any]],
    target_latent: Mapping[str, Any],
    method: str = "bilinear",
) -> list[list[Any]]:
    """Copy conditioning with every reference latent resized to the target grid."""
    if method not in _METHODS:
        raise ValueError(f"Unsupported interpolation method: {method}")
    target_samples = target_latent.get("samples")
    if not isinstance(target_samples, torch.Tensor) or target_samples.ndim not in (4, 5):
        raise ValueError("target_latent must contain 4D or 5D tensor samples.")
    target_size = tuple(target_samples.shape[-2:])

    matched = []
    for entry in conditioning:
        if len(entry) != 2:
            raise ValueError("Each CONDITIONING entry must contain a tensor and metadata.")
        tensor, metadata = entry
        matched_metadata = dict(metadata)
        reference_latents = metadata.get("reference_latents")
        if reference_latents is not None:
            matched_metadata["reference_latents"] = [
                _resize_spatial(reference, target_size, method)
                for reference in reference_latents
            ]
        matched.append([tensor, matched_metadata])
    return matched


class NO8DMatchKrea2ReferenceLatents:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "conditioning": ("CONDITIONING",),
                "target_latent": ("LATENT",),
                "method": (_METHODS, {"default": "bilinear"}),
            }
        }

    RETURN_TYPES = ("CONDITIONING",)
    RETURN_NAMES = ("conditioning",)
    FUNCTION = "match"
    CATEGORY = "NO8D-control"
    DESCRIPTION = (
        "Resize Krea2 Ostris Edit reference-latent grids to match a target latent "
        "while preserving prompt conditioning and other metadata."
    )

    def match(self, conditioning, target_latent, method="bilinear"):
        return (match_krea2_reference_latents(conditioning, target_latent, method),)


NODE_CLASS_MAPPINGS = {
    "NO8DMatchKrea2ReferenceLatents": NO8DMatchKrea2ReferenceLatents,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DMatchKrea2ReferenceLatents": "NO8D-Match Krea2 Reference Latents",
}
