import torch

import comfy.model_management
import nodes


MODEL_TYPES = [
    "SD / SDXL",
    "SD3 / Flux / Krea2",
    "Flux2",
]

ASPECT_RATIOS = {
    "1:1": (1, 1),
    "1:2": (1, 2),
    "2:3": (2, 3),
    "3:4": (3, 4),
    "4:5": (4, 5),
    "9:16": (9, 16),
    "9:21": (9, 21),
}

SHORT_SIDES = ["512", "640", "768", "896", "1024", "1280", "1536"]


def _round_to_multiple(value, multiple):
    value = int(round(float(value) / multiple) * multiple)
    return max(multiple, min(value, nodes.MAX_RESOLUTION))


def _ratio(aspect_ratio, invert_ratio):
    ratio_w, ratio_h = ASPECT_RATIOS[aspect_ratio]
    if invert_ratio:
        ratio_w, ratio_h = ratio_h, ratio_w
    return ratio_w, ratio_h


def _size_from_short_side(aspect_ratio, short_side, invert_ratio, multiple):
    ratio_w, ratio_h = _ratio(aspect_ratio, invert_ratio)
    short_side = int(short_side)

    if ratio_w >= ratio_h:
        height = short_side
        width = short_side * ratio_w / ratio_h
    else:
        width = short_side
        height = short_side * ratio_h / ratio_w

    return _round_to_multiple(width, multiple), _round_to_multiple(height, multiple)


def _size_from_manual_or_short_side(aspect_ratio, short_side, invert_ratio, manual_width, manual_height, multiple):
    ratio_w, ratio_h = _ratio(aspect_ratio, invert_ratio)
    manual_width = int(manual_width or 0)
    manual_height = int(manual_height or 0)

    if manual_width > 0 and manual_height > 0:
        return _round_to_multiple(manual_width, multiple), _round_to_multiple(manual_height, multiple)
    if manual_width > 0:
        height = manual_width * ratio_h / ratio_w
        return _round_to_multiple(manual_width, multiple), _round_to_multiple(height, multiple)
    if manual_height > 0:
        width = manual_height * ratio_w / ratio_h
        return _round_to_multiple(width, multiple), _round_to_multiple(manual_height, multiple)
    return _size_from_short_side(aspect_ratio, short_side, invert_ratio, multiple)


class NO8DEmptyLatent:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model_type": (MODEL_TYPES, {"default": "SD / SDXL"}),
                "short_side": (SHORT_SIDES, {"default": "512"}),
                "aspect_ratio": (list(ASPECT_RATIOS.keys()), {"default": "1:1"}),
                "invert_ratio": ("BOOLEAN", {"default": False}),
                "manual_width": ("INT", {"default": 0, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 16}),
                "manual_height": ("INT", {"default": 0, "min": 0, "max": nodes.MAX_RESOLUTION, "step": 16}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 4096}),
            }
        }

    RETURN_TYPES = ("LATENT", "INT", "INT")
    RETURN_NAMES = ("latent", "width", "height")
    FUNCTION = "generate"
    CATEGORY = "NO8D-control"
    DESCRIPTION = "Create an empty latent by choosing a model family, aspect ratio, short side size, or manual width and height."

    def generate(self, model_type, short_side, aspect_ratio, invert_ratio=False, manual_width=0, manual_height=0, batch_size=1):
        if model_type == "Flux2":
            multiple = 16
            channels = 128
            downscale = 16
        elif model_type == "SD3 / Flux / Krea2":
            multiple = 16
            channels = 16
            downscale = 8
        else:
            multiple = 8
            channels = 4
            downscale = 8

        width, height = _size_from_manual_or_short_side(
            aspect_ratio,
            short_side,
            invert_ratio,
            manual_width,
            manual_height,
            multiple,
        )
        latent_kwargs = {"device": comfy.model_management.intermediate_device()}
        if model_type != "Flux2":
            latent_kwargs["dtype"] = comfy.model_management.intermediate_dtype()
        latent = torch.zeros([batch_size, channels, height // downscale, width // downscale], **latent_kwargs)
        result = {"samples": latent}
        if downscale == 8:
            result["downscale_ratio_spacial"] = 8
        return (result, width, height)


NODE_CLASS_MAPPINGS = {"NO8DEmptyLatent": NO8DEmptyLatent}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DEmptyLatent": "NO8D-Empty latent"}
