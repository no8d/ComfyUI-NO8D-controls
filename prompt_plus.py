from __future__ import annotations

import base64
import concurrent.futures
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
    from comfy_execution.graph_utils import ExecutionBlocker
except Exception:
    ExecutionBlocker = None

from .prompt_config import RULE_JSON as _RULE_JSON
from .prompt_config import RULE_NATURAL as _RULE_NATURAL
from .prompt_config import prompt_config_manager


_IMAGE_MAX_EDGE = 768
_IMAGE_JPEG_QUALITY = 80
_IMAGE_ENCODE_CACHE_LIMIT = 64
_OPENAI_TIMEOUT = 120
_OLLAMA_TIMEOUT = 240
_MAX_PARALLEL_REQUESTS = 3
_RETRY_HTTP_CODES = {408, 429, 500, 502, 503, 504}
_STYLE_PRESETS = (
    "自行判断",
    "业余摄影",
    "专业摄影",
    "影视摄影",
    "日式动漫",
    "美式动漫",
    "插画艺术",
    "油画艺术",
    "3d写实",
    "3d卡通",
)
_STYLE_PRESET_ALIASES = {
    "无": "自行判断",
    "none": "自行判断",
    "None": "自行判断",
    "Auto": "自行判断",
    "自行判断": "自行判断",
    "Amateur photography": "业余摄影",
    "Professional photography": "专业摄影",
    "Cinematic photography": "影视摄影",
    "Japanese anime": "日式动漫",
    "American animation": "美式动漫",
    "Illustration art": "插画艺术",
    "Oil painting": "油画艺术",
    "3D realism": "3d写实",
    "3D cartoon": "3d卡通",
}
_STYLE_PRESET_INPUTS = _STYLE_PRESETS
_STYLE_PRESET_RULES = {
    "业余摄影": "Use a clearly amateur smartphone-photography look. Preserve the visible subject, clothing, styling, and setting, but describe the capture quality as rough and phone-made rather than polished. The final output must include common modern English cues such as phone photo, casual snapshot, handheld framing, available light, spontaneous moment, everyday setting, natural colors, uneven exposure, slight motion blur, phone-camera noise, limited dynamic range, compressed detail, imperfect focus, and believable everyday flaws when appropriate. Make it feel like a real mobile-phone capture or casual social-media photo, not a DSLR shoot, studio setup, commercial advertisement, or polished cinematic still.",
    "专业摄影": "Use a professional photography look: DSLR or mirrorless camera quality, refined commercial/editorial composition, controlled lighting, crisp lens rendering, polished color grading, and high-end advertising or fashion-shoot detail.",
    "影视摄影": "Use a cinematic film-still look: dramatic motivated lighting, film grain, expressive shadows, carefully staged blocking, atmospheric depth, lens character, and movie-like color grading.",
    "日式动漫": "Use a Japanese anime look: clean line art, expressive anime character design, cel shading, detailed background art, controlled color harmonies, and a polished key-visual or animation-still feeling.",
    "美式动漫": "Use an American animation or comic-inspired look: bold readable shapes, expressive poses, confident outlines, lively character acting, clear staging, saturated but balanced colors, and dynamic graphic energy.",
    "插画艺术": "Use an illustration-art look: deliberate stylized drawing, cohesive design language, expressive shapes, thoughtful composition, rich surface detail, and a polished editorial or concept-art finish.",
    "油画艺术": "Use an oil-painting look: visible brushwork, layered paint texture, canvas-like surface, painterly edges, rich pigments, classical light handling, and tactile material depth.",
    "3d写实": "Use a photorealistic 3D look: physically based materials, realistic geometry, ray-traced lighting, accurate reflections, natural camera perspective, and high-detail render quality.",
    "3d卡通": "Use a stylized 3D cartoon look: rounded forms, appealing simplified shapes, expressive animation-style characters, clean materials, bright controlled colors, and playful cinematic lighting.",
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
    "标准": 240,
    "详细": 480,
}
_LENGTH_PRESET_RULES = {
    "标准": "Target output length: standard, about 120-240 tokens. For natural-language output, write a compact single paragraph with about 3-5 clear sentences. Prioritize the subject, action, setting, composition, lighting, medium, and mood. Do not pad the prompt with secondary details.",
    "详细": "Target output length: detailed, about 240-480 tokens. For natural-language output, write a visibly longer single paragraph with about 6-10 rich sentences. Add more concrete visual evidence: subject details, pose, spatial layout, foreground and background, lighting direction, materials, textures, color relationships, camera or medium language, atmosphere, and visible text when present. The detailed result must be substantially more developed than the standard result while staying coherent and non-repetitive.",
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
    if max_edge > _IMAGE_MAX_EDGE:
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


def _clean_prompt_output(text, rule):
    text = _strip_code_fence(_strip_thinking(text)).strip()
    text = re.sub(r"^\s*(expanded prompt|positive prompt|prompt|result|output)\s*:\s*", "", text, flags=re.IGNORECASE)
    text = text.strip().strip('"').strip()
    if prompt_config_manager.prompt_rule_mode(rule) == "json":
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
        return "Infer the most suitable visual style automatically from the user's text and/or the input image. Do not force a preset style; choose the style, medium, lighting language, and camera or rendering vocabulary that best fits the subject and visible evidence."
    return _STYLE_PRESET_RULES.get(preset, "")


def _composition_preset_rule(composition_preset):
    preset = _normalize_composition_preset(composition_preset)
    if preset == "自行判断":
        return "Infer the most suitable subject shot scale automatically from the user's text and/or the input image. Do not force a preset shot scale; choose how close or far the main subject should appear based on the scene, intent, and visible evidence."
    return _COMPOSITION_PRESET_RULES.get(preset, "")


def _build_messages(prompt_input, rule, extra_rules, seed, image_data_url="", style_preset="自行判断", composition_preset="自行判断", length_preset="标准", output_language="英文", input_mode="text"):
    system = (
        _json_system_prompt(rule)
        if prompt_config_manager.prompt_rule_mode(rule) == "json"
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
                "Apply this style preset clearly in the final output. If both text and image are provided, preserve the user's text requirements first and use the image only for compatible visual reference. If only an image is provided, reverse-engineer the image content while rewriting the caption in this selected style. This style preset must not override an explicit subject shot-scale selection."
            )
    composition_rule = _composition_preset_rule(composition_preset)
    if composition_rule:
        system += (
            "\n\nSubject shot scale:\n"
            f"{composition_rule}\n"
            "Apply this shot-scale requirement to the main subject as a hard visual constraint. Expand or reverse-engineer the prompt so the described subject distance, visible body area, and amount of environment match this shot scale. Treat the subject/environment/lighting balance as a soft proportional guide, not a rigid formula. The closer the shot scale is, such as extreme close-up or close-up, the more the caption should focus on the subject's visible details and the less it should describe environment or broad atmosphere. The farther the shot scale is, such as wide shot or extreme wide shot, the more concise the subject description should be and the more the caption should describe environment, atmosphere, spatial relationships, and overall scene scale. Subject description may include angle, makeup or grooming, expression, clothing or surface appearance, and action when visible, but it must not contradict the selected shot scale. Do not add details that contradict the selected shot scale. If an input image is provided, preserve visible subject facts, identity, action, clothing, props, and setting evidence, but do not preserve the original image's camera distance when a different shot scale is selected."
        )
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
    prompt_text = str(prompt_input or "").strip()
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
                f"Mandatory user requirements:\n{prompt_text}"
            )
        else:
            instruction = (
                "Input mode: image only.\n"
                "Reverse-engineer the image into a high-quality T2I prompt. Describe visible subject, setting, composition, "
                "camera distance, lighting, color, medium, style, and atmosphere. Do not invent unsupported story details."
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
            f"User text:\n{prompt_text}"
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


def _chat_completion(base_url, api_key, model, messages, temperature, max_tokens, seed=0, service_type="openai_compatible"):
    if _uses_ollama_native(base_url, service_type):
        return _ollama_chat(base_url, model, messages, temperature, max_tokens, seed)

    endpoint = _endpoint_from_base_url(base_url)
    if not endpoint:
        raise ValueError("NO8D-Prompt: API base URL is empty")
    if not str(model or "").strip():
        raise ValueError("NO8D-Prompt: model is empty")

    payload = {
        "model": str(model).strip(),
        "messages": messages,
        "temperature": _safe_float(temperature, 0.7),
        "max_tokens": _safe_int(max_tokens, 800),
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    key = _clean_key(api_key) or _clean_key(os.getenv("NO8D_PROMPT_API_KEY")) or _clean_key(os.getenv("OPENAI_API_KEY"))
    if key:
        headers["Authorization"] = f"Bearer {key}"
    last_http_error = None
    for attempt in range(2):
        request = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with _urlopen(request, timeout=_OPENAI_TIMEOUT, base_url=base_url or endpoint) as response:
                raw = response.read().decode("utf-8", errors="replace")
            break
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last_http_error = (exc, body)
            if exc.code in _RETRY_HTTP_CODES and attempt == 0:
                time.sleep(1.2)
                continue
            hint = ""
            if "Model does not exist" in body or "model" in body.lower():
                hint = " Please open NO8D Prompt API Manager, validate the service again, and select an available model. Image reverse prompting also requires a vision-capable model."
            raise RuntimeError(f"NO8D-Prompt: API HTTP {exc.code}: {body[:800]}{hint}") from exc
        except (TimeoutError, socket.timeout) as exc:
            if attempt == 0:
                time.sleep(1.0)
                continue
            raise RuntimeError(f"NO8D-Prompt: API request timed out after {_OPENAI_TIMEOUT}s") from exc
        except urllib.error.URLError as exc:
            if attempt == 0:
                time.sleep(1.0)
                continue
            raise RuntimeError(f"NO8D-Prompt: API request failed: {exc.reason}") from exc
    else:
        exc, body = last_http_error
        raise RuntimeError(f"NO8D-Prompt: API HTTP {exc.code}: {body[:800]}") from exc

    parsed = json.loads(raw)
    choices = parsed.get("choices") or []
    if not choices:
        raise RuntimeError("NO8D-Prompt: API returned no choices")
    message = choices[0].get("message") or {}
    content = message.get("content") or choices[0].get("text") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    if not str(content).strip():
        raise RuntimeError("NO8D-Prompt: API returned empty content")
    return str(content)


def _max_tokens_for_length(length_preset):
    length_preset = _normalize_length_preset(length_preset)
    return _LENGTH_TOKEN_LIMITS.get(length_preset, _LENGTH_TOKEN_LIMITS["标准"])


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
        messages = _build_messages(instruction, prompt_rule, extra_rules, effective_seed, image_data_url, style_preset, composition_preset, length_preset, output_language, input_mode)
        cache_payload = {
            "messages": _message_cache_text(messages),
            "service_id": service.get("id"),
            "base_url": api_base_url,
            "model": model,
            "api_key": _api_key_fingerprint(api_key),
            "temperature": temperature,
            "max_tokens": max_tokens,
            "seed": effective_seed,
            "image": image_hash,
            "output_language": output_language,
        }
        cache_key = hashlib.sha1(json.dumps(cache_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        result = self._cache_get(cache_key)
        if result is None:
            raw = _chat_completion(api_base_url, api_key, model, messages, temperature, max_tokens, effective_seed, service_type)
            result = _clean_prompt_output(raw, prompt_rule)
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
        max_tokens = _max_tokens_for_length(length_preset)
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

        use_parallel = (
            len(items) > 1
            and not _uses_ollama_native(api_base_url, service_type)
            and not _is_local_url(api_base_url)
        )
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
    _last_send_seq = {}

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
        if auto:
            payload = {
                "text": text or "",
                "auto_output": True,
                "unique_id": unique_id,
                "linked_inputs": _linked_inputs_signature(prompt, unique_id, ("text",)),
            }
        else:
            payload = {
                "auto_output": False,
                "edited_text": edited_text,
                "send_seq": _safe_int(send_seq, 0),
                "unique_id": unique_id,
            }
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def view(self, auto_output=True, edited_text="", send_seq=0, text="", prompt=None, unique_id=None):
        incoming = str(text or "")
        edited = str(edited_text or "")
        node_key = str(unique_id or "default")
        send_seq = _safe_int(send_seq, 0)
        if _safe_bool(auto_output, True):
            output = incoming or edited
        elif edited.strip() and send_seq > int(self._last_send_seq.get(node_key, 0)):
            output = edited
            self._last_send_seq[node_key] = send_seq
        else:
            output = ExecutionBlocker(None) if ExecutionBlocker else ""
        ui_output = "" if ExecutionBlocker and isinstance(output, ExecutionBlocker) else output
        return {
            "ui": {
                "edited_text": [incoming],
                "NO8DPromptView_text": [incoming],
                "NO8DPromptView_output": [ui_output],
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
