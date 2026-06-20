from __future__ import annotations

import base64
import hashlib
import io
import json

import torch
import torch.nn.functional as F
from PIL import Image, ImageDraw

import comfy.samplers
import folder_paths
import nodes as comfy_nodes


def _hash_tensor_sample(h, tensor: torch.Tensor):
    flat = tensor.detach().to(torch.float32).flatten()
    n = min(flat.numel(), 1024)
    sample = flat[::max(1, flat.numel() // n)][:n]
    h.update(str(tuple(tensor.shape)).encode())
    h.update(sample.cpu().numpy().tobytes())


def _hash_value(h, value, depth=0):
    if depth > 8:
        h.update(b"<max-depth>")
        return
    if isinstance(value, torch.Tensor):
        h.update(b"<tensor>")
        _hash_tensor_sample(h, value)
    elif isinstance(value, dict):
        h.update(b"<dict>")
        for key in sorted(value.keys(), key=lambda x: str(x)):
            h.update(str(key).encode())
            _hash_value(h, value[key], depth + 1)
    elif isinstance(value, (list, tuple)):
        h.update(f"<seq:{len(value)}>".encode())
        for item in value:
            _hash_value(h, item, depth + 1)
    elif isinstance(value, (str, int, float, bool, type(None))):
        h.update(repr(value).encode())
    else:
        h.update(f"<{type(value).__name__}>".encode())


def _fingerprint(*values):
    h = hashlib.sha1()
    for value in values:
        _hash_value(h, value)
    return h.hexdigest()


def _safe_int(value, default=0):
    try:
        if value is None:
            return default
        text = str(value).strip()
        if not text or text.lower() == "none":
            return default
        return int(float(text))
    except Exception:
        return default


def _safe_float(value, default=0.0):
    try:
        if value is None:
            return default
        text = str(value).strip()
        if not text or text.lower() == "none":
            return default
        return float(text)
    except Exception:
        return default


def _safe_choice(value, choices, default):
    value = str(value)
    return value if value in choices else default


def _preview_or_result(image, refs_key, refs, result):
    if refs:
        return {"ui": {refs_key: refs}, "result": result}
    return {"result": result}


def _save_preview_image(image):
    previewer = comfy_nodes.PreviewImage()
    ui = previewer.save_images(image, filename_prefix="NO8DInpainting_preview")
    return ui["ui"]["images"]


def _image_ref_key(ref_json):
    try:
        ref = json.loads(ref_json or "")
    except (TypeError, ValueError):
        return ""
    return "/".join((
        str(ref.get("type", "output")),
        str(ref.get("subfolder", "")),
        str(ref.get("filename") or ref.get("name") or ""),
    ))


def _encode_history_image(vae, ref_json):
    import os
    import numpy as np
    from PIL import ImageOps

    ref = json.loads(ref_json)
    type_ = ref.get("type", "output")
    base_dir = (
        folder_paths.get_temp_directory() if type_ == "temp"
        else folder_paths.get_input_directory() if type_ == "input"
        else folder_paths.get_output_directory()
    )
    path = os.path.normpath(os.path.join(base_dir, ref.get("subfolder", ""), ref.get("filename", "")))
    if os.path.commonpath((base_dir, path)) != os.path.normpath(base_dir):
        raise ValueError("NO8D-Inpainting: invalid history image path")
    image = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    width = max(16, (image.width // 16) * 16)
    height = max(16, (image.height // 16) * 16)
    if image.size != (width, height):
        image = image.resize((width, height), Image.LANCZOS)
    pixels = torch.from_numpy(np.asarray(image, dtype=np.float32) / 255.0)[None, ...]
    return vae.encode(pixels)


def _remember_preview_latent(state, refs, latent):
    if not refs:
        return
    ref = refs[0]
    key = "/".join((
        str(ref.get("type", "output")),
        str(ref.get("subfolder", "")),
        str(ref.get("filename") or ref.get("name") or ""),
    ))
    latents = state.setdefault("latents_by_ref", {})
    latents[key] = latent
    while len(latents) > 20:
        del latents[next(iter(latents))]


def _empty_mask(latent, batch_size=None):
    b = int(batch_size or latent.shape[0])
    return torch.zeros((b, latent.shape[-2], latent.shape[-1]), device=latent.device, dtype=torch.float32)


def _blur_mask(mask, radius):
    radius = int(radius)
    if radius <= 0:
        return mask
    x = mask.unsqueeze(1)
    kernel = radius * 2 + 1
    for _ in range(2):
        x = F.avg_pool2d(x, kernel_size=kernel, stride=1, padding=radius)
    return x[:, 0].clamp(0.0, 1.0)


def _mask_from_png(data_url, image_w, image_h):
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    raw = base64.b64decode(data_url)
    return Image.open(io.BytesIO(raw)).convert("L").resize((image_w, image_h), Image.BILINEAR)


def _draw_mask_image(mask_data, image_w, image_h):
    img = Image.new("L", (image_w, image_h), 0)
    draw = ImageDraw.Draw(img)
    mode = str(mask_data.get("mode", ""))
    if mode == "brush" and mask_data.get("mask_png"):
        return _mask_from_png(str(mask_data["mask_png"]), image_w, image_h)

    shapes = mask_data.get("shapes") or ([mask_data] if mode == "geometry" else [])
    for item in shapes:
        if not isinstance(item, dict):
            continue
        fill = 0 if str(item.get("op", "add")) == "subtract" else 255
        shape = str(item.get("shape", mask_data.get("shape", "rectangle")))
        if shape == "circle":
            x = float(item.get("x", image_w / 2))
            y = float(item.get("y", image_h / 2))
            r = max(1.0, float(item.get("r", 96)))
            draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)
        elif shape == "lasso":
            pts = [(float(p[0]), float(p[1])) for p in item.get("points", []) if isinstance(p, list) and len(p) >= 2]
            if len(pts) > 2:
                draw.polygon(pts, fill=fill)
        else:
            x1 = float(item.get("x1", 0))
            y1 = float(item.get("y1", 0))
            x2 = float(item.get("x2", image_w))
            y2 = float(item.get("y2", image_h))
            draw.rectangle((min(x1, x2), min(y1, y2), max(x1, x2), max(y1, y2)), fill=fill)

    for stroke in mask_data.get("strokes", []):
        if not stroke:
            continue
        op = "add"
        points = stroke
        brush_size = _safe_float(mask_data.get("brush_size", 100), 100)
        if isinstance(stroke, dict):
            op = str(stroke.get("op", "add"))
            points = stroke.get("points", [])
            brush_size = _safe_float(stroke.get("brush_size", brush_size), brush_size)
        radius = max(1, brush_size / 2.0)
        fill = 0 if op == "subtract" else 255
        pts = [(float(p[0]), float(p[1])) for p in points if isinstance(p, list) and len(p) >= 2]
        if not pts:
            continue
        for x, y in pts:
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)
        if len(pts) > 1:
            draw.line(pts, fill=fill, width=max(1, int(radius * 2)), joint="curve")
    if bool(mask_data.get("invert", False)):
        img = Image.eval(img, lambda px: 255 - px)
    return img


def _latent_mask(mask_data_raw, latent, image_w, image_h, feather):
    if not str(mask_data_raw).strip():
        return _empty_mask(latent)
    try:
        mask_data = json.loads(mask_data_raw)
    except Exception:
        return _empty_mask(latent)
    image_w = max(1, int(image_w or latent.shape[-1] * 16))
    image_h = max(1, int(image_h or latent.shape[-2] * 16))
    mask_img = _draw_mask_image(mask_data, image_w, image_h)
    mask_tensor = torch.from_numpy(__import__("numpy").array(mask_img, dtype="float32") / 255.0)
    mask_tensor = mask_tensor.to(latent.device).unsqueeze(0).unsqueeze(0)
    mask_tensor = F.interpolate(mask_tensor, size=latent.shape[-2:], mode="bilinear", align_corners=False)[:, 0]
    latent_feather = max(0, round(float(feather) * latent.shape[-1] / image_w))
    if latent_feather > 0:
        hard_mask = mask_tensor
        blurred = _blur_mask(mask_tensor, latent_feather)
        mask_tensor = torch.maximum(hard_mask, blurred)
    mask_tensor = torch.where(mask_tensor < 0.001, torch.zeros_like(mask_tensor), mask_tensor)
    if latent.shape[0] > 1:
        mask_tensor = mask_tensor.repeat(latent.shape[0], 1, 1)
    return mask_tensor.clamp(0.0, 1.0)


class NO8DInpainting:
    def __init__(self):
        self._state = None

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "positive": ("CONDITIONING",),
                "negative": ("CONDITIONING",),
                "vae": ("VAE",),
                "latent": ("LATENT",),
                "steps": ("INT", {"default": 6, "min": 1, "max": 100}),
                "cfg": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 30.0, "step": 0.1}),
                "sampler_name": (comfy.samplers.KSampler.SAMPLERS, {"default": "euler"}),
                "scheduler": (comfy.samplers.KSampler.SCHEDULERS, {"default": "simple"}),
                "seed": ("INT", {"default": 0, "min": 0, "max": 0xFFFFFFFFFFFFFFFF, "control_after_generate": True}),
                "denoise": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0, "step": 0.05}),
                "feather": ("INT", {"default": 30, "min": 0, "max": 256, "step": 5}),
                "mask_mode": ("STRING", {"default": "none"}),
                "geometry_shape": ("STRING", {"default": "rectangle"}),
                "brush_size": ("STRING", {"default": "100"}),
                "mask_color": ("STRING", {"default": "#66ccff"}),
                "mask_data": ("STRING", {"default": "", "multiline": False}),
                "mask_seq": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
                "base_commit_seq": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
                "refresh_seq": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
                "image_w": ("STRING", {"default": "0"}),
                "image_h": ("STRING", {"default": "0"}),
                "history_image_ref": ("STRING", {"default": "", "multiline": False}),
                "history_select_seq": ("INT", {"default": 0, "min": 0, "max": 0x7FFFFFFF}),
            },
        }

    RETURN_TYPES = ("IMAGE", "LATENT", "MASK")
    RETURN_NAMES = ("image", "latent", "mask")
    FUNCTION = "run"
    OUTPUT_NODE = True
    CATEGORY = "NO8D-control"

    @classmethod
    def IS_CHANGED(cls, model, positive, negative, vae, latent, steps, cfg, sampler_name, scheduler,
                   seed, denoise, feather, mask_mode, geometry_shape, brush_size,
                   mask_color, mask_data, mask_seq, base_commit_seq, refresh_seq, image_w, image_h,
                   history_image_ref="", history_select_seq=0, *args, **kwargs):
        mask_mode = _safe_choice(mask_mode, {"none", "brush", "geometry"}, "none")
        return _fingerprint(
            str(id(model)), positive, negative, latent, _safe_int(seed),
            _safe_int(steps, 4), _safe_float(cfg, 1.0),
            sampler_name, scheduler, _safe_float(denoise, 1.0), _safe_int(feather, 30),
            mask_mode, mask_data, _safe_int(mask_seq), _safe_int(base_commit_seq), _safe_int(refresh_seq),
            _safe_int(image_w), _safe_int(image_h),
            history_image_ref, _safe_int(history_select_seq),
        )

    def run(self, model, positive, negative, vae, latent, steps, cfg, sampler_name, scheduler,
            seed, denoise, feather, mask_mode, geometry_shape,
            brush_size, mask_color, mask_data, mask_seq, base_commit_seq, refresh_seq,
            image_w, image_h, history_image_ref="", history_select_seq=0):
        incoming = latent["samples"]
        state = self._state
        steps = _safe_int(steps, 4)
        cfg = _safe_float(cfg, 1.0)
        denoise = max(0.0, min(1.0, _safe_float(denoise, 1.0)))
        feather = _safe_int(feather, 30)
        mask_mode = _safe_choice(mask_mode, {"none", "brush", "geometry"}, "none")
        mask_present = bool(str(mask_data).strip()) and str(mask_mode) != "none"
        seed = _safe_int(seed)
        image_w = _safe_int(image_w)
        image_h = _safe_int(image_h)
        mask_seq = _safe_int(mask_seq)
        base_commit_seq = _safe_int(base_commit_seq)
        model_fp = str(id(model))
        content_fp = _fingerprint(incoming, positive, negative)
        history_select_seq = _safe_int(history_select_seq)
        history_key = _image_ref_key(history_image_ref)
        history_changed = bool(history_key) and (
            state is None or history_select_seq != int(state.get("history_select_seq", 0))
        )
        selected_base = None
        if history_changed:
            selected_base = (state or {}).get("latents_by_ref", {}).get(history_key)
            if selected_base is None:
                selected_base = _encode_history_image(vae, history_image_ref)
        needs_base = (
            selected_base is None
            and (state is None
            or state.get("content_fp") != content_fp
            or int(refresh_seq) != int(state.get("refresh_seq", refresh_seq))
            or (
                not mask_present
                and (
                    int(state.get("global_seed", -1)) != seed
                    or state.get("model_fp") != model_fp
                )
            ))
        )
        if selected_base is not None:
            old_latents = (state or {}).get("latents_by_ref", {})
            base = selected_base
            state = {
                "base": base,
                "content_fp": content_fp,
                "model_fp": model_fp,
                "global_seed": seed,
                "refresh_seq": int(refresh_seq),
                "history_select_seq": history_select_seq,
                "base_commit_seq": base_commit_seq,
                "latents_by_ref": old_latents,
                "edit_fp": "",
                "edited": None,
                "edited_mask_seq": -1,
            }
            self._state = state
        elif needs_base:
            old_latents = (state or {}).get("latents_by_ref", {})
            base_input = dict(latent)
            base_input["samples"] = incoming
            base = comfy_nodes.common_ksampler(
                model, seed, steps, cfg, sampler_name, scheduler,
                positive, negative, base_input, denoise=1.0,
            )[0]["samples"]
            state = {
                "base": base,
                "content_fp": content_fp,
                "model_fp": model_fp,
                "global_seed": seed,
                "refresh_seq": int(refresh_seq),
                "history_select_seq": history_select_seq,
                "base_commit_seq": base_commit_seq,
                "latents_by_ref": old_latents,
                "edit_fp": "",
                "edited": None,
                "edited_mask_seq": -1,
            }
            self._state = state
        else:
            base = state["base"]

        if state is not None and base_commit_seq != int(state.get("base_commit_seq", base_commit_seq)):
            edited = state.get("edited")
            if edited is not None:
                base = edited
                state["base"] = base
                state["edit_fp"] = ""
                state["edited"] = None
                state["edited_mask_seq"] = -1
            state["base_commit_seq"] = base_commit_seq

        mask = _latent_mask(mask_data, base, image_w, image_h, feather)
        if not mask_present:
            image = vae.decode(base)
            refs = _save_preview_image(image)
            _remember_preview_latent(state, refs, base)
            return _preview_or_result(image, "NO8DInpainting_preview", refs, (image, {"samples": base}, mask))

        edit_fp = _fingerprint(
            base, model_fp, positive, negative, seed,
            steps, cfg, sampler_name, scheduler, denoise,
            feather, mask_mode, mask_data, mask_seq, image_w, image_h,
        )
        edited = state.get("edited") if state.get("edit_fp") == edit_fp else None
        if edited is None:
            edit_input = dict(latent)
            edit_input["samples"] = base
            edit_input["noise_mask"] = mask
            sampled = comfy_nodes.common_ksampler(
                model, seed, steps, cfg, sampler_name, scheduler,
                positive, negative, edit_input, denoise=denoise,
            )[0]["samples"]
            latent_mask = mask.unsqueeze(1)
            edited = sampled * latent_mask + base * (1.0 - latent_mask)
            state["edit_fp"] = edit_fp
            state["edited"] = edited
            state["edited_mask_seq"] = mask_seq
        image = vae.decode(edited)
        refs = _save_preview_image(image)
        _remember_preview_latent(state, refs, edited)
        return _preview_or_result(image, "NO8DInpainting_preview", refs, (image, {"samples": edited}, mask))


NODE_CLASS_MAPPINGS = {"NO8DInpainting": NO8DInpainting}
NODE_DISPLAY_NAME_MAPPINGS = {"NO8DInpainting": "NO8D-Inpainting"}
