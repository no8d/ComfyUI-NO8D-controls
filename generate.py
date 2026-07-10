from __future__ import annotations

import json
import math

import comfy.samplers
import torch
import torch.nn.functional as F
from comfy_execution.graph_utils import GraphBuilder


class NO8DDecodedImageAdapter:
    """Convert packed VAE output to RGB and align inpaint inputs."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {"decoded": ("IMAGE",)},
            "optional": {
                "destination": ("IMAGE",),
                "mask": ("MASK",),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "MASK")
    RETURN_NAMES = ("image", "destination", "mask")
    FUNCTION = "adapt"
    CATEGORY = "NO8D-controls/internal"

    @staticmethod
    def _unpack_rgb(image):
        channels = image.shape[-1]
        if channels in (3, 4):
            return image

        factor = math.isqrt(channels // 3) if channels % 3 == 0 else 0
        if factor < 1 or 3 * factor * factor != channels:
            raise RuntimeError(
                "NO8D-Generate: VAE Decode returned "
                f"{channels} channels, which cannot be converted to RGB."
            )
        return F.pixel_shuffle(image.movedim(-1, 1), factor).movedim(1, -1)

    @staticmethod
    def _resize_image(image, height, width):
        if image.shape[1:3] == (height, width):
            return image
        return F.interpolate(
            image.movedim(-1, 1),
            size=(height, width),
            mode="bicubic",
            align_corners=False,
            antialias=True,
        ).movedim(1, -1)

    @staticmethod
    def _resize_mask(mask, height, width):
        if mask.ndim == 2:
            mask = mask.unsqueeze(0)
        if mask.shape[-2:] == (height, width):
            return mask
        return F.interpolate(
            mask.unsqueeze(1),
            size=(height, width),
            mode="bilinear",
            align_corners=False,
        ).squeeze(1)

    @staticmethod
    def _match_image_batch(image, batch_size):
        if image.shape[0] == batch_size:
            return image
        if image.shape[0] == 1 and batch_size > 1:
            return image.repeat(batch_size, 1, 1, 1)
        raise RuntimeError(
            "NO8D-Generate: destination image batch does not match generated batch "
            f"({image.shape[0]} vs {batch_size})."
        )

    @staticmethod
    def _match_mask_batch(mask, batch_size):
        if mask.shape[0] == batch_size:
            return mask
        if mask.shape[0] == 1 and batch_size > 1:
            return mask.repeat(batch_size, 1, 1)
        raise RuntimeError(
            "NO8D-Generate: mask batch does not match generated batch "
            f"({mask.shape[0]} vs {batch_size})."
        )

    def adapt(self, decoded, destination=None, mask=None):
        image = self._unpack_rgb(decoded)
        batch_size = image.shape[0]
        height, width = image.shape[1:3]
        if destination is None:
            aligned_destination = image
        else:
            aligned_destination = self._resize_image(destination, height, width)
            aligned_destination = self._match_image_batch(aligned_destination, batch_size)
        aligned_mask = (
            torch.zeros(
                (batch_size, height, width),
                dtype=image.dtype,
                device=image.device,
            )
            if mask is None
            else self._resize_mask(mask, height, width)
        )
        aligned_mask = self._match_mask_batch(aligned_mask, batch_size)
        return (image, aligned_destination, aligned_mask)


class NO8DGenerate:
    """A UI shell that expands exclusively to ComfyUI core nodes."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"rawLink": True}),
                "positive": ("CONDITIONING",),
                "vae": ("VAE", {"rawLink": True}),
                "latent": ("LATENT",),
                "steps": ("INT", {"default": 6, "min": 1, "max": 10000}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 100.0, "step": 0.1, "round": 0.01}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler"}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01, "round": 0.01}),
                "mask_feather": ("INT", {"default": 50, "min": 0, "max": 100, "step": 1}),
                "canvas": ("NO8D_GENERATE_CANVAS",),
            },
            "optional": {
                "negative": ("CONDITIONING",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("IMAGE", "LATENT", "MASK")
    RETURN_NAMES = ("image", "latent", "mask")
    FUNCTION = "expand"
    CATEGORY = "NO8D-controls"

    def expand(
        self,
        model,
        positive,
        vae,
        latent,
        steps,
        cfg,
        sampler_name,
        scheduler,
        seed,
        denoise,
        mask_feather,
        canvas,
        negative=None,
        prompt=None,
        unique_id=None,
    ):
        graph = GraphBuilder()

        try:
            canvas_state = json.loads(canvas) if canvas else {}
        except (TypeError, json.JSONDecodeError):
            canvas_state = {}
        base_image_file = str(canvas_state.get("base_image_file") or "")
        mask_image_file = str(canvas_state.get("mask_image_file") or "")
        mask_active = bool(canvas_state.get("mask_active"))

        if mask_active and (not base_image_file or not mask_image_file):
            raise RuntimeError(
                "NO8D-Generate: the painted mask was not saved before execution. "
                "Please wait for the mask upload to finish and run the workflow again."
            )

        if negative is None:
            negative_node = graph.node("ConditioningZeroOut", conditioning=positive)
            negative = negative_node.out(0)

        sample_latent = latent
        sample_model = model
        output_mask = None
        if base_image_file and mask_image_file:
            base = graph.node("LoadImage", image=base_image_file)
            mask = graph.node("LoadImageMask", image=mask_image_file, channel="red")
            encoded = graph.node("VAEEncode", pixels=base.out(0), vae=vae)
            masked_latent = graph.node(
                "SetLatentNoiseMask",
                samples=encoded.out(0),
                mask=mask.out(0),
            )
            sample_latent = masked_latent.out(0)
            differential = graph.node("DifferentialDiffusion", model=model, strength=1.0)
            sample_model = differential.out(0)
            output_mask = mask.out(0)

        sampler = graph.node(
            "KSampler",
            model=sample_model,
            seed=seed,
            steps=steps,
            cfg=cfg,
            sampler_name=sampler_name,
            scheduler=scheduler,
            positive=positive,
            negative=negative,
            latent_image=sample_latent,
            denoise=denoise,
        )
        decode = graph.node("VAEDecode", samples=sampler.out(0), vae=vae)
        adapter_inputs = {"decoded": decode.out(0)}
        if output_mask is not None:
            adapter_inputs.update(destination=base.out(0), mask=output_mask)
        adapter = graph.node("NO8DDecodedImageAdapter", **adapter_inputs)
        final_image = adapter.out(0)
        if output_mask is not None:
            composite = graph.node(
                "ImageCompositeMasked",
                destination=adapter.out(1),
                source=adapter.out(0),
                x=0,
                y=0,
                resize_source=False,
                mask=adapter.out(2),
            )
            final_image = composite.out(0)
            output_mask = adapter.out(2)

        return {
            "result": (final_image, sampler.out(0), output_mask),
            "expand": graph.finalize(),
        }


NODE_CLASS_MAPPINGS = {
    "NO8DGenerate": NO8DGenerate,
    "NO8DDecodedImageAdapter": NO8DDecodedImageAdapter,
}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DGenerate": "NO8D-Generate"}
