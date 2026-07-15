from __future__ import annotations

import hashlib
from io import BytesIO
import json
import os
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageOps

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


_API_PREFIX = "/no8d-control/api"
_THUMB_CACHE = {}
_THUMB_CACHE_LIMIT = 512
def _input_directory():
    if folder_paths is not None:
        try:
            return folder_paths.get_input_directory()
        except Exception:
            pass
    return os.getcwd()


def _base_directory(image_type):
    if folder_paths is not None:
        getters = {
            "input": "get_input_directory",
            "output": "get_output_directory",
            "temp": "get_temp_directory",
        }
        getter = getattr(folder_paths, getters.get(str(image_type or "input"), "get_input_directory"), None)
        if getter is not None:
            try:
                return Path(getter()).resolve()
            except Exception:
                pass
    return Path(_input_directory()).resolve()


def _parse_image_refs(image_files):
    if isinstance(image_files, list):
        refs = image_files
    else:
        text = str(image_files or "").strip()
        if not text:
            return []
        try:
            refs = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError("NO8D-Load-images: image list is not valid JSON.") from exc
    if not isinstance(refs, list):
        raise ValueError("NO8D-Load-images: image list must be a JSON array.")
    return refs


def _ref_to_path(ref):
    if isinstance(ref, str):
        text = ref.strip()
        path = Path(text).expanduser()
        if not path.is_absolute():
            path = _base_directory("input") / path
        return path.resolve()

    if not isinstance(ref, dict):
        raise ValueError("NO8D-Load-images: each image reference must be a string or an object.")

    name = str(ref.get("name") or "").strip()
    if not name:
        raise ValueError("NO8D-Load-images: image reference missing name.")
    subfolder = str(ref.get("subfolder") or "").strip().strip("/\\")
    image_type = str(ref.get("type") or "input").strip() or "input"
    base = _base_directory(image_type)
    path = base
    if subfolder:
        path = path / subfolder
    resolved = (path / name).resolve()
    try:
        resolved.relative_to(base)
    except ValueError as exc:
        raise ValueError("NO8D-Load-images: image reference escapes its base directory.") from exc
    return resolved


def _load_image(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode == "I":
            image = image.point(lambda i: i * (1 / 255))
        image = image.convert("RGB")
        arr = np.asarray(image).astype(np.float32) / 255.0
    tensor = torch.from_numpy(arr)[None,]
    try:
        tensor.no8d_source_stem = path.stem
        tensor.no8d_source_name = path.name
        tensor.no8d_source_path = str(path)
    except Exception:
        pass
    return tensor


def _normalize_to_uint8(image):
    arr = np.asarray(image)
    if arr.dtype == np.uint8:
        return image
    arr = arr.astype(np.float32)
    finite = np.isfinite(arr)
    if not finite.any():
        arr = np.zeros_like(arr, dtype=np.uint8)
    else:
        lo = float(arr[finite].min())
        hi = float(arr[finite].max())
        if hi > lo:
            arr = (arr - lo) * (255.0 / (hi - lo))
        else:
            arr = np.zeros_like(arr)
        arr = np.clip(arr, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def _prepare_thumbnail_image(image):
    image = ImageOps.exif_transpose(image)
    if image.mode in ("I", "I;16", "I;16B", "I;16L", "F"):
        image = _normalize_to_uint8(image)
    if image.mode in ("RGBA", "LA") or ("transparency" in image.info):
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (17, 17, 17, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def _thumbnail_resample():
    try:
        return Image.Resampling.LANCZOS
    except AttributeError:
        return Image.LANCZOS


def _cache_put(key, value):
    _THUMB_CACHE[key] = value
    if len(_THUMB_CACHE) > _THUMB_CACHE_LIMIT:
        for old_key in list(_THUMB_CACHE.keys())[: len(_THUMB_CACHE) - _THUMB_CACHE_LIMIT]:
            _THUMB_CACHE.pop(old_key, None)


def _fingerprint(paths, image_files):
    h = hashlib.sha1()
    h.update(str(image_files or "").encode("utf-8", errors="ignore"))
    for path in paths:
        try:
            stat = path.stat()
            h.update(str(path).encode("utf-8", errors="ignore"))
            h.update(str(stat.st_size).encode())
            h.update(str(stat.st_mtime_ns).encode())
        except OSError:
            h.update(str(path).encode("utf-8", errors="ignore"))
    return h.hexdigest()


class NO8DLoadImages:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_files": ("STRING", {"default": "[]", "multiline": False}),
                "output_files": ("STRING", {"default": "[]", "multiline": False}),
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "load"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, image_files="[]", output_files="[]"):
        refs = _parse_image_refs(output_files)
        paths = [_ref_to_path(ref) for ref in refs]
        return _fingerprint(paths, f"{image_files}\n{output_files}")

    def load(self, image_files="[]", output_files="[]"):
        refs = _parse_image_refs(output_files)
        paths = [_ref_to_path(ref) for ref in refs]
        if not paths:
            return ([],)

        missing = [str(path) for path in paths if not path.is_file()]
        if missing:
            raise FileNotFoundError("NO8D-Load-images: image not found: " + missing[0])

        images = [_load_image(path) for path in paths]
        return (images,)


if PromptServer is not None and web is not None:
    @PromptServer.instance.routes.get(f"{_API_PREFIX}/load-images/thumbnail")
    async def no8d_load_images_thumbnail(request):
        try:
            size = int(float(request.rel_url.query.get("size", 96)))
        except Exception:
            size = 96
        size = max(48, min(512, size))
        ref = {
            "name": request.rel_url.query.get("name", ""),
            "subfolder": request.rel_url.query.get("subfolder", ""),
            "type": request.rel_url.query.get("type", "input"),
        }
        try:
            path = _ref_to_path(ref)
            if not path.is_file():
                return web.Response(status=404)
            stat = path.stat()
            cache_key = (str(path), stat.st_size, stat.st_mtime_ns, size)
            cached = _THUMB_CACHE.get(cache_key)
            if cached is not None:
                return web.Response(body=cached, content_type="image/png")
            with Image.open(path) as image:
                image = _prepare_thumbnail_image(image)
                image.thumbnail((size, size), _thumbnail_resample())
                buffer = BytesIO()
                image.save(buffer, format="PNG", optimize=True)
                buffer.seek(0)
                payload = buffer.read()
                _cache_put(cache_key, payload)
            return web.Response(body=payload, content_type="image/png")
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)


NODE_CLASS_MAPPINGS = {
    "NO8DLoadImages": NO8DLoadImages,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DLoadImages": "NO8D-Load-images",
}
