from __future__ import annotations

import json
from pathlib import Path

try:
    from aiohttp import web
    from server import PromptServer
except ImportError:
    web = None
    PromptServer = None


_ROOT = Path(__file__).resolve().parent
_DATA_PATH = _ROOT / "data" / "krea_styles.json"
_PREVIEW_DIR = _ROOT / "krea_style_previews"
_API_PREFIX = "/no8d/krea-style-selector"


def _load_styles() -> tuple[dict, ...]:
    with _DATA_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    styles = payload.get("styles", [])
    if not isinstance(styles, list) or not styles:
        raise RuntimeError("NO8D Krea style data is empty")
    return tuple(styles)


_STYLES = _load_styles()
_STYLE_BY_NAME = {item["name"]: item for item in _STYLES}
_CATEGORIES = ("写实摄影", "动漫插图", "手绘艺术", "数字艺术")
_STYLE_NAMES = tuple(
    item["name"]
    for category in _CATEGORIES
    for item in _STYLES
    if item["category"] == category
)


class NO8DKreaStyleSelector:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "style": ("STRING", {"default": _STYLE_NAMES[0]}),
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "select_style"
    CATEGORY = "NO8D-control"
    DESCRIPTION = "Choose a Krea 2 style from four categories and output its complete English style prompt."

    @classmethod
    def VALIDATE_INPUTS(cls, style):
        if style not in _STYLE_BY_NAME:
            return f"未知风格：{style}"
        return True

    def select_style(self, style):
        item = _STYLE_BY_NAME[style]
        return (item["prompt"],)


if PromptServer is not None and web is not None:
    @PromptServer.instance.routes.get(f"{_API_PREFIX}/styles")
    async def no8d_krea_style_catalog(_request):
        return web.json_response(
            {
                "categories": list(_CATEGORIES),
                "styles": [
                    {
                        "name": item["name"],
                        "name_zh": item["name_zh"],
                        "category": item["category"],
                        "preview": item["preview"],
                        "has_preview": (_PREVIEW_DIR / item["preview"]).is_file(),
                    }
                    for item in _STYLES
                ],
            }
        )

    @PromptServer.instance.routes.get(f"{_API_PREFIX}/preview")
    async def no8d_krea_style_preview(request):
        item = _STYLE_BY_NAME.get(request.rel_url.query.get("style", ""))
        if item is None:
            return web.Response(status=404)
        path = (_PREVIEW_DIR / item["preview"]).resolve()
        if path.parent != _PREVIEW_DIR.resolve() or not path.is_file():
            return web.Response(status=404)
        return web.FileResponse(path)


NODE_CLASS_MAPPINGS = {
    "NO8DKreaStyleSelector": NO8DKreaStyleSelector,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DKreaStyleSelector": "NO8D-Krea2 Style Selector",
}
