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
    return torch.from_numpy(arr)[None,]


def _thumbnail_resample():
    try:
        return Image.Resampling.LANCZOS
    except AttributeError:
        return Image.LANCZOS


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
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "load"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, image_files="[]"):
        refs = _parse_image_refs(image_files)
        paths = [_ref_to_path(ref) for ref in refs]
        return _fingerprint(paths, image_files)

    def load(self, image_files="[]"):
        refs = _parse_image_refs(image_files)
        paths = [_ref_to_path(ref) for ref in refs]
        if not paths:
            raise ValueError("NO8D-Load-images: no images selected.")

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
            with Image.open(path) as image:
                image = ImageOps.exif_transpose(image)
                image.thumbnail((size, size), _thumbnail_resample())
                image = image.convert("RGB")
                buffer = BytesIO()
                image.save(buffer, format="WEBP", quality=76, method=4)
                buffer.seek(0)
            return web.Response(body=buffer.read(), content_type="image/webp")
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=400)


NODE_CLASS_MAPPINGS = {
    "NO8DLoadImages": NO8DLoadImages,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DLoadImages": "NO8D-Load-images",
}
