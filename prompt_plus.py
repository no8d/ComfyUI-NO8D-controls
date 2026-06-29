from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import time
import urllib.error
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


_IMAGE_MAX_EDGE = 1024
_IMAGE_JPEG_QUALITY = 85
_STYLE_PRESETS = (
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
_STYLE_PRESET_INPUTS = _STYLE_PRESETS + tuple(_STYLE_PRESET_ALIASES.keys())
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

def _normalize_style_preset(style_preset):
    preset = str(style_preset or "").strip()
    return _STYLE_PRESET_ALIASES.get(preset, preset)

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


def _image_array_to_data_url(arr):
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


def _images_to_data_urls(images):
    if images is None:
        return []
    try:
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
    if high_level:
        normalized["high_level_description"] = high_level

    style = obj.get("style_description")
    if not isinstance(style, dict):
        style = {}
    style_out = {}
    aesthetics = str(style.get("aesthetics") or "").strip()
    lighting = str(style.get("lighting") or "").strip()
    photo = str(style.get("photo") or "").strip()
    medium = str(style.get("medium") or "").strip()
    art_style = str(style.get("art_style") or "").strip()
    palette = _clean_palette(style.get("color_palette"), 16)
    if aesthetics:
        style_out["aesthetics"] = aesthetics
    if lighting:
        style_out["lighting"] = lighting
    if photo:
        style_out["photo"] = photo
    if medium:
        style_out["medium"] = medium
    if not photo and art_style:
        style_out["art_style"] = art_style
    if palette:
        style_out["color_palette"] = palette
    if style_out:
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
            desc = str(element.get("desc") or "").strip()
            palette = _clean_palette(element.get("color_palette"), 5)
            clean = {"type": element_type}
            if bbox:
                clean["bbox"] = bbox
            if element_type == "text":
                text_value = str(element.get("text") or "").strip()
                if text_value:
                    clean["text"] = text_value
            if desc:
                clean["desc"] = desc
            if palette:
                clean["color_palette"] = palette
            if len(clean) > 1:
                clean_elements.append(clean)
    comp_out = {}
    if background:
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


def _natural_system_prompt(rule_name):
    rule_text = prompt_config_manager.prompt_rule_text(rule_name)
    return f"""
You are a professional image-generation prompt expansion assistant.

Prompt writing rules:
{rule_text}

Output only the final positive prompt.
""".strip()


def _json_system_prompt(rule_name):
    rule_text = prompt_config_manager.prompt_rule_text(rule_name)
    return f"""
You are a professional image-generation caption expansion assistant.

Prompt writing rules:
{rule_text}

Write all descriptive JSON string values in the requested output language.
""".strip()


def _style_preset_rule(style_preset):
    preset = _normalize_style_preset(style_preset)
    return _STYLE_PRESET_RULES.get(preset, _STYLE_PRESET_RULES[_STYLE_PRESETS[1]])


def _build_messages(prompt_input, rule, extra_rules, seed, image_data_url="", style_preset="专业摄影", length_preset="标准", output_language="英文"):
    system = (
        _json_system_prompt(rule)
        if prompt_config_manager.prompt_rule_mode(rule) == "json"
        else _natural_system_prompt(rule)
    )
    system += (
        "\n\nStyle preset:\n"
        f"{_style_preset_rule(style_preset)}\n"
        "Apply this style preset clearly in the final output. If an input image is provided, reverse-engineer the image content while rewriting the caption in this selected style. Preserve the user's subject and visible facts unless the user explicitly asks for a style transformation."
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
    if extra_rules and str(extra_rules).strip():
        system += "\n\nAdditional user rules:\n" + str(extra_rules).strip()
    prompt_text = str(prompt_input or "").strip()
    if image_data_url:
        instruction = prompt_text or "Reverse-engineer this image into a high-quality prompt following the selected output rules."
        user_content = [
            {"type": "text", "text": f"User request:\n{instruction}"},
            {"type": "image_url", "image_url": {"url": image_data_url}},
        ]
    else:
        user_content = f"User idea:\n{prompt_text}"
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


def _chat_completion(base_url, api_key, model, messages, temperature, max_tokens, seed=0):
    endpoint = _endpoint_from_base_url(base_url)
    if not endpoint:
        raise ValueError("NO8D-Prompt-plus: API base URL is empty")
    if not str(model or "").strip():
        raise ValueError("NO8D-Prompt-plus: model is empty")

    payload = {
        "model": str(model).strip(),
        "messages": messages,
        "temperature": _safe_float(temperature, 0.7),
        "max_tokens": _safe_int(max_tokens, 800),
    }
    seed = _safe_int(seed, 0)
    if seed:
        payload["seed"] = seed
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    key = _clean_key(api_key) or _clean_key(os.getenv("NO8D_PROMPT_API_KEY")) or _clean_key(os.getenv("OPENAI_API_KEY"))
    if key:
        headers["Authorization"] = f"Bearer {key}"
    request = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        hint = ""
        if "Model does not exist" in body or "model" in body.lower():
            hint = " Please open NO8D Prompt API Manager, validate the service again, and select an available model. Image reverse prompting also requires a vision-capable model."
        raise RuntimeError(f"NO8D-Prompt-plus: API HTTP {exc.code}: {body[:800]}{hint}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"NO8D-Prompt-plus: API request failed: {exc.reason}") from exc

    parsed = json.loads(raw)
    choices = parsed.get("choices") or []
    if not choices:
        raise RuntimeError("NO8D-Prompt-plus: API returned no choices")
    message = choices[0].get("message") or {}
    content = message.get("content") or choices[0].get("text") or ""
    if isinstance(content, list):
        content = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in content)
    if not str(content).strip():
        raise RuntimeError("NO8D-Prompt-plus: API returned empty content")
    return str(content)


def _max_tokens_for_length(length_preset):
    length_preset = _normalize_length_preset(length_preset)
    return _LENGTH_TOKEN_LIMITS.get(length_preset, _LENGTH_TOKEN_LIMITS["标准"])


def _api_key_fingerprint(api_key):
    key = _clean_key(api_key)
    if not key:
        return ""
    return hashlib.sha1(key.encode("utf-8")).hexdigest()


class NO8DPromptPlus:
    _cache = {}
    _last_by_node = {}

    @classmethod
    def INPUT_TYPES(cls):
        prompt_rule_names = prompt_config_manager.prompt_rule_names()
        prompt_rule_inputs = prompt_rule_names + [
            name for name in ("Natural language", "JSON structure") if name not in prompt_rule_names
        ]
        return {
            "required": {
                "prompt_rules": (prompt_rule_inputs, {"default": _RULE_NATURAL}),
                "style_preset": (_STYLE_PRESET_INPUTS, {"default": "专业摄影"}),
                "length_preset": (_LENGTH_PRESET_INPUTS, {"default": "标准"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "extra_rules": ("STRING", {"default": "", "multiline": True}),
            },
            "optional": {
                "text": ("STRING", {"forceInput": True}),
                "image": ("IMAGE",),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("positive",)
    FUNCTION = "run"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, prompt_rules, style_preset="专业摄影", length_preset="标准", seed=0, extra_rules="", text=None, image=None, unique_id=None):
        service, model_cfg = prompt_config_manager.current_service()
        effective_seed = _safe_int(seed, 0)
        image_data_url, image_hash = _image_to_data_url(image)
        prompt = str(text or "").strip()
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        style_preset = _normalize_style_preset(style_preset)
        length_preset = _normalize_length_preset(length_preset)
        payload = {
            "prompt": prompt,
            "prompt_rules": prompt_rule,
            "prompt_rule_text": prompt_config_manager.prompt_rule_text(prompt_rule),
            "style_preset": style_preset,
            "style_preset_rule": _style_preset_rule(style_preset),
            "length_preset": length_preset,
            "length_preset_rule": _LENGTH_PRESET_RULES.get(length_preset, _LENGTH_PRESET_RULES["标准"]),
            "service_id": service.get("id"),
            "api_base_url": service.get("base_url", ""),
            "model": model_cfg.get("name", ""),
            "api_key": _api_key_fingerprint(service.get("api_key", "")),
            "temperature": _safe_float(model_cfg.get("temperature"), 0.7),
            "seed": effective_seed,
            "extra_rules": extra_rules,
            "image": image_hash,
        }
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def run(self, prompt_rules, style_preset="专业摄影", length_preset="标准", seed=0, extra_rules="", text=None, image=None, unique_id=None):
        node_key = str(unique_id or "default")
        prompt = str(text or "").strip()
        image_data_url, image_hash = _image_to_data_url(image)
        if not prompt and not image_data_url:
            return ("",)

        service, model_cfg = prompt_config_manager.current_service()
        api_base_url = service.get("base_url", "")
        api_key = service.get("api_key", "") or os.getenv("NO8D_PROMPT_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
        model = model_cfg.get("name", "")
        temperature = _safe_float(model_cfg.get("temperature"), 0.7)
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        if prompt_rule not in prompt_config_manager.prompt_rule_names():
            prompt_rule = _RULE_NATURAL
        style_preset = _normalize_style_preset(style_preset)
        length_preset = _normalize_length_preset(length_preset)
        max_tokens = _max_tokens_for_length(length_preset)
        effective_seed = _safe_int(seed, 0)
        messages = _build_messages(prompt, prompt_rule, extra_rules, effective_seed, image_data_url, style_preset, length_preset)
        cache_payload = {
            "messages": _message_cache_text(messages),
            "service_id": service.get("id"),
            "base_url": api_base_url,
            "model": model,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "seed": effective_seed,
            "image": image_hash,
        }
        cache_key = hashlib.sha1(json.dumps(cache_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
        if cache_key in self._cache:
            result = self._cache[cache_key]
        else:
            raw = _chat_completion(api_base_url, api_key, model, messages, temperature, max_tokens, effective_seed)
            result = _clean_prompt_output(raw, prompt_rule)
            self._cache[cache_key] = result
            while len(self._cache) > 64:
                self._cache.pop(next(iter(self._cache)))

        self._last_by_node[node_key] = result
        return (result,)


class NO8DBatchPromptPlus:
    _cache = {}

    @classmethod
    def INPUT_TYPES(cls):
        prompt_rule_names = prompt_config_manager.prompt_rule_names()
        prompt_rule_inputs = prompt_rule_names + [
            name for name in ("Natural language", "JSON structure") if name not in prompt_rule_names
        ]
        return {
            "required": {
                "images": ("IMAGE",),
                "prompt_rules": (prompt_rule_inputs, {"default": _RULE_NATURAL}),
                "style_preset": (_STYLE_PRESET_INPUTS, {"default": "专业摄影"}),
                "length_preset": (_LENGTH_PRESET_INPUTS, {"default": "标准"}),
                "output_language": (_OUTPUT_LANGUAGE_INPUTS, {"default": "英文"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "extra_rules": ("STRING", {"default": "", "multiline": True}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("captions", "combined")
    OUTPUT_IS_LIST = (True, False)
    FUNCTION = "run"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, images, prompt_rules, style_preset="专业摄影", length_preset="标准", output_language="英文", seed=0, extra_rules=""):
        service, model_cfg = prompt_config_manager.current_service()
        encoded = _images_to_data_urls(images)
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        style_preset = _normalize_style_preset(style_preset)
        length_preset = _normalize_length_preset(length_preset)
        output_language = _normalize_output_language(output_language)
        payload = {
            "image_hashes": [image_hash for _, image_hash in encoded],
            "prompt_rules": prompt_rule,
            "prompt_rule_text": prompt_config_manager.prompt_rule_text(prompt_rule),
            "style_preset": style_preset,
            "style_preset_rule": _style_preset_rule(style_preset),
            "length_preset": length_preset,
            "length_preset_rule": _LENGTH_PRESET_RULES.get(length_preset, _LENGTH_PRESET_RULES["标准"]),
            "output_language": output_language,
            "service_id": service.get("id"),
            "api_base_url": service.get("base_url", ""),
            "model": model_cfg.get("name", ""),
            "api_key": _api_key_fingerprint(service.get("api_key", "")),
            "temperature": _safe_float(model_cfg.get("temperature"), 0.7),
            "seed": _safe_int(seed, 0),
            "extra_rules": extra_rules,
        }
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def run(self, images, prompt_rules, style_preset="专业摄影", length_preset="标准", output_language="英文", seed=0, extra_rules=""):
        encoded = _images_to_data_urls(images)
        if not encoded:
            return ([], "")

        service, model_cfg = prompt_config_manager.current_service()
        api_base_url = service.get("base_url", "")
        api_key = service.get("api_key", "") or os.getenv("NO8D_PROMPT_API_KEY") or os.getenv("OPENAI_API_KEY") or ""
        model = model_cfg.get("name", "")
        temperature = _safe_float(model_cfg.get("temperature"), 0.7)
        prompt_rule = prompt_config_manager.normalize_prompt_rule_name(prompt_rules)
        if prompt_rule not in prompt_config_manager.prompt_rule_names():
            prompt_rule = _RULE_NATURAL
        style_preset = _normalize_style_preset(style_preset)
        length_preset = _normalize_length_preset(length_preset)
        output_language = _normalize_output_language(output_language)
        max_tokens = _max_tokens_for_length(length_preset)
        base_seed = _safe_int(seed, 0)
        captions = []

        for index, (image_data_url, image_hash) in enumerate(encoded):
            effective_seed = base_seed + index if base_seed else 0
            instruction = f"Reverse-engineer image {index + 1} of {len(encoded)} into a high-quality prompt following the selected output rules."
            messages = _build_messages(instruction, prompt_rule, extra_rules, effective_seed, image_data_url, style_preset, length_preset, output_language)
            cache_payload = {
                "messages": _message_cache_text(messages),
                "service_id": service.get("id"),
                "base_url": api_base_url,
                "model": model,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "seed": effective_seed,
                "image": image_hash,
                "output_language": output_language,
            }
            cache_key = hashlib.sha1(json.dumps(cache_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()
            if cache_key in self._cache:
                result = self._cache[cache_key]
            else:
                raw = _chat_completion(api_base_url, api_key, model, messages, temperature, max_tokens, effective_seed)
                result = _clean_prompt_output(raw, prompt_rule)
                self._cache[cache_key] = result
                while len(self._cache) > 128:
                    self._cache.pop(next(iter(self._cache)))
            captions.append(result)

        combined = "\n\n".join(f"[{index + 1:03d}]\n{caption}" for index, caption in enumerate(captions))
        return (captions, combined)


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
                "unique_id": "UNIQUE_ID",
            }
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("positive",)
    FUNCTION = "view"
    OUTPUT_NODE = True
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, auto_output, edited_text, send_seq=0, text="", unique_id=None):
        auto = _safe_bool(auto_output, True)
        payload = {
            "text": text or "",
            "auto_output": auto,
            "edited_text": edited_text,
            "send_seq": _safe_int(send_seq, 0),
            "unique_id": unique_id,
        }
        if not auto:
            payload["manual_gate"] = time.time_ns()
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()

    def view(self, auto_output=True, edited_text="", send_seq=0, text="", unique_id=None):
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
        return {"ui": {"NO8DPromptView_text": [incoming], "NO8DPromptView_output": [ui_output]}, "result": (output,)}


NODE_CLASS_MAPPINGS = {
    "NO8DPromptPlus": NO8DPromptPlus,
    "NO8DBatchPromptPlus": NO8DBatchPromptPlus,
    "NO8DPromptView": NO8DPromptView,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "NO8DPromptPlus": "NO8D-Prompt-plus",
    "NO8DBatchPromptPlus": "NO8D-Batch-Prompt-plus",
    "NO8DPromptView": "NO8D-Prompt-view",
}
