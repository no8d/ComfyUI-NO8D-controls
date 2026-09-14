from __future__ import annotations

import asyncio
from io import BytesIO
import json
import math
from collections.abc import Mapping
from pathlib import Path, PurePath
import threading

import numpy as np
import torch
from PIL import Image, ImageChops, ImageColor, ImageOps
from comfy_api.v0_0_2 import io, ui

try:
    import folder_paths
except Exception:
    folder_paths = None

try:
    from aiohttp import web
    from server import PromptServer
except Exception:
    web = None
    PromptServer = None


_REMOVE_BACKGROUND_ROUTE = "/no8d/image-composer/remove-background"
_MAX_UPLOAD_BYTES = 64 * 1024 * 1024
_REMBG_SESSION = None
_REMBG_SESSION_LOCK = threading.Lock()
_BLEND_ALIASES = {
    "normal": "normal",
    "Normal": "normal",
    "multiply": "multiply",
    "Multiply": "multiply",
    "screen": "screen",
    "Screen": "screen",
    "overlay": "overlay",
    "Overlay": "overlay",
}


def _layout(value: str | Mapping) -> dict:
    if isinstance(value, Mapping):
        return dict(value)
    try:
        parsed = json.loads(str(value or "{}"))
    except json.JSONDecodeError as error:
        raise ValueError("图层布局数据不是有效的 JSON") from error
    if not isinstance(parsed, Mapping):
        raise ValueError("图层布局数据必须是 JSON 对象")
    return dict(parsed)


def _ratio_parts(value) -> tuple[float, float]:
    if isinstance(value, Mapping):
        left, right = value.get("width"), value.get("height")
    elif isinstance(value, (list, tuple)) and len(value) == 2:
        left, right = value
    else:
        text = str(value or "1:1").strip().lower().replace("x", ":").replace("/", ":")
        parts = text.split(":")
        if len(parts) != 2:
            raise ValueError(f"画布比例无效：{value!r}")
        left, right = parts
    try:
        width_ratio, height_ratio = float(left), float(right)
    except (TypeError, ValueError) as error:
        raise ValueError(f"画布比例无效：{value!r}") from error
    if not math.isfinite(width_ratio) or not math.isfinite(height_ratio):
        raise ValueError(f"画布比例无效：{value!r}")
    if width_ratio <= 0 or height_ratio <= 0:
        raise ValueError(f"画布比例必须大于 0：{value!r}")
    return width_ratio, height_ratio


def _align_eight(value: float) -> int:
    return max(8, int(math.floor(value / 8.0 + 0.5)) * 8)


def calculate_canvas_size(ratio="1:1", short_side=1024) -> tuple[int, int]:
    width_ratio, height_ratio = _ratio_parts(ratio)
    try:
        short = float(short_side)
    except (TypeError, ValueError) as error:
        raise ValueError("画布短边必须是数字") from error
    if not math.isfinite(short) or not 8 <= short <= 16384:
        raise ValueError("画布短边必须在 8 到 16384 像素之间")
    short = _align_eight(short)
    if width_ratio >= height_ratio:
        width, height = _align_eight(short * width_ratio / height_ratio), short
    else:
        width, height = short, _align_eight(short * height_ratio / width_ratio)
    if width > 16384 or height > 16384:
        raise ValueError("按当前比例计算出的画布长边超过 16384 像素")
    return width, height


def _input_directory() -> Path:
    if folder_paths is None:
        raise RuntimeError("ComfyUI folder_paths 不可用，无法读取输入图片")
    return Path(folder_paths.get_input_directory()).resolve()


def _resolve_image_ref(ref: Mapping) -> Path:
    if not isinstance(ref, Mapping):
        raise ValueError("图片引用必须是对象")
    image_type = str(ref.get("type") or "input").strip()
    if image_type != "input":
        raise ValueError("图层图片仅允许引用 ComfyUI input 目录")
    filename = str(ref.get("filename") or "").strip()
    raw_subfolder = str(ref.get("subfolder") or "").strip()
    if not filename:
        raise ValueError("图片引用缺少 filename")
    if (
        Path(filename).is_absolute()
        or Path(filename).drive
        or Path(raw_subfolder).is_absolute()
        or Path(raw_subfolder).drive
    ):
        raise ValueError("图片引用不能使用绝对路径")
    if "/" in filename or "\\" in filename:
        raise ValueError("filename 不能包含目录")
    subfolder = raw_subfolder.strip("/\\")
    if ".." in PurePath(filename).parts or ".." in PurePath(subfolder).parts:
        raise ValueError("图片引用不能离开 ComfyUI input 目录")
    base = _input_directory()
    path = (base / subfolder / filename).resolve()
    try:
        path.relative_to(base)
    except ValueError as error:
        raise ValueError("图片引用不能离开 ComfyUI input 目录") from error
    if not path.is_file():
        raise FileNotFoundError(f"找不到图层图片：{filename}")
    return path


def _load_rgba(ref: Mapping) -> Image.Image:
    with Image.open(_resolve_image_ref(ref)) as image:
        return ImageOps.exif_transpose(image).convert("RGBA")


def _load_eraser_mask(ref: Mapping, size: tuple[int, int]) -> Image.Image:
    with Image.open(_resolve_image_ref(ref)) as image:
        image = ImageOps.exif_transpose(image)
        mask = image.getchannel("A") if "A" in image.getbands() else image.convert("L")
        if mask.size != size:
            mask = mask.resize(size, Image.Resampling.LANCZOS)
        return mask


def _finite_number(value, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def _layer_source(layer: Mapping) -> Image.Image:
    source_ref = layer.get("cutout_source") or layer.get("source")
    if not isinstance(source_ref, Mapping):
        raise ValueError("图层缺少 source 图片引用")
    source = _load_rgba(source_ref)
    eraser_ref = layer.get("eraser_mask") if layer.get("cutout_source") else None
    if isinstance(eraser_ref, Mapping):
        eraser = np.asarray(_load_eraser_mask(eraser_ref, source.size), dtype=np.float32) / 255.0
        alpha = np.asarray(source.getchannel("A"), dtype=np.float32)
        source.putalpha(Image.fromarray(np.round(alpha * (1.0 - eraser)).astype(np.uint8), "L"))
    if layer.get("flip_horizontal"):
        source = ImageOps.mirror(source)
    if layer.get("flip_vertical"):
        source = ImageOps.flip(source)
    stroke_active = layer.get("stroke_enabled", bool(layer.get("stroke_width")))
    stroke_width = min(40, max(0, round(_finite_number(layer.get("stroke_width"), 0)))) if stroke_active and layer.get("cutout_source") else 0
    if stroke_width:
        try:
            color = ImageColor.getrgb(str(layer.get("stroke_color") or "#ffffff"))
        except ValueError as error:
            raise ValueError("描边颜色必须是有效的颜色值") from error
        padded = Image.new("RGBA", (source.width + stroke_width * 2, source.height + stroke_width * 2))
        padded.alpha_composite(source, (stroke_width, stroke_width))
        alpha = padded.getchannel("A")
        outline = Image.new("RGBA", padded.size, (*color[:3], 0))
        outline_alpha = alpha
        for step in range(24):
            angle = step * math.pi / 12
            shifted = ImageChops.offset(
                alpha,
                round(math.cos(angle) * stroke_width),
                round(math.sin(angle) * stroke_width),
            )
            outline_alpha = ImageChops.lighter(outline_alpha, shifted)
        outline.putalpha(outline_alpha)
        outline.alpha_composite(padded)
        source = outline
    return source


def _transform_layer(source: Image.Image, layer: Mapping, width: int, height: int) -> Image.Image:
    scale = min(20.0, max(0.01, _finite_number(layer.get("scale"), 1.0)))
    transformed = source.resize(
        (max(1, round(source.width * scale)), max(1, round(source.height * scale))),
        Image.Resampling.LANCZOS,
    )
    rotation = _finite_number(layer.get("rotation"), 0.0)
    if rotation % 360:
        transformed = transformed.rotate(-rotation, expand=True, resample=Image.Resampling.BICUBIC)
    opacity = min(1.0, max(0.0, _finite_number(layer.get("opacity"), 1.0)))
    if opacity < 1.0:
        alpha = transformed.getchannel("A").point(lambda value: round(value * opacity))
        transformed.putalpha(alpha)
    center_x = _finite_number(layer.get("x"), width / 2)
    center_y = _finite_number(layer.get("y"), height / 2)
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    canvas.alpha_composite(
        transformed,
        (round(center_x - transformed.width / 2), round(center_y - transformed.height / 2)),
    )
    return canvas


def _blend(base: Image.Image, top: Image.Image, mode: str) -> Image.Image:
    canonical = _BLEND_ALIASES.get(str(mode), str(mode).lower())
    if canonical == "normal":
        return Image.alpha_composite(base, top)
    if canonical not in {"multiply", "screen", "overlay"}:
        raise ValueError(f"不支持的图层混合模式：{mode}")
    base_array = np.asarray(base, dtype=np.float32) / 255.0
    top_array = np.asarray(top, dtype=np.float32) / 255.0
    base_rgb, top_rgb = base_array[..., :3], top_array[..., :3]
    alpha = top_array[..., 3:4]
    if canonical == "multiply":
        blended = base_rgb * top_rgb
    elif canonical == "screen":
        blended = 1.0 - (1.0 - base_rgb) * (1.0 - top_rgb)
    else:
        blended = np.where(
            base_rgb <= 0.5,
            2.0 * base_rgb * top_rgb,
            1.0 - 2.0 * (1.0 - base_rgb) * (1.0 - top_rgb),
        )
    output_rgb = blended * alpha + base_rgb * (1.0 - alpha)
    output = np.concatenate([output_rgb, np.ones_like(alpha)], axis=-1)
    return Image.fromarray(np.round(np.clip(output, 0, 1) * 255).astype(np.uint8), "RGBA")


def compose_project(layout_json: str | Mapping) -> tuple[torch.Tensor, int, int]:
    project = _layout(layout_json)
    width, height = calculate_canvas_size(project.get("ratio", "1:1"), project.get("short_side", 1024))
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 255))
    layers = project.get("layers", [])
    if not isinstance(layers, list):
        raise ValueError("layers 必须是数组")
    for layer in layers:
        if not isinstance(layer, Mapping) or not layer.get("visible", True):
            continue
        transformed = _transform_layer(_layer_source(layer), layer, width, height)
        canvas = _blend(canvas, transformed, layer.get("blend_mode", "normal"))
    array = np.asarray(canvas.convert("RGB"), dtype=np.float32) / 255.0
    return torch.from_numpy(array.copy())[None, ...], width, height


def _remove_background_sync(payload: bytes) -> bytes:
    global _REMBG_SESSION
    try:
        import rembg
    except ImportError as error:
        raise RuntimeError("未安装 rembg，无法使用抠图功能。请先在 ComfyUI 环境安装 rembg。") from error
    with _REMBG_SESSION_LOCK:
        if _REMBG_SESSION is None:
            _REMBG_SESSION = rembg.new_session()
        session = _REMBG_SESSION
    result = rembg.remove(payload, session=session)
    if isinstance(result, Image.Image):
        buffer = BytesIO()
        result.save(buffer, format="PNG")
        result = buffer.getvalue()
    elif isinstance(result, np.ndarray):
        buffer = BytesIO()
        Image.fromarray(result).save(buffer, format="PNG")
        result = buffer.getvalue()
    if not isinstance(result, bytes):
        raise RuntimeError("rembg 返回了无法识别的结果")
    return result


async def no8d_image_composer_remove_background(request):
    try:
        reader = await request.multipart()
        payload = None
        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "image":
                payload = await field.read(decode=False)
        if not payload:
            return web.json_response({"error": "缺少 multipart image 文件"}, status=400)
        if len(payload) > _MAX_UPLOAD_BYTES:
            return web.json_response({"error": "上传图片不能超过 64 MB"}, status=413)
        result = await asyncio.to_thread(_remove_background_sync, bytes(payload))
        return web.Response(body=result, content_type="image/png")
    except RuntimeError as error:
        return web.json_response({"error": str(error)}, status=503)
    except Exception as error:
        return web.json_response({"error": f"抠图失败：{error}"}, status=400)


def _register_routes():
    if PromptServer is not None and web is not None:
        PromptServer.instance.routes.post(_REMOVE_BACKGROUND_ROUTE)(no8d_image_composer_remove_background)


_register_routes()


class NO8DImageComposer(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="NO8DImageComposer",
            display_name="NO8D-Image Composer",
            category="NO8D-control",
            description="Compose uploaded image layers on a ratio-based canvas.",
            inputs=[
                io.String.Input(
                    "layout_json",
                    default='{"ratio":"1:1","short_side":1024,"layers":[]}',
                    socketless=True,
                )
            ],
            outputs=[
                io.Image.Output("image", display_name="image"),
                io.Int.Output("width", display_name="width"),
                io.Int.Output("height", display_name="height"),
            ],
        )

    @classmethod
    def execute(cls, layout_json: str = "{}") -> io.NodeOutput:
        output, width, height = compose_project(layout_json)
        preview = ui.PreviewImage(output, cls=cls).as_dict()
        return io.NodeOutput(output, width, height, ui=preview)


NODE_CLASS_MAPPINGS = {"NO8DImageComposer": NO8DImageComposer}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DImageComposer": "NO8D-Image Composer"}
