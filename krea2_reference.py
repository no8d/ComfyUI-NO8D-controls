"""Internal Krea2 Identity Edit source-reference nodes.

The model forward and pixel-fit path are a focused single-reference adaptation
of lbouaraba/comfyui-krea2edit (Apache-2.0).  Keeping the training-matched
``[text | source(frame=1) | target(frame=0)]`` path here lets NO8D-Generate
remain self-contained without depending on that extension at runtime.
"""

from __future__ import annotations

import math

import torch
import torch.nn.functional as F
from einops import rearrange

import comfy.ldm.common_dit
import comfy.patcher_extension
import comfy.utils
from comfy.ldm.flux.layers import timestep_embedding


def _image_ids(batch, frame, height, width, device):
    ids = torch.zeros(height, width, 3, device=device, dtype=torch.float32)
    ids[..., 0] = frame
    ids[..., 1] = torch.arange(
        height, device=device, dtype=torch.float32,
    )[:, None]
    ids[..., 2] = torch.arange(
        width, device=device, dtype=torch.float32,
    )[None, :]
    return ids.reshape(1, height * width, 3).repeat(batch, 1, 1)


def _offset_image_ids(
    batch, frame, source_height, source_width,
    target_height, target_width, device,
):
    offset_y = max(0, (target_height - source_height) // 2)
    offset_x = max(0, (target_width - source_width) // 2)
    ids = torch.zeros(
        source_height, source_width, 3,
        device=device, dtype=torch.float32,
    )
    ids[..., 0] = frame
    ids[..., 1] = (
        torch.arange(source_height, device=device, dtype=torch.float32)
        + offset_y
    )[:, None]
    ids[..., 2] = (
        torch.arange(source_width, device=device, dtype=torch.float32)
        + offset_x
    )[None, :]
    return ids.reshape(
        1, source_height * source_width, 3,
    ).repeat(batch, 1, 1)


def _to_4d(value):
    if value.ndim == 5:
        batch, channels, frames, height, width = value.shape
        return value.reshape(batch * frames, channels, height, width)
    return value


def _fit_source_latent(source, height, width):
    source_height, source_width = source.shape[-2:]
    if (source_height, source_width) == (height, width):
        return source
    scale = max(height / source_height, width / source_width)
    crop_height = min(source_height, int(round(height / scale)))
    crop_width = min(source_width, int(round(width / scale)))
    top = (source_height - crop_height) // 2
    left = (source_width - crop_width) // 2
    source = source[
        ..., top:top + crop_height, left:left + crop_width
    ]
    return F.interpolate(
        source.float(), size=(height, width), mode="bilinear",
    )


def _fit_encode_image(image, vae, height, width, cache):
    """Use Krea2Edit's training-matched pixel-space ``fit`` geometry."""
    key = (height, width)
    if key in cache:
        return cache[key]

    pixel_height = height * 8
    pixel_width = width * 8
    samples = image.movedim(-1, 1)
    image_height, image_width = samples.shape[-2:]
    scale = min(
        pixel_height / image_height,
        pixel_width / image_width,
    )
    crop_tolerance = 0.08
    if (
        image_height * scale >= pixel_height * (1 - crop_tolerance)
        and image_width * scale >= pixel_width * (1 - crop_tolerance)
    ):
        fill_scale = max(
            pixel_height / image_height,
            pixel_width / image_width,
        )
        crop_height = min(
            image_height, int(round(pixel_height / fill_scale)),
        )
        crop_width = min(
            image_width, int(round(pixel_width / fill_scale)),
        )
        top = (image_height - crop_height) // 2
        left = (image_width - crop_width) // 2
        samples = samples[
            ..., top:top + crop_height, left:left + crop_width
        ]
        fitted_height = pixel_height
        fitted_width = pixel_width
    else:
        fitted_height = min(
            max(16, int(image_height * scale) // 16 * 16),
            max(16, pixel_height // 16 * 16),
        )
        fitted_width = min(
            max(16, int(image_width * scale) // 16 * 16),
            max(16, pixel_width // 16 * 16),
        )
    samples = F.interpolate(
        samples.float(),
        size=(fitted_height, fitted_width),
        mode="bicubic",
        antialias=True,
    )
    latent = vae.encode(samples.movedim(1, -1)[..., :3].clamp(0, 1))
    cache[key] = latent
    return latent


def _reference_attention_bias(
    boost, text_length, source_length, target_length, device, dtype,
):
    if abs(float(boost) - 1.0) <= 1e-6:
        return None
    total_length = text_length + source_length + target_length
    bias = torch.zeros(
        1, 1, total_length, total_length,
        device=device, dtype=dtype,
    )
    target_start = text_length + source_length
    bias[:, :, target_start:, text_length:target_start] = math.log(
        max(float(boost), 1e-4),
    )
    return bias


def _krea2_edit_forward(
    model,
    target,
    timesteps,
    context,
    source,
    transformer_options,
    ref_boost=1.0,
    source_native=False,
):
    patch = model.patch
    temporal = target.ndim == 5
    if temporal:
        batch_5d, _, frames_5d, height_5d, width_5d = target.shape

    target = _to_4d(target)
    batch, _, original_height, original_width = target.shape
    target = comfy.ldm.common_dit.pad_to_patch_size(
        target, (patch, patch), padding_mode="replicate",
    )
    height, width = target.shape[-2:]
    token_height = height // patch
    token_width = width // patch

    source = _to_4d(source).to(target.device, target.dtype)
    if source.shape[0] != batch:
        source = source[:1].expand(batch, *source.shape[1:])
    if not source_native and source.shape[-2:] != (height, width):
        source = _fit_source_latent(source, height, width).to(target.dtype)
    source = comfy.ldm.common_dit.pad_to_patch_size(
        source, (patch, patch), padding_mode="replicate",
    )
    source_height = source.shape[-2] // patch
    source_width = source.shape[-1] // patch

    context = model._unpack_context(context)
    target_tokens = model.first(rearrange(
        target,
        "b c (h ph) (w pw) -> b (h w) (c ph pw)",
        ph=patch,
        pw=patch,
    ))
    source_tokens = model.first(rearrange(
        source,
        "b c (h ph) (w pw) -> b (h w) (c ph pw)",
        ph=patch,
        pw=patch,
    ))
    time = model.tmlp(
        timestep_embedding(timesteps, model.tdim)
        .unsqueeze(1)
        .to(target_tokens.dtype)
    )
    time_vector = model.tproj(time)
    context = model.txtfusion(
        context, mask=None, transformer_options=transformer_options,
    )
    context = model.txtmlp(context)

    text_length = context.shape[1]
    source_length = source_tokens.shape[1]
    target_length = target_tokens.shape[1]
    combined = torch.cat(
        (context, source_tokens, target_tokens), dim=1,
    )
    positions = torch.cat((
        torch.zeros(
            batch, text_length, 3,
            device=combined.device, dtype=torch.float32,
        ),
        (
            _offset_image_ids(
                batch,
                1,
                source_height,
                source_width,
                token_height,
                token_width,
                combined.device,
            )
            if source_native
            else _image_ids(
                batch,
                1,
                source_height,
                source_width,
                combined.device,
            )
        ),
        _image_ids(
            batch,
            0,
            token_height,
            token_width,
            combined.device,
        ),
    ), dim=1)
    frequencies = model.pe_embedder(positions)
    attention_bias = _reference_attention_bias(
        ref_boost,
        text_length,
        source_length,
        target_length,
        combined.device,
        combined.dtype,
    )
    for block in model.blocks:
        combined = block(
            combined,
            time_vector,
            frequencies,
            attention_bias,
            transformer_options=transformer_options,
        )
    final = model.last(combined, time)
    output = final[
        :,
        text_length + source_length:
        text_length + source_length + target_length,
    ]
    output = rearrange(
        output,
        "b (h w) (c ph pw) -> b c (h ph) (w pw)",
        h=token_height,
        w=token_width,
        ph=patch,
        pw=patch,
        c=model.channels,
    )
    output = output[:, :, :original_height, :original_width]
    if temporal:
        output = output.reshape(
            batch_5d,
            frames_5d,
            model.channels,
            height_5d,
            width_5d,
        ).movedim(1, 2)
    return output


class NO8DKrea2ReferenceModel:
    """Add Krea2 Identity Edit's clean frame-1 source-token block."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "source_latent": ("LATENT",),
            },
            "optional": {
                "ref_boost": (
                    "FLOAT",
                    {"default": 1.0, "min": 0.0, "max": 1000.0, "step": 0.01},
                ),
                "vae": ("VAE",),
                "source_image": ("IMAGE",),
            },
        }

    RETURN_TYPES = ("MODEL",)
    FUNCTION = "patch"
    CATEGORY = "NO8D-controls/internal"
    DEPRECATED = True

    @staticmethod
    def patch(
        model,
        source_latent,
        ref_boost=1.0,
        vae=None,
        source_image=None,
    ):
        patched = model.clone()
        source = model.model.process_latent_in(source_latent["samples"])
        pixel_cache = {}
        model_wrapper = model.model

        def wrapper(executor, target, timesteps, context, *args, **kwargs):
            transformer_options = kwargs.pop("transformer_options", None)
            if transformer_options is None:
                transformer_options = next(
                    (
                        value for value in reversed(args)
                        if isinstance(value, dict)
                    ),
                    {},
                )
            fitted_source = source
            source_native = False
            if vae is not None and source_image is not None:
                target_4d = _to_4d(target)
                latent_height, latent_width = target_4d.shape[-2:]
                fitted_source = model_wrapper.process_latent_in(
                    _fit_encode_image(
                        source_image,
                        vae,
                        latent_height,
                        latent_width,
                        pixel_cache,
                    )
                )
                source_native = True
            return _krea2_edit_forward(
                executor.class_obj,
                target,
                timesteps,
                context,
                fitted_source,
                transformer_options,
                ref_boost=ref_boost,
                source_native=source_native,
            )

        transformer_options = patched.model_options.setdefault(
            "transformer_options", {},
        )
        comfy.patcher_extension.add_wrapper_with_key(
            comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
            "no8d_krea2_reference",
            wrapper,
            transformer_options,
        )
        return (patched,)


class NO8DKrea2GroundedEncode:
    """Encode Krea2's instruction together with its source image."""

    DEFAULT_SYSTEM = (
        "Describe the image by detailing the color, shape, size, "
        "texture, quantity, text, spatial relationships of the objects "
        "and background:"
    )

    @classmethod
    def _template(cls):
        return (
            f"<|im_start|>system\n{cls.DEFAULT_SYSTEM}<|im_end|>\n"
            "<|im_start|>user\n"
            "<|vision_start|><|image_pad|><|vision_end|>"
            "{}<|im_end|>\n<|im_start|>assistant\n"
        )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "clip": ("CLIP",),
                "text": ("STRING", {"multiline": True, "default": ""}),
                "image": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("CONDITIONING",)
    FUNCTION = "encode"
    CATEGORY = "NO8D-controls/internal"
    DEPRECATED = True

    @classmethod
    def encode(cls, clip, text, image):
        samples = image.movedim(-1, 1)
        height, width = samples.shape[-2:]
        if max(height, width) > 768:
            scale = 768 / max(height, width)
            samples = comfy.utils.common_upscale(
                samples,
                round(width * scale),
                round(height * scale),
                "area",
                "disabled",
            )
        grounded_image = samples.movedim(1, -1)[..., :3]
        tokens = clip.tokenize(
            str(text or ""),
            images=[grounded_image],
            llama_template=cls._template(),
        )
        return (clip.encode_from_tokens_scheduled(tokens),)


NODE_CLASS_MAPPINGS = {
    "NO8DKrea2ReferenceModel": NO8DKrea2ReferenceModel,
    "NO8DKrea2GroundedEncode": NO8DKrea2GroundedEncode,
}
NODE_DISPLAY_NAME_MAPPINGS = {}
