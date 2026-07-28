import nodes


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


def _size_from_manual_or_short_side(
    aspect_ratio,
    short_side,
    invert_ratio,
    manual_short_side,
    manual_long_side,
    multiple,
):
    ratio_w, ratio_h = _ratio(aspect_ratio, invert_ratio)
    manual_short_side = int(manual_short_side or 0)
    manual_long_side = int(manual_long_side or 0)
    ratio_short = min(ratio_w, ratio_h)
    ratio_long = max(ratio_w, ratio_h)

    if manual_short_side <= 0 and manual_long_side <= 0:
        return _size_from_short_side(aspect_ratio, short_side, invert_ratio, multiple)

    if manual_short_side <= 0:
        manual_short_side = manual_long_side * ratio_short / ratio_long
    if manual_long_side <= 0:
        manual_long_side = manual_short_side * ratio_long / ratio_short

    if ratio_w > ratio_h:
        width, height = manual_long_side, manual_short_side
    else:
        width, height = manual_short_side, manual_long_side
    return _round_to_multiple(width, multiple), _round_to_multiple(height, multiple)


class NO8DEmptyLatent:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "aspect_ratio": (list(ASPECT_RATIOS.keys()), {"default": "1:1"}),
                "short_side": (SHORT_SIDES, {"default": "512"}),
                "invert_ratio": ("BOOLEAN", {
                    "default": False,
                    "tooltip": "Swap the selected aspect ratio between portrait and landscape.",
                }),
                "manual_short_side": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": nodes.MAX_RESOLUTION,
                    "step": 8,
                    "tooltip": "Override the short side. Keep at 0 to calculate it from the selected size or manual long side.",
                }),
                "manual_long_side": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": nodes.MAX_RESOLUTION,
                    "step": 8,
                    "tooltip": "Override the long side. Keep at 0 to calculate it from the aspect ratio.",
                }),
                "batch_size": ("INT", {
                    "default": 1,
                    "min": 1,
                    "max": 4096,
                    "tooltip": "The number of latent images in the batch.",
                }),
            }
        }

    RETURN_TYPES = ("LATENT", "INT", "INT")
    RETURN_NAMES = ("latent", "width", "height")
    OUTPUT_TOOLTIPS = (
        "The empty latent created by ComfyUI's native EmptyLatentImage node.",
        "The final pixel width passed to the core node.",
        "The final pixel height passed to the core node.",
    )
    FUNCTION = "generate"
    CATEGORY = "NO8D-control"
    DESCRIPTION = "Choose dimensions, then create the latent with ComfyUI's native EmptyLatentImage node."
    SEARCH_ALIASES = ["empty latent", "native empty latent", "空 latent", "空潜空间"]

    def generate(
        self,
        aspect_ratio,
        short_side,
        invert_ratio=False,
        manual_short_side=0,
        manual_long_side=0,
        batch_size=1,
    ):
        width, height = _size_from_manual_or_short_side(
            aspect_ratio,
            short_side,
            invert_ratio,
            manual_short_side,
            manual_long_side,
            8,
        )
        latent = nodes.EmptyLatentImage().generate(width, height, batch_size)[0]
        return (latent, width, height)


NODE_CLASS_MAPPINGS = {"NO8DEmptyLatent": NO8DEmptyLatent}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DEmptyLatent": "NO8D-Empty latent"}
