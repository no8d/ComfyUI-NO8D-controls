import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { isComfySpaceDown, passMouseToComfy } from "./no8d_comfy_events.js";
import { t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DInpainting";
const LITE_MIN_WIDTH = 920;
const LITE_MIN_HEIGHT = 560;
const LITE_HISTORY_LIMIT = 8;
const BRUSH_SIZE_SCALE = 10;
const DEFAULT_BRUSH_SIZE = 100;
const DEFAULT_MASK_COLOR = "#66ccff";

const litePassThroughStyle = document.createElement("style");
litePassThroughStyle.textContent = `
    .dom-widget.no8d-lite-widget { pointer-events: none !important; }
    .no8d-lite-control { pointer-events: auto; }
`;
document.head.appendChild(litePassThroughStyle);

function findWidget(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function setWidget(widget, value) {
    if (!widget) return;
    widget.value = value;
    try {
        if (typeof widget.callback === "function") {
            widget.callback(value, app.canvas, widget.node || null);
        }
    } catch (_) {}
}

function setInteractive(el, enabled = true) {
    if (!el) return;
    el.style.pointerEvents = enabled ? "auto" : "none";
    el.classList.toggle("no8d-lite-control", enabled);
}

function shouldDrawLiteMask(node, event) {
    if (event.button !== 0 || isComfySpaceDown() || event.ctrlKey || event.metaKey) return false;
    return activeLiteMaskMode(node) !== "none" && !!imagePoint(node, event);
}

function makeViewUrl(ref) {
    const params = new URLSearchParams();
    params.set("filename", ref.filename);
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    if (ref.type) params.set("type", ref.type);
    return `/view?${params.toString()}`;
}

function loadImage(ref) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = makeViewUrl(ref);
    });
}

function isImageRefArray(value) {
    return Array.isArray(value) && value.some((item) => item?.filename);
}

function extractLiteRefs(message) {
    if (!message) return [];
    if (isImageRefArray(message.NO8DInpainting_preview)) return message.NO8DInpainting_preview;
    if (isImageRefArray(message.images)) return message.images;
    if (isImageRefArray(message.ui?.NO8DInpainting_preview)) return message.ui.NO8DInpainting_preview;
    if (isImageRefArray(message.output?.NO8DInpainting_preview)) return message.output.NO8DInpainting_preview;
    for (const value of Object.values(message || {})) {
        if (isImageRefArray(value)) return value;
        if (value && typeof value === "object") {
            const nested = extractLiteRefs(value);
            if (nested.length) return nested;
        }
    }
    return [];
}

function cloneImageRef(ref) {
    if (!ref?.filename) return null;
    return {
        filename: ref.filename,
        subfolder: ref.subfolder || "",
        type: ref.type || "output",
    };
}

function setHistoryImageRef(node, ref, incrementSelection = false) {
    setWidget(findWidget(node, "history_image_ref"), ref ? JSON.stringify(cloneImageRef(ref)) : "");
    if (incrementSelection) {
        const seq = findWidget(node, "history_select_seq");
        setWidget(seq, ((Number(seq?.value) || 0) + 1) & 0x7fffffff);
    }
}

function imageKey(ref) {
    return `${ref.type || ""}/${ref.subfolder || ""}/${ref.filename || ""}`;
}

async function loadComfyHistoryImages(limit = LITE_HISTORY_LIMIT) {
    try {
        const response = await api.fetchApi("/history");
        if (!response.ok) return [];
        const history = await response.json();
        const items = [];
        for (const entry of Object.values(history || {})) {
            for (const output of Object.values(entry?.outputs || {})) {
                for (const img of output?.images || []) {
                    if (img?.filename) items.push(img);
                }
            }
        }
        const seen = new Set();
        return items.filter((ref) => {
            const key = imageKey(ref);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).slice(-limit);
    } catch (_) {
        return [];
    }
}

function row() {
    const el = document.createElement("div");
    el.style.cssText = "display:flex; align-items:center; column-gap:20px; row-gap:10px; flex-wrap:wrap; padding:7px 12px; border-bottom:1px solid #333;";
    el.style.pointerEvents = "none";
    return el;
}

function button(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cursor = "pointer";
    b.style.height = "32px";
    b.style.boxSizing = "border-box";
    b.style.margin = "0";
    b.style.padding = "4px 12px";
    b.style.fontWeight = "600";
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    setInteractive(b);
    return b;
}

function iconButton(icon, title, onClick) {
    const b = button(icon, onClick);
    b.title = title;
    b.style.width = "38px";
    b.style.minWidth = "38px";
    b.style.height = "32px";
    b.style.padding = "0";
    b.style.display = "inline-flex";
    b.style.alignItems = "center";
    b.style.justifyContent = "center";
    b.style.lineHeight = "1";
    b.style.fontSize = "20px";
    b.style.fontWeight = "700";
    return b;
}

function controlGroup(...children) {
    const group = document.createElement("span");
    group.style.cssText = "display:inline-flex; align-items:center; gap:10px; height:32px; white-space:nowrap; flex:0 0 auto;";
    group.append(...children);
    setInteractive(group);
    return group;
}

function labelText(label) {
    const span = document.createElement("span");
    span.textContent = label;
    span.style.cssText = "display:inline-block; line-height:28px; flex:0 0 auto;";
    return span;
}

function number(label, opts, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex; align-items:center; gap:10px; height:32px; white-space:nowrap; flex:0 0 auto;";
    wrap.appendChild(labelText(label));
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(opts.min ?? 0);
    input.max = String(opts.max ?? 999999);
    input.step = String(opts.step ?? 1);
    input.style.width = `${opts.width || 64}px`;
    input.style.height = "28px";
    input.style.boxSizing = "border-box";
    input.style.margin = "0";
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("focus", () => input.select());
    const commit = () => {
        let v = parseFloat(input.value);
        if (!Number.isFinite(v)) v = opts.min ?? 0;
        v = Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v));
        input.value = String(v);
        onChange(v);
    };
    input.addEventListener("input", () => {
        const v = parseFloat(input.value);
        if (Number.isFinite(v)) {
            onChange(Math.max(opts.min ?? -Infinity, Math.min(opts.max ?? Infinity, v)));
        }
    });
    input.addEventListener("change", commit);
    wrap.appendChild(input);
    wrap._input = input;
    wrap._label = wrap.firstChild;
    setInteractive(wrap);
    return wrap;
}

function select(label, options, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex; align-items:center; gap:0; height:32px; white-space:nowrap; flex:0 0 auto;";
    const labelNode = labelText(label);
    wrap.appendChild(labelNode);
    const spacer = document.createElement("span");
    spacer.style.cssText = "display:inline-block; width:10px; min-width:10px; height:1px; flex:0 0 10px;";
    wrap.appendChild(spacer);
    const sel = document.createElement("select");
    sel.style.height = "28px";
    sel.style.minWidth = "116px";
    sel.style.boxSizing = "border-box";
    sel.style.margin = "0";
    for (const option of options) {
        const o = document.createElement("option");
        if (typeof option === "object") {
            o.value = option.value;
            o.textContent = option.label;
        } else {
            o.value = option;
            o.textContent = option;
        }
        sel.appendChild(o);
    }
    sel.addEventListener("pointerdown", (e) => e.stopPropagation());
    sel.addEventListener("change", () => onChange(sel.value));
    wrap.appendChild(sel);
    wrap._select = sel;
    wrap._labelNode = labelNode;
    wrap._spacer = spacer;
    setInteractive(wrap);
    return wrap;
}

function colorInput(label, onChange) {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:inline-flex; align-items:center; gap:10px; height:32px; white-space:nowrap; flex:0 0 auto;";
    wrap.appendChild(labelText(label));
    const input = document.createElement("input");
    input.type = "color";
    input.style.width = "48px";
    input.style.height = "28px";
    input.style.boxSizing = "border-box";
    input.style.margin = "0";
    input.style.padding = "0";
    input.addEventListener("pointerdown", (e) => e.stopPropagation());
    input.addEventListener("input", () => onChange(input.value));
    wrap.appendChild(input);
    wrap._input = input;
    setInteractive(wrap);
    return wrap;
}

function seedWidget(node) {
    return findWidget(node, "seed");
}

function seedControlWidget(node) {
    return (node.widgets || []).find((w) => typeof w.name === "string" && /control_after_generate/i.test(w.name));
}

function seedControlOptions(widget) {
    return widget?.options?.values || ["fixed", "increment", "decrement", "randomize"];
}

function syncSeedLockButton(node) {
    const button = node?._liteSeedLock;
    const widget = seedControlWidget(node);
    if (!button || !widget) return;
    const locked = String(widget.value || "randomize") === "fixed";
    button.textContent = locked ? "🔒" : "🔓";
    button.title = locked ? "Seed locked" : "Seed randomize";
    button.style.borderColor = locked ? "#3b82f6" : "#555";
    button.style.color = locked ? "#bfdbfe" : "#ddd";
    button.style.background = locked ? "#102b4f" : "#242424";
}

function syncLiteSeedControls(node) {
    syncInput(node?._liteSeed, seedWidget(node)?.value);
    syncSeedLockButton(node);
}

function wrapLiteSeedWidgetCallback(node, widget) {
    if (!node || !widget || widget._no8dLiteSeedCallbackWrapped) return;
    const original = widget.callback;
    widget.callback = function () {
        const returned = original?.apply(this, arguments);
        requestAnimationFrame(() => syncLiteSeedControls(node));
        return returned;
    };
    widget._no8dLiteSeedCallbackWrapped = true;
}

function watchLiteSeedWidgets(node) {
    wrapLiteSeedWidgetCallback(node, seedWidget(node));
    wrapLiteSeedWidgetCallback(node, seedControlWidget(node));
}

function hideNativeWidgets(node) {
    const visibleThroughDom = new Set([
        "steps", "cfg", "sampler_name", "scheduler", "seed", "seed_control", "seed_control_timing",
        "denoise", "feather", "mask_mode", "geometry_shape",
        "brush_size", "mask_color", "mask_data", "mask_seq",
        "base_commit_seq", "refresh_seq", "image_w", "image_h",
        "history_image_ref", "history_select_seq",
    ]);
    for (const w of node.widgets || []) {
        const isAutoControl = typeof w.name === "string" && /control_after_generate/i.test(w.name);
        if (!visibleThroughDom.has(w.name) && !isAutoControl) continue;
        if (["mask_data", "mask_seq", "base_commit_seq", "refresh_seq", "image_w", "image_h", "history_image_ref", "history_select_seq"].includes(w.name)) {
            w.serialize = false;
        }
        w.options = w.options || {};
        w.options.hidden = true;
        w.options.collapsed = true;
        w.type = "converted-widget";
        w.hidden = true;
        w.computeSize = () => [0, -4];
        w.draw = () => {};
    }
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function syncInput(wrap, value) {
    if (wrap?._input && value != null) wrap._input.value = String(value);
}

function syncSelect(wrap, value) {
    if (wrap?._select && value != null) wrap._select.value = String(value);
}

function scheduleDraw(node) {
    if (!node || node._liteDrawQueued) return;
    node._liteDrawQueued = true;
    requestAnimationFrame(() => {
        node._liteDrawQueued = false;
        draw(node);
    });
}

function maskPayload(node) {
    const mode = findWidget(node, "mask_mode")?.value || "none";
    const shape = findWidget(node, "geometry_shape")?.value || "rectangle";
    const payload = node._liteMask || { mode, strokes: [], shapes: [] };
    payload.mode = mode;
    payload.shape = shape;
    payload.brush_size = Number(findWidget(node, "brush_size")?.value || DEFAULT_BRUSH_SIZE);
    return payload;
}

function cloneMaskPayload(payload) {
    try {
        return JSON.parse(JSON.stringify(payload || { mode: "none", strokes: [], shapes: [] }));
    } catch (_) {
        return { mode: "none", strokes: [], shapes: [] };
    }
}

function currentMaskHasContent(node) {
    const payload = maskPayload(node);
    return !!payload.shapes?.length || !!payload.strokes?.length || payload.x1 != null || payload.r != null || !!payload.mask_png;
}

function saveCurrentMaskForUrl(node, url = node._liteCurrentUrl) {
    if (!url) return;
    node._liteMasksByUrl = node._liteMasksByUrl || {};
    node.properties = node.properties || {};
    const payload = cloneMaskPayload(maskPayload(node));
    if (currentMaskHasContent(node)) node._liteMasksByUrl[url] = payload;
    else delete node._liteMasksByUrl[url];
    node.properties.no8d_inpainting_masks_by_url = node._liteMasksByUrl;
}

function applyMaskForUrl(node, url) {
    node._liteMasksByUrl = node._liteMasksByUrl || node.properties?.no8d_inpainting_masks_by_url || {};
    const saved = url ? node._liteMasksByUrl[url] : null;
    node._liteMask = saved ? cloneMaskPayload(saved) : { mode: findWidget(node, "mask_mode")?.value || "none", strokes: [], shapes: [] };
    if (saved?.mode) setWidget(findWidget(node, "mask_mode"), saved.mode);
    if (saved?.shape) setWidget(findWidget(node, "geometry_shape"), saved.shape);
    node._litePreviewShape = null;
    node._liteDrag = null;
    node._liteDrawing = false;
    node._liteStroke = null;
    setWidget(findWidget(node, "mask_data"), saved ? JSON.stringify(node._liteMask) : "");
}

function setDisabledControl(wrap, disabled) {
    if (!wrap) return;
    wrap.style.opacity = disabled ? "0.45" : "1";
    if (wrap._input) wrap._input.disabled = !!disabled;
    if (wrap._select) wrap._select.disabled = !!disabled;
}

function setElementDisabled(el, disabled) {
    if (!el) return;
    el.style.opacity = disabled ? "0.42" : "1";
    el.style.pointerEvents = disabled ? "none" : "auto";
    for (const input of el.querySelectorAll("input, select, button")) input.disabled = !!disabled;
}

function addHistoryImage(node, ref, img) {
    node._liteHistory = node._liteHistory || [];
    const url = makeViewUrl(ref);
    if (!node._liteHistory.some((item) => item.url === url)) {
        node._liteHistory.push({ ref, img, url });
        node._liteHistory = node._liteHistory.slice(-LITE_HISTORY_LIMIT);
    }
    renderHistory(node);
}

function persistLitePreview(node, ref) {
    node.properties = node.properties || {};
    node.properties.no8d_inpainting_preview_ref = cloneImageRef(ref);
}

async function restoreLitePreview(node) {
    if (node._liteImg || node._litePreviewRestoring) return;
    const ref = node.properties?.no8d_inpainting_preview_ref;
    if (!ref?.filename) return;
    node._litePreviewRestoring = true;
    try {
        const img = await loadImage(ref);
        node._liteImg = img;
        node._liteCurrentUrl = makeViewUrl(ref);
        node._liteCurrentRef = cloneImageRef(ref);
        setHistoryImageRef(node, ref);
        setWidget(findWidget(node, "image_w"), img.naturalWidth);
        setWidget(findWidget(node, "image_h"), img.naturalHeight);
        applyMaskForUrl(node, node._liteCurrentUrl);
        addHistoryImage(node, ref, img);
        renderHistory(node);
        syncControls(node);
        draw(node);
    } catch (_) {
    } finally {
        node._litePreviewRestoring = false;
    }
}

async function receiveLitePreviewRef(node, ref) {
    if (!ref?.filename) return;
    const carriedMask = cloneMaskPayload(maskPayload(node));
    const hasCarriedMask = currentMaskHasContent(node);
    saveCurrentMaskForUrl(node);
    try {
        const img = await loadImage(ref);
        const url = makeViewUrl(ref);
        node._liteImg = img;
        node._liteCurrentUrl = url;
        node._liteCurrentRef = cloneImageRef(ref);
        setHistoryImageRef(node, ref);
        persistLitePreview(node, ref);
        setWidget(findWidget(node, "image_w"), img.naturalWidth);
        setWidget(findWidget(node, "image_h"), img.naturalHeight);
        if (hasCarriedMask) {
            node._liteMasksByUrl = node._liteMasksByUrl || node.properties?.no8d_inpainting_masks_by_url || {};
            node._liteMasksByUrl[url] = carriedMask;
            node.properties = node.properties || {};
            node.properties.no8d_inpainting_masks_by_url = node._liteMasksByUrl;
            node._liteMask = cloneMaskPayload(carriedMask);
            setWidget(findWidget(node, "mask_data"), JSON.stringify(node._liteMask));
        } else {
            applyMaskForUrl(node, url);
        }
        addHistoryImage(node, ref, img);
        renderHistory(node);
        syncControls(node);
        draw(node);
    } catch (_) {}
}

async function loadInitialHistory(node) {
    if (node._liteHistoryLoaded) return;
    node._liteHistoryLoaded = true;
    const refs = await loadComfyHistoryImages();
    for (const ref of refs) {
        try {
            const img = await loadImage(ref);
            addHistoryImage(node, ref, img);
        } catch (_) {}
    }
}

function renderHistory(node) {
    const strip = node._liteHistoryStrip;
    if (!strip) return;
    strip.replaceChildren();
    for (const item of node._liteHistory || []) {
        const thumb = document.createElement("img");
        thumb.src = item.url;
        thumb.title = t("replacePreview");
        thumb.dataset.no8dHistoryThumb = "1";
        const selected = node._liteCurrentUrl === item.url;
        thumb.style.cssText = `height:100%; aspect-ratio:1/1; object-fit:cover; border:${selected ? "2px solid #60a5fa" : "1px solid #444"}; border-radius:3px; cursor:pointer; flex:0 0 auto; box-sizing:border-box; background:#111;`;
        setInteractive(thumb);
        thumb.addEventListener("pointerdown", (e) => e.stopPropagation());
        thumb.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            saveCurrentMaskForUrl(node);
            node._liteImg = item.img;
            node._liteCurrentUrl = item.url;
            node._liteCurrentRef = cloneImageRef(item.ref);
            setHistoryImageRef(node, item.ref, true);
            persistLitePreview(node, item.ref);
            setWidget(findWidget(node, "image_w"), item.img.naturalWidth);
            setWidget(findWidget(node, "image_h"), item.img.naturalHeight);
            applyMaskForUrl(node, item.url);
            syncControls(node);
            renderHistory(node);
            draw(node);
        });
        strip.appendChild(thumb);
    }
}

function commitMask(node) {
    const w = findWidget(node, "mask_data");
    const seq = findWidget(node, "mask_seq");
    setWidget(w, JSON.stringify(maskPayload(node)));
    saveCurrentMaskForUrl(node);
    setWidget(seq, ((Number(seq?.value) || 0) + 1) & 0x7fffffff);
    draw(node);
}

function clearMask(node) {
    node._liteMask = { mode: findWidget(node, "mask_mode")?.value || "none", strokes: [], shapes: [] };
    node._liteDrag = null;
    node._liteDrawing = false;
    node._liteStroke = null;
    setWidget(findWidget(node, "mask_data"), "");
    setWidget(findWidget(node, "base_commit_seq"), ((Number(findWidget(node, "base_commit_seq")?.value) || 0) + 1) & 0x7fffffff);
    if (node._liteCurrentUrl) {
        node._liteMasksByUrl = node._liteMasksByUrl || {};
        delete node._liteMasksByUrl[node._liteCurrentUrl];
        node.properties = node.properties || {};
        node.properties.no8d_inpainting_masks_by_url = node._liteMasksByUrl;
    }
    setWidget(findWidget(node, "mask_seq"), ((Number(findWidget(node, "mask_seq")?.value) || 0) + 1) & 0x7fffffff);
    draw(node);
}

function clearMaskSilently(node) {
    node._liteMask = { mode: findWidget(node, "mask_mode")?.value || "none", strokes: [], shapes: [] };
    node._litePreviewShape = null;
    node._liteDrag = null;
    node._liteDrawing = false;
    node._liteStroke = null;
    setWidget(findWidget(node, "mask_data"), "");
}

function refresh(node) {
    clearMask(node);
}

function invertMask(node) {
    const payload = maskPayload(node);
    const hasMask = !!payload.shapes?.length || !!payload.strokes?.length || payload.x1 != null || payload.r != null;
    if (!hasMask) return;
    payload.invert = !payload.invert;
    node._liteMask = payload;
    commitMask(node);
}

function imagePoint(node, event) {
    const canvas = node._liteCanvas;
    const img = node._liteImg;
    if (!canvas || !img?.naturalWidth) return null;
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width * img.naturalWidth;
    const y = (event.clientY - rect.top) / rect.height * img.naturalHeight;
    return { x, y };
}

function drawMaskOverlay(node, ctx, scaleX, scaleY) {
    const payload = maskPayload(node);
    const color = findWidget(node, "mask_color")?.value || DEFAULT_MASK_COLOR;
    const alpha = 0.30;
    const hasShapes = !!payload.shapes?.length || payload.x1 != null || payload.r != null;
    const hasStrokes = !!payload.strokes?.length;
    if (payload.mode === "none" && !hasShapes && !hasStrokes) return;

    let mask = document.createElement("canvas");
    mask.width = ctx.canvas.width;
    mask.height = ctx.canvas.height;
    const mctx = mask.getContext("2d");
    mctx.fillStyle = "#fff";
    mctx.strokeStyle = "#fff";
    mctx.lineWidth = 2;

    const drawShape = (shapeData) => {
        mctx.save();
        mctx.globalCompositeOperation = shapeData.op === "subtract" ? "destination-out" : "source-over";
        const shape = shapeData.shape || payload.shape || "rectangle";
        if (shape === "circle") {
            const x = (shapeData.x || 0) * scaleX;
            const y = (shapeData.y || 0) * scaleY;
            const r = (shapeData.r || 0) * scaleX;
            if (r > 0) {
                mctx.beginPath();
                mctx.arc(x, y, r, 0, Math.PI * 2);
                mctx.fill();
            }
        } else if (shape === "lasso") {
            const pts = shapeData.points || [];
            if (pts.length > 2) {
                mctx.beginPath();
                pts.forEach((p, i) => {
                    const x = p[0] * scaleX;
                    const y = p[1] * scaleY;
                    if (i === 0) mctx.moveTo(x, y);
                    else mctx.lineTo(x, y);
                });
                mctx.closePath();
                mctx.fill();
            }
        } else {
            const x1 = (shapeData.x1 || 0) * scaleX;
            const y1 = (shapeData.y1 || 0) * scaleY;
            const x2 = (shapeData.x2 || 0) * scaleX;
            const y2 = (shapeData.y2 || 0) * scaleY;
            mctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        }
        mctx.restore();
    };

    const shapes = payload.shapes?.length ? payload.shapes : (payload.x1 != null || payload.r != null ? [payload] : []);
    for (const shape of shapes) drawShape(shape);
    if (node._litePreviewShape) drawShape(node._litePreviewShape);

    mctx.lineCap = "round";
    mctx.lineJoin = "round";
    for (const stroke of payload.strokes || []) {
        const points = Array.isArray(stroke) ? stroke : stroke?.points;
        if (!points?.length) continue;
        const brushSize = Number(stroke?.brush_size || payload.brush_size || findWidget(node, "brush_size")?.value || DEFAULT_BRUSH_SIZE);
        const radius = brushSize / 2 * scaleX;
        mctx.lineWidth = Math.max(1, radius * 2);
        mctx.save();
        mctx.globalCompositeOperation = stroke?.op === "subtract" ? "destination-out" : "source-over";
        mctx.beginPath();
        points.forEach((p, i) => {
            const x = p[0] * scaleX;
            const y = p[1] * scaleY;
            if (i === 0) mctx.moveTo(x, y);
            else mctx.lineTo(x, y);
        });
        mctx.stroke();
        mctx.restore();
    }

    if (payload.invert) {
        const inverted = document.createElement("canvas");
        inverted.width = mask.width;
        inverted.height = mask.height;
        const ictx = inverted.getContext("2d");
        ictx.fillStyle = "#fff";
        ictx.fillRect(0, 0, inverted.width, inverted.height);
        ictx.globalCompositeOperation = "destination-out";
        ictx.drawImage(mask, 0, 0);
        mask = inverted;
    }

    const colorLayer = document.createElement("canvas");
    colorLayer.width = mask.width;
    colorLayer.height = mask.height;
    const cctx = colorLayer.getContext("2d");
    cctx.fillStyle = color;
    cctx.fillRect(0, 0, colorLayer.width, colorLayer.height);
    cctx.globalCompositeOperation = "destination-in";
    cctx.drawImage(mask, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(colorLayer, 0, 0);
    ctx.restore();

    if (payload.mode === "brush" && node._liteHoverPoint) {
        const radius = Number(findWidget(node, "brush_size")?.value || DEFAULT_BRUSH_SIZE) / 2 * scaleX;
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(node._liteHoverPoint.x * scaleX, node._liteHoverPoint.y * scaleY, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.65;
        ctx.beginPath();
        ctx.arc(node._liteHoverPoint.x * scaleX, node._liteHoverPoint.y * scaleY, radius + 1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function draw(node) {
    const canvas = node._liteCanvas;
    const img = node._liteImg;
    if (!canvas || !img?.naturalWidth) return;
    const wrap = node._liteCanvasWrap;
    const maxW = Math.max(256, wrap.clientWidth || 512);
    const maxH = Math.max(256, wrap.clientHeight || 512);
    const ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const canvasWidth = Math.max(1, Math.round(img.naturalWidth * ratio));
    const canvasHeight = Math.max(1, Math.round(img.naturalHeight * ratio));
    if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
    if (canvas.height !== canvasHeight) canvas.height = canvasHeight;
    if (canvas.style.width !== `${canvasWidth}px`) canvas.style.width = `${canvasWidth}px`;
    if (canvas.style.height !== `${canvasHeight}px`) canvas.style.height = `${canvasHeight}px`;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawMaskOverlay(node, ctx, canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
}

function syncControls(node) {
    normalizeLiteMaskWidgets(node);
    const defaults = [
        ["feather", 30],
        ["mask_color", DEFAULT_MASK_COLOR],
        ["brush_size", DEFAULT_BRUSH_SIZE],
        ["denoise", 1.0],
    ];
    for (const [name, value] of defaults) {
        const w = findWidget(node, name);
        if (w && (w.value === "" || w.value == null)) setWidget(w, value);
    }
    syncInput(node._liteSteps, findWidget(node, "steps")?.value);
    syncInput(node._liteCfg, findWidget(node, "cfg")?.value);
    syncSelect(node._liteSampler, findWidget(node, "sampler_name")?.value);
    syncSelect(node._liteScheduler, findWidget(node, "scheduler")?.value);
    syncLiteSeedControls(node);
    syncInput(node._liteFeather, findWidget(node, "feather")?.value);
    const activeTool = activeLiteMaskTool(node);
    const denoiseWidget = findWidget(node, "denoise");
    if (!activeTool && Number(denoiseWidget?.value) !== 1.0) setWidget(denoiseWidget, 1.0);
    syncInput(node._liteDenoise, denoiseWidget?.value);
    for (const btn of node._liteToolButtons || []) {
        const active = activeTool && btn.dataset.liteToolId === activeTool;
        btn.style.borderColor = active ? "#3b82f6" : "#555";
        btn.style.color = active ? "#bfdbfe" : "#eee";
        btn.style.background = active ? "#102b4f" : "#2b2b2b";
    }
    syncInput(node._liteBrushSize, Number(findWidget(node, "brush_size")?.value || DEFAULT_BRUSH_SIZE) / BRUSH_SIZE_SCALE);
    syncInput(node._liteColor, findWidget(node, "mask_color")?.value);
    for (const control of node._liteCommonMaskControls || []) control.style.display = "inline-flex";
    if (node._liteRefreshActions) node._liteRefreshActions.style.display = "inline-flex";
    if (node._liteBrushGroup) node._liteBrushGroup.style.display = "inline-flex";
    const maskControlsDisabled = !node._liteImg || !activeTool;
    for (const control of node._liteCommonMaskControls || []) setElementDisabled(control, maskControlsDisabled);
    if (node._liteRefreshActions) setElementDisabled(node._liteRefreshActions, !node._liteImg);
    setDisabledControl(node._liteBrushSize, !node._liteImg || activeTool !== "brush");
    setDisabledControl(node._liteDenoise, !node._liteImg || !activeTool);
    setInteractive(node._liteCanvas, !!node._liteImg && !!activeTool);
    if (node._liteCanvas) node._liteCanvas.style.cursor = activeTool ? "crosshair" : "default";
}

function activeLiteMaskTool(node) {
    const mode = findWidget(node, "mask_mode")?.value || "none";
    const shape = findWidget(node, "geometry_shape")?.value || "rectangle";
    if (mode === "brush") return "brush";
    if (mode === "geometry" && shape === "lasso") return shape;
    return "";
}

function activeLiteMaskMode(node) {
    const tool = activeLiteMaskTool(node);
    if (tool === "brush") return "brush";
    if (tool === "lasso") return "geometry";
    return "none";
}

function cancelLiteMaskGesture(node) {
    node._litePreviewShape = null;
    node._liteDrawing = false;
    node._liteStroke = null;
    node._liteDrag = null;
}

function normalizeLiteMaskWidgets(node) {
    node.properties = node.properties || {};
    const version = Number(node.properties.no8d_inpainting_defaults_version || 0);
    const featherW = findWidget(node, "feather");
    const brushW = findWidget(node, "brush_size");
    const colorW = findWidget(node, "mask_color");

    const brush = parseFloat(brushW?.value);
    const color = String(colorW?.value || "");
    if (version < 3) {
        setWidget(featherW, 30);
        setWidget(colorW, DEFAULT_MASK_COLOR);
        setWidget(brushW, DEFAULT_BRUSH_SIZE);
        node.properties.no8d_inpainting_defaults_version = 6;
        return;
    }
    if (version < 4) {
        setWidget(brushW, DEFAULT_BRUSH_SIZE);
        setWidget(colorW, DEFAULT_MASK_COLOR);
        node.properties.no8d_inpainting_defaults_version = 6;
        return;
    }
    if (version < 6) {
        if (!Number.isFinite(brush) || brush <= 0 || brush === 90 || brush === 150) setWidget(brushW, DEFAULT_BRUSH_SIZE);
        if (!/^#[0-9a-f]{6}$/i.test(color) || color.toLowerCase() === "#00ffff") setWidget(colorW, DEFAULT_MASK_COLOR);
        node.properties.no8d_inpainting_defaults_version = 6;
    }
    if (!/^#[0-9a-f]{6}$/i.test(color)) setWidget(colorW, DEFAULT_MASK_COLOR);
    if (!Number.isFinite(parseFloat(featherW?.value))) setWidget(featherW, 30);
    if (!Number.isFinite(brush) || brush <= 0) setWidget(brushW, DEFAULT_BRUSH_SIZE);
}

function applyLiteDefaultMigration(node) {
    node.properties = node.properties || {};
    normalizeLiteMaskWidgets(node);
}

function activateLiteNode(node) {
    try {
        hideNativeWidgets(node);
        attach(node);
        hideNativeWidgets(node);
        if (node.size?.[0] < LITE_MIN_WIDTH && typeof node.setSize === "function") {
            node.setSize([LITE_MIN_WIDTH, node.size?.[1] || LITE_MIN_HEIGHT]);
        }
        syncControls(node);
        draw(node);
        return true;
    } catch (error) {
        console.error("[NO8D-control] Inpainting activation failed", error);
        return false;
    }
}

function attach(node) {
    if (node._liteWidget) return;
    hideNativeWidgets(node);
    applyLiteDefaultMigration(node);
    node._no8dInpaintingReceivePreview = (ref) => receiveLitePreviewRef(node, ref);

    const container = document.createElement("div");
    container.classList.add("no8d-lite-root");
    container.style.cssText = "width:100%; height:100%; position:relative; box-sizing:border-box; overflow:hidden; pointer-events:none;";
    const panel = document.createElement("div");
    panel.style.cssText = "position:absolute; inset:0; display:flex; flex-direction:column; background:#202020; border:1px solid #333; border-radius:4px; overflow:hidden; box-sizing:border-box; pointer-events:none;";
    container.appendChild(panel);
    node._liteContainer = container;
    node._litePanel = panel;

    const sampler = row();
    const samplerOptions = findWidget(node, "sampler_name")?.options?.values || ["euler"];
    const schedOptions = findWidget(node, "scheduler")?.options?.values || ["simple"];
    node.title = t("liteTitle");
    node._liteSampler = select(t("sampler"), samplerOptions, (v) => setWidget(findWidget(node, "sampler_name"), v));
    node._liteScheduler = select(t("scheduler"), schedOptions, (v) => setWidget(findWidget(node, "scheduler"), v));
    node._liteDenoise = number(t("denoise"), { min: 0, max: 1, step: 0.05, width: 76 }, (v) => setWidget(findWidget(node, "denoise"), v));
    sampler.style.display = "grid";
    sampler.style.gridTemplateColumns = "320px 320px";
    const samplerGroup = controlGroup(node._liteSampler);
    const schedulerGroup = controlGroup(node._liteScheduler);
    for (const [group, control] of [[samplerGroup, node._liteSampler], [schedulerGroup, node._liteScheduler]]) {
        group.style.minWidth = "0";
        control.style.flex = "1 1 0";
        control._select.style.width = "auto";
        control._select.style.minWidth = "0";
        control._select.style.flex = "1 1 0";
    }
    sampler.append(samplerGroup, schedulerGroup);
    panel.appendChild(sampler);

    const seedRow = row();
    node._liteSteps = number(t("steps"), { min: 1, max: 100, step: 1, width: 68 }, (v) => setWidget(findWidget(node, "steps"), Math.round(v)));
    node._liteCfg = number(t("cfg"), { min: 0, max: 30, step: 0.1, width: 68 }, (v) => setWidget(findWidget(node, "cfg"), v));
    node._liteSeed = number(t("seed"), { min: 0, max: Number.MAX_SAFE_INTEGER, step: 1, width: 240 }, (v) => {
        const next = Math.round(v);
        setWidget(seedWidget(node), next);
        syncLiteSeedControls(node);
    });
    watchLiteSeedWidgets(node);
    const nativeSeedControl = seedControlWidget(node);
    if (nativeSeedControl && seedControlOptions(nativeSeedControl).includes("randomize")) {
        setWidget(nativeSeedControl, "randomize");
    }
    node._liteSeedLock = iconButton("🔓", "Seed randomize", () => {
        const control = seedControlWidget(node);
        if (!control) return;
        const locked = String(control.value || "randomize") === "fixed";
        const next = locked ? "randomize" : "fixed";
        if (seedControlOptions(control).includes(next)) {
            setWidget(control, next);
            syncLiteSeedControls(node);
        }
    });
    syncLiteSeedControls(node);
    seedRow.style.display = "grid";
    seedRow.style.gridTemplateColumns = "120px 120px 0px 320px 20px";
    const stepsGroup = controlGroup(node._liteSteps);
    const cfgGroup = controlGroup(node._liteCfg);
    const seedGap = document.createElement("span");
    const seedGroup = controlGroup(node._liteSeed);
    const seedLockGroup = controlGroup(node._liteSeedLock);
    seedLockGroup.style.justifySelf = "end";
    seedRow.append(stepsGroup, cfgGroup, seedGap, seedGroup, seedLockGroup);
    panel.appendChild(seedRow);

    const setMaskTool = (tool, shape = null) => {
        const modeWidget = findWidget(node, "mask_mode");
        const shapeWidget = findWidget(node, "geometry_shape");
        const currentMode = modeWidget?.value || "none";
        const currentShape = shapeWidget?.value || "rectangle";
        const nextMode = tool === "brush" ? "brush" : "geometry";
        const sameTool = currentMode === nextMode && (nextMode === "brush" || !shape || currentShape === shape);
        if (sameTool) {
            setWidget(modeWidget, "none");
            setWidget(findWidget(node, "denoise"), 1.0);
        } else {
            setWidget(modeWidget, nextMode);
            if (shape) setWidget(shapeWidget, shape);
            setWidget(findWidget(node, "denoise"), 0.75);
        }
        node._liteMask = maskPayload(node);
        node._liteMask.strokes = node._liteMask.strokes || [];
        node._liteMask.shapes = node._liteMask.shapes || [];
        cancelLiteMaskGesture(node);
        syncControls(node);
        draw(node);
    };
    node._liteFeather = number(t("feather"), { min: 0, max: 256, step: 5, width: 76 }, (v) => setWidget(findWidget(node, "feather"), Math.round(v)));
    node._liteColor = colorInput(t("color"), (v) => {
        setWidget(findWidget(node, "mask_color"), v);
        draw(node);
    });
    const maskRow = row();
    maskRow.style.flexWrap = "nowrap";
    maskRow.style.alignItems = "center";
    node._liteMaskRow = maskRow;
    node._liteBrushGroup = document.createElement("span");
    node._liteBrushGroup.style.cssText = "display:inline-flex; align-items:center; gap:10px; height:32px; white-space:nowrap; flex:0 0 auto;";
    node._liteBrushSize = number(t("brushSize"), { min: 1, max: 102, step: 1, width: 72 }, (v) => {
        setWidget(findWidget(node, "brush_size"), Math.round(v * BRUSH_SIZE_SCALE));
        draw(node);
    });
    node._liteBrushGroup.append(node._liteBrushSize);
    node._liteToolGroup = document.createElement("span");
    node._liteToolGroup.style.cssText = "display:inline-flex; align-items:center; gap:10px; height:32px; white-space:nowrap; flex:0 0 auto;";
    const toolButton = (icon, tool, shape = null, title = "") => {
        const b = iconButton(icon, title, () => setMaskTool(tool, shape));
        b.dataset.tool = tool;
        if (shape) b.dataset.shape = shape;
        b.dataset.liteToolId = tool === "brush" ? "brush" : shape;
        b.dataset.no8dControl = "1";
        b.addEventListener("pointerdown", (e) => e.stopPropagation());
        b.style.margin = "0";
        b.style.border = "1px solid #555";
        b.style.borderRadius = "4px";
        b.style.background = "#2b2b2b";
        b.style.color = "#eee";
        b.style.userSelect = "none";
        return b;
    };
    node._liteToolButtons = [
        toolButton(t("brushIcon"), "brush", null, t("brushMask")),
        toolButton(t("lassoIcon"), "geometry", "lasso", t("lassoMask")),
    ];
    node._liteToolGroup.append(...node._liteToolButtons);
    node._liteCommonMaskControls = [
        controlGroup(node._liteFeather),
        controlGroup(node._liteColor),
    ];
    maskRow.append(
        controlGroup(node._liteToolGroup),
        controlGroup(node._liteBrushGroup),
        ...node._liteCommonMaskControls,
        controlGroup(node._liteDenoise),
    );
    panel.appendChild(maskRow);

    const wrap = document.createElement("div");
    wrap.style.cssText = "position:relative; flex:9 1 0; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#111; pointer-events:none;";
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block; cursor:crosshair;";
    setInteractive(canvas, false);
    wrap.appendChild(canvas);
    const refreshActions = document.createElement("span");
    refreshActions.style.cssText = "position:absolute; left:10px; bottom:10px; display:inline-flex; flex-direction:column; gap:8px; z-index:4;";
    const invertButton = iconButton(t("invertMaskIcon"), t("invertMask"), () => invertMask(node));
    const clearButton = iconButton(t("refreshMaskIcon"), t("refreshMask"), () => refresh(node));
    for (const action of [invertButton, clearButton]) {
        action.style.width = "48px";
        action.style.minWidth = "48px";
        action.style.height = "48px";
        action.style.border = "1px solid #333";
        action.style.borderRadius = "4px";
        action.style.background = "rgba(24,24,24,0.86)";
        action.style.color = "#fff";
        action.style.fontSize = "28px";
        action.style.boxSizing = "border-box";
    }
    refreshActions.append(invertButton, clearButton);
    node._liteRefreshActions = refreshActions;
    wrap.appendChild(refreshActions);
    panel.appendChild(wrap);
    const historyStrip = document.createElement("div");
    historyStrip.style.cssText = "display:flex; gap:12px; align-items:center; justify-content:center; flex:1 1 0; min-height:44px; padding:12px 10px 8px; overflow-x:auto; overflow-y:hidden; border-top:1px solid #333; background:#181818; box-sizing:border-box; pointer-events:none;";
    panel.appendChild(historyStrip);
    node._liteCanvas = canvas;
    node._liteCanvasWrap = wrap;
    node._liteHistoryStrip = historyStrip;
    node._liteMask = { mode: findWidget(node, "mask_mode")?.value || "none", strokes: [], shapes: [] };
    clearMaskSilently(node);
    loadInitialHistory(node);
    restoreLitePreview(node);

    canvas.addEventListener("pointerdown", (event) => {
        if (!shouldDrawLiteMask(node, event)) {
            node._litePassPointerId = event.pointerId;
            passMouseToComfy(event);
            return;
        }
        const p = imagePoint(node, event);
        const mode = activeLiteMaskMode(node);
        try { canvas.setPointerCapture(event.pointerId); } catch (_) {}
        if (mode === "geometry") {
            const shape = activeLiteMaskTool(node);
            const op = event.altKey ? "subtract" : "add";
            node._liteMask = maskPayload(node);
            node._liteMask.mode = "geometry";
            node._liteMask.shapes = node._liteMask.shapes || [];
            node._liteDrawing = true;
            node._liteStroke = { op, points: [[p.x, p.y]] };
            node._litePreviewShape = { mode: "geometry", shape, op, points: node._liteStroke.points };
        } else {
            const op = event.altKey ? "subtract" : "add";
            node._liteDrawing = true;
            node._liteStroke = { op, brush_size: Number(findWidget(node, "brush_size")?.value || DEFAULT_BRUSH_SIZE), points: [[p.x, p.y]] };
            node._liteMask = maskPayload(node);
            node._liteMask.mode = "brush";
            node._liteMask.strokes = node._liteMask.strokes || [];
            node._liteMask.strokes.push(node._liteStroke);
        }
        draw(node);
    });
    canvas.addEventListener("pointermove", (event) => {
        if (node._litePassPointerId === event.pointerId || isComfySpaceDown()) {
            passMouseToComfy(event);
            return;
        }
        const mode = activeLiteMaskMode(node);
        if (mode === "none") {
            if (event.buttons) cancelLiteMaskGesture(node);
            return;
        }
        const p = imagePoint(node, event);
        if (!p) return;
        node._liteHoverPoint = p;
        if (node._liteDrag) {
            const shape = activeLiteMaskTool(node);
            const d = node._liteDrag;
            d.x2 = p.x;
            d.y2 = p.y;
            if (shape === "circle") {
                const r = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
                node._litePreviewShape = { mode: "geometry", shape, op: d.op, x: d.x1, y: d.y1, r };
            } else {
                node._litePreviewShape = { mode: "geometry", shape, op: d.op, x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
            }
            draw(node);
        } else if (node._liteDrawing && node._liteStroke) {
            const points = Array.isArray(node._liteStroke) ? node._liteStroke : node._liteStroke.points;
            const last = points[points.length - 1];
            if (!last || Math.hypot(last[0] - p.x, last[1] - p.y) > 2) {
                points.push([p.x, p.y]);
                if (mode === "geometry") {
                    node._litePreviewShape = { mode: "geometry", shape: "lasso", op: node._liteStroke.op, points };
                }
                draw(node);
            }
        } else {
            draw(node);
        }
    });
    canvas.addEventListener("pointerleave", () => {
        node._liteHoverPoint = null;
        draw(node);
    });
    canvas.addEventListener("pointerup", (event) => {
        if (node._litePassPointerId === event.pointerId) {
            node._litePassPointerId = null;
            passMouseToComfy(event);
            return;
        }
        const mode = activeLiteMaskMode(node);
        if (mode === "none") {
            cancelLiteMaskGesture(node);
            return;
        }
        if (mode === "geometry" && node._litePreviewShape?.points?.length > 2) {
            node._liteMask = maskPayload(node);
            node._liteMask.mode = "geometry";
            node._liteMask.shapes = node._liteMask.shapes || [];
            node._liteMask.shapes.push(node._litePreviewShape);
        }
        node._litePreviewShape = null;
        node._liteDrawing = false;
        node._liteStroke = null;
        node._liteDrag = null;
        commitMask(node);
    });
    canvas.addEventListener("pointercancel", () => {
        node._litePassPointerId = null;
        cancelLiteMaskGesture(node);
        if (activeLiteMaskMode(node) !== "none") commitMask(node);
    });
    canvas.addEventListener("wheel", (event) => passMouseToComfy(event), { passive: true });
    canvas.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        passMouseToComfy(event);
    });

    const widget = node.addDOMWidget("no8d_inpainting_canvas", "inpainting_canvas", container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => LITE_MIN_HEIGHT,
        margin: 10,
        afterResize: () => scheduleDraw(node),
    });
    node._liteWidget = widget;
    const markWrapper = () => container.closest(".dom-widget")?.classList.add("no8d-lite-widget");
    markWrapper();
    requestAnimationFrame(markWrapper);
    hideNativeWidgets(node);
    syncControls(node);
}

app.registerExtension({
    name: "NO8D.Control.Inpainting",
    async setup() {
        setTimeout(() => {
            for (const node of app?.graph?._nodes || []) {
                if (node?.type === NODE_NAME || node?.comfyClass === NODE_NAME) {
                    activateLiteNode(node);
                }
            }
        }, 500);
    },
    async nodeCreated(node) {
        if (node?.type !== NODE_NAME && node?.comfyClass !== NODE_NAME) return;
        activateLiteNode(node);
        setTimeout(() => activateLiteNode(node), 0);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onCreated) onCreated.apply(this, arguments);
            activateLiteNode(this);
            setTimeout(() => activateLiteNode(this), 0);
            setTimeout(() => activateLiteNode(this), 250);
            if (typeof this.setSize === "function") {
                this.setSize([
                    Math.max(this.size?.[0] || 0, LITE_MIN_WIDTH),
                    Math.max(this.size?.[1] || 0, LITE_MIN_HEIGHT),
                ]);
            }
        };
        const onAdded = nodeType.prototype.onAdded;
        nodeType.prototype.onAdded = function () {
            if (onAdded) onAdded.apply(this, arguments);
            activateLiteNode(this);
            setTimeout(() => activateLiteNode(this), 0);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => {
                activateLiteNode(this);
                this.title = t("liteTitle");
                clearMaskSilently(this);
                restoreLitePreview(this);
                syncControls(this);
                draw(this);
                hideNativeWidgets(this);
            }, 0);
        };
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            if (onResize) onResize.apply(this, arguments);
            if (this.size && this.size[0] < LITE_MIN_WIDTH) this.size[0] = LITE_MIN_WIDTH;
            scheduleDraw(this);
        };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            if (onExecuted) onExecuted.apply(this, arguments);
            syncControls(this);
            const refs = extractLiteRefs(message);
            if (!refs?.length) return;
            receiveLitePreviewRef(this, refs[0]);
            setTimeout(() => {
                syncControls(this);
                draw(this);
            }, 80);
        };
    },
});
