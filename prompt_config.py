from __future__ import annotations

import json
import os
import tempfile

try:
    import folder_paths
except Exception:
    folder_paths = None


OLD_RULE_NATURAL = "Natural language (Krea-style)"
OLD_RULE_JSON = "JSON caption (Ideogram-style)"
RULE_NATURAL = "自然语言"
RULE_JSON = "json结构"
RULE_ALIASES = {
    "Natural language": RULE_NATURAL,
    "JSON structure": RULE_JSON,
    OLD_RULE_NATURAL: RULE_NATURAL,
    OLD_RULE_JSON: RULE_JSON,
}
PROMPT_RULE_MODES = {
    RULE_NATURAL: "natural",
    RULE_JSON: "json",
}


def preferred_vision_model(text_model, model_options):
    text_model = str(text_model or "").strip()
    options = [str(item or "").strip() for item in (model_options or []) if str(item or "").strip()]
    if text_model.endswith("-Thinking"):
        instruct = text_model[:-len("-Thinking")] + "-Instruct"
        if instruct in options:
            return instruct
    return text_model

LEGACY_CAMERA_TERMINOLOGY_RULE = '- Use photographic and cinematic terminology only when appropriate: 35mm lens, 85mm portrait lens, shallow depth of field, soft bokeh, rim light, golden hour, overcast daylight, tungsten glow, studio lighting, film grain, close-up, medium shot, wide shot, low angle, high angle.'
NEUTRAL_CAMERA_TERMINOLOGY_RULE = "- Use photographic and cinematic terminology only when appropriate and supported by the input: lens class, depth of field, bokeh, lighting, film grain, shot scale, and camera viewpoint. Do not default to any lens or viewing angle."

RECENT_DEFAULT_PROMPT_RULES = {
    RULE_JSON: """You are a scene composition assistant for structured JSON image captioning.
Given a user request or an input image, output a single valid JSON object that describes the scene in a structured, render-ready form.
Output JSON only: no prose, no markdown fences, no commentary, no labels, and no surrounding quotes.
Write all descriptive string values in the requested output language.

Input behavior:
- If the input is text, expand the user's idea into a structured image caption while preserving the user's original intent.
- If the input is an image, reverse-engineer the visible scene into the same JSON structure: describe the actual subjects, composition, lighting, medium, colors, background, and visible text from the image.
- If both text and image are provided, use the image as visual evidence and the text as user intent or correction.

Output format:
Return exactly one JSON object using this top-level key order:
{
  "high_level_description": "",
  "style_description": {
    "aesthetics": "",
    "lighting": "",
    "medium": "",
    "art_style": "",
    "color_palette": []
  },
  "compositional_deconstruction": {
    "background": "",
    "elements": [
      {
        "type": "obj",
        "bbox": [0, 0, 0, 0],
        "desc": "",
        "color_palette": []
      }
    ]
  }
}

Required top-level fields:
- `high_level_description`: one sentence or short paragraph summarizing the whole image: setting, time of day, main subjects, overall mood, and the user's core intent.
- `style_description`: a flat object describing how the image is rendered, independent of what it depicts.
- `compositional_deconstruction`: a required object containing `background` before `elements`.

style_description field rules:
- `aesthetics`: overall visual style and treatment, such as clean product photography, moody cinematic realism, flat vector illustration, glossy 3D render, watercolor, anime key art, or editorial poster design.
- `lighting`: light source, direction, quality, contrast, and color temperature.
- `medium`: the medium category, such as photography, oil painting, digital illustration, 3D render, watercolor, flat vector design, collage, or poster design.
- `art_style`: required rendering-style description. For photographic images, include camera/lens/film/depth-of-field/photo-specific language here. For non-photographic images, include the artistic rendering style, such as flat vector design, generous whitespace, sans-serif typography, cel shading, hand-painted watercolor, or glossy 3D toy render.
- `color_palette`: 3-6 dominant colors of the overall image as uppercase hex codes in `#RRGGBB` form.
- Always preserve this key order: `aesthetics`, `lighting`, `medium`, `art_style`, `color_palette`.

compositional_deconstruction.background:
- Describe only the environment behind and around the subjects: setting, surface, atmosphere, depth cues, and broad spatial context.
- Do not describe any subject or object that is listed in `elements`.

compositional_deconstruction.elements:
- For standard-length output, use 1-6 elements. For detailed output, use 3-9 elements. Use at least 1 element.
- List elements roughly background-to-foreground.
- Use deliberate placement and varied depth. Avoid centering every element.
- Bounding boxes must match the prose: an element described as midground left should have smaller x values than one described as right.
- Keep `style_description`, `background`, and each element's `desc` mutually consistent in palette, lighting, and atmosphere.
- Each element's `color_palette` should be plausibly drawn from, or harmonious with, the overall `style_description.color_palette`.

Structured element shapes:
- Object element key order: `{"type":"obj","bbox":[y_min,x_min,y_max,x_max],"desc":"","color_palette":[]}`
- Text element key order: `{"type":"text","bbox":[y_min,x_min,y_max,x_max],"text":"","desc":"","color_palette":[]}`
- `bbox` is required for every element. `color_palette` is required for every element.

Element field rules:
- `type`: use `"obj"` for people, animals, objects, props, environmental features, or visual subjects. Use `"text"` only when the user requests visible text, signage, labels, typography, posters, UI text, or quoted words.
- `bbox`: required four integers on a normalized 1000 x 1000 canvas, origin at the top-left, in `[y_min, x_min, y_max, x_max]` order. It must satisfy `0 <= y_min < y_max <= 1000` and `0 <= x_min < x_max <= 1000`.
- `desc`: identity, pose, orientation, location in frame, relative size, key visual details, textures, markings, gaze or motion, and light interaction specific to this element. Do not restate global background or style information.
- `text`: for `type:"text"` only. Use the exact visible text requested by the user.
- `color_palette`: 2-5 dominant colors of this element as uppercase hex codes in `#RRGGBB` form.

Hard constraints:
- Preserve the user's original subject, count, action, style request, medium request, visible text, and spatial intent.
- Do not add new characters, animals, logos, brands, written text, or major props unless the user clearly states or strongly implies them.
- Do not create unknown keys such as `name`, `label`, `prompt`, `caption`, `objects`, `scene`, `foreground`, `camera`, `lens`, `negative`, or `metadata`.
- Do not use `[x_min,y_min,x_max,y_max]`; always use `[y_min,x_min,y_max,x_max]`.
- Do not create a `photo` key. Put photographic camera, lens, film, aperture, and depth-of-field language into `art_style`.
- Output valid JSON only. Prefer readable pretty JSON formatting.""",
}


def _looks_like_old_builtin_rule(rule_name, text):
    text = str(text or "")
    if rule_name == RULE_NATURAL:
        return (
            text.startswith("Expand the user's short idea into one rich positive prompt")
            or "Krea2-style natural-language prompting" in text
            or "Krea 2" in text
            or "Krea's aesthetic potential" in text
            or "one richly evocative English positive prompt" in text
            or "Use fluent, common, modern English" in text
            or "Keep the final prompt between 90 and 180 English words" in text
            or "standard output should stay around 120-240 tokens, and detailed output should stay around 240-480 tokens" in text
            or "Follow the node's selected token length preset" in text
        )
    if rule_name == RULE_JSON:
        return (
            text.startswith("Expand the user's short idea into a structured JSON caption string")
            or text.startswith("Expand the user's short idea into an Ideogram 4 structured JSON caption string")
            or text.startswith("You are a scene composition assistant for Ideogram 4 structured JSON captioning")
            or "Official Ideogram 4" in text
            or "Ideogram examples" in text
            or "Write all descriptive string values in fluent, common, modern English" in text
            or "For photographic outputs, preserve this key order" in text
            or "`photo`: camera, lens, film" in text
        )
    return False


def _migrate_builtin_rule_text(rule_name, text):
    text = str(text or "")
    if rule_name == RULE_NATURAL:
        return text.replace(LEGACY_CAMERA_TERMINOLOGY_RULE, NEUTRAL_CAMERA_TERMINOLOGY_RULE)
    return text

DEFAULT_PROMPT_RULES = {
    RULE_NATURAL: """You are an expert prompt engineer specializing in expanding user descriptions and reverse-engineering images into highly effective natural-language image prompts.

Objective:
Transform the user's brief description, detailed description, or input image into one richly evocative positive prompt in the requested output language while remaining faithful to the user's original intent and the visible evidence.

Input behavior:
- If the input is text, expand the user's idea into a richer prompt without changing its core meaning.
- If the input is an image, reverse-engineer the visible scene into a prompt: identify the main subjects, action, setting, composition, viewpoint, lighting, color palette, medium, mood, textures, and any visible text.
- If both text and image are provided, use the image as visual evidence and the text as user intent, correction, or emphasis.
- Do not describe hidden facts, identities, backstory, brands, or text that are not visible or explicitly provided.

Internal thinking process, do not output:
1. Identify the core subject, action, setting, spatial relationships, mood, and any explicit constraints.
2. Decide the most suitable visual style, medium, lighting, composition, framing, and level of detail for the user's idea.
3. Add grounded, model-friendly details that clarify the scene without changing its meaning.
4. Choose textures, materials, atmosphere, and camera or design language only when they fit the requested medium.

Core principles:
- Faithfulness first. Preserve all original subjects, actions, quantities, colors, style requests, medium requests, and spatial relationships.
- Do not add new objects, props, characters, animals, logos, brands, text, or narrative events unless the user clearly states or strongly implies them.
- Avoid over-specification. Do not invent highly specific clothing, colors, ages, identities, locations, materials, or scene details when the input does not support them.
- If the user's prompt is already detailed, lightly polish and clarify it rather than heavily expanding it.
- Respect the user's medium. If the user asks for a photo, illustration, painting, sketch, anime, 3D render, product render, poster, graphic design, collage, or typography layout, honor that medium.
- When no medium is specified, infer the best medium from the subject instead of defaulting everything to cinematic photography.
- Treat depictions of people with dignity and respect. Do not sexualize minors.

Natural-language prompt optimization:
- Write flowing, descriptive sentences, never comma-separated tag soup such as "masterpiece, best quality, 8k".
- Use fluent, common, modern phrasing in the requested output language. Avoid archaic phrasing, poetic old-fashioned wording, textbook-style language, machine-translation phrasing, and overly academic wording.
- Group subjects with their own attributes and actions so poses, interactions, and spatial layout are clear.
- Add relevant sensory and visual details: materials, surfaces, fabric, texture, atmosphere, color temperature, lighting quality, foreground/background, composition, viewpoint, depth, mood, and style.
- Use photographic and cinematic terminology only when appropriate and supported by the input: lens class, depth of field, bokeh, lighting, film grain, shot scale, and camera viewpoint. Do not default to any lens or viewing angle.
- Use non-photographic terminology when appropriate: cel shading, ink linework, flat vector shapes, paper grain, impasto brushstrokes, airbrush gradients, clay render, vinyl texture, clean geometric layout, editorial typography, generous whitespace.
- For style hints such as Fuji, film, retro, vintage, portrait, Hong Kong neon, anime, 3D toy, collage, graphic design, or product render, add concise style-specific details without overriding the user's subject.
- If visible text, signage, labels, quotes, UI text, or typography are requested, include the exact requested text in quotation marks.

Strict output rules:
1. Output only the final positive prompt.
2. Start directly with the image description.
3. Write one cohesive paragraph.
4. Do not output explanations, markdown, bullets, JSON, labels, negative prompts, parameter syntax, or thinking tags.""",
    RULE_JSON: RECENT_DEFAULT_PROMPT_RULES[RULE_JSON],
}


def _default_base_dir():
    if folder_paths is not None:
        try:
            user_dir = folder_paths.get_user_directory()
            if user_dir:
                return os.path.join(user_dir, "default", "no8d-control")
        except Exception:
            pass
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "config")


class PromptConfigManager:
    def __init__(self):
        self.base_dir = _default_base_dir()
        self.config_dir = os.path.join(self.base_dir, "config")
        self.config_path = os.path.join(self.config_dir, "prompt_api.json")
        os.makedirs(self.config_dir, exist_ok=True)
        self.default_config = {
            "version": 1,
            "current_service": "openai",
            "prompt_rules": DEFAULT_PROMPT_RULES.copy(),
            "prompt_rule_modes": PROMPT_RULE_MODES.copy(),
            "services": [
                {
                    "id": "openai",
                    "name": "OpenAI",
                    "type": "openai_compatible",
                    "base_url": "https://api.openai.com/v1",
                    "api_key": "",
                    "models": [
                        {
                            "name": "",
                            "is_default": True,
                        }
                    ],
                }
            ],
        }
        self.ensure_config()

    def ensure_config(self):
        if os.path.exists(self.config_path):
            return
        self.save_config(self.default_config)

    def normalize_config(self, data):
        if not isinstance(data, dict):
            return self.default_config.copy(), False
        changed = False
        data.setdefault("version", 1)
        data.setdefault("current_service", "openai")
        rules = data.setdefault("prompt_rules", {})
        old_rule_values = {}
        for old_name, new_name in ((OLD_RULE_NATURAL, RULE_NATURAL), (OLD_RULE_JSON, RULE_JSON)):
            if old_name in rules:
                old_value = rules.get(old_name)
                current_value = rules.get(new_name)
                if not str(current_value or "").strip() or _looks_like_old_builtin_rule(new_name, current_value):
                    rules[new_name] = old_value
                    old_rule_values[new_name] = old_value
                rules.pop(old_name, None)
                changed = True
        for rule_name, rule_text in list(rules.items()):
            migrated_text = _migrate_builtin_rule_text(rule_name, rule_text)
            if migrated_text != rule_text:
                rules[rule_name] = migrated_text
                changed = True
        modes = data.setdefault("prompt_rule_modes", {})
        for old_name, new_name in ((OLD_RULE_NATURAL, RULE_NATURAL), (OLD_RULE_JSON, RULE_JSON)):
            if old_name in modes:
                if new_name not in modes:
                    modes[new_name] = modes[old_name]
                modes.pop(old_name, None)
                changed = True
        for key, value in DEFAULT_PROMPT_RULES.items():
            saved_rule = rules.get(key)
            if not str(saved_rule or "").strip() or _looks_like_old_builtin_rule(key, saved_rule) or old_rule_values.get(key) == saved_rule:
                if rules.get(key) != value:
                    rules[key] = value
                    changed = True
            elif key not in rules:
                rules[key] = value
                changed = True
        for key, value in PROMPT_RULE_MODES.items():
            if modes.get(key) != value and key not in modes:
                modes[key] = value
                changed = True
            else:
                modes.setdefault(key, value)
        services = data.setdefault("services", [])
        for service in services:
            if not isinstance(service, dict):
                continue
            service.setdefault("type", "openai_compatible")
            service.setdefault("models", [])
            service.setdefault("model_options", [])
            if "vision_model" not in service or not str(service.get("vision_model") or "").strip():
                models = service.get("models") or []
                selected = next((item for item in models if item.get("is_default")), None)
                if selected is None and models:
                    selected = models[0]
                text_model = (selected or {}).get("name", "")
                preferred = preferred_vision_model(text_model, service.get("model_options"))
                if "vision_model" not in service or preferred:
                    service["vision_model"] = preferred
                    changed = True
            if service.get("type") == "ollama" and not str(service.get("base_url") or "").strip():
                service["base_url"] = "http://localhost:11434"
                changed = True
        return data, changed

    def load_config(self):
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            data, changed = self.normalize_config(data)
            if changed:
                self.save_config(data)
            return data
        except Exception:
            return self.default_config.copy()

    def save_config(self, config):
        os.makedirs(self.config_dir, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(prefix=".prompt_api_", suffix=".tmp", dir=self.config_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.config_path)
            return True
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except Exception:
                    pass

    def masked_config(self):
        config = self.load_config()
        masked = json.loads(json.dumps(config, ensure_ascii=False))
        for service in masked.get("services", []):
            key = service.get("api_key", "")
            service["api_key_exists"] = bool(key)
            service["api_key_masked"] = self.mask_api_key(key)
            service.pop("api_key", None)
        return masked

    @staticmethod
    def mask_api_key(api_key):
        if not api_key:
            return ""
        api_key = str(api_key)
        if len(api_key) <= 10:
            return "***"
        return f"{api_key[:6]}***{api_key[-4:]}"

    def upsert_service(self, service):
        config = self.load_config()
        service = dict(service or {})
        service_id = str(service.get("id") or "").strip()
        if not service_id:
            service_id = "custom"
        service["id"] = service_id
        service.setdefault("name", service_id)
        service.setdefault("type", "openai_compatible")
        service.setdefault("base_url", "")
        if service.get("type") == "ollama" and not str(service.get("base_url") or "").strip():
            service["base_url"] = "http://localhost:11434"
        service.setdefault("models", [])
        service.setdefault("model_options", [])
        service.setdefault("vision_model", "")

        services = config.setdefault("services", [])
        for idx, existing in enumerate(services):
            if existing.get("id") == service_id:
                if "api_key" not in service:
                    service["api_key"] = existing.get("api_key", "")
                services[idx] = service
                break
        else:
            services.append(service)
        config.setdefault("current_service", service_id)
        self.save_config(config)
        return service_id

    def set_current_service(self, service_id):
        config = self.load_config()
        ids = {service.get("id") for service in config.get("services", [])}
        if service_id not in ids:
            raise ValueError(f"NO8D-Prompt API service not found: {service_id}")
        config["current_service"] = service_id
        self.save_config(config)

    def current_service(self):
        config = self.load_config()
        services = config.get("services", [])
        current_id = config.get("current_service")
        service = next((item for item in services if item.get("id") == current_id), None)
        if service is None and services:
            service = services[0]
        if service is None:
            raise ValueError("NO8D-Prompt: no API service is configured")
        models = service.get("models") or []
        model = next((item for item in models if item.get("is_default")), None)
        if model is None and models:
            model = models[0]
        if model is None:
            model = {"name": ""}
        return service, model

    def normalize_prompt_rule_name(self, rule_name):
        name = str(rule_name or "").strip()
        return RULE_ALIASES.get(name, name)

    def prompt_rule_text(self, rule_name):
        rule_name = self.normalize_prompt_rule_name(rule_name)
        config = self.load_config()
        rules = config.get("prompt_rules") or {}
        text = rules.get(rule_name) or DEFAULT_PROMPT_RULES.get(rule_name) or ""
        return str(text).strip()

    def prompt_rule_mode(self, rule_name):
        rule_name = self.normalize_prompt_rule_name(rule_name)
        config = self.load_config()
        modes = config.get("prompt_rule_modes") or {}
        mode = str(modes.get(rule_name) or PROMPT_RULE_MODES.get(rule_name) or "natural").strip().lower()
        return "json" if mode == "json" else "natural"

    def prompt_rule_names(self):
        config = self.load_config()
        names = []
        for name in DEFAULT_PROMPT_RULES:
            names.append(name)
        for name in (config.get("prompt_rules") or {}):
            if name not in names:
                names.append(name)
        return names


prompt_config_manager = PromptConfigManager()
