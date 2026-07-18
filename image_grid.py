from __future__ import annotations

import math
import os
from collections.abc import Iterable, Mapping

import numpy as np
import torch
from PIL import Image, ImageDraw, ImageFont
from comfy_api.v0_0_2 import io


NO8D_ACCENT_COLOR = "#2563EB"


_LAYOUT_ALIASES = {
    "horizontal": "horizontal",
    "Horizontal": "horizontal",
    "横向": "horizontal",
    "vertical": "vertical",
    "Vertical": "vertical",
    "纵向": "vertical",
    "grid": "grid",
    "Grid": "grid",
    "网格": "grid",
}
_CROP_ALIASES = {
    "none": "none",
    "standard": "standard",
    "Standard crop": "standard",
    "标准裁切": "standard",
    "left": "left",
    "Left crop": "left",
    "居左裁切": "left",
    "center": "center",
    "Center crop": "center",
    "居中裁切": "center",
    "right": "right",
    "Right crop": "right",
    "居右裁切": "right",
}
_TITLE_POSITION_ALIASES = {
    "top": "top",
    "Outside top": "top",
    "顶部": "top",
    "图外顶部": "top",
    "middle": "middle",
    "Middle": "middle",
    "中间": "middle",
    "中部": "middle",
    "bottom": "bottom",
    "Outside bottom": "bottom",
    "底部": "bottom",
    "图外底部": "bottom",
    "inner_top": "inner_top",
    "Inside top": "inner_top",
    "图内顶部": "inner_top",
    "inner_bottom": "inner_bottom",
    "Inside bottom": "inner_bottom",
    "图内底部": "inner_bottom",
}
_TEXT_ALIGN_ALIASES = {
    "left": "left",
    "Left": "left",
    "居左": "left",
    "center": "center",
    "Center": "center",
    "居中": "center",
    "right": "right",
    "Right": "right",
    "居右": "right",
}


def _parse_color(value: str) -> tuple[int, int, int]:
    text = str(value).strip().lstrip("#")
    if len(text) == 3:
        text = "".join(channel * 2 for channel in text)
    if len(text) != 6:
        raise ValueError(f"颜色必须使用 #RRGGBB 格式，当前值：{value!r}")
    try:
        return tuple(int(text[index : index + 2], 16) for index in (0, 2, 4))
    except ValueError as error:
        raise ValueError(f"颜色必须使用 #RRGGBB 格式，当前值：{value!r}") from error


def _darken(color: tuple[int, int, int], amount: float = 0.2) -> tuple[int, int, int]:
    factor = 1.0 - amount
    return tuple(round(channel * factor) for channel in color)


def _percentage(value: int | str) -> int:
    return int(str(value).strip().removesuffix("%"))


def _tensor_images(inputs: Iterable[torch.Tensor]) -> list[Image.Image]:
    images: list[Image.Image] = []
    for batch in inputs:
        if not isinstance(batch, torch.Tensor) or batch.ndim != 4:
            raise ValueError("图片输入必须是形状为 [B,H,W,C] 的 IMAGE 张量")
        for item in batch:
            array = item.detach().to(device="cpu", dtype=torch.float32).numpy()
            array = np.clip(array[..., :3] * 255.0, 0, 255).astype(np.uint8)
            images.append(Image.fromarray(array, mode="RGB"))
    if not images:
        raise ValueError("至少需要输入一张图片")
    return images


def _fit_inside(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = min(width / image.width, height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    return image.resize(size, Image.Resampling.LANCZOS)


def _cover(image: Image.Image, width: int, height: int) -> Image.Image:
    scale = max(width / image.width, height / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    resized = image.resize(size, Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _horizontal_crop(image: Image.Image, width: int, align: str) -> Image.Image:
    if align == "left":
        left = 0
    elif align == "right":
        left = image.width - width
    else:
        left = (image.width - width) // 2
    return image.crop((left, 0, left + width, image.height))


def _vertical_crop(image: Image.Image, height: int, align: str) -> Image.Image:
    if align == "left":
        top = 0
    elif align == "right":
        top = image.height - height
    else:
        top = (image.height - height) // 2
    return image.crop((0, top, image.width, top + height))


def _resize_to_height(image: Image.Image, height: int) -> Image.Image:
    width = max(1, round(image.width * height / image.height))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _resize_to_width(image: Image.Image, width: int) -> Image.Image:
    height = max(1, round(image.height * width / image.width))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _font_candidates() -> list[str]:
    return [
        os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "msyh.ttc"),
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]


def _load_font(size: int) -> ImageFont.ImageFont:
    for candidate in _font_candidates():
        if candidate and os.path.isfile(candidate):
            try:
                return ImageFont.truetype(candidate, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _add_title(
    image: Image.Image,
    title: str,
    *,
    bar_color: tuple[int, int, int],
    bar_opacity: int,
    bar_position: str,
    bar_height: int,
    font: ImageFont.ImageFont,
    text_color: tuple[int, int, int],
    text_align: str,
    text_padding: int,
) -> Image.Image:
    height = max(1, bar_height)
    if bar_position in {"middle", "inner_top", "inner_bottom"}:
        height = min(height, image.height)
    bar = Image.new("RGBA", (image.width, height), (*bar_color, bar_opacity))
    draw = ImageDraw.Draw(bar)
    if title:
        bbox = draw.textbbox((0, 0), title, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        if text_align == "left":
            x = text_padding
        elif text_align == "right":
            x = image.width - text_padding - text_width
        else:
            x = (image.width - text_width) // 2
        text_y = (height - text_height) // 2 - bbox[1]
        draw.text((x, text_y), title, font=font, fill=(*text_color, 255))

    if bar_position in {"middle", "inner_top", "inner_bottom"}:
        if bar_position == "inner_top":
            y = 0
        elif bar_position == "inner_bottom":
            y = image.height - height
        else:
            y = (image.height - height) // 2
        result = image.convert("RGBA")
        result.alpha_composite(bar, (0, y))
    else:
        result = Image.new("RGBA", (image.width, image.height + height), (0, 0, 0, 255))
        if bar_position == "top":
            result.alpha_composite(bar, (0, 0))
            result.alpha_composite(image.convert("RGBA"), (0, height))
        else:
            result.alpha_composite(image.convert("RGBA"), (0, 0))
            result.alpha_composite(bar, (0, image.height))
    return result.convert("RGB")


def add_titles(
    images: torch.Tensor,
    *,
    titles: str,
    title_bar_color: str,
    title_bar_opacity: int | str,
    title_position: str,
    title_bar_height: int | str,
    font_size: int,
    text_padding: int,
    text_color: str,
    text_align: str,
) -> torch.Tensor:
    source_images = _tensor_images([images])
    labels = str(titles).splitlines()
    labels.extend([""] * (len(source_images) - len(labels)))
    if not any(labels):
        return images
    position = _TITLE_POSITION_ALIASES.get(title_position, title_position)
    alignment = _TEXT_ALIGN_ALIASES.get(text_align, text_align)
    font = _load_font(font_size)
    bar_color = _parse_color(title_bar_color)
    foreground = _parse_color(text_color)
    opacity_percent = _percentage(title_bar_opacity)
    height_percent = _percentage(title_bar_height)
    bar_opacity = round(255 * opacity_percent / 100)

    titled = [
        _add_title(
            image,
            labels[index],
            bar_color=bar_color,
            bar_opacity=bar_opacity,
            bar_position=position,
            bar_height=max(1, round(image.height * height_percent / 100)),
            font=font,
            text_color=foreground,
            text_align=alignment,
            text_padding=text_padding,
        )
        for index, image in enumerate(source_images)
    ]
    output = np.stack([np.asarray(image, dtype=np.float32) / 255.0 for image in titled])
    return torch.from_numpy(output).to(device=images.device, dtype=images.dtype)


def compose_grid(
    image_batches: Iterable[torch.Tensor],
    *,
    layout: str,
    crop_mode: str,
    columns: int,
    spacing: int,
    background_color: str,
) -> torch.Tensor:
    images = _tensor_images(image_batches)
    mode = _LAYOUT_ALIASES.get(layout, layout)
    crop = _CROP_ALIASES.get(crop_mode, crop_mode)
    if mode not in {"horizontal", "vertical", "grid"}:
        raise ValueError(f"不支持的拼接方式：{layout}")
    if crop not in {"none", "standard", "left", "center", "right"}:
        raise ValueError(f"不支持的裁切方式：{crop_mode}")

    base_width, base_height = images[0].size
    if crop != "none":
        if len(images) != 2:
            raise ValueError("裁切拼接需要正好两张图片")
        first = _cover(images[0], base_width, base_height)
        second = _cover(images[1], base_width, base_height)
        first_align = "left" if crop == "standard" else crop
        second_align = "right" if crop == "standard" else crop
        vertical_split = mode == "vertical" or (mode == "grid" and columns == 1)
        if vertical_split:
            top_height = base_height // 2
            bottom_height = base_height - top_height
            first_half = _vertical_crop(first, top_height, first_align)
            second_half = _vertical_crop(second, bottom_height, second_align)
            canvas = Image.new(
                "RGB",
                (base_width + spacing * 2, base_height + spacing * 3),
                _parse_color(background_color),
            )
            canvas.paste(first_half, (spacing, spacing))
            canvas.paste(second_half, (spacing, spacing * 2 + top_height))
        else:
            left_width = base_width // 2
            right_width = base_width - left_width
            first_half = _horizontal_crop(first, left_width, first_align)
            second_half = _horizontal_crop(second, right_width, second_align)
            canvas = Image.new(
                "RGB",
                (base_width + spacing * 3, base_height + spacing * 2),
                _parse_color(background_color),
            )
            canvas.paste(first_half, (spacing, spacing))
            canvas.paste(second_half, (spacing * 2 + left_width, spacing))
        output = np.asarray(canvas, dtype=np.float32) / 255.0
        return torch.from_numpy(output.copy()).unsqueeze(0)
    if mode == "horizontal":
        prepared = [_resize_to_height(image, base_height) for image in images]
        cells = [(image.width, base_height) for image in prepared]
        grid_columns = len(images)
    elif mode == "vertical":
        prepared = [_resize_to_width(image, base_width) for image in images]
        cells = [(base_width, image.height) for image in prepared]
        grid_columns = 1
    else:
        prepared = [_fit_inside(image, base_width, base_height) for image in images]
        cells = [(base_width, base_height)] * len(images)
        grid_columns = columns or math.ceil(math.sqrt(len(images)))
        grid_columns = min(max(1, grid_columns), len(images))

    rows = math.ceil(len(images) / grid_columns)
    if mode == "horizontal":
        canvas_width = sum(width for width, _ in cells) + spacing * (len(images) + 1)
        canvas_height = base_height + spacing * 2
    elif mode == "vertical":
        canvas_width = base_width + spacing * 2
        canvas_height = sum(height for _, height in cells) + spacing * (len(images) + 1)
    else:
        canvas_width = base_width * grid_columns + spacing * (grid_columns + 1)
        canvas_height = base_height * rows + spacing * (rows + 1)

    background = _parse_color(background_color)
    canvas = Image.new("RGB", (canvas_width, canvas_height), background)
    fill = _darken(background)
    for index, image in enumerate(prepared):
        row, column = divmod(index, grid_columns)
        if mode == "horizontal":
            x = spacing + sum(cells[item][0] + spacing for item in range(index))
            y = spacing
        elif mode == "vertical":
            x = spacing
            y = spacing + sum(cells[item][1] + spacing for item in range(index))
        else:
            cell_x = spacing + column * (base_width + spacing)
            cell_y = spacing + row * (base_height + spacing)
            canvas.paste(fill, (cell_x, cell_y, cell_x + base_width, cell_y + base_height))
            x = cell_x + (base_width - image.width) // 2
            y = cell_y + (base_height - image.height) // 2
        canvas.paste(image, (x, y))

    output = np.asarray(canvas, dtype=np.float32) / 255.0
    return torch.from_numpy(output.copy()).unsqueeze(0)


class NO8DImageGrid(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        template = io.Autogrow.TemplatePrefix(
            io.Image.Input("image"), prefix="image", min=1, max=50
        )
        return io.Schema(
            node_id="NO8DImageGrid",
            display_name="NO8D-Image Grid",
            category="NO8D-control",
            description="Combine multiple images horizontally, vertically, or in a grid using the first image as the size reference.",
            inputs=[
                io.Autogrow.Input("images", template=template),
                io.Combo.Input(
                    "layout",
                    display_name="拼接方式",
                    options=["横向", "纵向", "网格"],
                    default="横向",
                ),
                io.Combo.Input(
                    "crop_mode",
                    display_name="裁切方式",
                    options=["none", "标准裁切", "居左裁切", "居中裁切", "居右裁切"],
                    default="none",
                ),
                io.Int.Input("columns", display_name="网格列数（0=自动）", default=0, min=0, max=50, step=1),
                io.Int.Input("spacing", display_name="边距 / 间距", default=4, min=0, max=1024, step=1),
                io.Color.Input("background_color", display_name="背景颜色", default=NO8D_ACCENT_COLOR),
            ],
            outputs=[io.Image.Output(display_name="image")],
        )

    @classmethod
    def execute(cls, images: Mapping[str, torch.Tensor], **kwargs) -> io.NodeOutput:
        return io.NodeOutput(compose_grid(images.values(), **kwargs))


class NO8DImageTitle(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="NO8DImageTitle",
            display_name="NO8D-Image Title",
            category="NO8D-control",
            description="Add a title bar outside the top or bottom edge, or overlay a title inside the image.",
            inputs=[
                io.Image.Input("images", display_name="图片"),
                io.String.Input("titles", display_name="独立标题（每行一个）", default="image-01", multiline=True),
                io.Color.Input("title_bar_color", display_name="标题底色", default=NO8D_ACCENT_COLOR),
                io.Int.Input(
                    "title_bar_opacity",
                    display_name="底色透明度",
                    default=60,
                    min=0,
                    max=100,
                    step=1,
                    extra_dict={"suffix": "%"},
                ),
                io.Combo.Input(
                    "title_position",
                    display_name="标题位置",
                    options=["图外顶部", "图内顶部", "中部", "图内底部", "图外底部"],
                    default="图内底部",
                ),
                io.Int.Input(
                    "title_bar_height",
                    display_name="标题色条高度",
                    default=10,
                    min=1,
                    max=100,
                    step=1,
                    extra_dict={"suffix": "%"},
                ),
                io.Int.Input("font_size", display_name="标题字号", default=36, min=1, max=512, step=1),
                io.Int.Input("text_padding", display_name="标题间距", default=4, min=0, max=1024, step=1),
                io.Color.Input("text_color", display_name="标题颜色", default="#FFFFFF"),
                io.Combo.Input("text_align", display_name="标题对齐", options=["居左", "居中", "居右"], default="居中"),
            ],
            outputs=[io.Image.Output(display_name="image")],
        )

    @classmethod
    def execute(cls, images: torch.Tensor, **kwargs) -> io.NodeOutput:
        return io.NodeOutput(add_titles(images, **kwargs))


NODE_CLASS_MAPPINGS = {
    "NO8DImageGrid": NO8DImageGrid,
    "NO8DImageTitle": NO8DImageTitle,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DImageGrid": "NO8D-Image Grid",
    "NO8DImageTitle": "NO8D-Image Title",
}
