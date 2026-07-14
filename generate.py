from __future__ import annotations

import json
import math

import comfy.samplers
import torch.nn.functional as F
from comfy_execution.graph_utils import GraphBuilder


class NO8DNormalizeDecodedImage:
    """Convert VAE packed RGB output to a standard ComfyUI IMAGE tensor."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"image": ("IMAGE",)}}

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "normalize"
    CATEGORY = "NO8D-controls/internal"
    DEPRECATED = True

    @staticmethod
    def normalize(image):
        channels = image.shape[-1]
        if channels in (3, 4):
            return (image,)
        factor = math.isqrt(channels // 3) if channels % 3 == 0 else 0
        if factor < 1 or 3 * factor * factor != channels:
            raise RuntimeError(
                "NO8D-Generate: VAE Decode returned an unsupported packed image "
                f"with {channels} channels."
            )
        rgb = F.pixel_shuffle(image.movedim(-1, 1), factor).movedim(1, -1)
        return (rgb,)


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

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "expand"
    OUTPUT_NODE = True
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
        linked_outputs = self._linked_outputs(prompt, unique_id)

        try:
            canvas_state = json.loads(canvas) if canvas else {}
        except (TypeError, json.JSONDecodeError):
            canvas_state = {}
        base_image_file = str(canvas_state.get("base_image_file") or "")
        mask_image_file = str(canvas_state.get("mask_image_file") or "")
        mask_active = bool(canvas_state.get("mask_active"))
        base_width = int(canvas_state.get("mask_base_width") or 0)
        base_height = int(canvas_state.get("mask_base_height") or 0)

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
        if mask_active:
            base = graph.node("LoadImage", image=base_image_file)
            mask = graph.node("LoadImageMask", image=mask_image_file, channel="red")
            encode_image = base.out(0)
            sample_mask = mask.out(0)
            latent_size = self._latent_image_size(latent)
            if latent_size and latent_size != (base_width, base_height):
                target_width, target_height = latent_size
                scaled_base = graph.node(
                    "ImageScale",
                    image=base.out(0),
                    upscale_method="lanczos",
                    width=target_width,
                    height=target_height,
                    crop="disabled",
                )
                mask_image = graph.node("MaskToImage", mask=mask.out(0))
                scaled_mask_image = graph.node(
                    "ImageScale",
                    image=mask_image.out(0),
                    upscale_method="bilinear",
                    width=target_width,
                    height=target_height,
                    crop="disabled",
                )
                scaled_mask = graph.node(
                    "ImageToMask",
                    image=scaled_mask_image.out(0),
                    channel="red",
                )
                encode_image = scaled_base.out(0)
                sample_mask = scaled_mask.out(0)
            encoded = graph.node("VAEEncode", pixels=encode_image, vae=vae)
            core_mask = graph.node("ThresholdMask", mask=sample_mask, value=0.99)
            inpaint_encoded = graph.node(
                "VAEEncodeForInpaint",
                pixels=encode_image,
                vae=vae,
                mask=core_mask.out(0),
                grow_mask_by=6,
            )
            blended = graph.node(
                "LatentBlend",
                samples1=encoded.out(0),
                samples2=inpaint_encoded.out(0),
                blend_factor=round(1.0 - 0.7 * denoise, 4),
            )
            masked_latent = graph.node(
                "SetLatentNoiseMask",
                samples=blended.out(0),
                mask=sample_mask,
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
        normalized = graph.node("NO8DNormalizeDecodedImage", image=decode.out(0))
        if output_mask is not None:
            composite = graph.node(
                "ImageCompositeMasked",
                destination=base.out(0),
                source=normalized.out(0),
                x=0,
                y=0,
                resize_source=True,
                mask=output_mask,
            )
            final_image = composite.out(0)
        else:
            final_image = normalized.out(0)
        # Always create this node's own native preview. Its expanded
        # display_node is NO8D-Generate, so the frontend never has to borrow
        # an image emitted by a downstream save/preview/transform node.
        graph.node("PreviewImage", images=final_image)

        return {
            "result": (final_image if 0 in linked_outputs else None,),
            "expand": graph.finalize(),
        }

    @staticmethod
    def _latent_image_size(latent):
        if not isinstance(latent, dict):
            return None
        samples = latent.get("samples")
        shape = getattr(samples, "shape", None)
        if shape is None or len(shape) < 4:
            return None
        downscale = latent.get("downscale_ratio_spacial")
        if not isinstance(downscale, (int, float)) or downscale <= 0:
            return None
        return (int(shape[-1] * downscale), int(shape[-2] * downscale))

    @staticmethod
    def _linked_outputs(prompt, unique_id):
        if not isinstance(prompt, dict) or unique_id is None:
            return set()
        node_key = str(unique_id)
        linked = set()
        for node in prompt.values():
            if not isinstance(node, dict):
                continue
            for value in (node.get("inputs") or {}).values():
                if (
                    isinstance(value, (list, tuple))
                    and len(value) == 2
                    and str(value[0]) == node_key
                    and isinstance(value[1], int)
                ):
                    linked.add(value[1])
        return linked

NODE_CLASS_MAPPINGS = {
    "NO8DGenerate": NO8DGenerate,
    "NO8DNormalizeDecodedImage": NO8DNormalizeDecodedImage,
}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DGenerate": "NO8D-Generate"}
