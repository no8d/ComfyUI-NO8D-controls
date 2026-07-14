from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import hashlib
import io
import json
import os
import re
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
from PIL import Image

try:
    from json_repair import repair_json as _repair_json
except ImportError:
    _repair_json = None

from .prompt_config import RULE_NATURAL as _RULE_NATURAL
from .prompt_config import prompt_config_manager
from .prompt_provider import configure_chat_payload as _configure_chat_payload
from .prompt_provider import is_ark_url as _is_ark_url


_IMAGE_MAX_EDGE = 768
_IMAGE_JPEG_QUALITY = 80
_IMAGE_ENCODE_CACHE_LIMIT = 64
_OPENAI_TIMEOUT = 120
_OLLAMA_TIMEOUT = 240
_MAX_PARALLEL_REQUESTS = 3
_RETRY_HTTP_CODES = {408, 429, 500, 502, 503, 504}
_ARK_BURST_RETRY_DELAY = 8.0
_ARK_REQUEST_LOCK = threading.Lock()
_PROMPT_PIPELINE_VERSION = "structured-geometry-v8"
# The structured worksheet has substantially more fields than the rendered
# prompt. Keep its private budget separate from the public 256/512-token target.
# Native JSON-schema decoding still obeys max_tokens and needs room to emit all
# required geometry and grounded descriptive fields.
_NATURAL_ANALYSIS_TOKEN_OVERHEAD = 1792
_STYLE_PRESETS = (
    "自行判断",
    "写实摄影",
    "动漫插图",
    "手绘艺术",
    "数字艺术",
)
_STYLE_PRESET_ALIASES = {
    "无": "自行判断",
    "none": "自行判断",
    "None": "自行判断",
    "Auto": "自行判断",
    "自行判断": "自行判断",
    "Realistic photography": "写实摄影",
    "Anime illustration": "动漫插图",
    "Hand-drawn art": "手绘艺术",
    "Digital art": "数字艺术",
    "艺术手绘": "手绘艺术",
    "数字绘画": "数字艺术",
    "Traditional hand-drawn art": "手绘艺术",
    "Digital painting": "数字艺术",
    # Migrate style values serialized by releases before the umbrella categories.
    "业余摄影": "写实摄影",
    "专业摄影": "写实摄影",
    "影视摄影": "写实摄影",
    "Amateur photography": "写实摄影",
    "Professional photography": "写实摄影",
    "Cinematic photography": "写实摄影",
    "日式动漫": "动漫插图",
    "美式动漫": "动漫插图",
    "3d卡通": "动漫插图",
    "Japanese anime": "动漫插图",
    "American animation": "动漫插图",
    "3D cartoon": "动漫插图",
    "油画艺术": "手绘艺术",
    "Oil painting": "手绘艺术",
    "插画艺术": "数字艺术",
    "3d写实": "数字艺术",
    "Illustration art": "数字艺术",
    "3D realism": "数字艺术",
}
_STYLE_PRESET_INPUTS = _STYLE_PRESETS
_STYLE_PRESET_RULES = {
    "写实摄影": (
        "Stay within realistic photography. Infer the best-supported photographic subtype from the image and/or text, "
        "such as a casual smartphone snapshot, documentary or street photography, DSLR/mirrorless portrait or editorial "
        "photography, commercial studio or product photography, architecture/interior photography, sports/action, macro, "
        "wildlife, analog film photography, or a cinematic film still. Describe the selected capture type and only the "
        "lens character, lighting, depth of field, color response, grain/noise, dynamic range, and believable imperfections "
        "that fit the evidence. Keep rough phone images rough and polished studio images polished. Do not turn the result "
        "into illustration, painting, anime, or CGI."
    ),
    "动漫插图": (
        "Stay within anime, animation, comic, and cartoon illustration. Infer the best-supported subtype from the image "
        "and/or text, such as Japanese anime key art, manga, cel animation, webtoon, western animation, comic-book or "
        "graphic-novel art, children's cartoon/storybook art, retro animation, or a stylized 3D animated/cartoon render "
        "when that rendering is clearly intended. Describe the selected subtype through its line quality, shape language, "
        "color treatment, shading, background treatment, and rendering finish. Apply the visual grammar to the actual "
        "subject, including non-human subjects, without inventing anime characters or human traits."
    ),
    "手绘艺术": (
        "Stay within art made with physical hand-drawn or hand-painted media. Infer the best-supported traditional medium "
        "from the image and/or text, such as oil, watercolor, gouache, acrylic, ink wash, pen and ink, pencil, charcoal, "
        "pastel, marker, printmaking, or mixed media. Describe the selected medium through plausible paper or canvas, "
        "pigment, stroke, edge, layering, bleeding, granulation, pressure, and surface characteristics. Do not substitute "
        "a photographic, anime, 3D-rendered, or generically digital finish."
    ),
    "数字艺术": (
        "Stay within digitally created visual art. Infer the best-supported subtype from the image and/or text, such as "
        "digital painting, concept art, environment design, character key art, matte painting, editorial illustration, "
        "game art, painterly photobashing, pixel art, or a photoreal/stylized CGI hybrid when the evidence calls for it. "
        "Describe the selected subtype through its brush or rendering language, edge control, material treatment, layer-like "
        "depth, color design, lighting, and finish. Do not mislabel it as an ordinary camera photograph or a physical "
        "traditional artwork."
    ),
}
_COMPOSITION_PRESETS = (
    "自行判断",
    "大特写",
    "特写",
    "近景",
    "中景",
    "全景",
    "大远景",
)
_COMPOSITION_PRESET_ALIASES = {
    "无": "自行判断",
    "none": "自行判断",
    "None": "自行判断",
    "Auto": "自行判断",
    "自动判断": "自行判断",
    "自行判断": "自行判断",
    "Extreme close-up": "大特写",
    "Close-up": "特写",
    "Close shot": "近景",
    "Medium close-up": "近景",
    "Medium shot": "中景",
    "Medium wide shot": "全景",
    "Full shot": "全景",
    "Wide shot": "全景",
    "Extreme wide shot": "大远景",
    "近景": "近景",
    "中近景": "中景",
    "中远景": "全景",
    "全景": "全景",
    "远景": "全景",
    "居中主体": "中景",
    "半身人像": "中景",
    "全身人像": "全景",
    "低角度": "中景",
    "高角度": "中景",
    "三分法构图": "中景",
    "对称构图": "中景",
    "留白构图": "全景",
    "主体偏左": "中景",
    "主体偏右": "中景",
}
_COMPOSITION_PRESET_INPUTS = _COMPOSITION_PRESETS
_COMPOSITION_PRESET_RULES = {
    "大特写": "Use an extreme close-up shot scale. The main subject is not limited to a person; it may be an animal, building, product, vehicle, plant, object, logo, food item, or any other primary visual subject. Show only a small, important part of that subject, such as eyes, mouth, hands, fur, fabric texture, product material, architectural ornament, logo detail, surface wear, or a similarly tight feature. The subject detail should dominate the caption, with light, color, and atmosphere used only to support that detail. Do not describe the whole subject, full pose, complete product, full building, full body, ground contact, or broad environment; the background should read only as blur, color, texture, or abstract light.",
    "特写": "Use a close-up shot scale. The main subject is not limited to a person; apply the same framing logic to animals, buildings, products, vehicles, plants, objects, food, or any other primary visual subject. The subject should fill most of the frame, such as a face, head-and-shoulders portrait, animal head and upper body, product front/detail view, building facade section, or tight object view. Prioritize visible subject features, expression or form, grooming or surface finish, local texture, pose angle, material, and nearby light. Include only a little nearby environment and strong light/atmosphere. Do not describe full-body framing, complete architecture, full product display, distant spatial layout, or large scenic context.",
    "近景": "Use a near shot / medium close-up shot scale. The main subject is not limited to a person; use this for animals, buildings, products, vehicles, plants, objects, food, or any other primary visual subject when the subject should remain dominant but not face-only or detail-only. For a person, frame roughly from the chest or waist upward; for animals, show the head and enough body to read posture; for products or objects, show most of the item with close surface detail; for buildings, show a readable section rather than the whole site. Subject description should remain dominant, with limited nearby setting and light/atmosphere. Do not describe feet, full-body stance, full product layout, full building context, ground contact, or a broad scenic environment.",
    "中景": "Use a medium shot scale. The main subject is not limited to a person; apply the same distance logic to animals, buildings, products, vehicles, plants, objects, food, or any other primary visual subject. Show enough of the subject to understand pose, action, function, silhouette, or structure, such as waist-to-knee framing for a person, most of an animal, a product with immediate tabletop context, a vehicle with nearby ground, or a building portion with adjacent space. Keep subject, nearby environment, and light/atmosphere in clear balance. Avoid face-only microdetail, and avoid turning it into a full-subject environmental shot.",
    "全景": "Use a full shot scale. The main subject is not limited to a person; apply this to animals, buildings, products, vehicles, plants, objects, food, or any other primary visual subject. Show the complete main subject, such as a full person from head to feet, a whole animal, the complete product, the full vehicle, the entire object, or a complete building when that is the selected subject, while keeping the surrounding environment clearly visible. Environment, spatial relationships, ground contact, scale, and atmosphere should matter more than fine subject detail. Avoid close-up-only details such as eye texture, makeup microdetails, tiny fabric texture, small product scratches, or architectural ornaments that would not be prominent in a full shot.",
    "大远景": "Use an extreme wide shot scale. The main subject is not limited to a person; apply this to animals, buildings, products, vehicles, plants, objects, food, or any other primary visual subject. The environment and overall scene geography should dominate, with the subject very small or used as a scale marker. Focus on location, weather, architecture or landscape, distance, mood, and light across the scene. Keep the subject description brief and avoid face, clothing, paw, hand, product-label, surface, or small architectural details that would not be visible at this distance.",
}
_LENGTH_PRESETS = ("标准", "详细")
_LENGTH_PRESET_ALIASES = {
    "Standard": "标准",
    "Detailed": "详细",
}
_LENGTH_PRESET_INPUTS = _LENGTH_PRESETS + tuple(_LENGTH_PRESET_ALIASES.keys())
_LENGTH_TOKEN_LIMITS = {
    "标准": 256,
    "详细": 512,
}
_LENGTH_PRESET_RULES = {
    "标准": "Target output length: approximately 256 tokens. Aim close to 256 tokens but never exceed the hard maximum of 256 output tokens. For natural-language output, write one cohesive paragraph with enough clear sentences to use the available budget without padding or repetition. Put the main subject, action, camera-to-subject relationship, frame placement, and composition before secondary style or atmosphere details so essential spatial information survives downstream truncation. Prioritize setting, lighting, medium, and mood after those essentials.",
    "详细": "Target output length: approximately 512 tokens. Aim close to 512 tokens but never exceed the hard maximum of 512 output tokens. For natural-language output, write one cohesive, richly developed paragraph that uses the available budget without padding or repetition. Put the main subject, action, camera-to-subject relationship, frame placement, and composition first. Then add grounded visual evidence: subject details, pose or orientation, spatial layout, foreground and background, lighting direction, materials, textures, color relationships, camera or medium language, atmosphere, and visible text when present. The detailed result must be substantially more developed than the standard result while staying coherent.",
}
_OUTPUT_LANGUAGES = ("英文", "中文")
_OUTPUT_LANGUAGE_ALIASES = {
    "English": "英文",
    "Chinese": "中文",
}
_OUTPUT_LANGUAGE_INPUTS = _OUTPUT_LANGUAGES + tuple(_OUTPUT_LANGUAGE_ALIASES.keys())
_IMAGE_ENCODE_CACHE = {}
_IMAGE_ENCODE_CACHE_LOCK = threading.Lock()

def _normalize_style_preset(style_preset):
    preset = str(style_preset or "").strip()
    return _STYLE_PRESET_ALIASES.get(preset, preset) if preset else "自行判断"

def _normalize_composition_preset(composition_preset):
    preset = str(composition_preset or "").strip()
    return _COMPOSITION_PRESET_ALIASES.get(preset, preset) if preset else "自行判断"

def _normalize_length_preset(length_preset):
    preset = str(length_preset or "").strip()
    return _LENGTH_PRESET_ALIASES.get(preset, preset) if preset else "标准"

def _normalize_output_language(output_language):
    language = str(output_language or "").strip()
    return _OUTPUT_LANGUAGE_ALIASES.get(language, language) if language else "英文"

def _endpoint_from_base_url(base_url):
    url = str(base_url or "").strip().strip('"').strip("'")
    if not url:
        return ""
    if url.endswith("#"):
        return url[:-1].rstrip("/")
    known = ("/chat/completions", "/v1/messages", "/completions")
    if any(part in url for part in known):
        return url.rstrip("/")
    if "api.openai.com" in url and "/v1" not in url:
        url = url.rstrip("/") + "/v1"
    return url.rstrip("/") + "/chat/completions"


def _uses_streaming_chat(base_url):
    """Use Ark's SSE transport so long generations do not wait for one final response."""
    return _is_ark_url(base_url)


def _content_text(content):
    if isinstance(content, list):
        return "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    return str(content or "")


class _StreamingAPIError(RuntimeError):
    def __init__(self, error, had_content=False):
        self.error = error if isinstance(error, dict) else {"message": str(error)}
        self.code = str(self.error.get("code") or "").strip()
        self.error_type = str(self.error.get("type") or "").strip()
        self.had_content = bool(had_content)
        super().__init__(f"NO8D-Prompt: API streaming error: {self.error}")

    @property
    def retryable_burst(self):
        return not self.had_content and (
            self.code == "RequestBurstTooFast" or self.error_type == "TooManyRequests"
        )


def _read_chat_response(response, streaming=False):
    if not streaming:
        raw = response.read().decode("utf-8", errors="replace")
        parsed = json.loads(raw)
        choices = parsed.get("choices") or []
        if not choices:
            raise RuntimeError("NO8D-Prompt: API returned no choices")
        message = choices[0].get("message") or {}
        content = _content_text(message.get("content") or choices[0].get("text"))
        if not content.strip():
            raise RuntimeError("NO8D-Prompt: API returned empty content")
        return content

    parts = []
    had_generation = False
    for raw_line in response:
        line = raw_line.decode("utf-8", errors="replace").strip()
        if not line or line.startswith(":") or not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if not data or data == "[DONE]":
            if data == "[DONE]":
                break
            continue
        try:
            event = json.loads(data)
        except json.JSONDecodeError as exc:
            raise RuntimeError("NO8D-Prompt: API returned an invalid streaming event") from exc
        if isinstance(event, dict) and event.get("error"):
            raise _StreamingAPIError(event["error"], had_content=had_generation)
        choices = event.get("choices") or [] if isinstance(event, dict) else []
        if not choices:
            continue
        choice = choices[0]
        message = choice.get("delta") or choice.get("message") or {}
        if any(message.get(field) for field in ("content", "reasoning_content", "refusal", "tool_calls")):
            had_generation = True
        content = _content_text(message.get("content") or choice.get("text"))
        if content:
            parts.append(content)
    content = "".join(parts)
    if not content.strip():
        raise RuntimeError("NO8D-Prompt: API returned empty streaming content")
    return content


def _timeout_message(base_url, model):
    host = urllib.parse.urlparse(str(base_url or "")).hostname or str(base_url or "API")
    model_name = str(model or "unknown model").strip()
    message = (
        f"NO8D-Prompt: model {model_name} at {host} did not return data for {_OPENAI_TIMEOUT}s. "
        "The request was not repeated."
    )
    if _uses_streaming_chat(base_url):
        return message + " Check the Ark model status, account quota, and provider load, or select a faster available model."
    return message + " For image inputs, select a faster Vision model; for Qwen, prefer an Instruct variant over Thinking."


def _request_guard(base_url):
    if _uses_streaming_chat(base_url):
        return _ARK_REQUEST_LOCK
    return contextlib.nullcontext()


def _should_parallelize_requests(item_count, base_url, service_type):
    return (
        item_count > 1
        and not _uses_ollama_native(base_url, service_type)
        and not _is_local_url(base_url)
        and not _uses_streaming_chat(base_url)
    )


def _is_local_url(url):
    try:
        host = urllib.parse.urlparse(str(url or "")).hostname or ""
    except Exception:
        return False
    return host in {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}


_NO_PROXY_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _urlopen(request, timeout, base_url=""):
    target = base_url or getattr(request, "full_url", "")
    if _is_local_url(target):
        return _NO_PROXY_OPENER.open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)


def _uses_ollama_native(base_url, service_type):
    if str(service_type or "").strip().lower() != "ollama":
        return False
    url = str(base_url or "").strip().strip('"').strip("'").rstrip("/")
    return not url.endswith("/v1") and "/v1/" not in url


def _clean_key(value):
    return str(value or "").strip().strip('"').strip("'").replace("\n", "").replace("\r", "").replace("\t", "")


def _safe_int(value, default):
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value, default):
    try:
        return float(value)
    except Exception:
        return default


def _safe_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return value != 0
    text = str(value).strip().lower()
    if text in {"true", "1", "yes", "on", "auto"}:
        return True
    if text in {"false", "0", "no", "off", "edit", ""}:
        return False
    return default


def _prompt_view_text(value):
    """Normalize ComfyUI STRING inputs, including empty bypass/list values."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        for item in value:
            text = _prompt_view_text(item)
            if text.strip():
                return text
        return ""
    if isinstance(value, (dict, set)):
        return ""
    return str(value)


def _strip_thinking(text):
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.IGNORECASE | re.DOTALL).strip()


def _strip_code_fence(text):
    text = (text or "").strip()
    match = re.match(r"^```(?:json|text|prompt)?\s*(.*?)\s*```$", text, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else text


def _image_to_data_url(image):
    if image is None:
        return "", ""
    arr = image
    try:
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        arr = np.asarray(arr)
        if arr.ndim == 4:
            arr = arr[0]
        return _image_array_to_data_url(arr)
    except Exception:
        return "", ""


def _image_array_cache_key(arr):
    clean = np.ascontiguousarray(arr)
    return (
        str(clean.dtype),
        tuple(int(v) for v in clean.shape),
        hashlib.sha1(clean.tobytes()).hexdigest(),
    )


def _image_cache_get(cache_key):
    with _IMAGE_ENCODE_CACHE_LOCK:
        return _IMAGE_ENCODE_CACHE.get(cache_key)


def _image_cache_put(cache_key, value):
    with _IMAGE_ENCODE_CACHE_LOCK:
        _IMAGE_ENCODE_CACHE[cache_key] = value
        while len(_IMAGE_ENCODE_CACHE) > _IMAGE_ENCODE_CACHE_LIMIT:
            _IMAGE_ENCODE_CACHE.pop(next(iter(_IMAGE_ENCODE_CACHE)))


def _image_array_to_data_url_uncached(arr):
    if arr.ndim != 3:
        return "", ""
    if arr.shape[-1] > 3:
        arr = arr[..., :3]
    arr = np.clip(arr * 255.0, 0, 255).astype(np.uint8)
    pil = Image.fromarray(arr, "RGB")
    max_edge = max(pil.size)
    if max_edge != _IMAGE_MAX_EDGE:
        scale = _IMAGE_MAX_EDGE / max_edge
        size = (max(1, round(pil.width * scale)), max(1, round(pil.height * scale)))
        resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.BICUBIC)
        pil = pil.resize(size, resampling)
    buf = io.BytesIO()
    pil.save(buf, format="JPEG", quality=_IMAGE_JPEG_QUALITY, optimize=True)
    raw = buf.getvalue()
    return "data:image/jpeg;base64," + base64.b64encode(raw).decode("ascii"), hashlib.sha1(raw).hexdigest()


def _image_array_to_data_url(arr):
    try:
        cache_key = _image_array_cache_key(arr)
    except Exception:
        cache_key = None
    if cache_key is not None:
        cached = _image_cache_get(cache_key)
        if cached is not None:
            return cached
    encoded = _image_array_to_data_url_uncached(arr)
    if cache_key is not None and encoded[0]:
        _image_cache_put(cache_key, encoded)
    return encoded


def _images_to_data_urls(images):
    if images is None:
        return []
    try:
        if isinstance(images, (list, tuple)):
            encoded = []
            for image in images:
                if image is None:
                    continue
                arr = image.detach().cpu().numpy() if hasattr(image, "detach") else np.asarray(image)
                if arr.ndim == 4:
                    for item in arr:
                        data_url, image_hash = _image_array_to_data_url(item)
                        if data_url:
                            encoded.append((data_url, image_hash))
                elif arr.ndim == 3:
                    data_url, image_hash = _image_array_to_data_url(arr)
                    if data_url:
                        encoded.append((data_url, image_hash))
            return encoded
        arr = images
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        arr = np.asarray(arr)
        if arr.ndim == 3:
            arr = arr[None, ...]
        if arr.ndim != 4:
            return []
        encoded = []
        for item in arr:
            data_url, image_hash = _image_array_to_data_url(item)
            if data_url:
                encoded.append((data_url, image_hash))
        return encoded
    except Exception:
        return []


def _images_to_hashes(images):
    if images is None:
        return []
    try:
        arr = images
        if isinstance(images, (list, tuple)):
            hashes = []
            for image in images:
                if image is None:
                    continue
                item = image.detach().cpu().numpy() if hasattr(image, "detach") else np.asarray(image)
                if item.ndim == 4:
                    hashes.extend(_image_array_cache_key(frame)[2] for frame in item)
                elif item.ndim == 3:
                    hashes.append(_image_array_cache_key(item)[2])
            return hashes
        if hasattr(arr, "detach"):
            arr = arr.detach().cpu().numpy()
        arr = np.asarray(arr)
        if arr.ndim == 3:
            arr = arr[None, ...]
        if arr.ndim != 4:
            return []
        return [_image_array_cache_key(item)[2] for item in arr]
    except Exception:
        return []


def _is_link_value(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and isinstance(value[1], int)
        and str(value[0]).strip() != ""
    )


def _linked_node_signature(prompt, node_id, output_index=0, seen=None):
    if not isinstance(prompt, dict):
        return None
    seen = seen or set()
    node_key = str(node_id)
    if node_key in seen:
        return {"node": node_key, "output": output_index, "cycle": True}
    seen.add(node_key)
    node = prompt.get(node_key)
    if not isinstance(node, dict):
        return {"node": node_key, "output": output_index, "missing": True}
    inputs = node.get("inputs") or {}
    clean_inputs = {}
    for name, value in sorted(inputs.items(), key=lambda item: item[0]):
        if _is_link_value(value):
            clean_inputs[name] = _linked_node_signature(prompt, value[0], value[1], seen.copy())
        else:
            clean_inputs[name] = value
    return {
        "node": node_key,
        "output": output_index,
        "class_type": node.get("class_type"),
        "inputs": clean_inputs,
    }


def _linked_inputs_signature(prompt, unique_id, input_names):
    if not isinstance(prompt, dict) or unique_id is None:
        return {}
    node = prompt.get(str(unique_id))
    if not isinstance(node, dict):
        return {}
    inputs = node.get("inputs") or {}
    signatures = {}
    for name in input_names:
        value = inputs.get(name)
        if _is_link_value(value):
            signatures[name] = _linked_node_signature(prompt, value[0], value[1])
        else:
            signatures[name] = value
    return signatures


def _clean_palette(value, limit):
    if not isinstance(value, list):
        return []
    colors = []
    for item in value:
        color = str(item or "").strip().upper()
        if re.fullmatch(r"#[0-9A-F]{6}", color):
            colors.append(color)
        if len(colors) >= limit:
            break
    return colors


def _clean_bbox(value):
    if not isinstance(value, list) or len(value) != 4:
        return None
    bbox = []
    for item in value:
        try:
            number = int(round(float(item)))
        except Exception:
            return None
        bbox.append(max(0, min(1000, number)))
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        return None
    return bbox


def _normalize_ideogram_json(obj):
    if not isinstance(obj, dict):
        return obj

    normalized = {}
    high_level = str(obj.get("high_level_description") or "").strip()
    normalized["high_level_description"] = high_level

    style = obj.get("style_description")
    if not isinstance(style, dict):
        style = {}
    style_out = {}
    aesthetics = str(style.get("aesthetics") or "").strip()
    lighting = str(style.get("lighting") or "").strip()
    medium = str(style.get("medium") or "").strip()
    art_style = str(style.get("art_style") or style.get("photo") or "").strip()
    palette = _clean_palette(style.get("color_palette"), 16)
    style_out["aesthetics"] = aesthetics
    style_out["lighting"] = lighting
    style_out["medium"] = medium
    style_out["art_style"] = art_style
    style_out["color_palette"] = palette
    normalized["style_description"] = style_out

    comp = obj.get("compositional_deconstruction")
    if not isinstance(comp, dict):
        comp = {}
    background = str(comp.get("background") or "").strip()
    elements = comp.get("elements")
    clean_elements = []
    if isinstance(elements, list):
        for element in elements:
            if not isinstance(element, dict):
                continue
            element_type = str(element.get("type") or "obj").strip().lower()
            if element_type not in {"obj", "text"}:
                element_type = "obj"
            bbox = _clean_bbox(element.get("bbox"))
            if bbox is None:
                continue
            desc = str(element.get("desc") or "").strip()
            palette = _clean_palette(element.get("color_palette"), 5)
            clean = {"type": element_type, "bbox": bbox}
            if element_type == "text":
                text_value = str(element.get("text") or "").strip()
                clean["text"] = text_value
            clean["desc"] = desc
            clean["color_palette"] = palette
            clean_elements.append(clean)
    comp_out = {}
    comp_out["background"] = background
    comp_out["elements"] = clean_elements
    normalized["compositional_deconstruction"] = comp_out

    return normalized


def _point_xy(value):
    if not isinstance(value, (list, tuple)) or len(value) < 2:
        return None
    try:
        return max(0, min(1000, int(value[0]))), max(0, min(1000, int(value[1])))
    except (TypeError, ValueError):
        return None


def _point_region(point, language):
    if point is None:
        return ""
    x, y = point
    if language == "中文":
        horizontal = "左侧" if x < 300 else "中间偏左" if x < 450 else "中部" if x <= 550 else "中间偏右" if x <= 700 else "右侧"
        vertical = "上部" if y < 333 else "中部" if y < 667 else "下部"
        return f"画面{vertical}{horizontal}"
    horizontal = "left" if x < 300 else "left-of-center" if x < 450 else "center" if x <= 550 else "right-of-center" if x <= 700 else "right"
    vertical = "upper" if y < 333 else "middle" if y < 667 else "lower"
    return f"{vertical} {horizontal}"


def _derived_shot_scale(analysis, language):
    extent = str(analysis.get("primary_subject_visible_extent") or analysis.get("visible_body_extent") or "").lower()
    if any(token in extent for token in ("full", "head to feet", "head-to-feet", "全身", "头到脚")):
        return "全身景别" if language == "中文" else "a full-body view"
    if any(token in extent for token in ("near_full", "near-full", "most of", "大部分身体")):
        return "近全身景别" if language == "中文" else "a near-full-body view"
    if any(token in extent for token in ("waist", "腰")):
        return "中景" if language == "中文" else "a waist-up medium view"
    if any(token in extent for token in ("chest", "胸")):
        return "近景" if language == "中文" else "a chest-up close view"
    return str(analysis.get("shot_scale") or "").strip()


def _derived_axis(analysis, language):
    anchors = analysis.get("primary_subject_key_anchors") or {}
    start = _point_xy(anchors.get("head_or_front_xy"))
    end = _point_xy(anchors.get("legs_rear_or_far_extent_xy"))
    if start is None or end is None:
        return "", start, end
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    start_region = _point_region(start, language)
    end_region = _point_region(end, language)
    if abs(dx) >= 120 and abs(dy) >= 120:
        if language == "中文":
            return f"主体从{start_region}斜向延伸至{end_region}", start, end
        return f"subject axis: {start_region} to {end_region} diagonal", start, end
    if abs(dx) >= 160:
        if language == "中文":
            return f"主体横向延伸于{start_region}与{end_region}之间", start, end
        return f"subject axis: {start_region} to {end_region} horizontal", start, end
    if abs(dy) >= 160:
        if language == "中文":
            return f"主体纵向延伸于{start_region}与{end_region}之间", start, end
        return f"subject axis: {start_region} to {end_region} vertical", start, end
    return "", start, end


def _lens_phrase(analysis, language):
    lens = str(analysis.get("lens_class") or "").strip()
    lens = re.sub(r"\s+lens$", "", lens, flags=re.IGNORECASE).strip()
    lens = re.sub(r"镜头$", "", lens).strip()
    lens_lower = lens.lower()
    if not lens:
        return ""
    if any(token in lens_lower for token in ("ultra", "wide", "广角")):
        effect = "强化近大远小、边缘拉伸和前后景纵深" if language == "中文" else "with foreground exaggeration, edge stretch, and deep perspective"
    elif any(token in lens_lower for token in ("tele", "long lens", "长焦")):
        effect = "压缩前后景距离" if language == "中文" else "compresses front-to-back distance"
    else:
        effect = "保持较自然的空间比例" if language == "中文" else "keeps relatively natural spatial proportions"
    if language == "中文":
        return f"{lens}镜头{effect}"
    article = "an" if lens[:1].lower() in "aeiou" else "a"
    return f"{article} {lens} lens {effect}"


def _secondary_layout(analysis, language):
    parts = []
    for subject in analysis.get("secondary_subjects") or []:
        if not isinstance(subject, dict):
            continue
        descriptor = str(subject.get("visible_descriptor") or subject.get("descriptor") or "secondary subject").strip()
        region = _point_region(_point_xy(subject.get("anchor_xy") or subject.get("xy")), language)
        depth = str(subject.get("depth_layer") or subject.get("depth") or "").strip()
        if language == "中文":
            parts.append("位于".join(part for part in (descriptor, f"{region}{depth}" if region or depth else "") if part))
        else:
            detail = " ".join(part for part in (region, depth) if part)
            parts.append(f"{descriptor} at {detail}" if detail else descriptor)
    if not parts:
        return ""
    joiner = "，" if language == "中文" else ", "
    prefix = "次要主体分别为" if language == "中文" else "secondary subjects are "
    return prefix + joiner.join(parts)


def _expression_phrase(analysis, language):
    expression = str(
        analysis.get("primary_subject_expression")
        or analysis.get("facial_expression_and_gaze")
        or ""
    ).strip()
    if not expression:
        return ""
    return f"主体表情与视线为{expression}" if language == "中文" else f"facial expression and gaze: {expression}"


def _expression_priority(analysis):
    shot = str(analysis.get("shot_scale") or "").lower()
    extent = str(analysis.get("primary_subject_visible_extent") or "").lower()
    scale = f"{shot} {extent}"
    if any(token in scale for token in ("extreme wide", "very wide", "extreme long", "tiny face", "face not visible", "no visible face")):
        return "omit"
    if any(token in shot for token in ("full-body", "full body", "near-full", "near full", "wide shot", "long shot")):
        return "low"
    if any(token in shot for token in ("medium", "three-quarter", "three quarter", "cowboy", "knee", "thigh", "waist")):
        return "normal"
    if any(token in shot for token in ("extreme close", "close-up", "close up", "headshot", "head shot", "bust", "chest-up", "chest up")):
        return "high"
    if any(token in extent for token in ("head-to-toe", "head to toe", "full body", "near-full", "near full", "feet visible")):
        return "low"
    if any(token in extent for token in ("knee", "thigh", "waist", "three-quarter", "three quarter")):
        return "normal"
    if any(token in extent for token in ("head-and-shoulders", "head and shoulders", "face only", "chest-up", "chest up", "bust")):
        return "high"
    return "normal"


def _description_detail_band(analysis):
    priority = _expression_priority(analysis)
    if priority == "omit":
        return "extreme_far"
    if priority == "low":
        return "far"
    if priority == "high":
        return "near"
    return "medium"


def _descriptive_fields(analysis):
    return {
        "appearance": str(analysis.get("primary_subject_appearance_and_clothing") or "").strip(),
        "pose": str(analysis.get("primary_subject_pose_and_action") or "").strip(),
        "environment": str(analysis.get("environment_and_spatial_context") or "").strip(),
        "atmosphere": str(analysis.get("lighting_color_and_atmosphere") or "").strip(),
    }


def _weighted_descriptive_fields(descriptive, detail_band):
    budgets = {
        "near": {"appearance": 48, "pose": 28, "environment": 24, "atmosphere": 28},
        "medium": {"appearance": 48, "pose": 40, "environment": 36, "atmosphere": 32},
        "far": {"appearance": 44, "pose": 40, "environment": 40, "atmosphere": 28},
        "extreme_far": {"appearance": 28, "pose": 40, "environment": 56, "atmosphere": 36},
    }.get(detail_band, {})
    compacted = {}
    for key, value in descriptive.items():
        budget = budgets.get(key, 40)
        compact = _limit_prompt_to_approx_tokens(value, budget) if value else ""
        compacted[key] = compact.rstrip(" .;；,，:：")
    return compacted


def _validated_vertical_relation(analysis, conservative_image_geometry=False):
    elevation = str(analysis.get("camera_elevation") or "").strip().lower()
    direction = str(analysis.get("view_direction") or "").strip().lower()
    if (elevation == "above" and direction == "upward") or (elevation == "below" and direction == "downward"):
        return "level", "level"
    if not conservative_image_geometry or (elevation == "level" and direction == "level"):
        return elevation, direction

    extent = " ".join(
        str(analysis.get(key) or "").lower()
        for key in ("primary_subject_visible_extent", "shot_scale")
    )
    tight_portrait = any(token in extent for token in ("close", "head", "face", "shoulder", "chest", "bust", "portrait"))
    tight_portrait = tight_portrait and not any(token in extent for token in ("full", "near-full", "near_full", "waist"))
    if not tight_portrait or (elevation, direction) not in {("above", "downward"), ("below", "upward")}:
        return elevation, direction

    evidence_value = analysis.get("geometry_evidence_or_design_basis") or []
    if not isinstance(evidence_value, (list, tuple)):
        evidence_value = [evidence_value]
    evidence = " ".join(str(item or "").lower() for item in evidence_value)
    if elevation == "above":
        plane_cue = any(token in evidence for token in ("top plane", "top surface", "top of head", "floor plane", "bird's-eye", "top-down"))
    else:
        plane_cue = any(token in evidence for token in ("underside", "bottom plane", "worm's-eye"))
    perspective_cue = any(token in evidence for token in ("foreshorten", "converg", "steep", "pronounced", "clearly above", "clearly below"))
    if not (plane_cue and perspective_cue):
        return "level", "level"
    return elevation, direction


def _render_natural_prompt(envelope, output_language, conservative_image_geometry=False):
    analysis = envelope.get("visual_analysis") if isinstance(envelope, dict) else None
    scene = str(
        (envelope or {}).get("scene_description")
        or ((analysis or {}).get("scene_description") if isinstance(analysis, dict) else "")
        or ""
    ).strip()
    descriptive = _descriptive_fields(analysis) if isinstance(analysis, dict) else {}
    if not isinstance(analysis, dict) or not (scene or any(descriptive.values())):
        return ""
    language = _normalize_output_language(output_language)
    style = str(analysis.get("style_subtype") or analysis.get("style_category") or "").strip()
    primary = str(
        analysis.get("explicit_subject_requirement")
        or analysis.get("primary_subject")
        or ("主体" if language == "中文" else "the primary subject")
    ).strip()
    elevation, direction = _validated_vertical_relation(analysis, conservative_image_geometry)
    azimuth = str(analysis.get("camera_azimuth_or_visible_side") or "").strip()
    shot_scale = _derived_shot_scale(analysis, language)
    axis, _, _ = _derived_axis(analysis, language)
    occupancy = analysis.get("primary_subject_frame_occupancy_percent")
    occupancy_text = ""
    try:
        occupancy_value = max(0, min(100, round(float(occupancy))))
        if occupancy_value:
            occupancy_text = f"约占画面{occupancy_value}%" if language == "中文" else f"occupying about {occupancy_value}% of the frame"
    except (TypeError, ValueError):
        pass
    lens = _lens_phrase(analysis, language)
    secondary = _secondary_layout(analysis, language)
    expression = _expression_phrase(analysis, language)
    expression_priority = _expression_priority(analysis)
    detail_band = _description_detail_band(analysis)
    descriptive = _weighted_descriptive_fields(descriptive, detail_band)
    if expression_priority == "omit":
        expression = ""
    elif expression_priority == "low":
        expression = _limit_prompt_to_approx_tokens(expression, 12).rstrip(" .;；,，:：")
    elif expression_priority == "normal":
        expression = _limit_prompt_to_approx_tokens(expression, 24).rstrip(" .;；,，:：")
    if language == "中文":
        if elevation == "level" and direction == "level":
            elevation, direction = "平视", ""
        camera = "、".join(dict.fromkeys(part for part in (elevation, direction, azimuth) if part))
        geometry = "，".join(part for part in (shot_scale, f"镜头相对{primary}呈{camera}" if camera else "", axis, occupancy_text) if part)
        if detail_band == "near":
            content = (expression, lens, descriptive["appearance"], descriptive["pose"], descriptive["atmosphere"], descriptive["environment"], secondary, scene)
        elif detail_band == "medium":
            content = (lens, descriptive["pose"], descriptive["appearance"], descriptive["environment"], descriptive["atmosphere"], expression, secondary, scene)
        else:
            content = (lens, descriptive["pose"], descriptive["appearance"], descriptive["environment"], descriptive["atmosphere"], secondary, scene, expression)
        return "。".join(part.strip("。") for part in (style, geometry, *content) if part).strip("。") + "。"
    if elevation == "level" and direction == "level":
        elevation, direction = "at subject eye level", ""
    camera = ", ".join(dict.fromkeys(part for part in (elevation, direction, azimuth) if part))
    geometry = "; ".join(part for part in (shot_scale, f"the camera is {camera} relative to {primary}" if camera else "", axis, occupancy_text) if part)
    if detail_band == "near":
        content = (expression, lens, descriptive["appearance"], descriptive["pose"], descriptive["atmosphere"], descriptive["environment"], secondary, scene)
    elif detail_band == "medium":
        content = (lens, descriptive["pose"], descriptive["appearance"], descriptive["environment"], descriptive["atmosphere"], expression, secondary, scene)
    else:
        content = (lens, descriptive["pose"], descriptive["appearance"], descriptive["environment"], descriptive["atmosphere"], secondary, scene, expression)
    return ". ".join(part.strip(". ") for part in (style, geometry, *content) if part).strip() + "."


def _parse_analysis_envelope(text):
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("response has no complete JSON object boundary")
    candidate = text[start:end + 1]
    try:
        envelope = json.loads(candidate)
    except json.JSONDecodeError as original_error:
        if _repair_json is None:
            raise ValueError(f"invalid JSON: {original_error}") from original_error
        try:
            envelope = _repair_json(candidate, return_objects=True)
        except Exception as repair_error:
            raise ValueError(f"invalid JSON: {original_error}; repair failed: {repair_error}") from repair_error
    if not isinstance(envelope, dict):
        raise ValueError("visual-analysis envelope is not a JSON object")
    return envelope


def _partial_analysis_envelope(text):
    """Return usable worksheet parts without treating them as a final result."""
    cleaned = _strip_code_fence(_strip_thinking(str(text or ""))).strip()
    try:
        envelope = _parse_analysis_envelope(cleaned)
    except ValueError:
        return None, ""
    analysis = envelope.get("visual_analysis")
    if not isinstance(analysis, dict):
        analysis = None
    scene = str(
        envelope.get("scene_description")
        or ((analysis or {}).get("scene_description") if analysis else "")
        or ""
    ).strip()
    return analysis, scene


def _clean_prompt_output(text, rule, output_language="英文", strict_natural=False):
    text = _strip_code_fence(_strip_thinking(text)).strip()
    text = re.sub(r"^\s*(expanded prompt|positive prompt|prompt|result|output)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = text.strip().strip('"').strip()
    rule_mode = prompt_config_manager.prompt_rule_mode(rule)
    if rule_mode == "natural":
        parse_error = None
        try:
            envelope = _parse_analysis_envelope(text)
            rendered = _render_natural_prompt(envelope, output_language, strict_natural)
            if rendered:
                return rendered
            if not strict_natural:
                prompt = envelope.get("prompt")
                if isinstance(prompt, str) and prompt.strip():
                    return prompt.strip().strip('"').strip()
            parse_error = "JSON object is missing visual_analysis or grounded descriptive fields"
        except ValueError as exc:
            parse_error = str(exc)
        if strict_natural:
            raise ValueError(
                f"natural prompt response did not contain a complete visual-analysis envelope: {parse_error}"
            )
    if rule_mode == "json":
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            text = text[start:end + 1]
        try:
            obj = json.loads(text)
            obj = _normalize_ideogram_json(obj)
            text = json.dumps(obj, ensure_ascii=False, indent=2)
        except Exception:
            pass
    return text


def _has_terminal_punctuation(text):
    return bool(re.search(r"[。！？；：、，,.!?:;…][\"'”’）\])}】》]*$", str(text or "").strip()))


def _finish_fixed_prompt(text):
    text = str(text or "").strip()
    if text and not _has_terminal_punctuation(text):
        text += "."
    return text


def _approx_prompt_tokens(text):
    """Provider-neutral estimate used only to keep the public prompt near its preset."""
    text = str(text or "")
    cjk = len(re.findall(r"[\u3400-\u9fff\uf900-\ufaff]", text))
    non_cjk = re.sub(r"[\u3400-\u9fff\uf900-\ufaff]", "", text)
    return cjk + max(0, (len(non_cjk) + 3) // 4)


def _limit_prompt_to_approx_tokens(text, target_tokens):
    text = str(text or "").strip()
    target_tokens = max(1, _safe_int(target_tokens, 256))
    if _approx_prompt_tokens(text) <= target_tokens:
        return text
    low, high = 0, len(text)
    while low < high:
        mid = (low + high + 1) // 2
        if _approx_prompt_tokens(text[:mid]) <= target_tokens:
            low = mid
        else:
            high = mid - 1
    fragment = text[:low].rstrip()
    minimum = int(len(fragment) * 0.7)
    sentence_end = max(fragment.rfind(mark, minimum) for mark in ("。", "！", "？", ".", "!", "?", ";"))
    if sentence_end >= minimum:
        return fragment[:sentence_end + 1].strip()
    word_end = max(fragment.rfind(" "), fragment.rfind("，"), fragment.rfind(","))
    if word_end > 0:
        fragment = fragment[:word_end].rstrip()
    return fragment.rstrip("，,;；:：") + ("。" if re.search(r"[\u3400-\u9fff]", fragment) else ".")


def _join_prompt_parts(fixed_text="", prompt_text=""):
    fixed = _finish_fixed_prompt(fixed_text)
    prompt = str(prompt_text or "").strip()
    return "\n".join(part for part in (fixed, prompt) if part)


def _natural_system_prompt(rule_name):
    rule_text = prompt_config_manager.prompt_rule_text(rule_name)
    return f"""
You are a visual concept organizer and prompt engineer for text-to-image models.

Your job is not merely to make the input longer. Transform the available intent and/or visual reference into one clear, useful, image-generation prompt.

First infer the input situation internally:
- Text only: treat the user's text as a creative seed. If it is short or vague, develop a coherent visual direction with subject, setting, mood, style, composition, lighting, and grounded details. If it is already detailed, lightly polish and structure it without changing the core idea.
- Image only: reverse-engineer the image into a prompt that can reproduce its visible subject, setting, composition, camera distance, lighting, color, medium, and style. Stay faithful to visible evidence and avoid inventing unsupported story details.
- Text plus image: treat the user's text as the generation target and the image as visual reference. Extract all explicit requirements from the text first, including subject identity, name, gender, ethnicity/nationality, hair, clothing, accessories, colors, action, medium, and style. Use the image only for compatible visual evidence such as composition, pose, setting, lighting, palette, and atmosphere. When text and image conflict, the text must override the image.

Core behavior:
1. Faithfulness first: preserve explicit subjects, actions, colors, medium, style, and spatial relationships from the user's text. In text-plus-image mode, never replace explicit text details with conflicting image details.
2. Creative completion is allowed for short text prompts, but keep additions plausible and aligned with the user's seed idea.
3. Do not add new main subjects, animals, props, text, logos, or specific identities unless implied or requested.
4. If a medium is explicit, such as photo, illustration, sketch, painting, 3D render, or cinematic still, preserve that medium.
5. If visible or requested text should appear in the image, quote the exact text.
6. Organize the final prompt so a T2I model can parse it cleanly: main subject first, then action/pose, setting, composition, lighting, style, atmosphere, and key details.
7. Use internal reasoning to choose the best visual direction, but do not output reasoning, alternatives, bullets, JSON, markdown, labels, or commentary.

Prompt writing rules:
{rule_text}

Output only one final positive prompt paragraph.
""".strip()


def _json_system_prompt(rule_name):
    rule_text = prompt_config_manager.prompt_rule_text(rule_name)
    return f"""
You are a visual concept organizer and prompt engineer for text-to-image models.

Your job is to transform the available text and/or image reference into structured image-generation prompt data, not merely to make the input longer.

Infer the input situation internally:
- Text only: expand short user ideas into a coherent visual concept; lightly polish detailed prompts.
- Image only: reverse-engineer visible subject, setting, composition, lighting, color, medium, and style without inventing unsupported story details.
- Text plus image: use the user's text as the generation target and the image as compatible visual reference. Extract explicit requirements from the text first. If text and image conflict, follow the text and use the image only for non-conflicting composition, setting, lighting, palette, and atmosphere.

Keep the output faithful, useful for T2I generation, and constrained to the requested JSON structure.

Prompt writing rules:
{rule_text}

Write all descriptive JSON string values in the requested output language.
""".strip()


def _style_preset_rule(style_preset):
    preset = _normalize_style_preset(style_preset)
    if preset == "自行判断":
        return (
            "Perform a mandatory two-level style classification. First choose exactly one supported upper-level category "
            "from realistic photography, anime illustration, hand-drawn art, or digital art. Then choose exactly one "
            "concrete subtype inside it from the user's text and/or image evidence. Photography subtypes include casual "
            "smartphone snapshot, documentary/street photography, editorial/fashion photography, commercial studio or "
            "product photography, architecture/interior photography, analog film photography, and cinematic film still. "
            "Anime-illustration subtypes include anime key art, manga, cel animation, webtoon, western comic/animation, "
            "children's cartoon art, and stylized animation rendering. Hand-drawn subtypes identify a physical medium such "
            "as oil, watercolor, gouache, acrylic, ink, pencil, charcoal, pastel, printmaking, or mixed media. Digital-art "
            "subtypes include digital painting, concept art, matte painting, editorial illustration, game key art, pixel "
            "art, photobashing, and CGI hybrid art. State the selected concrete subtype and its supported visual vocabulary "
            "in the final prompt without exposing the classification process or listing alternatives."
        )
    category_rule = _STYLE_PRESET_RULES.get(preset, "")
    if not category_rule:
        return ""
    return (
        f"Treat {preset} as an upper-level style category, not as a single fixed look. {category_rule} "
        "Choose one best-fitting subtype, or one concise hybrid only when the evidence genuinely supports it. Explicitly "
        "name or unambiguously describe that subtype in the final prompt. Do not list alternatives, default to the most "
        "polished/common subtype, or add unsupported style traits. With an image, visual evidence determines the subtype; "
        "with text only, infer it from the subject, context, and stated intent."
    )


def _style_task_instruction(style_preset):
    preset = _normalize_style_preset(style_preset)
    if preset == "自行判断":
        return (
            "Mandatory style task: classify the reference into exactly one of these four categories—realistic photography, "
            "anime illustration, hand-drawn art, or digital art—then select one evidence-based concrete subtype inside it. "
            "The opening sentence of the final prompt must explicitly contain that subtype, not merely a vague adjective."
        )
    return (
        f"Mandatory style task: the upper-level category is locked to {preset}. Select one concrete subtype inside this "
        "category from the image and/or text evidence, and explicitly describe that subtype in the opening sentence of "
        "the final prompt. An "
        "explicit text subtype is valid only when it belongs to the selected category."
    )


def _camera_task_instruction(input_mode):
    has_image = input_mode in {"image", "image_text"}
    source_rule = (
        "Derive and reproduce these facts from the image"
        if has_image
        else "Design these facts explicitly from the user's intent"
    )
    return (
        "Mandatory camera/subject relationship task: the opening sentence of the final prompt must combine the primary "
        "subject with a coherent spatial description that "
        "states (1) whether the camera is above, roughly level with, or below the primary subject and whether it looks "
        "downward, level, or upward; (2) the supported frontal, side, rear, or three-quarter relationship between camera "
        "and subject, or the visible face/side for a subject without a natural front; (3) the primary subject's viewer-"
        "relative left/center/right and upper/middle/lower frame placement, scale, and foreground/midground/background "
        "position, including the subject's head/front, center mass, lower/rear extent, and dominant diagonal or horizontal/"
        "vertical axis when applicable; and (4) the lens class and its visible perspective effect. For multiple important subjects, state their "
        "left/right and front/back relationship. Do not replace these facts with generic phrases such as dynamic angle, "
        f"immersive composition, or cinematic framing. {source_rule}. This task is mandatory for photographic and non-"
        "photographic styles alike; use a virtual viewpoint for illustration or artwork. Do not omit it when the user "
        "supplies no camera wording. Repeating a user-provided lens phrase alone does not satisfy this task."
    )


def _final_output_audit(style_preset, input_mode):
    preset = _normalize_style_preset(style_preset)
    category_check = (
        "one of the four allowed upper-level categories and one concrete subtype"
        if preset == "自行判断"
        else f"the selected {preset} category and one concrete subtype within it"
    )
    checks = [
        f"Style: the final prompt must clearly communicate {category_check}.",
        "Specificity: generic phrases by themselves—such as atmospheric photography, cinematic style, realistic look, "
        "anime style, hand-drawn look, or digital art—do not count as a subtype; replace them with a supported concrete "
        "form such as editorial photography, casual smartphone snapshot, cinematic film still, anime key art, watercolor, "
        "or concept art.",
    ]
    geometry_source = (
        "reproduce these relationships from image evidence"
        if input_mode in {"image", "image_text"}
        else "design these relationships coherently from the user's intent"
    )
    checks.append(
        "Opening sentence: the answer is invalid unless its first sentence combines the concrete style subtype with "
        "the camera's vertical relationship to the primary subject, the camera/subject front-side-rear relationship, the "
        "subject's viewer-relative spatial extent, dominant axis and depth layer, and the lens class/perspective effect. "
        "For a person, the visible head-to-feet/body extent must determine shot scale; a visible full or nearly full body "
        "must not be called a medium shot. A diagonal subject must be described through its endpoints rather than reduced "
        "to centered framing. For multiple "
        "important subjects, it must also state their left/right and front/back arrangement. It must "
        f"{geometry_source}. Generic composition adjectives do not satisfy this requirement, and merely repeating camera "
        "wording supplied by the user does not replace the required analysis or design."
    )
    checks.append(
        "Expression scales with shot distance: for extreme close-up, close-up, head-and-shoulders, or chest-up views, "
        "give the visible expression and gaze high priority and describe eye openness/direction, brows, nose tension when "
        "relevant, mouth/lips/teeth, jaw, and facial muscle tension. For medium shots, keep only the clearest expression "
        "and gaze cues. For full-body or wide shots, use only broad expression cues that are genuinely readable. For an "
        "extreme-wide subject or a face that is not visible, omit expression. Never invent an unsupported inner state."
    )
    return "\n".join(f"- {check}" for check in checks)


def _composition_preset_rule(composition_preset):
    preset = _normalize_composition_preset(composition_preset)
    if preset == "自行判断":
        return (
            "Infer the subject shot scale from the available evidence. When an image is provided, reproduce its observed "
            "shot scale instead of replacing it with a more conventional or aesthetically preferred framing. When no image "
            "is provided, choose how close or far the main subject should appear from the user's intent."
        )
    return _COMPOSITION_PRESET_RULES.get(preset, "")


def _camera_geometry_rule(input_mode):
    if input_mode == "text":
        return """
Designed camera geometry and subject relationship (mandatory for every text expansion):
- Identify the primary visual subject or, for an environment-led scene, its dominant visual anchor.
- Deliberately choose and state a coherent shot scale, camera elevation and viewing direction, camera azimuth or visible subject side, subject orientation, viewer-relative frame placement, depth layer, and lens/perspective character.
- The choices must serve the user's subject, action, mood, and selected style rather than defaulting to eye-level centered framing, a low angle, or an ultra-wide lens.
- Keep camera position, subject orientation, and frame placement as separate facts. For multiple important subjects, define their left/right and front/back arrangement.
- For anime, hand-drawn art, digital art, and other non-photographic media, treat camera as the virtual viewpoint used to construct the image; camera-to-subject geometry remains mandatory even when physical camera terminology would be inappropriate.
- Do not omit this relationship because the user supplied only a brief concept. Do not replace it with vague phrases such as dynamic composition or cinematic angle.
""".strip()
    if input_mode not in {"image", "image_text"}:
        return ""
    conflict_rule = (
        "Explicit text requirements override conflicting image evidence."
        if input_mode == "image_text"
        else "Treat the image as the source of truth."
    )
    return f"""
Camera geometry and subject relationship evidence (mandatory and direction-neutral for every image input):
- Inspect visual evidence before choosing terminology. Determine these properties independently: (1) shot scale, (2) vertical viewing direction, (3) horizontal camera position and optical-axis direction, (4) subject orientation, (5) subject placement in the image frame, (6) lens perspective / field of view, (7) camera roll, and (8) depth arrangement.
- Keep three coordinate systems separate. The camera's position relative to the subject, the subject's own facing/orientation, and the subject's placement inside the image frame are different facts and must never be substituted for one another. `frame-left` and `frame-right` always mean the viewer's image coordinates, not the subject's anatomical left/right.
- Classify vertical viewing direction with exactly one internal result: downward-looking, level, upward-looking, or indeterminate. Do not blend opposite directions in the final prompt.
- Evidence must determine the sign of the angle. Visible top surfaces, a camera position above the subject, and a receding ground plane support downward-looking; visible undersides, a camera position below the subject, and a subject silhouetted against the upper background support upward-looking. A centered horizon with neither set of cues supports level. Perspective convergence or a subject's gaze alone does not determine the sign.
- Treat angle direction and angle strength separately. Only use strong labels such as top-down, bird's-eye, worm's-eye, steep high angle, or steep low angle when the corresponding evidence is unmistakable. Never use "slight upward", "slight downward", or a similar angle label as an uncertainty hedge; choose level or omit the angle when evidence is insufficient.
- Determine horizontal camera-to-subject position independently from vertical angle. When the primary subject has an identifiable front and back, choose one supported azimuth: frontal, front-left three-quarter, left-side/profile, rear-left three-quarter, rear, rear-right three-quarter, right-side/profile, front-right three-quarter, or indeterminate. This applies to people, animals, buildings, vehicles, products, plants, furniture, and other objects. For a subject without a meaningful front, do not invent one; describe the visible side, leading face, facade, long axis, or scene direction instead.
- Determine the camera's optical-axis direction separately from its position. Use vanishing points, visible side planes, overlap, foreshortening, and scene depth to describe whether the camera looks straight toward the subject or diagonally across it, and whether the view travels through the scene from frame-left to frame-right or frame-right to frame-left. Do not infer left/right direction from subject gaze alone.
- Determine subject orientation separately: facing the camera, facing away, oriented toward frame-left, oriented toward frame-right, or diagonal when supported. For non-human subjects, use the identifiable front, facade, nose, entrance, display face, or direction of travel; otherwise mark orientation indeterminate rather than anthropomorphizing the object.
- Determine frame placement using viewer coordinates: left / center / right and upper / middle / lower regions, with left-third, right-third, edge placement, foreground overlap, or negative-space direction when clearly visible. State the primary subject's relative size and frame occupancy when useful. For multiple important subjects, describe each one's placement and their left-right/front-back relationship without forcing every element into the center.
- Do not reduce an extended or diagonal subject to a single center label. Track its meaningful endpoints or parts independently—for a person, at least head, torso/center mass, and legs/feet; for a vehicle, building, animal, product, or other subject, use its front/leading end, center mass, and rear/far extent. State the dominant frame axis such as lower-left to upper-right when visible.
- Determine human shot scale from visible body extent, not face prominence. If the head and most or all legs/feet are visible, describe a full or near-full-body view even when the face is large; reserve medium shot for roughly waist-up framing and medium close-up for chest-up framing.
- Use explicit intermediate scales instead of collapsing them into medium shot: head-to-chest is medium close-up, head-to-waist is medium shot, head-to-upper-thigh is medium-long/cowboy shot, head-to-knee or lower is three-quarter shot, and visible feet is full/near-full-body. Apply the same visible-extent logic to non-human subjects.
- Identify secondary subjects by visible appearance and placement unless text or unmistakable markings establish an exact identity. Do not guess a character name from costume color alone.
- In the final prompt, express supported relationships concretely: camera elevation plus camera azimuth/side, optical-axis direction, subject orientation, and subject frame placement. Do not collapse these into vague words such as dynamic angle or cinematic composition, and do not add a left/right label merely to fill every category.
- Lens width and camera elevation are independent. Wide or ultra-wide perspective is not evidence of looking upward, and telephoto compression is not evidence of looking downward. Classify lens character only from field of view, edge stretching, barrel distortion, foreground exaggeration, convergence, or background compression. Do not invent an exact focal length when only a qualitative lens class is supported.
- Preserve the observed direction without normalizing it: downward remains downward, upward remains upward, and level remains level. In the final prompt, state a supported camera angle and lens/perspective explicitly; omit an indeterminate property rather than guessing.
- Before finalizing, perform a contradiction check: reject any upward-looking wording when downward evidence was selected, reject any downward-looking wording when upward evidence was selected, and remove all angle wording when the result was indeterminate. Also reject left/right statements that confuse camera position, subject orientation, or frame placement, and reject mirrored placement relative to the visible image.
- A selected subject shot-scale preset may change only camera distance / the visible amount of the main subject. Preserve viewing direction, lens character, camera roll, and perspective strength unless the user's text explicitly changes them or they are physically incompatible with the selected shot scale.
- For JSON output, express camera geometry inside the allowed descriptive fields; do not add forbidden keys such as camera, lens, or metadata.
{conflict_rule}
""".strip()


def _natural_analysis_contract(input_mode):
    basis = (
        "observed image evidence"
        if input_mode in {"image", "image_text"}
        else "an intentional design derived from the user's text"
    )
    return f"""
Natural-prompt analysis envelope (mandatory response transport format):
- Before writing the prompt, fill every visual_analysis field below using {basis}. This is a compact composition worksheet, not a place for narrative prose.
- Estimate the primary subject's occupied bounding box and three meaningful anchors in viewer-relative normalized coordinates from 0 to 1000, with origin at image top-left and bbox order [x_min, y_min, x_max, y_max]. Use head/front, center mass, and legs/rear/far extent so an extended or diagonal subject cannot collapse into an assumed centered position.
- State the primary subject's dominant spatial axis, visible body/object extent, and approximate percentage of frame occupancy. For a person, visible legs or feet prevent a false medium-shot label even when the face is prominent.
- In image-plus-text mode, copy the user's explicit subject identity constraints into explicit_subject_requirement as one concise noun phrase, preserving stated name, nationality or ethnicity, gender, and age wording without substitution; for example, "an American woman" must not become "a young woman". Leave this field empty when the user did not explicitly specify a subject. Never infer these attributes from the image for this field.
- Describe every important secondary subject with a visible descriptor, anchor coordinate, and foreground/midground/background layer. Do not infer a named identity from color or costume alone.
- Scale primary_subject_expression with shot distance. In extreme close-up, close-up, head-and-shoulders, or chest-up views, record detailed eye/gaze, brow, nose, mouth/lips/teeth, jaw, and facial-muscle evidence. In medium shots, keep only the clearest readable cues. In full-body or wide shots, use only broad expression cues that remain visibly legible. In extreme-wide views or when the face is not visible, leave it empty. Add an emotion word only when observable cues clearly support it.
- Fill primary_subject_appearance_and_clothing from visible evidence only. List garments first in head-to-toe order—type, cut, layers, exact visible colors, materials, openings, straps, and footwear—then eyewear, jewelry, hair, and other accessories. Do not replace unusual clothing with a conventional outfit or infer hidden garments.
- Fill primary_subject_pose_and_action as an articulated body/object description. For people, state head tilt, torso lean/twist, both arms and hands, both legs and feet, support points, grasped objects, and weight distribution when visible. Full-body and wide views require more pose detail than facial detail.
- In pose/action, do not guess anatomical left/right from image position. Use hand/arm at frame-left or frame-right when anatomy is uncertain; reserve anatomical left/right for unambiguous evidence. Keep the contacted prop in the same viewer-relative coordinate system.
- Fill environment_and_spatial_context with the actual floor/ground, background surfaces, equipment, furniture, props, negative space, and foreground/midground/background relationships. Full-body, wide, and extreme-wide views require progressively more environmental detail.
- Fill lighting_color_and_atmosphere with visible light sources and direction, dominant colors, color temperature, contrast, shadow quality, saturation, and the resulting visual atmosphere. Do not use unsupported generic words such as cinematic, moody, or atmospheric without visible color/light evidence.
- Allocate detail by shot distance before writing any descriptive field: close views prioritize expression and local appearance; medium views balance expression, pose, clothing, and setting; full-body/wide views prioritize articulated pose, clothing silhouette, environment, spatial relationships, light, and palette; extreme-wide views omit facial detail.
- Keep each dedicated descriptive field concise and information-dense. List distinctive evidence before generic context, preserve every clearly visible garment/limb/prop/color cue, and remove filler adjectives or repeated facts so all four fields can survive the final token budget.
- Determine vertical camera direction from visible planes and perspective: top surfaces support a camera above/looking downward; undersides support below/looking upward. Do not call a view eye-level merely because the subject looks toward the camera.
- Determine lens class from field of view, foreground/background scale difference, edge stretching, convergence, or compression. A user-provided lens phrase is a requirement but is not visual evidence.
- Fill visual_analysis from observable evidence or intentional text-mode design. The node, not the model, will convert these fields into the final style-and-geometry sentence.
- Keep categorical analysis values in the English canonical forms shown by the schema even when the requested final output language is Chinese. Write all visible descriptive fields in the requested output language.
- Return exactly one valid JSON object with these keys and no markdown:
{{
  "visual_analysis": {{
    "style_category": "",
    "style_subtype": "",
    "explicit_subject_requirement": "",
    "primary_subject": "",
    "primary_subject_bbox_xyxy": [0, 0, 0, 0],
    "primary_subject_key_anchors": {{
      "head_or_front_xy": [0, 0],
      "center_mass_xy": [0, 0],
      "legs_rear_or_far_extent_xy": [0, 0]
    }},
    "primary_subject_dominant_axis": "",
    "primary_subject_visible_extent": "",
    "primary_subject_frame_occupancy_percent": 0,
    "primary_subject_appearance_and_clothing": "",
    "primary_subject_pose_and_action": "",
    "primary_subject_expression": "",
    "shot_scale": "",
    "camera_elevation": "above | level | below",
    "view_direction": "downward | level | upward",
    "camera_azimuth_or_visible_side": "",
    "subject_orientation": "",
    "frame_placement_and_depth": "",
    "lens_class": "",
    "perspective_effect": "",
    "secondary_subjects": [
      {{"visible_descriptor": "", "anchor_xy": [0, 0], "depth_layer": ""}}
    ],
    "multiple_subject_layout": "",
    "environment_and_spatial_context": "",
    "lighting_color_and_atmosphere": "",
    "geometry_evidence_or_design_basis": ["", ""]
  }}
}}
- Keep the four descriptive fields mutually non-duplicative and faithful. The node orders them by shot distance and renders the final prompt; the worksheet itself does not count toward the selected final prompt length.
""".strip()


def _build_messages(prompt_input, rule, extra_rules, seed, image_data_url="", style_preset="自行判断", composition_preset="自行判断", length_preset="标准", output_language="英文", input_mode="text"):
    rule_mode = prompt_config_manager.prompt_rule_mode(rule)
    system = (
        _json_system_prompt(rule)
        if rule_mode == "json"
        else _natural_system_prompt(rule)
    )
    normalized_style = _normalize_style_preset(style_preset)
    style_rule = _style_preset_rule(style_preset)
    if style_rule:
        if normalized_style == "自行判断":
            system += (
                "\n\nStyle preset:\n"
                f"{style_rule}\n"
                "This only controls visual style inference. It must not override an explicit subject shot-scale selection."
            )
        else:
            system += (
                "\n\nStyle preset:\n"
                f"{style_rule}\n"
                "Apply the selected upper-level category and the inferred subtype clearly in the final output. If both text and image are provided, preserve the user's text requirements first and use the image only for compatible visual reference. If only an image is provided, reverse-engineer both its content and the best-supported subtype within the selected category. This style category must not override an explicit subject shot-scale selection."
            )
    composition_rule = _composition_preset_rule(composition_preset)
    if composition_rule:
        system += (
            "\n\nSubject shot scale:\n"
            f"{composition_rule}\n"
            "Apply this shot-scale requirement to the main subject as a hard visual constraint. Expand or reverse-engineer the prompt so the described subject distance, visible body area, and amount of environment match this shot scale. Treat the subject/environment/lighting balance as a soft proportional guide, not a rigid formula. The closer the shot scale is, such as extreme close-up or close-up, the more the caption should focus on the subject's visible details and the less it should describe environment or broad atmosphere. The farther the shot scale is, such as wide shot or extreme wide shot, the more concise the subject description should be and the more the caption should describe environment, atmosphere, spatial relationships, and overall scene scale. Subject description may include angle, makeup or grooming, expression, clothing or surface appearance, and action when visible, but it must not contradict the selected shot scale. Do not add details that contradict the selected shot scale. If an input image is provided, preserve visible subject facts, identity, action, clothing, props, and setting evidence, but do not preserve the original image's camera distance when a different shot scale is selected."
        )
    camera_geometry_rule = _camera_geometry_rule(input_mode)
    if camera_geometry_rule:
        system += f"\n\n{camera_geometry_rule}"
    length_preset = _normalize_length_preset(length_preset)
    system += (
        "\n\nOutput length:\n"
        f"{_LENGTH_PRESET_RULES.get(length_preset, _LENGTH_PRESET_RULES['标准'])}"
    )
    output_language = _normalize_output_language(output_language)
    if output_language == "中文":
        system += "\n\nOutput language:\nWrite the final caption in fluent, natural Simplified Chinese. For JSON output, keep all keys exactly as required, but write descriptive string values in Simplified Chinese."
    else:
        system += "\n\nOutput language:\nWrite the final caption in fluent, common, modern English."
    audit_tail = (
        "If any applicable check fails, revise visual_analysis before returning the analysis envelope."
        if rule_mode == "natural"
        else "If any applicable check fails, revise the output before returning it."
    )
    system += (
        "\n\nMandatory final audit (perform silently before answering):\n"
        f"{_final_output_audit(style_preset, input_mode)}\n"
        f"{audit_tail}"
    )
    if rule_mode == "natural":
        system += f"\n\n{_natural_analysis_contract(input_mode)}"
    prompt_text = str(prompt_input or "").strip()
    style_task = _style_task_instruction(style_preset)
    camera_task = _camera_task_instruction(input_mode)
    mandatory_tasks = "\n\n".join(task for task in (style_task, camera_task) if task)
    if input_mode == "image_text" and prompt_text:
        system += (
            "\n\nMandatory user requirements from text input:\n"
            f"{prompt_text}\n"
            "These requirements are the target prompt constraints. Preserve them in the final output and apply them to every image independently. If the image conflicts with these requirements, ignore the conflicting image detail and follow the text."
        )
    if image_data_url:
        if input_mode == "image_text":
            instruction = (
                "Input mode: image plus user text.\n"
                "The user text is the target prompt, not a loose note. Extract and preserve every explicit text requirement before looking at the image: subject identity, name, gender, nationality or ethnicity, hair color and style, clothing, accessories, colors, action, medium, and style. "
                "Use the image only as compatible visual reference for pose, framing, setting, lighting, color palette, atmosphere, and production style. "
                "If the image shows a different person, clothing, hair, accessory, action, medium, or setting than the text requests, replace the image detail with the text detail. "
                "Fuse text and image into one final prompt that clearly includes the user's text requirements.\n\n"
                f"Mandatory user requirements:\n{prompt_text}\n\n{mandatory_tasks}"
            )
        else:
            instruction = (
                "Input mode: image only.\n"
                "Reverse-engineer the image into a high-quality T2I prompt. Describe visible subject, setting, composition, "
                "camera distance, camera elevation, horizontal camera-to-subject position, optical-axis direction, subject "
                "orientation and frame placement, lens perspective and field of view, perspective distortion or compression, "
                "framing, lighting, color, medium, style, and atmosphere. Preserve unusual "
                "viewpoints and lens geometry exactly when they are visible. Do not invent unsupported story details.\n\n"
                f"{mandatory_tasks}"
            )
        user_content = [
            {"type": "text", "text": f"User request:\n{instruction}"},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]
    else:
        user_content = (
            "Input mode: text only.\n"
            "Use the text as a creative seed or detailed prompt. If it is short, develop a coherent visual direction. "
            "If it is already detailed, preserve its direction and lightly polish it.\n\n"
            f"User text:\n{prompt_text}\n\n{mandatory_tasks}"
        )
    if _safe_int(seed, 0):
        seed_text = (
            f"\n\nVariation seed: {seed}. Use this seed to make concrete creative choices "
            "for details, composition, lighting, atmosphere, and supporting elements. "
            "Different seed values should produce meaningfully different expansions while preserving the user's core idea."
        )
        if isinstance(user_content, list):
            user_content[0]["text"] += seed_text
        else:
            user_content += seed_text
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]


def _build_image_analysis_messages(prompt_input, image_data_url, style_preset, composition_preset, length_preset, output_language):
    """Build a compact VLM request whose only job is grounded visual analysis."""
    language = _normalize_output_language(output_language)
    style_preset = _normalize_style_preset(style_preset)
    composition_preset = _normalize_composition_preset(composition_preset)
    length_preset = _normalize_length_preset(length_preset)
    target_tokens = _LENGTH_TOKEN_LIMITS.get(length_preset, 256)
    style_instruction = _style_task_instruction(style_preset)
    if style_preset != "自行判断":
        style_instruction += "\n" + _STYLE_PRESET_RULES.get(style_preset, "")
    composition_instruction = _composition_preset_rule(composition_preset)
    text_requirement = str(prompt_input or "").strip()
    conflict_instruction = (
        "The user requirement below overrides only facts it explicitly states; a lens requirement never determines camera elevation.\n"
        f"User requirement: {text_requirement}"
        if text_requirement
        else "The image is the sole source of truth."
    )
    system = f"""
You are a visual-geometry analyzer for an image-prompt node. Analyze the supplied image; do not write a finished prompt.
Return exactly one valid JSON object and no markdown or prose outside it. The node will render the final prompt from this data.
Every string must obey JSON escaping rules. Escape internal double quotes as \\" or rewrite the phrase without quotation marks; never place raw double quotes inside a JSON string.

Required decisions:
- Identify the primary subject and estimate its bbox and three anchors in viewer coordinates 0..1000, origin at image top-left.
- If the user text explicitly specifies the subject, copy its stated identity into explicit_subject_requirement as one concise noun phrase. Preserve stated name, nationality or ethnicity, gender, and age wording exactly in meaning; do not replace "an American woman" with "a young woman". Leave it empty for image-only input or when text specifies no subject. Never infer these attributes from the image for this field.
- Keep camera elevation, viewing direction, subject orientation, and frame placement separate.
- Vertical sign requires converging evidence. Use above/downward only when a visible top plane is accompanied by clear perspective foreshortening or scene convergence proving that the camera is elevated; use below/upward only when visible undersides are accompanied by equivalent perspective evidence. A visible crown, forehead, shoulders, chest, or neckline alone is insufficient.
- For a tight face, head-and-shoulders, bust, or chest-up portrait, choose level unless strong plane and perspective evidence jointly proves a high or low angle. Head tilt, chin position, facial expression, subject gaze, cropping, and wide-angle distortion do not determine camera elevation.
- A reclining or diagonal person must be located by head, center mass, and feet; do not reduce the person to "centered".
- Human shot scale follows visible body extent. Visible head plus most legs/feet is full-body or near-full-body, not medium shot.
- Use explicit intermediate scales: head-to-chest is medium close-up, head-to-waist is medium, head-to-upper-thigh is medium-long/cowboy, head-to-knee or lower is three-quarter, and visible feet is full/near-full-body. Never call a thigh-up or knee-up subject a plain medium shot.
- Lens width is independent of elevation. Describe the visible field of view and perspective effect.
- Locate every important secondary subject with an anchor and depth layer. Use visible descriptors unless identity is unmistakable.
- Scale expression detail and priority with shot distance. For extreme close-up, close-up, head-and-shoulders, or chest-up views, record detailed eye/gaze, brow, nose, mouth/lips/teeth, jaw, and facial-muscle evidence. For medium shots, retain only clearly readable expression cues. For full-body or wide shots, use only broad cues that remain visible. For extreme-wide views or an invisible face, leave the field empty. Do not reduce a readable close expression to "expressive", "happy", or "serious", and do not invent emotion.
- Select one concrete style subtype. {style_instruction}
- Shot-scale instruction: {composition_instruction}
- {conflict_instruction}
- Record appearance/clothing, articulated pose/action, environment/spatial context, and lighting/color/atmosphere in their dedicated fields. In appearance/clothing, list garment type, cut, layers, openings/straps, colors, materials, and footwear before hair, eyewear, jewelry, or makeup. Keep all fields mutually non-duplicative and grounded in visible evidence.
- In pose/action, do not guess anatomical left/right from screen position. If anatomy is uncertain, use the arm/hand at frame-left or frame-right and describe its contacted railing, prop, or support in the same viewer coordinates.
- Allocate detail by shot distance: close views prioritize readable facial and local appearance evidence; medium views balance expression, pose, clothing, and setting; full-body/wide views prioritize complete pose, clothing silhouette, equipment/props, environment, spatial relationships, palette, and atmosphere; extreme-wide views omit facial detail.
- Write descriptive fields in {"Simplified Chinese" if language == "中文" else "English"}, with enough combined detail for a final prompt near {target_tokens} tokens. Never normalize unusual clothing, pose, equipment, color cast, or lighting into a generic scene.
- Keep the four fields concise: appearance/clothing about {50 if target_tokens == 256 else 100} tokens, pose/action about {42 if target_tokens == 256 else 84}, environment/spatial context about {45 if target_tokens == 256 else 90}, and lighting/color/atmosphere about {32 if target_tokens == 256 else 64}. Put distinctive evidence such as unusual garments, hand-object contact, cables/equipment, and dominant color casts before generic background facts.
- Before returning JSON, reject any combination of camera_elevation=above with view_direction=upward, or below with downward.

Schema:
{{
  "visual_analysis": {{
    "style_category": "realistic photography | anime illustration | hand-drawn art | digital art",
    "style_subtype": "",
    "explicit_subject_requirement": "",
    "primary_subject": "",
    "primary_subject_bbox_xyxy": [0, 0, 0, 0],
    "primary_subject_key_anchors": {{
      "head_or_front_xy": [0, 0],
      "center_mass_xy": [0, 0],
      "legs_rear_or_far_extent_xy": [0, 0]
    }},
    "primary_subject_dominant_axis": "",
    "primary_subject_visible_extent": "",
    "primary_subject_frame_occupancy_percent": 0,
    "primary_subject_appearance_and_clothing": "",
    "primary_subject_pose_and_action": "",
    "primary_subject_expression": "",
    "shot_scale": "",
    "camera_elevation": "above | level | below",
    "view_direction": "downward | level | upward",
    "camera_azimuth_or_visible_side": "",
    "subject_orientation": "",
    "frame_placement_and_depth": "",
    "lens_class": "",
    "perspective_effect": "",
    "secondary_subjects": [{{"visible_descriptor": "", "anchor_xy": [0, 0], "depth_layer": "foreground | midground | background"}}],
    "multiple_subject_layout": "",
    "environment_and_spatial_context": "",
    "lighting_color_and_atmosphere": "",
    "geometry_evidence_or_design_basis": ["", ""]
  }}
}}
""".strip()
    user_content = [
        {"type": "text", "text": "Analyze this image into the required JSON worksheet. Inspect visible planes and subject anchors before choosing the vertical angle."},
        {"type": "image_url", "image_url": {"url": image_data_url}},
    ]
    return [{"role": "system", "content": system}, {"role": "user", "content": user_content}]


def _message_cache_text(messages):
    parts = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "text":
                    parts.append(str(item.get("text") or ""))
        else:
            parts.append(str(content or ""))
    return "\n".join(parts)


def _strip_data_url_prefix(data_url):
    text = str(data_url or "")
    if "," in text and text.lower().startswith("data:image"):
        return text.split(",", 1)[1]
    return text


def _ollama_messages_from_openai(messages):
    output = []
    for message in messages:
        role = message.get("role") or "user"
        content = message.get("content")
        if isinstance(content, list):
            text_parts = []
            images = []
            for item in content:
                if not isinstance(item, dict):
                    text_parts.append(str(item))
                    continue
                if item.get("type") == "text":
                    text_parts.append(str(item.get("text") or ""))
                elif item.get("type") == "image_url":
                    url = (item.get("image_url") or {}).get("url")
                    if url:
                        images.append(_strip_data_url_prefix(url))
            clean = {"role": role, "content": "\n".join(part for part in text_parts if part).strip()}
            if images:
                clean["images"] = images
            output.append(clean)
        else:
            output.append({"role": role, "content": str(content or "")})
    return output


def _ollama_chat(base_url, model, messages, temperature, max_tokens, seed=0):
    base = str(base_url or "").strip().strip('"').strip("'").rstrip("/") or "http://localhost:11434"
    if base.endswith("/v1"):
        base = base[:-3].rstrip("/")
    if not str(model or "").strip():
        raise ValueError("NO8D-Prompt: model is empty")
    endpoint = base + "/api/chat"
    payload = {
        "model": str(model).strip(),
        "messages": _ollama_messages_from_openai(messages),
        "stream": False,
        "options": {
            "temperature": _safe_float(temperature, 0.7),
            "num_predict": _safe_int(max_tokens, 800),
        },
    }
    seed = _safe_int(seed, 0)
    if seed:
        payload["options"]["seed"] = seed
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(endpoint, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with _urlopen(request, timeout=_OLLAMA_TIMEOUT, base_url=base) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"NO8D-Prompt: Ollama HTTP {exc.code}: {body[:800]}") from exc
    except (TimeoutError, socket.timeout) as exc:
        raise RuntimeError(f"NO8D-Prompt: Ollama request timed out after {_OLLAMA_TIMEOUT}s") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"NO8D-Prompt: Ollama request failed: {exc.reason}") from exc
    parsed = json.loads(raw)
    message = parsed.get("message") if isinstance(parsed, dict) else None
    content = (message or {}).get("content") if isinstance(message, dict) else ""
    if not str(content or "").strip():
        raise RuntimeError("NO8D-Prompt: Ollama returned empty content")
    return str(content)


def _send_chat_completion(base_url, endpoint, data, headers, streaming, model):
    last_http_error = None
    for attempt in range(2):
        request = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with _urlopen(request, timeout=_OPENAI_TIMEOUT, base_url=base_url or endpoint) as response:
                return _read_chat_response(response, streaming)
        except _StreamingAPIError as exc:
            if exc.retryable_burst and attempt == 0:
                time.sleep(_ARK_BURST_RETRY_DELAY)
                continue
            if exc.retryable_burst:
                raise RuntimeError(
                    f"NO8D-Prompt: Ark rejected model {model} with {exc.code or exc.error_type} after one paced retry. "
                    "Wait briefly before running again, reduce simultaneous prompt jobs, or check the Ark endpoint capacity."
                ) from exc
            raise
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last_http_error = (exc, body)
            if exc.code in _RETRY_HTTP_CODES and attempt == 0:
                time.sleep(_ARK_BURST_RETRY_DELAY if _uses_streaming_chat(base_url) else 1.2)
                continue
            hint = ""
            if "Model does not exist" in body or "model" in body.lower():
                hint = " Please open NO8D Prompt API Manager, validate the service again, and select an available model. Image reverse prompting also requires a vision-capable model."
            raise RuntimeError(f"NO8D-Prompt: API HTTP {exc.code}: {body[:800]}{hint}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise RuntimeError(_timeout_message(base_url, model)) from exc
        except urllib.error.URLError as exc:
            if attempt == 0:
                time.sleep(1.0)
                continue
            raise RuntimeError(f"NO8D-Prompt: API request failed: {exc.reason}") from exc
    else:
        exc, body = last_http_error
        raise RuntimeError(f"NO8D-Prompt: API HTTP {exc.code}: {body[:800]}") from exc

    raise RuntimeError("NO8D-Prompt: API request ended without a response")


def _chat_completion(base_url, api_key, model, messages, temperature, max_tokens, seed=0, service_type="openai_compatible", response_format=None):
    if _uses_ollama_native(base_url, service_type):
        return _ollama_chat(base_url, model, messages, temperature, max_tokens, seed)

    endpoint = _endpoint_from_base_url(base_url)
    if not endpoint:
        raise ValueError("NO8D-Prompt: API base URL is empty")
    if not str(model or "").strip():
        raise ValueError("NO8D-Prompt: model is empty")

    streaming = _uses_streaming_chat(base_url)
    payload = _configure_chat_payload({
        "model": str(model).strip(),
        "messages": messages,
        "temperature": _safe_float(temperature, 0.7),
        "max_tokens": _safe_int(max_tokens, 800),
        "stream": streaming,
    }, base_url, model)
    if response_format:
        payload["response_format"] = response_format
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    key = _clean_key(api_key) or _clean_key(os.getenv("NO8D_PROMPT_API_KEY")) or _clean_key(os.getenv("OPENAI_API_KEY"))
    if key:
        headers["Authorization"] = f"Bearer {key}"
    with _request_guard(base_url):
        return _send_chat_completion(base_url, endpoint, data, headers, streaming, model)


def _max_tokens_for_length(length_preset):
    length_preset = _normalize_length_preset(length_preset)
    return _LENGTH_TOKEN_LIMITS.get(length_preset, _LENGTH_TOKEN_LIMITS["标准"])


def _max_tokens_for_request(length_preset, prompt_rule):
    prompt_tokens = _max_tokens_for_length(length_preset)
    if prompt_config_manager.prompt_rule_mode(prompt_rule) == "natural":
        return prompt_tokens + _NATURAL_ANALYSIS_TOKEN_OVERHEAD
    return prompt_tokens


def _supports_native_json_schema(base_url):
    try:
        host = (urllib.parse.urlparse(str(base_url or "")).hostname or "").lower()
    except Exception:
        return False
    return (host.startswith("ark.") and host.endswith(".volces.com")) or host == "api.siliconflow.cn"


def _image_analysis_response_format(base_url, scene_only=False):
    if not _supports_native_json_schema(base_url):
        return None
    if scene_only:
        schema = {
            "type": "object",
            "properties": {"scene_description": {"type": "string"}},
            "required": ["scene_description"],
            "additionalProperties": False,
        }
        name = "no8d_scene_description"
    else:
        string_fields = (
            "style_category", "style_subtype", "explicit_subject_requirement", "primary_subject",
            "primary_subject_dominant_axis", "primary_subject_visible_extent",
            "primary_subject_appearance_and_clothing", "primary_subject_pose_and_action",
            "primary_subject_expression", "shot_scale", "camera_elevation",
            "view_direction", "camera_azimuth_or_visible_side", "subject_orientation",
            "frame_placement_and_depth", "lens_class", "perspective_effect",
            "multiple_subject_layout", "environment_and_spatial_context",
            "lighting_color_and_atmosphere",
        )
        properties = {field: {"type": "string"} for field in string_fields}
        properties.update({
            "explicit_subject_requirement": {"type": "string", "maxLength": 100},
            "primary_subject_appearance_and_clothing": {"type": "string", "maxLength": 200},
            "primary_subject_pose_and_action": {"type": "string", "maxLength": 170},
            "environment_and_spatial_context": {"type": "string", "maxLength": 180},
            "lighting_color_and_atmosphere": {"type": "string", "maxLength": 130},
        })
        point = {"type": "array", "items": {"type": "integer"}}
        properties.update({
            "primary_subject_bbox_xyxy": point,
            "primary_subject_key_anchors": {
                "type": "object",
                "properties": {
                    "head_or_front_xy": point,
                    "center_mass_xy": point,
                    "legs_rear_or_far_extent_xy": point,
                },
                "required": ["head_or_front_xy", "center_mass_xy", "legs_rear_or_far_extent_xy"],
                "additionalProperties": False,
            },
            "primary_subject_frame_occupancy_percent": {"type": "number"},
            "secondary_subjects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "visible_descriptor": {"type": "string"},
                        "anchor_xy": point,
                        "depth_layer": {"type": "string"},
                    },
                    "required": ["visible_descriptor", "anchor_xy", "depth_layer"],
                    "additionalProperties": False,
                },
            },
            "geometry_evidence_or_design_basis": {"type": "array", "items": {"type": "string"}},
        })
        analysis_schema = {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }
        schema = {
            "type": "object",
            "properties": {"visual_analysis": analysis_schema},
            "required": ["visual_analysis"],
            "additionalProperties": False,
        }
        name = "no8d_visual_analysis"
    return {"type": "json_schema", "json_schema": {"name": name, "strict": True, "schema": schema}}


def _temperature_for_input(temperature, input_mode):
    value = _safe_float(temperature, 0.7)
    return min(value, 0.1) if input_mode in {"image", "image_text"} else value


def _model_for_input(service, text_model, input_mode):
    if input_mode in {"image", "image_text"}:
        return str((service or {}).get("vision_model") or text_model or "").strip()
    return str(text_model or "").strip()


def _api_key_fingerprint(api_key):
    key = _clean_key(api_key)
    if not key:
        return ""
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


class NO8DBatchPromptPlus:
    _cache = {}
    _cache_lock = threading.Lock()

    @classmethod
    def INPUT_TYPES(cls):
        prompt_rule_names = prompt_config_manager.prompt_rule_names()
        prompt_rule_inputs = prompt_rule_names + [
            name for name in ("Natural language", "JSON structure") if name not in prompt_rule_names
        ]
        return {
            "required": {
                "prompt_rules": (prompt_rule_inputs, {"default": _RULE_NATURAL}),
                "style_preset": (_STYLE_PRESET_INPUTS, {"default": "自行判断"}),
                "composition_preset": (_COMPOSITION_PRESET_INPUTS, {"default": "自行判断"}),
                "length_preset": (_LENGTH_PRESET_INPUTS, {"default": "标准"}),
                "output_language": (_OUTPUT_LANGUAGE_INPUTS, {"default": "英文"}),
                "fixed_text": ("STRING", {"default": ""}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "extra_rules": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "images": ("IMAGE",),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    OUTPUT_IS_LIST = (True,)
    FUNCTION = "run"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, prompt_rules, style_preset="自行判断", composition_preset="自行判断", length_preset="标准", output_language="英文", fixed_text="", seed=0, extra_rules="", images=None, prompt=None, unique_id=None):
        service, model_cfg = prompt_config_manager.current_service()
        image_hashes = _images_to_hashes(images)
        prompt_text = str(extra_rules or "").strip()
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        style_preset = _normalize_style_preset(style_preset)
        composition_preset = _normalize_composition_preset(composition_preset)
        length_preset = _normalize_length_preset(length_preset)
        output_language = _normalize_output_language(output_language)
        payload = {
            "pipeline_version": _PROMPT_PIPELINE_VERSION,
            "prompt": prompt_text,
            "image_hashes": image_hashes,
            "prompt_rules": prompt_rule,
            "prompt_rule_text": prompt_config_manager.prompt_rule_text(prompt_rule),
            "style_preset": style_preset,
            "style_preset_rule": _style_preset_rule(style_preset),
            "composition_preset": composition_preset,
            "composition_preset_rule": _composition_preset_rule(composition_preset),
            "length_preset": length_preset,
            "length_preset_rule": _LENGTH_PRESET_RULES.get(length_preset, _LENGTH_PRESET_RULES["标准"]),
            "output_language": output_language,
            "fixed_text": fixed_text,
            "service_id": service.get("id"),
            "service_type": service.get("type", "openai_compatible"),
            "api_base_url": service.get("base_url", ""),
            "model": model_cfg.get("name", ""),
            "vision_model": service.get("vision_model", ""),
            "api_key": _api_key_fingerprint(service.get("api_key", "")),
            "temperature": _safe_float(model_cfg.get("temperature"), 0.7),
            "seed": _safe_int(seed, 0),
            "input_text": prompt_text,
            "linked_inputs": _linked_inputs_signature(prompt, unique_id, ("images",)),
        }
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    @classmethod
    def _cache_get(cls, cache_key):
        with cls._cache_lock:
            return cls._cache.get(cache_key)

    @classmethod
    def _cache_put(cls, cache_key, value):
        with cls._cache_lock:
            cls._cache[cache_key] = value
            while len(cls._cache) > 128:
                cls._cache.pop(next(iter(cls._cache)))

    def _generate_prompt_item(
        self,
        *,
        index,
        total,
        image_data_url,
        image_hash,
        prompt,
        prompt_rule,
        extra_rules,
        base_seed,
        style_preset,
        composition_preset,
        length_preset,
        output_language,
        service,
        api_base_url,
        api_key,
        model,
        service_type,
        temperature,
        max_tokens,
    ):
        effective_seed = base_seed + index if base_seed else 0
        if image_data_url:
            input_mode = "image_text" if prompt else "image"
            instruction = ""
            if prompt:
                instruction = prompt
        else:
            input_mode = "text"
            instruction = prompt
        request_model = _model_for_input(service, model, input_mode)
        request_temperature = _temperature_for_input(temperature, input_mode)
        strict_image_analysis = bool(
            image_data_url and prompt_config_manager.prompt_rule_mode(prompt_rule) == "natural"
        )
        if strict_image_analysis:
            messages = _build_image_analysis_messages(
                instruction,
                image_data_url,
                style_preset,
                composition_preset,
                length_preset,
                output_language,
            )
        else:
            messages = _build_messages(instruction, prompt_rule, extra_rules, effective_seed, image_data_url, style_preset, composition_preset, length_preset, output_language, input_mode)
        cache_payload = {
            "messages": _message_cache_text(messages),
            "service_id": service.get("id"),
            "base_url": api_base_url,
            "model": request_model,
            "api_key": _api_key_fingerprint(api_key),
            "temperature": request_temperature,
            "max_tokens": max_tokens,
            "seed": effective_seed,
            "image": image_hash,
            "output_language": output_language,
        }
        cache_key = hashlib.sha1(json.dumps(cache_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        result = self._cache_get(cache_key)
        if result is None:
            response_format = _image_analysis_response_format(api_base_url) if strict_image_analysis else None
            raw = _chat_completion(api_base_url, api_key, request_model, messages, request_temperature, max_tokens, effective_seed, service_type, response_format)
            try:
                result = _clean_prompt_output(raw, prompt_rule, output_language, strict_image_analysis)
            except ValueError:
                partial_analysis, partial_scene = _partial_analysis_envelope(raw)
                if partial_analysis and not partial_scene:
                    repair_instruction = (
                        "The visual_analysis object is already complete and will be preserved. Return exactly one JSON "
                        "object with only this key: {\"scene_description\": \"...\"}. Describe visible subject appearance "
                        "and action, setting, lighting, colors, materials, textures, and atmosphere in the requested "
                        "language. Do not include camera angle, lens, framing, placement, style labels, coordinates, "
                        "markdown, or any other key."
                    )
                    repair_max_tokens = _max_tokens_for_length(length_preset) + 128
                else:
                    repair_instruction = (
                        "The previous response was not a complete valid JSON worksheet. Return the required JSON "
                        "object only. Reinspect the image; do not copy camera wording from the invalid response."
                    )
                    repair_max_tokens = max_tokens + 128
                repair_messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": repair_instruction},
                ]
                repair_format = _image_analysis_response_format(
                    api_base_url,
                    scene_only=bool(partial_analysis and not partial_scene),
                )
                repaired = _chat_completion(api_base_url, api_key, request_model, repair_messages, 0.0, repair_max_tokens, effective_seed, service_type, repair_format)
                try:
                    if partial_analysis and not partial_scene:
                        _, repaired_scene = _partial_analysis_envelope(repaired)
                        merged = {
                            "visual_analysis": partial_analysis,
                            "scene_description": repaired_scene,
                        }
                        repaired = json.dumps(merged, ensure_ascii=False)
                    result = _clean_prompt_output(repaired, prompt_rule, output_language, True)
                except ValueError as exc:
                    raise RuntimeError(
                        "NO8D-Prompt: the vision model did not return a complete visual-analysis result after one correction. "
                        "No unverified composition prompt was emitted."
                    ) from exc
            if prompt_config_manager.prompt_rule_mode(prompt_rule) == "natural":
                result = _limit_prompt_to_approx_tokens(result, _max_tokens_for_length(length_preset))
            self._cache_put(cache_key, result)
        return result

    def run(self, prompt_rules, style_preset="自行判断", composition_preset="自行判断", length_preset="标准", output_language="英文", fixed_text="", seed=0, extra_rules="", images=None, prompt=None, unique_id=None):
        encoded = _images_to_data_urls(images)
        prompt = str(extra_rules or "").strip()
        fixed_text = str(fixed_text or "").strip()
        if not encoded and not prompt:
            return ([fixed_text],) if fixed_text else ([],)

        service, model_cfg = prompt_config_manager.current_service()
        api_base_url = service.get("base_url", "")
        api_key = service.get("api_key", "") or os.getenv("NO8D_PROMPT_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
        model = model_cfg.get("name", "")
        service_type = service.get("type", "openai_compatible")
        temperature = _safe_float(model_cfg.get("temperature"), 0.7)
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        if prompt_rule not in prompt_config_manager.prompt_rule_names():
            prompt_rule = _RULE_NATURAL
        style_preset = _normalize_style_preset(style_preset)
        composition_preset = _normalize_composition_preset(composition_preset)
        length_preset = _normalize_length_preset(length_preset)
        output_language = _normalize_output_language(output_language)
        max_tokens = _max_tokens_for_request(length_preset, prompt_rule)
        base_seed = _safe_int(seed, 0)
        items = encoded or [("", "")]
        common = {
            "total": len(items),
            "prompt": prompt,
            "prompt_rule": prompt_rule,
            "extra_rules": extra_rules,
            "base_seed": base_seed,
            "style_preset": style_preset,
            "composition_preset": composition_preset,
            "length_preset": length_preset,
            "output_language": output_language,
            "service": service,
            "api_base_url": api_base_url,
            "api_key": api_key,
            "model": model,
            "service_type": service_type,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        use_parallel = _should_parallelize_requests(len(items), api_base_url, service_type)
        if use_parallel:
            prompts = [None] * len(items)
            max_workers = min(_MAX_PARALLEL_REQUESTS, len(items))
            with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                future_map = {
                    executor.submit(
                        self._generate_prompt_item,
                        index=index,
                        image_data_url=image_data_url,
                        image_hash=image_hash,
                        **common,
                    ): index
                    for index, (image_data_url, image_hash) in enumerate(items)
                }
                for future in concurrent.futures.as_completed(future_map):
                    prompts[future_map[future]] = future.result()
            return ([_join_prompt_parts(fixed_text, item) for item in prompts],)

        prompts = [
            self._generate_prompt_item(
                index=index,
                image_data_url=image_data_url,
                image_hash=image_hash,
                **common,
            )
            for index, (image_data_url, image_hash) in enumerate(items)
        ]
        return ([_join_prompt_parts(fixed_text, item) for item in prompts],)


class NO8DPromptView:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "auto_output": ("BOOLEAN", {"default": True, "label_on": "auto", "label_off": "edit"}),
                "edited_text": ("STRING", {"default": "", "multiline": True}),
                "send_seq": ("STRING", {"default": "0"}),
            },
            "optional": {
                "text": ("STRING", {"forceInput": True}),
            },
            "hidden": {
                "prompt": "PROMPT",
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("positive",)
    FUNCTION = "view"
    OUTPUT_NODE = True
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, auto_output, edited_text="", send_seq=0, text="", prompt=None, unique_id=None):
        auto = _safe_bool(auto_output, True)
        incoming = _prompt_view_text(text)
        edited = _prompt_view_text(edited_text)
        sequence = _safe_int(send_seq, 0)
        if sequence > 0:
            payload = {
                "mode": "send",
                "edited_text": edited,
                "send_seq": sequence,
                "unique_id": unique_id,
            }
        elif auto:
            payload = {
                "mode": "auto",
                "text": incoming,
                "unique_id": unique_id,
                "linked_inputs": _linked_inputs_signature(prompt, unique_id, ("text",)),
            }
            if not incoming.strip():
                payload["edited_text"] = edited
        else:
            payload = {
                "mode": "edit",
                "text": incoming,
                "edited_text": edited,
                "unique_id": unique_id,
                "linked_inputs": _linked_inputs_signature(prompt, unique_id, ("text",)),
            }
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def view(self, auto_output=True, edited_text="", send_seq=0, text="", prompt=None, unique_id=None):
        incoming = _prompt_view_text(text)
        edited = _prompt_view_text(edited_text)
        incoming_output = incoming if incoming.strip() else ""
        edited_output = edited if edited.strip() else ""
        is_send = _safe_int(send_seq, 0) > 0
        if is_send:
            output = edited_output
            display_text = edited
        elif _safe_bool(auto_output, True):
            output = incoming_output or edited_output
            display_text = output
        else:
            output = ""
            display_text = incoming_output or edited
        return {
            "ui": {
                "edited_text": [display_text],
                "NO8DPromptView_text": [display_text],
                "NO8DPromptView_output": [output],
            },
            "result": (output,),
        }


NODE_CLASS_MAPPINGS = {
    "NO8DBatchPromptPlus": NO8DBatchPromptPlus,
    "NO8DPromptView": NO8DPromptView,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DBatchPromptPlus": "NO8D-Prompt",
    "NO8DPromptView": "NO8D-Prompt-view",
}
