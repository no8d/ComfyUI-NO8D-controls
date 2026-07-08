from __future__ import annotations

import hashlib
import json
import math

import comfy.sd
import comfy.utils
import folder_paths


_NO_LORA = "None"
_WEIGHT_EPSILON = 0.000001


def _lora_names():
    return [_NO_LORA] + folder_paths.get_filename_list("loras")


def _parse_entries(stack_json):
    try:
        entries = json.loads(stack_json or "[]")
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("NO8D-LoRA stack: stack data is not valid JSON") from exc
    if not isinstance(entries, list):
        raise ValueError("NO8D-LoRA stack: stack data must be a list")
    return entries


def _effective_entry_signature(entries):
    signature = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        enabled = bool(entry.get("enabled", True))
        name = str(entry.get("name", _NO_LORA))
        try:
            weight = float(entry.get("weight", 0.0))
        except (TypeError, ValueError):
            weight = 0.0
        if not enabled:
            signature.append({"enabled": False})
        elif name == _NO_LORA:
            signature.append({"enabled": True, "name": _NO_LORA})
        elif abs(weight) <= _WEIGHT_EPSILON:
            signature.append({"enabled": True, "name": name, "weight": 0.0})
        else:
            signature.append(
                {
                    "enabled": True,
                    "name": name,
                    "weight": round(weight, 6),
                    "trigger": str(entry.get("trigger", "")).strip(),
                }
            )
    return signature


def _trigger_words_from_entries(validated_entries):
    triggers = []
    seen = set()
    for enabled, name, weight, _path, _index, trigger in validated_entries:
        if not enabled or name == _NO_LORA or abs(weight) <= _WEIGHT_EPSILON:
            continue
        trigger = str(trigger or "").strip()
        if not trigger:
            continue
        key = trigger.casefold()
        if key in seen:
            continue
        seen.add(key)
        triggers.append(trigger)
    return ", ".join(triggers)


class NO8DLoraStack:
    def __init__(self):
        self._loaded_loras = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "lora_picker": (_lora_names(),),
                "stack_json": ("STRING", {"default": "[]", "multiline": True}),
            }
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "trigger_words")
    FUNCTION = "run"
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, model, lora_picker, stack_json):
        entries = _parse_entries(stack_json)
        h = hashlib.sha1()
        h.update(str(id(model)).encode())
        h.update(
            json.dumps(
                _effective_entry_signature(entries),
                ensure_ascii=False,
                sort_keys=True,
            ).encode("utf-8")
        )
        return h.hexdigest()

    def run(self, model, lora_picker, stack_json):
        entries = _parse_entries(stack_json)

        retained_paths = set()
        validated_entries = []
        for index, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise ValueError(f"NO8D-LoRA stack: entry {index + 1} must be an object")
            name = str(entry.get("name", _NO_LORA))
            try:
                weight = float(entry.get("weight", 0.0))
            except (TypeError, ValueError) as exc:
                raise ValueError(
                    f"NO8D-LoRA stack: invalid weight for entry {index + 1} ({name})"
                ) from exc
            if not math.isfinite(weight):
                raise ValueError(
                    f"NO8D-LoRA stack: weight must be finite for entry {index + 1} ({name})"
                )
            path = None
            if name != _NO_LORA:
                path = folder_paths.get_full_path("loras", name)
                if path is not None:
                    retained_paths.add(path)
            trigger = str(entry.get("trigger", "")).strip()
            validated_entries.append((bool(entry.get("enabled", True)), name, weight, path, index, trigger))

        for enabled, name, weight, path, index, _trigger in validated_entries:
            if not enabled:
                continue
            if name == _NO_LORA or abs(weight) <= _WEIGHT_EPSILON:
                continue
            if path is None:
                raise FileNotFoundError(
                    f"NO8D-LoRA stack: LoRA file not found for entry {index + 1}: {name}"
                )
            lora = self._loaded_loras.get(path)
            if lora is None:
                lora = comfy.utils.load_torch_file(path, safe_load=True)
                self._loaded_loras[path] = lora
            model, _ = comfy.sd.load_lora_for_models(model, None, lora, weight, 0.0)

        self._loaded_loras = {
            path: lora for path, lora in self._loaded_loras.items()
            if path in retained_paths
        }
        return (model, _trigger_words_from_entries(validated_entries))


NODE_CLASS_MAPPINGS = {"NO8DLoraStack": NO8DLoraStack}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DLoraStack": "NO8D-LoRA stack"}
