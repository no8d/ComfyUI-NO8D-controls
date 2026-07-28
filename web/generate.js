import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { shouldPassKeyToComfy } from "./no8d_comfy_events.js";
import { no8dLocale, t } from "./no8d_i18n.js";
import { refreshBypassElements, registerBypassElement, wrapBypassRefresh } from "./no8d_bypass.js";

const NODE_NAME = "NO8DGenerate";
const CANVAS_TYPE = "NO8D_GENERATE_CANVAS";
const NATIVE_PREVIEW_WIDGET = "$$canvas-image-preview";
const MIN_WIDTH = 600;
const PAD = 10;
const TOOLBAR_HEIGHT = 52;
const EDITOR_HEIGHT = 58;
const DEFAULT_MASK_COLOR = "#66ccff";
const DEFAULT_MASK_OPACITY = 0.4;
const EMPTY_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const MAX_PREVIEW_EDGE = 1024;
const BRUSH_FEATHER_RADIUS_MULTIPLIER = 2;
// Outpaint has no brush radius.  Using half of the placed image as its
// substitute made 60% feather cover hundreds of pixels and double-expose a
// large part of the source.  Keep the seam proportional to the canvas while
// bounding it to a practical blending band.
const OUTPAINT_FEATHER_MAX_CANVAS_FRACTION = 0.1;
const MASK_RENDER_VERSION = 2;
const MASK_FEATHER_VALUE = 128;
const EXECUTION_MASK_GRADIENT_STEPS = 32;
const ASPECT_RATIOS = {
    "1:1": [1, 1],
    "1:2": [1, 2],
    "2:3": [2, 3],
    "3:4": [3, 4],
    "4:5": [4, 5],
    "9:16": [9, 16],
    "9:21": [9, 21],
};
const TRANSFORM_HANDLE_SIZE = 10;
// ComfyUI 1.42 uses the native bounding-rect corner detector with a 15 px
// handle. This canvas-heavy node benefits from a slightly larger target while
// retaining the exact same native corner directions and resize behavior.
const NODE_RESIZE_CORNER_SIZE = 24;
let activeLocale = "";

function isGenerateNode(node) {
    const type = node?.constructor?.comfyClass || node?.comfyClass || node?.type;
    return type === NODE_NAME;
}

function migrateGenerateSlots(node) {
    if (!node) return;
    for (let index = (node.inputs?.length || 0) - 1; index >= 0; index -= 1) {
        if (node.inputs[index]?.name !== "image") continue;
        node.disconnectInput?.(index);
        if (typeof node.removeInput === "function") node.removeInput(index);
        else node.inputs.splice(index, 1);
    }
    for (let index = (node.outputs?.length || 0) - 1; index >= 1; index -= 1) {
        node.disconnectOutput?.(index);
        if (typeof node.removeOutput === "function") node.removeOutput(index);
        else node.outputs.splice(index, 1);
    }
}

function findWidget(node, name) {
    return (node?.widgets || []).find((widget) => widget.name === name);
}

function hideToolbarWidgets(node) {
    const hiddenNames = new Set([
        "steps", "cfg", "sampler_name", "scheduler", "seed", "denoise", "mask_feather",
    ]);
    for (const widget of node?.widgets || []) {
        const autoControl = typeof widget.name === "string" && /control_after_generate/i.test(widget.name);
        if (!hiddenNames.has(widget.name) && !autoControl) continue;
        widget.options = widget.options || {};
        widget.options.hidden = true;
        widget.options.collapsed = true;
        widget.hidden = true;
        widget.serialize = true;
        if (!autoControl && widget.name !== "seed") widget.type = "converted-widget";
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
    }
}

function seedControlWidget(node) {
    return (node?.widgets || []).find((widget) => typeof widget.name === "string"
        && /control_after_generate/i.test(widget.name));
}

function setNativeWidget(widget, value) {
    if (!widget) return;
    widget.value = value;
    widget.callback?.(value);
    setDirty();
}

function clampNumber(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function selectNumberOnFocus(element) {
    const select = () => element.select();
    element.addEventListener("focus", select);
    element.addEventListener("click", select);
}

function createSamplerPanel(node) {
    if (node._no8dGenerateSamplerPanel || typeof node.addDOMWidget !== "function") return;
    const root = document.createElement("div");
    root.classList.add("no8d-ui");
    root.style.cssText = [
        "display:grid", "grid-template-rows:repeat(2,36px)", "gap:6px",
        "box-sizing:border-box", "width:100%", "height:96px", "padding:9px 8px",
        "--comfy-widget-min-height:96px", "--comfy-widget-max-height:96px",
        "background:#171717", "color:#ddd", "font:12px sans-serif",
    ].join(";");
    registerBypassElement(node, root);

    const makeRow = (columns) => {
        const row = document.createElement("div");
        row.style.cssText = `display:grid;grid-template-columns:${columns};gap:10px;align-items:center;min-width:0;`;
        root.append(row);
        return row;
    };
    node._no8dGenerateSamplerLabels = [];
    const makeGroup = (labelKey, control) => {
        const group = document.createElement("label");
        group.style.cssText = "display:flex;align-items:center;gap:7px;min-width:0;height:100%;font-weight:600;";
        const text = document.createElement("span");
        text.textContent = t(labelKey);
        text.style.cssText = "flex:0 0 auto;white-space:nowrap;";
        node._no8dGenerateSamplerLabels.push({ text, key: labelKey });
        control.style.cssText += ";min-width:0;height:28px;box-sizing:border-box;flex:1 1 auto;color:#eee;background:#303030;border:1px solid #666;border-radius:3px;padding:2px 7px;";
        group.append(text, control);
        return group;
    };
    const select = (name) => {
        const widget = findWidget(node, name);
        const element = document.createElement("select");
        for (const value of widget?.options?.values || []) {
            const option = document.createElement("option");
            option.value = String(value);
            option.textContent = String(value);
            element.append(option);
        }
        element.addEventListener("change", () => setNativeWidget(widget, element.value));
        return element;
    };
    const number = (name, { digits = 0, onStep = null } = {}) => {
        const widget = findWidget(node, name);
        const element = document.createElement("input");
        element.type = "number";
        const min = Number(widget?.options?.min ?? 0);
        const max = Number(widget?.options?.max ?? Number.MAX_SAFE_INTEGER);
        element.min = String(min);
        element.max = String(max);
        element.step = String(digits > 0 ? 10 ** -digits : 1);
        element.dataset.digits = String(digits);
        selectNumberOnFocus(element);
        element.addEventListener("change", () => {
            const value = Number(element.value);
            if (Number.isFinite(value)) setNativeWidget(widget, value);
        });
        element.addEventListener("keydown", (event) => {
            if (shouldPassKeyToComfy(event)) return;
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            event.preventDefault();
            event.stopPropagation();
            const direction = event.key === "ArrowUp" ? 1 : -1;
            const baseStep = digits > 0 ? 10 ** -digits : 1;
            const amount = event.shiftKey ? baseStep * 10 : baseStep;
            const raw = Number(element.value || widget?.value || 0);
            const next = clampNumber(raw + direction * amount, min, max);
            const value = digits > 0 ? Number(next.toFixed(digits)) : Math.round(next);
            element.value = digits > 0 ? value.toFixed(digits) : String(value);
            setNativeWidget(widget, value);
            onStep?.();
            element.select();
        });
        return element;
    };

    const sampler = select("sampler_name");
    const scheduler = select("scheduler");
    const cfg = number("cfg", { digits: 2 });
    const steps = number("steps");
    const denoise = number("denoise", { digits: 2 });
    const seed = number("seed", { onStep: () => lockSeed() });
    seed.style.fontVariantNumeric = "tabular-nums";

    const lock = document.createElement("button");
    lock.type = "button";
    lock.style.cssText = "width:36px;height:28px;padding:0;color:#ddd;background:#303030;border:1px solid #666;border-radius:3px;cursor:pointer;";
    const control = seedControlWidget(node);
    const sync = () => {
        sampler.value = String(findWidget(node, "sampler_name")?.value ?? "");
        scheduler.value = String(findWidget(node, "scheduler")?.value ?? "");
        cfg.value = Number(findWidget(node, "cfg")?.value ?? 1).toFixed(2);
        steps.value = String(findWidget(node, "steps")?.value ?? 6);
        denoise.value = Number(findWidget(node, "denoise")?.value ?? 1).toFixed(2);
        seed.value = String(findWidget(node, "seed")?.value ?? 0);
        const locked = String(control?.value || "randomize") === "fixed";
        lock.textContent = locked ? "🔒" : "🔓";
        lock.style.background = locked ? "#24272d" : "#303030";
        lock.style.borderColor = locked ? "#2563eb" : "#666";
    };
    node._no8dGenerateSyncSampler = sync;

    const lockSeed = () => {
        if (control && String(control.value || "randomize") !== "fixed") setNativeWidget(control, "fixed");
        sync();
    };
    seed.addEventListener("input", () => {
        const value = Number(seed.value);
        if (Number.isFinite(value)) setNativeWidget(findWidget(node, "seed"), Math.round(value));
        lockSeed();
    });
    lock.addEventListener("click", () => {
        if (!control) return;
        const locked = String(control.value || "randomize") === "fixed";
        setNativeWidget(control, locked ? "randomize" : "fixed");
        sync();
    });

    const first = makeRow("minmax(0,1fr) minmax(0,1fr) 150px");
    first.append(makeGroup("sampler", sampler), makeGroup("scheduler", scheduler), makeGroup("cfg", cfg));
    const second = makeRow("120px 150px minmax(0,1fr) 36px");
    second.append(makeGroup("steps", steps), makeGroup("denoise", denoise), makeGroup("seed", seed), lock);

    for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "keydown"]) {
        root.addEventListener(eventName, (event) => {
            if (eventName === "keydown" && shouldPassKeyToComfy(event)) return;
            event.stopPropagation();
        });
    }
    const panel = node.addDOMWidget("no8d_generate_sampler", "sampler_panel", root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 96,
        getMaxHeight: () => 96,
        getValue: () => "",
        setValue: () => {},
    });
    node._no8dGenerateSamplerPanel = panel;

    const widgets = node.widgets || [];
    const panelIndex = widgets.indexOf(panel);
    const canvasIndex = widgets.findIndex((widget) => widget.type === CANVAS_TYPE || widget.name === "canvas");
    if (panelIndex >= 0 && canvasIndex >= 0 && panelIndex > canvasIndex) {
        widgets.splice(panelIndex, 1);
        widgets.splice(canvasIndex, 0, panel);
    }
    const seedWidget = findWidget(node, "seed");
    const originalSeedCallback = seedWidget?.callback;
    if (seedWidget && !seedWidget._no8dGenerateCallback) {
        seedWidget.callback = function () {
            const result = originalSeedCallback?.apply(this, arguments);
            requestAnimationFrame(sync);
            return result;
        };
        seedWidget._no8dGenerateCallback = true;
    }
    sync();
}

function setDirty() {
    app.graph?.setDirtyCanvas?.(true, true);
}

function refreshAllGenerateLabels(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeLocale) return;
    activeLocale = locale;
    for (const node of app?.graph?._nodes || []) {
        if (!isGenerateNode(node)) continue;
        for (const item of node._no8dGenerateSamplerLabels || []) {
            item.text.textContent = t(item.key);
        }
        node._no8dGenerateCanvas?.invalidateCache?.();
    }
    setDirty();
}

let cursorFramePending = false;
function setCursorDirty() {
    if (cursorFramePending) return;
    cursorFramePending = true;
    requestAnimationFrame(() => {
        cursorFramePending = false;
        app.graph?.setDirtyCanvas?.(true, false);
    });
}

function suppressNativePreview(node) {
    if (!node) return;
    node.preview = undefined;

    const widgets = node.widgets || [];
    const index = widgets.findIndex((widget) => widget.name === NATIVE_PREVIEW_WIDGET);
    if (index >= 0) {
        widgets[index].onRemove?.();
        widgets.splice(index, 1);
    }
}

function syncNativeImageState(node, ref, image, refs = null) {
    if (!node || !ref || !image) return;
    node.imgs = [image];
    node.imageIndex = 0;
    node.images = [ref];
    node.properties = node.properties || {};
    node.properties.no8d_generate_preview = { ...ref };
    if (Array.isArray(refs) && refs.length > 1) {
        node.properties.no8d_generate_preview_list = refs.map((item) => ({ ...item }));
        node._no8dGeneratePreviewIndex = refs.findIndex((item) => item?.filename === ref.filename);
        if (node._no8dGeneratePreviewIndex < 0) node._no8dGeneratePreviewIndex = refs.length - 1;
        node._no8dGeneratePreviewCount = refs.length;
    } else {
        delete node.properties.no8d_generate_preview_list;
        node._no8dGeneratePreviewIndex = 0;
        node._no8dGeneratePreviewCount = 1;
    }
}

function clearNativeImageState(node) {
    if (!node) return;
    suppressNativePreview(node);
    node.imgs = undefined;
    node.images = undefined;
    node.imageIndex = 0;
    node._no8dGeneratePreviewIndex = 0;
    node._no8dGeneratePreviewCount = 0;
}

function restorePreview(node) {
    const ref = node?.properties?.no8d_generate_preview;
    const widget = node?._no8dGenerateCanvas;
    if (!ref?.filename || !widget) return;
    if (widget.image?.naturalWidth) {
        syncNativeImageState(node, ref, widget.image);
        return;
    }
    widget.setPreview(ref).catch((error) => {
        console.warn("[NO8D Generate] saved preview restore failed", error);
    });
}

function imageRefs(value) {
    return Array.isArray(value) ? value.filter((item) => item?.filename) : [];
}

function refsFromMessage(message) {
    if (!message || typeof message !== "object") return [];
    const direct = imageRefs(message.images)
        .concat(imageRefs(message.a_images))
        .concat(imageRefs(message.b_images));
    if (direct.length) return direct;
    for (const value of Object.values(message)) {
        if (!value || typeof value !== "object") continue;
        const nested = refsFromMessage(value);
        if (nested.length) return nested;
    }
    return [];
}

function makeViewUrl(ref) {
    const params = new URLSearchParams();
    params.set("filename", ref.filename);
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    params.set("type", ref.type || "temp");
    return api.apiURL(`/view?${params.toString()}`);
}

function loadImage(ref) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.crossOrigin = "anonymous";
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = makeViewUrl(ref);
    });
}

function releaseDecodedImage(image) {
    if (!image) return;
    image.onload = null;
    image.onerror = null;
    try {
        image.src = EMPTY_IMAGE_SRC;
    } catch (_) {}
}

function releasePreviewCanvas(canvas) {
    if (!canvas?.getContext) return;
    canvas.width = 0;
    canvas.height = 0;
}

function makePreviewCanvas(image) {
    if (!image?.naturalWidth || !image?.naturalHeight) return null;
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale >= 1) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function safeFilenamePart(value) {
    return String(value ?? "node").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48) || "node";
}

async function contentAddressedFilename(blob, prefix, nodeId) {
    let version = Date.now().toString(36);
    if (globalThis.crypto?.subtle && typeof blob?.arrayBuffer === "function") {
        try {
            const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
            version = Array.from(
                new Uint8Array(digest).slice(0, 12),
                (byte) => byte.toString(16).padStart(2, "0"),
            ).join("");
        } catch (_) {
            // Keep uploads functional on older/insecure browser contexts without WebCrypto.
        }
    }
    return `${safeFilenamePart(prefix)}_${safeFilenamePart(nodeId)}_${version}.png`;
}

async function uploadBlob(blob, prefix, nodeId, isCurrent = () => true) {
    const filename = await contentAddressedFilename(blob, prefix, nodeId);
    if (!isCurrent()) return null;
    const body = new FormData();
    body.append("image", new File([blob], filename, { type: "image/png" }));
    body.append("type", "input");
    body.append("subfolder", "no8d_generate");
    body.append("overwrite", "true");
    const response = await api.fetchApi("/upload/image", { method: "POST", body });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    const data = await response.json();
    return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

function canvasBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Canvas export failed")), "image/png");
    });
}

function pointInRect(pos, rect) {
    return Boolean(rect && pos[0] >= rect[0] && pos[0] <= rect[0] + rect[2]
        && pos[1] >= rect[1] && pos[1] <= rect[1] + rect[3]);
}

function fitSizeRect(width, height, rect) {
    if (!width || !height) return null;
    const scale = Math.min(rect[2] / width, rect[3] / height);
    return [
        rect[0] + (rect[2] - width * scale) / 2,
        rect[1] + (rect[3] - height * scale) / 2,
        width * scale,
        height * scale,
        scale,
    ];
}

function roundCanvasDimension(value) {
    return Math.max(16, Math.min(16384, Math.round(Number(value || 0) / 8) * 8));
}

function canvasSize(aspectRatio, latentShortSide, swapped) {
    let [ratioWidth, ratioHeight] = ASPECT_RATIOS[aspectRatio] || ASPECT_RATIOS["1:1"];
    if (swapped) [ratioWidth, ratioHeight] = [ratioHeight, ratioWidth];
    const short = roundCanvasDimension(latentShortSide || 1024);
    const width = ratioWidth >= ratioHeight ? short * ratioWidth / ratioHeight : short;
    const height = ratioHeight >= ratioWidth ? short * ratioHeight / ratioWidth : short;
    return [roundCanvasDimension(width), roundCanvasDimension(height)];
}

function hexToRgb(hex) {
    const value = String(hex || DEFAULT_MASK_COLOR).replace("#", "");
    const normalized = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
    const number = Number.parseInt(normalized, 16);
    if (!Number.isFinite(number)) return [102, 204, 255];
    return [number >> 16, (number >> 8) & 255, number & 255];
}

function rgba(hex, alpha) {
    const [red, green, blue] = hexToRgb(hex);
    return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, Number(alpha) || 0))})`;
}

function rgbToHue(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    if (!delta) return 0;
    let hue = max === r
        ? ((g - b) / delta) % 6
        : max === g
            ? (b - r) / delta + 2
            : (r - g) / delta + 4;
    hue *= 60;
    return Math.round(hue < 0 ? hue + 360 : hue);
}

function hueToHex(hue) {
    const normalized = ((Number(hue) % 360) + 360) % 360;
    const x = 1 - Math.abs((normalized / 60) % 2 - 1);
    const rgb = normalized < 60 ? [1, x, 0]
        : normalized < 120 ? [x, 1, 0]
            : normalized < 180 ? [0, 1, x]
                : normalized < 240 ? [0, x, 1]
                    : normalized < 300 ? [x, 0, 1]
                        : [1, 0, x];
    return `#${rgb.map((value) => Math.round(value * 255))
        .map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function drawStrokeGeometry(ctx, stroke) {
    if (!stroke?.points?.length) return;
    ctx.beginPath();
    if (stroke.kind === "lasso") {
        stroke.points.forEach((point, index) => index
            ? ctx.lineTo(point[0], point[1])
            : ctx.moveTo(point[0], point[1]));
        if (stroke.points.length > 2) {
            ctx.closePath();
            ctx.fill();
            if (stroke.outlineSize > 0) {
                ctx.lineWidth = stroke.outlineSize;
                ctx.stroke();
            }
        }
    } else if (stroke.points.length === 1) {
        ctx.arc(stroke.points[0][0], stroke.points[0][1], stroke.brushSize / 2, 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.moveTo(stroke.points[0][0], stroke.points[0][1]);
        for (let index = 1; index < stroke.points.length - 1; index += 1) {
            const point = stroke.points[index];
            const next = stroke.points[index + 1];
            ctx.quadraticCurveTo(point[0], point[1], (point[0] + next[0]) / 2, (point[1] + next[1]) / 2);
        }
        const last = stroke.points[stroke.points.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
    }
}

function strokeCoreBounds(stroke, clipWidth = null, clipHeight = null) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of stroke.points || []) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    if (!Number.isFinite(minX)) return null;
    if (stroke.kind !== "lasso") {
        const radius = Math.max(1, Number(stroke.brushSize) || 1) / 2;
        minX -= radius;
        minY -= radius;
        maxX += radius;
        maxY += radius;
    }
    if (Number.isFinite(clipWidth) && Number.isFinite(clipHeight)) {
        if (maxX < 0 || maxY < 0 || minX > clipWidth || minY > clipHeight) return null;
        minX = Math.max(0, minX);
        minY = Math.max(0, minY);
        maxX = Math.min(clipWidth, maxX);
        maxY = Math.min(clipHeight, maxY);
    }
    return { minX, minY, maxX, maxY };
}

function boundsOverlap(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX
        && a.minY <= b.maxY && a.maxY >= b.minY;
}

function strokeFeatherDiameters(strokes, clipWidth = null, clipHeight = null) {
    const entries = (strokes || []).map((stroke) => ({
        stroke,
        bounds: strokeCoreBounds(stroke, clipWidth, clipHeight),
    })).filter((entry) => entry.bounds);
    const parent = entries.map((_, index) => index);
    const find = (index) => {
        while (parent[index] !== index) {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }
        return index;
    };
    const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
    };
    for (let left = 0; left < entries.length; left += 1) {
        for (let right = left + 1; right < entries.length; right += 1) {
            const a = entries[left];
            const b = entries[right];
            if (a.stroke.op !== b.stroke.op || a.stroke.kind !== b.stroke.kind) continue;
            if (boundsOverlap(a.bounds, b.bounds)) union(left, right);
        }
    }
    const groups = new Map();
    entries.forEach((entry, index) => {
        const root = find(index);
        const bounds = groups.get(root) || { ...entry.bounds };
        bounds.minX = Math.min(bounds.minX, entry.bounds.minX);
        bounds.minY = Math.min(bounds.minY, entry.bounds.minY);
        bounds.maxX = Math.max(bounds.maxX, entry.bounds.maxX);
        bounds.maxY = Math.max(bounds.maxY, entry.bounds.maxY);
        groups.set(root, bounds);
    });
    const result = new Map();
    entries.forEach((entry, index) => {
        const bounds = groups.get(find(index));
        result.set(entry.stroke, Math.max(1, Math.min(
            bounds.maxX - bounds.minX,
            bounds.maxY - bounds.minY,
        )));
    });
    return result;
}

function scaledStroke(stroke, scale, brushScale = 1, featherDiameter = null) {
    const diameter = featherDiameter ?? Math.max(1, Number(stroke.brushSize) || 1);
    const featherGrowth = diameter * Math.max(0, brushScale - 1);
    return {
        ...stroke,
        brushSize: (stroke.brushSize + (stroke.kind === "lasso" ? 0 : featherGrowth)) * scale,
        outlineSize: stroke.kind === "lasso"
            ? featherGrowth * scale
            : 0,
        points: stroke.points.map((point) => [point[0] * scale, point[1] * scale]),
    };
}

function scaledMaskStroke(stroke, scale, brushScale, featherDiameter, visible) {
    if (visible) return scaledStroke(stroke, scale, brushScale, featherDiameter);
    if (brushScale <= 1 || stroke.kind === "lasso") {
        return scaledStroke(stroke, scale, 1, featherDiameter);
    }
    const contractedSize = stroke.brushSize
        - featherDiameter * Math.max(0, brushScale - 1);
    if (contractedSize <= 0) return null;
    return {
        ...stroke,
        brushSize: contractedSize * scale,
        outlineSize: 0,
        points: stroke.points.map((point) => [point[0] * scale, point[1] * scale]),
    };
}

function executionMaskGradientStep(step, featherPercent) {
    const progress = step / EXECUTION_MASK_GRADIENT_STEPS;
    return {
        brushScale: 1 + (BRUSH_FEATHER_RADIUS_MULTIPLIER - 1)
            * featherPercent * progress,
        value: Math.round(255 * (1 - progress)),
    };
}

function serializeStrokes(strokes) {
    if (!Array.isArray(strokes)) return [];
    return strokes.filter((stroke) => stroke && typeof stroke === "object").map((stroke) => ({
        op: stroke.op === "subtract" ? "subtract" : "add",
        kind: stroke.kind === "lasso" ? "lasso" : "brush",
        brushSize: Math.min(512, Math.max(1, Number(stroke.brushSize) || 80)),
        points: (Array.isArray(stroke.points) ? stroke.points : []).filter((point) => (
            Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))
        )).map((point) => [
            Math.round(Number(point[0]) * 100) / 100,
            Math.round(Number(point[1]) * 100) / 100,
        ]),
    })).filter((stroke) => stroke.points.length > 0);
}

function restoreStrokes(value) {
    if (!Array.isArray(value)) return [];
    return serializeStrokes(value);
}

class NO8DGenerateCanvasWidget {
    constructor(node, name, type) {
        this.node = node;
        this.name = name;
        this.type = type;
        this.options = {};
        this.value = "";
        this.image = null;
        this.sourceImage = null;
        this.previewImage = null;
        this.sourcePreviewImage = null;
        this.contentRect = null;
        this.canvasRect = null;
        this.rect = [0, 0, MIN_WIDTH, 360];
        this.toolbarRect = null;
        this.strokes = [];
        this.activeStroke = null;
        this.hoverImagePoint = null;
        this.tool = null;
        this.invert = false;
        this.brushSize = 80;
        this.eraserSize = 80;
        this.maskOpacity = DEFAULT_MASK_OPACITY;
        this.maskColor = DEFAULT_MASK_COLOR;
        this.aspectRatio = "1:1";
        this.latentShortSide = 1024;
        this.swapDimensions = false;
        [this.canvasWidth, this.canvasHeight] = canvasSize(
            this.aspectRatio, this.latentShortSide, this.swapDimensions,
        );
        this.transformActive = false;
        this.imageTransform = null;
        this.transformDrag = null;
        this.transformCursorRevision = 0;
        this.baseImageFile = "";
        this.sourceImageFile = "";
        this.maskImageFile = "";
        this.maskBaseWidth = 0;
        this.maskBaseHeight = 0;
        this.maskOverlay = null;
        this.maskOverlayKey = "";
        this.maskDirty = false;
        this.pending = null;
        this.maskCommitTimer = null;
        this.maskRevision = 0;
        this.outpaintResultVisible = false;
        this.valueEditorClose = null;
        this.activeEditor = null;
        this.activeEditorAction = null;
        this.flashAction = null;
        this.previewLoadToken = 0;
        this.disposed = false;
        this.beforeQueued = async () => {
            await this.serializeValue();
        };
    }

    computeLayoutSize() {
        return {
            minWidth: 1,
            minHeight: 220,
            maxHeight: 1000000,
        };
    }

    getValue() {
        const maskModeActive = this.isMaskModeActive();
        return JSON.stringify({
            base_image_file: this.baseImageFile,
            source_image_file: this.sourceImageFile,
            mask_image_file: this.maskImageFile,
            mask_active: maskModeActive && Boolean(this.baseImageFile && this.maskImageFile),
            outpaint_active: this.isOutpaintModeActive(),
            mask_tool: this.isMaskToolActive() ? this.tool : null,
            mask_base_width: this.maskBaseWidth,
            mask_base_height: this.maskBaseHeight,
            brush_size: this.brushSize,
            eraser_size: this.eraserSize,
            mask_opacity: this.maskOpacity,
            mask_color: this.maskColor,
            mask_render_version: MASK_RENDER_VERSION,
            aspect_ratio: this.aspectRatio,
            short_side: this.latentShortSide,
            swap_dimensions: this.swapDimensions,
            canvas_width: this.canvasWidth,
            canvas_height: this.canvasHeight,
            transform_active: this.transformActive,
            image_transform: this.imageTransform,
            invert: this.invert,
            strokes: serializeStrokes(this.strokes),
        });
    }

    hasMaskContent() {
        return this.strokes.length > 0 || this.invert;
    }

    isMaskToolActive() {
        return this.tool === "brush" || this.tool === "lasso" || this.tool === "eraser";
    }

    isInpaintModeActive() {
        return this.isMaskToolActive() && this.hasMaskContent();
    }

    isMaskModeActive() {
        return this.isInpaintModeActive() || this.isOutpaintModeActive();
    }

    isOutpaintModeActive() {
        return this.transformActive && this.hasOutpaintArea();
    }

    editingImage() {
        return this.sourceImage || this.image;
    }

    ensureImageTransform() {
        const image = this.editingImage();
        if (!image?.naturalWidth || !image?.naturalHeight) return null;
        if (!this.imageTransform) {
            this.fitImageTransformToCanvas();
        }
        return this.imageTransform;
    }

    rasterImageTransform() {
        const transform = this.ensureImageTransform();
        if (!transform) return null;
        const left = Math.round(transform.x);
        const top = Math.round(transform.y);
        const right = Math.round(transform.x + transform.width);
        const bottom = Math.round(transform.y + transform.height);
        return {
            x: left,
            y: top,
            width: Math.max(1, right - left),
            height: Math.max(1, bottom - top),
        };
    }

    outpaintFeatherWidth(transform = this.rasterImageTransform()) {
        if (!transform) return 0;
        const canvasShortSide = Math.min(this.canvasWidth || 0, this.canvasHeight || 0);
        const sourceShortSide = Math.min(transform.width, transform.height);
        const maximum = Math.min(
            canvasShortSide * OUTPAINT_FEATHER_MAX_CANVAS_FRACTION,
            sourceShortSide * 0.15,
        );
        return Math.max(0, maximum) * (this.getFeatherPercent() / 100);
    }

    fitImageTransformToCanvas() {
        const image = this.editingImage();
        if (!image?.naturalWidth || !image?.naturalHeight) return null;
        const imageWidth = image.naturalWidth;
        const imageHeight = image.naturalHeight;
        let scale;
        if (imageWidth > imageHeight) {
            scale = this.canvasWidth / imageWidth;
        } else if (imageHeight > imageWidth) {
            scale = this.canvasHeight / imageHeight;
        } else {
            scale = Math.min(
                this.canvasWidth / imageWidth,
                this.canvasHeight / imageHeight,
            );
        }
        const width = imageWidth * scale;
        const height = imageHeight * scale;
        this.imageTransform = {
            x: (this.canvasWidth - width) / 2,
            y: (this.canvasHeight - height) / 2,
            width,
            height,
        };
        return this.imageTransform;
    }

    syncCanvasToImageSize(image) {
        if (!image?.naturalWidth || !image?.naturalHeight) return;
        const width = roundCanvasDimension(image.naturalWidth);
        const height = roundCanvasDimension(image.naturalHeight);
        const portraitRatio = Math.min(width, height) / Math.max(width, height);
        let closestRatio = "1:1";
        let closestDistance = Infinity;
        for (const [name, [ratioWidth, ratioHeight]] of Object.entries(ASPECT_RATIOS)) {
            const candidate = Math.min(ratioWidth, ratioHeight)
                / Math.max(ratioWidth, ratioHeight);
            const distance = Math.abs(candidate - portraitRatio);
            if (distance < closestDistance) {
                closestRatio = name;
                closestDistance = distance;
            }
        }
        this.aspectRatio = closestRatio;
        this.swapDimensions = width > height && closestRatio !== "1:1";
        this.latentShortSide = Math.min(width, height);
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.maskBaseWidth = width;
        this.maskBaseHeight = height;
    }

    hasOutpaintArea() {
        const transform = this.ensureImageTransform();
        if (!transform) return false;
        const epsilon = 0.5;
        return transform.x > epsilon || transform.y > epsilon
            || transform.x + transform.width < this.canvasWidth - epsilon
            || transform.y + transform.height < this.canvasHeight - epsilon;
    }

    invalidateMaskCommit() {
        this.maskRevision += 1;
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        this.pending = null;
        return this.maskRevision;
    }

    markMaskDirty() {
        this.invalidateMaskCommit();
        this.maskDirty = true;
    }

    isCurrentMaskRevision(revision) {
        return !this.disposed && revision === this.maskRevision;
    }

    clearMaskState() {
        this.outpaintResultVisible = false;
        const hadOutpaint = this.hasOutpaintArea();
        this.previewLoadToken += 1;
        this.invalidateMaskCommit();
        this.strokes = [];
        this.activeStroke = null;
        this.hoverImagePoint = null;
        this.invert = false;
        this.baseImageFile = "";
        this.maskImageFile = "";
        if (!hadOutpaint && this.image?.naturalWidth) {
            const oldSource = this.sourceImage;
            const oldSourcePreview = this.sourcePreviewImage;
            this.sourceImage = this.image;
            this.sourcePreviewImage = this.previewImage;
            this.sourceImageFile = "";
            this.imageTransform = null;
            this.fitImageTransformToCanvas();
            this.transformActive = false;
            if (oldSource && oldSource !== this.image) releaseDecodedImage(oldSource);
            if (oldSourcePreview && oldSourcePreview !== this.previewImage) {
                releasePreviewCanvas(oldSourcePreview);
            }
        }
        this.maskBaseWidth = this.canvasWidth;
        this.maskBaseHeight = this.canvasHeight;
        this.clearMaskOverlay();
        this.maskDirty = this.isOutpaintModeActive();
        this.value = this.getValue();
        if (this.maskDirty) this.scheduleMaskCommit();
    }

    clearMaskOverlay() {
        if (this.maskOverlay) releasePreviewCanvas(this.maskOverlay);
        this.maskOverlay = null;
        this.maskOverlayKey = "";
    }

    clearInpaintMode() {
        const hadMask = this.hasMaskContent();
        this.invalidateMaskCommit();
        this.strokes = [];
        this.activeStroke = null;
        this.invert = false;
        this.tool = null;
        this.baseImageFile = "";
        this.maskImageFile = "";
        this.maskDirty = false;
        this.clearMaskOverlay();
        return hadMask;
    }

    clearOutpaintMode() {
        if (!this.transformActive) return false;
        this.invalidateMaskCommit();
        this.transformActive = false;
        this.transformDrag = null;
        this.setTransformCursor(null);
        const image = this.editingImage();
        if (image?.naturalWidth && image?.naturalHeight) {
            this.syncCanvasToImageSize(image);
            this.imageTransform = {
                x: 0,
                y: 0,
                width: this.canvasWidth,
                height: this.canvasHeight,
            };
        }
        this.baseImageFile = "";
        this.maskImageFile = "";
        this.maskBaseWidth = this.canvasWidth;
        this.maskBaseHeight = this.canvasHeight;
        this.maskDirty = false;
        this.clearMaskOverlay();
        return true;
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.setTransformCursor(null);
        this.previewLoadToken += 1;
        this.invalidateMaskCommit();
        this.closeActiveEditor();
        this.clearMaskOverlay();
        const previewImage = this.previewImage;
        const sourcePreviewImage = this.sourcePreviewImage;
        const image = this.image;
        const sourceImage = this.sourceImage;
        if (previewImage) releasePreviewCanvas(previewImage);
        if (sourcePreviewImage && sourcePreviewImage !== previewImage) releasePreviewCanvas(sourcePreviewImage);
        if (image) releaseDecodedImage(image);
        if (sourceImage && sourceImage !== image) releaseDecodedImage(sourceImage);
        this.previewImage = null;
        this.sourcePreviewImage = null;
        this.image = null;
        this.sourceImage = null;
        this.strokes = [];
        this.activeStroke = null;
        this.hoverImagePoint = null;
        clearNativeImageState(this.node);
    }

    setValue(value) {
        this.previewLoadToken += 1;
        this.invalidateMaskCommit();
        this.value = String(value || "");
        try {
            const state = JSON.parse(this.value || "{}");
            this.strokes = restoreStrokes(state.strokes);
            this.invert = Boolean(state.invert);
            this.tool = ["brush", "lasso", "eraser"].includes(state.mask_tool) ? state.mask_tool : null;
            this.aspectRatio = ASPECT_RATIOS[state.aspect_ratio] ? state.aspect_ratio : "1:1";
            const restoredShortSide = Number(state.short_side);
            this.latentShortSide = Number.isFinite(restoredShortSide)
                ? Math.min(4096, Math.max(256, roundCanvasDimension(restoredShortSide)))
                : 1024;
            this.swapDimensions = Boolean(state.swap_dimensions);
            const defaultSize = canvasSize(
                this.aspectRatio, this.latentShortSide, this.swapDimensions,
            );
            this.canvasWidth = roundCanvasDimension(state.canvas_width || defaultSize[0]);
            this.canvasHeight = roundCanvasDimension(state.canvas_height || defaultSize[1]);
            this.transformActive = Boolean(state.transform_active);
            const transform = state.image_transform;
            this.imageTransform = transform && ["x", "y", "width", "height"].every(
                (key) => Number.isFinite(Number(transform[key])),
            ) ? {
                x: Number(transform.x),
                y: Number(transform.y),
                width: Math.max(1, Number(transform.width)),
                height: Math.max(1, Number(transform.height)),
            } : null;
            const hadModeConflict = this.transformActive && this.hasMaskContent();
            if (hadModeConflict) {
                this.strokes = [];
                this.activeStroke = null;
                this.invert = false;
                this.tool = null;
            }
            const hasRestorableMask = Boolean(state.mask_active)
                || this.hasMaskContent()
                || Boolean(state.image_transform && state.source_image_file);
            this.baseImageFile = hasRestorableMask ? String(state.base_image_file || "") : "";
            this.sourceImageFile = String(state.source_image_file || state.base_image_file || "");
            this.maskImageFile = hasRestorableMask ? String(state.mask_image_file || "") : "";
            this.maskBaseWidth = this.canvasWidth;
            this.maskBaseHeight = this.canvasHeight;
            this.brushSize = Math.max(1, Number(state.brush_size) || 80);
            this.eraserSize = Math.max(1, Number(state.eraser_size) || 80);
            this.maskOpacity = Math.min(1, Math.max(0.05, Number(state.mask_opacity) || DEFAULT_MASK_OPACITY));
            this.maskColor = /^#[0-9a-f]{6}$/i.test(state.mask_color) ? state.mask_color : DEFAULT_MASK_COLOR;
            this.maskDirty = hasRestorableMask && (
                hadModeConflict
                ||
                !this.baseImageFile
                || !this.maskImageFile
                || Number(state.mask_render_version || 0) !== MASK_RENDER_VERSION
            );
            this.value = this.getValue();
            if (this.sourceImageFile && !this.sourceImage) {
                const token = ++this.previewLoadToken;
                loadImage({ filename: this.sourceImageFile, type: "input" })
                    .then((image) => {
                        if (this.disposed || token !== this.previewLoadToken) {
                            releaseDecodedImage(image);
                            return;
                        }
                        if (this.sourceImage && this.sourceImage !== image) releaseDecodedImage(this.sourceImage);
                        if (this.sourcePreviewImage) releasePreviewCanvas(this.sourcePreviewImage);
                        this.sourceImage = image;
                        this.sourcePreviewImage = makePreviewCanvas(image);
                        if (!this.image) {
                            this.image = image;
                            this.previewImage = this.sourcePreviewImage;
                        }
                        this.ensureImageTransform();
                        if (this.maskDirty) this.scheduleMaskCommit(0);
                        setDirty();
                    })
                    .catch(() => {});
            }
        } catch (_) {
            this.strokes = [];
            this.activeStroke = null;
            this.invert = false;
            this.tool = null;
            this.aspectRatio = "1:1";
            this.latentShortSide = 1024;
            this.swapDimensions = false;
            [this.canvasWidth, this.canvasHeight] = canvasSize("1:1", 1024, false);
            this.transformActive = false;
            this.imageTransform = null;
            this.baseImageFile = "";
            this.sourceImageFile = "";
            this.maskImageFile = "";
            this.maskBaseWidth = 0;
            this.maskBaseHeight = 0;
            this.maskDirty = false;
            this.clearMaskOverlay();
                this.value = this.getValue();
        }
    }

    async serializeValue() {
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        if (this.pending) await this.pending;
        if (this.maskDirty) await this.startMaskCommit();
        this.value = this.getValue();
        setDirty();
        return this.value;
    }

    imagePoint(pos, allowOutside = false) {
        if (!this.canvasRect?.[2] || !this.canvasRect?.[3]) return null;
        if (!allowOutside && !pointInRect(pos, this.canvasRect)) return null;
        const baseWidth = this.canvasWidth;
        const baseHeight = this.canvasHeight;
        if (!baseWidth || !baseHeight) return null;
        return [
            ((pos[0] - this.canvasRect[0]) / this.canvasRect[2]) * baseWidth,
            ((pos[1] - this.canvasRect[1]) / this.canvasRect[3]) * baseHeight,
        ];
    }

    drawMask(ctx) {
        if (!this.canvasRect || !this.editingImage()?.naturalWidth) return;
        if (!this.isMaskModeActive()) {
            this.clearMaskOverlay();
            return;
        }
        const overlayKey = this.maskOverlayCacheKey();
        if (this.maskOverlay && this.maskOverlayKey === overlayKey) {
            ctx.drawImage(this.maskOverlay, this.canvasRect[0], this.canvasRect[1], this.canvasRect[2], this.canvasRect[3]);
            return;
        }
        this.clearMaskOverlay();
        const displayOverlay = document.createElement("canvas");
        displayOverlay.width = Math.max(1, Math.round(this.canvasRect[2]));
        displayOverlay.height = Math.max(1, Math.round(this.canvasRect[3]));
        const displayCtx = displayOverlay.getContext("2d");
        const maskScale = this.previewMaskScale();
        this.drawMaskPreview(displayCtx, maskScale);
        this.maskOverlay = displayOverlay;
        this.maskOverlayKey = overlayKey;
        ctx.drawImage(displayOverlay, this.canvasRect[0], this.canvasRect[1], this.canvasRect[2], this.canvasRect[3]);
    }

    maskOverlayCacheKey() {
        const strokeKey = this.strokes.map((stroke) => {
            const points = stroke.points || [];
            const first = points[0] || [0, 0];
            const last = points[points.length - 1] || first;
            const checksum = points.reduce((total, point, index) => (
                total + (index + 1) * (Math.round(point[0]) * 31 + Math.round(point[1]) * 17)
            ), 0);
            return `${stroke.op}:${stroke.kind}:${stroke.brushSize}:${points.length}:${Math.round(first[0])},${Math.round(first[1])}:${Math.round(last[0])},${Math.round(last[1])}:${checksum}`;
        }).join("|");
        return [
            Math.round(this.canvasRect?.[0] || 0),
            Math.round(this.canvasRect?.[1] || 0),
            Math.round(this.canvasRect?.[2] || 0),
            Math.round(this.canvasRect?.[3] || 0),
            this.canvasWidth,
            this.canvasHeight,
            JSON.stringify(this.imageTransform || {}),
            this.strokes.length,
            strokeKey,
            this.invert ? 1 : 0,
            this.getFeatherPercent(),
            this.maskOpacity,
            this.maskColor,
        ].join(":");
    }

    previewMaskScale() {
        if (!this.canvasWidth || !this.canvasHeight || !this.canvasRect?.[2] || !this.canvasRect?.[3]) return 1;
        return Math.min(this.canvasRect[2] / this.canvasWidth, this.canvasRect[3] / this.canvasHeight);
    }

    drawMaskPreview(ctx, scale) {
        const core = this.makePreviewCoreMask(ctx.canvas.width, ctx.canvas.height, scale);
        if (!core) return;
        const percent = this.getFeatherPercent() / 100;
        if (percent > 0) {
            const outer = this.makePreviewOuterMask(ctx.canvas.width, ctx.canvas.height, scale, percent);
            if (outer) {
                const blend = this.makePreviewBlendMask(core, outer);
                this.drawTintedPreviewMask(ctx, blend, Math.min(1, this.maskOpacity));
                releasePreviewCanvas(blend);
                releasePreviewCanvas(outer);
                releasePreviewCanvas(core);
                return;
            }
        }
        this.drawTintedPreviewMask(ctx, core, Math.min(1, this.maskOpacity));
        releasePreviewCanvas(core);
    }

    makePreviewCoreMask(width, height, scale, brushScale = 1) {
        const layer = document.createElement("canvas");
        layer.width = width;
        layer.height = height;
        const layerCtx = layer.getContext("2d");
        if (this.isOutpaintModeActive()) {
            const transform = this.rasterImageTransform();
            const growth = Math.max(0, brushScale - 1)
                * Math.min(transform.width, transform.height) * 0.5 * scale;
            const imageX = transform.x * scale + growth;
            const imageY = transform.y * scale + growth;
            const imageWidth = transform.width * scale - growth * 2;
            const imageHeight = transform.height * scale - growth * 2;
            layerCtx.fillStyle = "#fff";
            layerCtx.fillRect(0, 0, width, height);
            if (imageWidth > 0 && imageHeight > 0) {
                layerCtx.clearRect(imageX, imageY, imageWidth, imageHeight);
            }
        }
        const manual = document.createElement("canvas");
        manual.width = width;
        manual.height = height;
        const manualCtx = manual.getContext("2d");
        if (this.invert) {
            manualCtx.fillStyle = "#fff";
            manualCtx.fillRect(0, 0, manual.width, manual.height);
        }
        const baseWidth = this.maskBaseWidth || this.image?.naturalWidth || 0;
        const baseHeight = this.maskBaseHeight || this.image?.naturalHeight || 0;
        const featherDiameters = strokeFeatherDiameters(this.strokes, baseWidth, baseHeight);
        for (const pass of ["add", "subtract"]) for (const stroke of this.strokes) {
            if (!stroke.points.length) continue;
            if (stroke.op !== pass) continue;
            const visible = this.invert ? stroke.op !== "add" : stroke.op === "add";
            manualCtx.globalCompositeOperation = visible ? "source-over" : "destination-out";
            manualCtx.strokeStyle = "#fff";
            manualCtx.fillStyle = "#fff";
            manualCtx.lineCap = "round";
            manualCtx.lineJoin = "round";
            const scaled = scaledMaskStroke(
                stroke, scale, brushScale, featherDiameters.get(stroke), visible,
            );
            if (!scaled) continue;
            manualCtx.lineWidth = scaled.brushSize;
            drawStrokeGeometry(manualCtx, scaled);
        }
        manualCtx.globalCompositeOperation = "source-over";
        layerCtx.drawImage(manual, 0, 0);
        releasePreviewCanvas(manual);
        return layer;
    }

    makePreviewOuterMask(width, height, scale, percent) {
        if (this.isOutpaintModeActive()) {
            const transform = this.rasterImageTransform();
            if (!transform) return null;
            const sourceShortSide = Math.min(transform.width, transform.height);
            const feather = this.outpaintFeatherWidth(transform);
            const brushScale = sourceShortSide > 0
                ? 1 + feather * 2 / sourceShortSide
                : 1;
            return this.makePreviewCoreMask(
                width, height, scale, brushScale,
            );
        }
        return this.makePreviewCoreMask(
            width,
            height,
            scale,
            1 + (BRUSH_FEATHER_RADIUS_MULTIPLIER - 1) * percent,
        );
    }

    makePreviewBlendMask(coreMask, outerMask) {
        const coreCtx = coreMask.getContext("2d");
        const corePixels = coreCtx.getImageData(0, 0, coreMask.width, coreMask.height);
        const outerPixels = outerMask.getContext("2d").getImageData(0, 0, outerMask.width, outerMask.height);
        const blend = document.createElement("canvas");
        blend.width = outerMask.width;
        blend.height = outerMask.height;
        const image = blend.getContext("2d").createImageData(blend.width, blend.height);
        for (let index = 0; index < image.data.length; index += 4) {
            const inCore = corePixels.data[index + 3] > 0;
            const inOuter = outerPixels.data[index + 3] > 0;
            const value = inCore
                ? 255
                : inOuter
                ? MASK_FEATHER_VALUE
                : 0;
            image.data[index] = value;
            image.data[index + 1] = value;
            image.data[index + 2] = value;
            image.data[index + 3] = value;
        }
        blend.getContext("2d").putImageData(image, 0, 0);
        return blend;
    }

    drawTintedPreviewMask(ctx, mask, opacity) {
        const layer = document.createElement("canvas");
        layer.width = mask.width;
        layer.height = mask.height;
        const layerCtx = layer.getContext("2d");
        layerCtx.drawImage(mask, 0, 0);
        layerCtx.globalCompositeOperation = "source-in";
        layerCtx.fillStyle = rgba(this.maskColor, opacity);
        layerCtx.fillRect(0, 0, layer.width, layer.height);
        layerCtx.globalCompositeOperation = "source-over";
        ctx.drawImage(layer, 0, 0);
        releasePreviewCanvas(layer);
    }

    hasActiveTool() {
        return ["lasso", "brush", "eraser"].includes(this.tool);
    }

    closeActiveEditor() {
        this.valueEditorClose?.();
    }

    currentToolSize() {
        return this.tool === "eraser" ? this.eraserSize : this.brushSize;
    }

    drawToolIcon(ctx, action, rect, enabled = true) {
        const cx = rect[0] + rect[2] / 2;
        const cy = rect[1] + rect[3] / 2;
        ctx.save();
        ctx.globalAlpha = enabled ? 1 : 0.35;
        ctx.strokeStyle = "#ddd";
        ctx.fillStyle = "#ddd";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (action === "brush") {
            ctx.beginPath(); ctx.moveTo(cx - 6, cy + 6); ctx.lineTo(cx + 6, cy - 6); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx - 7, cy + 7); ctx.lineTo(cx - 3, cy + 6); ctx.stroke();
        } else if (action === "lasso") {
            ctx.beginPath(); ctx.ellipse(cx, cy - 1, 7, 5, -0.2, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(cx + 5, cy + 3); ctx.quadraticCurveTo(cx + 8, cy + 7, cx + 3, cy + 7); ctx.stroke();
        } else if (action === "eraser") {
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(-Math.PI / 4);
            ctx.strokeRect(-7, -4, 14, 8); ctx.beginPath(); ctx.moveTo(2, -4); ctx.lineTo(2, 4); ctx.stroke(); ctx.restore();
        } else if (action === "transform") {
            ctx.strokeRect(cx - 6, cy - 5, 12, 10);
            for (const [x, y] of [[cx - 6, cy - 5], [cx + 6, cy - 5], [cx - 6, cy + 5], [cx + 6, cy + 5]]) {
                ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
            }
        } else {
            ctx.font = "18px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(action === "invert" ? "◐" : "↻", cx, cy);
        }
        ctx.restore();
    }

    drawProperty(ctx, action, label, value, left, y, width, height, enabled) {
        const rect = [left, y + 12, width, height - 24];
        this.buttons.push({ action, rect, enabled });
        ctx.fillStyle = enabled && this.activeEditorAction === action ? "#2563eb" : "#303030";
        ctx.fillRect(...rect);
        ctx.fillStyle = enabled ? "#bbb" : "#666";
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, rect[0] + 6, rect[1] + rect[3] / 2);
        ctx.fillStyle = enabled ? "#eee" : "#666";
        ctx.textAlign = "right";
        ctx.fillText(String(value), rect[0] + rect[2] - 6, rect[1] + rect[3] / 2);
        return left + width + 6;
    }

    makeBinaryMask(brushScale = 1, featherDiameters = null) {
        const width = this.canvasWidth;
        const height = this.canvasHeight;
        if (!width || !height) return null;
        if (!this.hasMaskContent()) return null;
        const overlay = document.createElement("canvas");
        overlay.width = Math.max(1, Math.round(width));
        overlay.height = Math.max(1, Math.round(height));
        const overlayCtx = overlay.getContext("2d");
        overlayCtx.lineCap = "round";
        overlayCtx.lineJoin = "round";
        if (this.invert) {
            overlayCtx.fillStyle = "#fff";
            overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
        }
        featherDiameters ||= strokeFeatherDiameters(this.strokes, width, height);
        for (const pass of ["add", "subtract"]) for (const stroke of this.strokes) {
            if (!stroke.points.length) continue;
            if (stroke.op !== pass) continue;
            const visible = this.invert ? stroke.op !== "add" : stroke.op === "add";
            overlayCtx.globalCompositeOperation = visible ? "source-over" : "destination-out";
            overlayCtx.strokeStyle = visible ? "#fff" : "#000";
            overlayCtx.fillStyle = overlayCtx.strokeStyle;
            const scaled = scaledMaskStroke(
                stroke, 1, brushScale, featherDiameters.get(stroke), visible,
            );
            if (!scaled) continue;
            overlayCtx.lineWidth = scaled.brushSize;
            drawStrokeGeometry(overlayCtx, scaled);
        }
        return overlay;
    }

    drawToolbar(ctx) {
        const [x, y, width, height] = this.toolbarRect;
        ctx.fillStyle = "#191919";
        ctx.fillRect(x, y, width, height);
        const groupPadding = 4;
        const itemGap = 4;
        const toolWidth = 28;
        const propertyWidth = 88;
        const toolActive = this.hasActiveTool();
        const propertyActive = toolActive || this.transformActive;
        const drawGroup = (left, groupWidth) => {
            ctx.fillStyle = "#232323";
            ctx.fillRect(left, y + 8, groupWidth, height - 16);
            ctx.strokeStyle = "#3d3d3d";
            ctx.lineWidth = 1;
            ctx.strokeRect(left + 0.5, y + 8.5, groupWidth - 1, height - 17);
        };

        const visibleToolActions = ["transform", "lasso"];
        const toolGroupWidth = (
            groupPadding * 2
            + toolWidth * visibleToolActions.length
            + itemGap * (visibleToolActions.length - 1)
        );
        let groupLeft = x + 8;
        drawGroup(groupLeft, toolGroupWidth);
        let left = groupLeft + groupPadding;
        const editingImageAvailable = Boolean(this.editingImage()?.naturalWidth);
        for (const action of visibleToolActions) {
            const rect = [left, y + 12, toolWidth, height - 24];
            const enabled = editingImageAvailable;
            const active = action === "transform" ? this.transformActive : action === this.tool;
            this.buttons.push({ action, rect, enabled });
            ctx.fillStyle = enabled && active ? "#2563eb" : "#303030";
            ctx.fillRect(...rect);
            this.drawToolIcon(ctx, action, rect, enabled);
            left += toolWidth + itemGap;
        }

        if (this.transformActive) {
            const ratioWidth = Math.min(150, Math.max(110, width * 0.2));
            const swapWidth = 62;
            const outpaintGroupWidth = (
                groupPadding * 2 + ratioWidth + itemGap + swapWidth
            );
            groupLeft = x + (width - outpaintGroupWidth) / 2;
            drawGroup(groupLeft, outpaintGroupWidth);
            left = groupLeft + groupPadding;
            left = this.drawProperty(
                ctx,
                "canvas_ratio",
                t("canvasRatio"),
                this.swapDimensions
                    ? this.aspectRatio.split(":").reverse().join(":")
                    : this.aspectRatio,
                left,
                y,
                ratioWidth,
                height,
                true,
            );
            const rect = [left, y + 12, swapWidth, height - 24];
            this.buttons.push({ action: "canvas_swap", rect, enabled: true });
            ctx.fillStyle = this.swapDimensions ? "#2563eb" : "#303030";
            ctx.fillRect(...rect);
            ctx.fillStyle = "#eee";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                t("swapCanvas"),
                rect[0] + rect[2] / 2,
                rect[1] + rect[3] / 2,
            );
        } else {
            const propertyGroupWidth = groupPadding * 2 + propertyWidth * 3 + 6 * 2;
            groupLeft = x + (width - propertyGroupWidth) / 2;
            drawGroup(groupLeft, propertyGroupWidth);
            left = groupLeft + groupPadding;
            const featherPercent = Math.round(Number(findWidget(this.node, "mask_feather")?.value || 0));
            left = this.drawProperty(ctx, "mask_feather", t("feather"), `${featherPercent}%`, left, y, propertyWidth, height, propertyActive);
            left = this.drawProperty(ctx, "mask_opacity", t("maskOpacity"), `${Math.round(this.maskOpacity * 100)}%`, left, y, propertyWidth, height, propertyActive);
            const colorStart = left;
            this.drawProperty(ctx, "mask_color", t("colorValue"), "", left, y, propertyWidth, height, propertyActive);
            const swatchRect = [colorStart + propertyWidth - 18, y + (height - 10) / 2, 10, 10];
            ctx.fillStyle = propertyActive ? this.maskColor : "#555";
            ctx.fillRect(...swatchRect);
            ctx.strokeStyle = "#777";
            ctx.lineWidth = 1;
            ctx.strokeRect(...swatchRect);
        }

        const actionGroupWidth = groupPadding * 2 + toolWidth * 2 + itemGap;
        groupLeft = x + width - 8 - actionGroupWidth;
        drawGroup(groupLeft, actionGroupWidth);
        let right = groupLeft + actionGroupWidth - groupPadding;
        for (const action of ["clear", "invert"]) {
            right -= toolWidth;
            const rect = [right, y + 12, toolWidth, height - 24];
            this.buttons.push({ action, rect, enabled: propertyActive });
            const active = propertyActive && this.flashAction === action;
            ctx.fillStyle = active ? "#2563eb" : "#303030";
            ctx.fillRect(...rect);
            this.drawToolIcon(ctx, action, rect, propertyActive);
            right -= itemGap;
        }
    }

    drawTransformHandles(ctx) {
        if (!this.transformActive || !this.contentRect) return;
        const visibleRect = this.visibleTransformRect();
        if (!visibleRect) return;
        const [x, y, width, height] = visibleRect;
        const points = [
            [x, y, "nw"], [x + width / 2, y, "n"], [x + width, y, "ne"],
            [x, y + height / 2, "w"], [x + width, y + height / 2, "e"],
            [x, y + height, "sw"], [x + width / 2, y + height, "s"], [x + width, y + height, "se"],
        ];
        ctx.save();
        ctx.beginPath();
        ctx.rect(...this.canvasRect.slice(0, 4));
        ctx.clip();
        ctx.strokeStyle = "#66ccff";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, width, height);
        for (const [cx, cy] of points) {
            const rect = [
                cx - TRANSFORM_HANDLE_SIZE / 2,
                cy - TRANSFORM_HANDLE_SIZE / 2,
                TRANSFORM_HANDLE_SIZE,
                TRANSFORM_HANDLE_SIZE,
            ];
            ctx.fillStyle = "#f5f5f5";
            ctx.fillRect(...rect);
            ctx.strokeStyle = "#2563eb";
            ctx.strokeRect(...rect);
        }
        ctx.restore();
    }

    getFeatherPercent() {
        return Math.min(100, Math.max(0, Number(findWidget(this.node, "mask_feather")?.value || 0)));
    }

    drawBrushCursor(ctx) {
        if (!this.hoverImagePoint || !this.canvasRect?.[4] || this.tool === "lasso" || !["brush", "eraser"].includes(this.tool)) return;
        const baseWidth = this.canvasWidth;
        const baseHeight = this.canvasHeight;
        if (!baseWidth || !baseHeight) return;
        const scaleX = this.canvasRect[2] / baseWidth;
        const scaleY = this.canvasRect[3] / baseHeight;
        const scale = Math.min(scaleX, scaleY);
        const x = this.canvasRect[0] + this.hoverImagePoint[0] * scaleX;
        const y = this.canvasRect[1] + this.hoverImagePoint[1] * scaleY;
        const toolSize = this.activeStroke?.brushSize || this.currentToolSize();
        const feather = (toolSize / 2) * (BRUSH_FEATHER_RADIUS_MULTIPLIER - 1) * (this.getFeatherPercent() / 100);
        const innerRadius = Math.max(1, toolSize * scale / 2);
        const outerRadius = Math.max(innerRadius, (toolSize / 2 + feather) * scale);
        const ring = (radius, opacity = 1) => {
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(0, 0, 0, ${0.85 * opacity})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.strokeStyle = `rgba(255, 255, 255, ${0.95 * opacity})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        };
        ring(outerRadius, 0.5);
        ring(innerRadius);
    }

    draw(ctx, node, width, y, height) {
        const widgetHeight = Math.max(220, Number(this.computedHeight) || Number(height) || 220);
        this.rect = [PAD, y + 4, Math.max(1, width - PAD * 2), widgetHeight - 8];
        this.toolbarRect = [this.rect[0], this.rect[1] + this.rect[3] - TOOLBAR_HEIGHT, this.rect[2], TOOLBAR_HEIGHT];
        const previewRect = [
            this.rect[0], this.rect[1], this.rect[2],
            this.rect[3] - TOOLBAR_HEIGHT,
        ];

        ctx.save();
        ctx.fillStyle = "#080808";
        ctx.fillRect(...previewRect);
        this.canvasRect = fitSizeRect(this.canvasWidth, this.canvasHeight, previewRect);
        this.contentRect = null;
        if (this.canvasRect) {
            ctx.fillStyle = "#111";
            ctx.fillRect(this.canvasRect[0], this.canvasRect[1], this.canvasRect[2], this.canvasRect[3]);
            ctx.save();
            ctx.beginPath();
            ctx.rect(this.canvasRect[0], this.canvasRect[1], this.canvasRect[2], this.canvasRect[3]);
            ctx.clip();
            const resultMatchesCanvas = this.outpaintResultVisible
                && this.image?.naturalWidth === this.canvasWidth
                && this.image?.naturalHeight === this.canvasHeight;
            if (resultMatchesCanvas) {
                this.contentRect = [...this.canvasRect.slice(0, 4)];
                ctx.drawImage(this.previewImage || this.image, ...this.canvasRect.slice(0, 4));
            } else if (this.transformActive
                && this.editingImage()?.naturalWidth) {
                const transform = this.ensureImageTransform();
                const scale = this.canvasRect[4];
                this.contentRect = [
                    this.canvasRect[0] + transform.x * scale,
                    this.canvasRect[1] + transform.y * scale,
                    transform.width * scale,
                    transform.height * scale,
                ];
                ctx.drawImage(this.sourcePreviewImage || this.editingImage(), ...this.contentRect);
            } else if (this.image?.naturalWidth) {
                // A canvas ratio change must not rescale the already generated
                // image independently on each axis. Keep the source aspect
                // ratio until the transform tool explicitly changes it.
                this.contentRect = fitSizeRect(
                    this.image.naturalWidth,
                    this.image.naturalHeight,
                    this.canvasRect.slice(0, 4),
                ).slice(0, 4);
                ctx.drawImage(this.previewImage || this.image, ...this.contentRect);
            }
            if (this.isMaskModeActive()) this.drawMask(ctx);
            ctx.restore();
            this.drawTransformHandles(ctx);
            ctx.strokeStyle = "#444";
            ctx.lineWidth = 1;
            ctx.strokeRect(this.canvasRect[0] + 0.5, this.canvasRect[1] + 0.5, this.canvasRect[2] - 1, this.canvasRect[3] - 1);
            const count = Number(node._no8dGeneratePreviewCount) || 0;
            const index = Number(node._no8dGeneratePreviewIndex) || 0;
            if (count > 1) {
                const label = `${index + 1}/${count}`;
                ctx.font = "12px sans-serif";
                const labelWidth = ctx.measureText(label).width + 14;
                const x = previewRect[0] + previewRect[2] - labelWidth - 8;
                const yPos = previewRect[1] + previewRect[3] - 28;
                ctx.fillStyle = "rgba(0,0,0,0.55)";
                ctx.beginPath();
                ctx.roundRect?.(x, yPos, labelWidth, 22, 5);
                if (!ctx.roundRect) ctx.rect(x, yPos, labelWidth, 22);
                ctx.fill();
                ctx.fillStyle = "#fff";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(label, x + labelWidth / 2, yPos + 11);
            }
            this.drawBrushCursor(ctx);
        }
        if (!this.image?.naturalWidth) {
                ctx.fillStyle = "#aaa";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(t("noImage"), previewRect[0] + 12, previewRect[1] + 12);
        }
        this.buttons = [];
        this.drawToolbar(ctx);
        ctx.restore();
        this.repositionActiveEditor();
    }

    renderExecutionMask() {
        const width = this.canvasWidth;
        const height = this.canvasHeight;
        if (!width || !height) return null;
        const featherDiameters = strokeFeatherDiameters(this.strokes, width, height);
        const coreMask = this.makeBinaryMask(1, featherDiameters);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (this.isOutpaintModeActive()) {
            const transform = this.rasterImageTransform();
            const feather = this.outpaintFeatherWidth(transform);
            ctx.fillStyle = "#fff";
            ctx.fillRect(0, 0, width, height);
            if (feather <= 0) {
                ctx.fillStyle = "#000";
                ctx.fillRect(transform.x, transform.y, transform.width, transform.height);
            } else {
                for (let step = 1; step <= EXECUTION_MASK_GRADIENT_STEPS; step += 1) {
                    const progress = step / EXECUTION_MASK_GRADIENT_STEPS;
                    const inset = feather * progress;
                    const innerWidth = Math.max(0, transform.width - inset * 2);
                    const innerHeight = Math.max(0, transform.height - inset * 2);
                    if (!innerWidth || !innerHeight) break;
                    const value = Math.round(255 * (1 - progress));
                    ctx.fillStyle = `rgb(${value}, ${value}, ${value})`;
                    ctx.fillRect(
                        transform.x + inset,
                        transform.y + inset,
                        innerWidth,
                        innerHeight,
                    );
                }
            }
        }

        if (!coreMask) return this.isOutpaintModeActive() ? canvas : null;
        const manual = document.createElement("canvas");
        manual.width = width;
        manual.height = height;
        const manualCtx = manual.getContext("2d");
        if (this.getFeatherPercent() <= 0) {
            manualCtx.drawImage(coreMask, 0, 0);
        } else {
            const featherPercent = this.getFeatherPercent() / 100;
            for (let step = EXECUTION_MASK_GRADIENT_STEPS - 1; step >= 0; step -= 1) {
                const { brushScale, value } = executionMaskGradientStep(step, featherPercent);
                const layer = step === 0
                    ? coreMask
                    : this.makeBinaryMask(brushScale, featherDiameters);
                if (!layer) continue;
                const layerCtx = layer.getContext("2d");
                layerCtx.globalCompositeOperation = "source-in";
                layerCtx.fillStyle = `rgb(${value}, ${value}, ${value})`;
                layerCtx.fillRect(0, 0, layer.width, layer.height);
                layerCtx.globalCompositeOperation = "source-over";
                manualCtx.drawImage(layer, 0, 0);
                if (layer !== coreMask) releasePreviewCanvas(layer);
            }
        }
        ctx.globalCompositeOperation = "lighten";
        ctx.drawImage(manual, 0, 0);
        ctx.globalCompositeOperation = "source-over";
        releasePreviewCanvas(manual);
        releasePreviewCanvas(coreMask);
        return canvas;
    }

    makeEmptyExecutionMask() {
        const width = this.canvasWidth;
        const height = this.canvasHeight;
        if (!width || !height) return null;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, width, height);
        return canvas;
    }

    renderCompositeBase() {
        const image = this.editingImage();
        const transform = this.rasterImageTransform();
        if (!image?.naturalWidth || !transform || !this.canvasWidth || !this.canvasHeight) return null;
        const canvas = document.createElement("canvas");
        canvas.width = this.canvasWidth;
        canvas.height = this.canvasHeight;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, transform.x, transform.y, transform.width, transform.height);
        return canvas;
    }

    async commitMask() {
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        const revision = this.maskRevision;
        if (!this.isMaskModeActive()) {
            if (this.isCurrentMaskRevision(revision)) {
                this.baseImageFile = "";
                this.maskImageFile = "";
                this.maskBaseWidth = this.canvasWidth;
                this.maskBaseHeight = this.canvasHeight;
                this.maskDirty = false;
                this.value = this.getValue();
            }
            return;
        }
        const editImage = this.editingImage();
        if (!editImage?.src && !this.sourceImageFile) return;
        if (!this.sourceImageFile && editImage?.src) {
            const source = await (await fetch(editImage.src)).blob();
            if (!this.isCurrentMaskRevision(revision)) return;
            const uploadedBase = await uploadBlob(
                source, "source", this.node.id, () => this.isCurrentMaskRevision(revision),
            );
            if (!this.isCurrentMaskRevision(revision)) return;
            this.sourceImageFile = uploadedBase;
        }
        if (!this.isCurrentMaskRevision(revision)) return;
        this.maskBaseWidth = this.canvasWidth;
        this.maskBaseHeight = this.canvasHeight;
        const base = this.renderCompositeBase();
        const mask = this.renderExecutionMask() || this.makeEmptyExecutionMask();
        if (!base || !mask) return;
        try {
            const baseBlob = await canvasBlob(base);
            if (!this.isCurrentMaskRevision(revision)) return;
            const uploadedBase = await uploadBlob(
                baseBlob, "base", this.node.id, () => this.isCurrentMaskRevision(revision),
            );
            if (!this.isCurrentMaskRevision(revision)) return;
            this.baseImageFile = uploadedBase;
            const blob = await canvasBlob(mask);
            if (!this.isCurrentMaskRevision(revision)) return;
            const uploadedMask = await uploadBlob(
                blob, "mask", this.node.id, () => this.isCurrentMaskRevision(revision),
            );
            if (!this.isCurrentMaskRevision(revision)) return;
            this.maskImageFile = uploadedMask;
            this.maskDirty = false;
            this.value = this.getValue();
        } finally {
            releasePreviewCanvas(base);
            releasePreviewCanvas(mask);
        }
    }

    startMaskCommit() {
        const task = this.commitMask();
        this.pending = task;
        const clearPending = () => {
            if (this.pending === task) this.pending = null;
        };
        task.then(clearPending, clearPending);
        return task;
    }

    scheduleMaskCommit(delay = 700) {
        if (this.maskCommitTimer) clearTimeout(this.maskCommitTimer);
        this.maskCommitTimer = setTimeout(() => {
            this.maskCommitTimer = null;
            if (!this.maskDirty) return;
            this.startMaskCommit().catch((error) => console.error("[NO8D Generate] mask upload failed", error));
        }, delay);
    }

    updateCanvasDimensions() {
        this.outpaintResultVisible = false;
        const [width, height] = canvasSize(
            this.aspectRatio, this.latentShortSide, this.swapDimensions,
        );
        this.canvasWidth = width;
        this.canvasHeight = height;
        this.maskBaseWidth = width;
        this.maskBaseHeight = height;
        if (this.transformActive && this.editingImage()?.naturalWidth) {
            this.fitImageTransformToCanvas();
        }
        this.clearMaskOverlay();
        if (this.isMaskModeActive() && this.editingImage()?.naturalWidth) {
            this.markMaskDirty();
            this.scheduleMaskCommit();
        }
        this.value = this.getValue();
        setDirty();
    }

    promoteOutpaintResultToEditingBase() {
        const result = this.image;
        if (!this.outpaintResultVisible
            || !result?.naturalWidth
            || result.naturalWidth !== this.canvasWidth
            || result.naturalHeight !== this.canvasHeight) {
            return false;
        }
        const oldSource = this.sourceImage;
        const oldSourcePreview = this.sourcePreviewImage;
        this.sourceImage = result;
        this.sourcePreviewImage = this.previewImage;
        this.sourceImageFile = "";
        this.baseImageFile = "";
        this.maskImageFile = "";
        this.maskBaseWidth = this.canvasWidth;
        this.maskBaseHeight = this.canvasHeight;
        this.imageTransform = {
            x: 0,
            y: 0,
            width: this.canvasWidth,
            height: this.canvasHeight,
        };
        this.outpaintResultVisible = false;
        this.invalidateMaskCommit();
        this.maskDirty = false;
        this.clearMaskOverlay();
        if (oldSource && oldSource !== result) releaseDecodedImage(oldSource);
        if (oldSourcePreview && oldSourcePreview !== this.previewImage) {
            releasePreviewCanvas(oldSourcePreview);
        }
        return true;
    }

    activateTransform() {
        if (!this.editingImage()?.naturalWidth) return;
        if (this.transformActive && this.outpaintResultVisible) {
            this.promoteOutpaintResultToEditingBase();
        }
        this.outpaintResultVisible = false;
        this.closeActiveEditor();
        const activating = !this.transformActive;
        if (activating) this.clearInpaintMode();
        this.tool = null;
        this.transformActive = activating;
        if (this.transformActive) {
            if (!this.sourceImage) {
                this.sourceImage = this.image;
                this.sourcePreviewImage = this.previewImage;
            }
            this.ensureImageTransform();
            this.markMaskDirty();
            this.scheduleMaskCommit();
        } else {
            this.invalidateMaskCommit();
            this.maskDirty = this.hasMaskContent();
            this.clearMaskOverlay();
            this.setTransformCursor(null);
        }
        this.value = this.getValue();
        setDirty();
    }

    runAction(action) {
        if (this.outpaintResultVisible
            && ["transform", "lasso", "brush", "eraser"].includes(action)) {
            this.promoteOutpaintResultToEditingBase();
        }
        if (action !== "transform") this.outpaintResultVisible = false;
        if (action === "brush" || action === "lasso" || action === "eraser") {
            this.closeActiveEditor();
            this.clearOutpaintMode();
            this.tool = this.tool === action ? null : action;
        } else if (action === "transform") {
            this.activateTransform();
        } else if (action === "canvas_swap") {
            this.swapDimensions = !this.swapDimensions;
            this.updateCanvasDimensions();
        } else if (action === "invert") {
            this.invert = !this.invert;
            this.clearMaskOverlay();
                this.markMaskDirty();
            this.scheduleMaskCommit();
        } else if (action === "clear") {
            this.clearMaskState();
        }
        if (action === "invert" || action === "clear") {
            this.flashAction = action;
            setTimeout(() => {
                if (this.flashAction === action) this.flashAction = null;
                setDirty();
            }, 140);
        }
        this.value = this.getValue();
        setDirty();
    }

    propertyValue(action) {
        if (action === "brush_size") return this.currentToolSize();
        if (action === "mask_feather") {
            return Math.round(Number(findWidget(this.node, "mask_feather")?.value || 0));
        }
        return Math.round(this.maskOpacity * 100);
    }

    setProperty(action, value) {
        this.outpaintResultVisible = false;
        if (action === "brush_size") {
            const size = Math.min(512, Math.max(1, Math.round(value)));
            if (this.tool === "eraser") this.eraserSize = size;
            else this.brushSize = size;
        } else if (action === "mask_feather") {
            const widget = findWidget(this.node, "mask_feather");
            if (widget) widget.value = Math.round(Math.min(100, Math.max(0, value)));
            this.markMaskDirty();
        } else {
            this.maskOpacity = Math.min(1, Math.max(0.05, value / 100));
        }
        this.clearMaskOverlay();
        setDirty();
    }

    positionBottomEditor(editor, _event, _nodePos, height = EDITOR_HEIGHT) {
        const canvas = app.canvas?.canvas;
        const dragScale = app.canvas?.ds;
        if (!canvas || !dragScale || !this.node?.pos) return;
        const scale = Number(app.canvas?.ds?.scale) || 1;
        const toolbar = this.toolbarRect || this.rect;
        const screenPoint = dragScale.convertOffsetToCanvas([
            this.node.pos[0] + toolbar[0],
            this.node.pos[1] + toolbar[1],
        ]);
        const canvasRect = canvas.getBoundingClientRect();
        editor.style.position = "fixed";
        editor.style.left = `${canvasRect.left + screenPoint[0]}px`;
        editor.style.top = `${canvasRect.top + screenPoint[1] - height * scale}px`;
        editor.style.width = `${toolbar[2]}px`;
        editor.style.height = `${height}px`;
        editor.style.transform = `scale(${scale})`;
        editor.style.transformOrigin = "left top";
        editor.style.zIndex = "100000";
    }

    repositionActiveEditor() {
        const active = this.activeEditor;
        if (!active?.element?.isConnected) return;
        this.positionBottomEditor(active.element, null, null, active.height);
    }

    bindEditorEvents(editor) {
        for (const eventName of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel"]) {
            editor.addEventListener(eventName, (inputEvent) => inputEvent.stopPropagation());
        }
    }

    createEditorGroups(editor) {
        editor.style.cssText = [
            "display:flex", "align-items:center", "justify-content:space-between", "gap:12px",
            "box-sizing:border-box", "padding:8px", "background:rgba(0,0,0,.8)",
            "border:0", "border-bottom:1px solid #555", "border-radius:0", "box-shadow:none",
        ].join(";");
        const presetGroup = document.createElement("div");
        presetGroup.style.cssText = [
            "display:flex", "align-items:center", "justify-content:flex-start", "gap:6px",
            "height:40px", "box-sizing:border-box", "padding:4px",
            "background:#232323", "border:1px solid #444", "border-radius:3px",
        ].join(";");
        const valueGroup = document.createElement("div");
        valueGroup.style.cssText = [
            "display:flex", "align-items:center", "justify-content:flex-end", "gap:8px",
            "height:40px", "box-sizing:border-box", "padding:4px 6px", "flex:1 1 auto",
            "background:#232323", "border:1px solid #444", "border-radius:3px",
        ].join(";");
        editor.append(presetGroup, valueGroup);
        return { presetGroup, valueGroup };
    }

    openColorPicker(event, _buttonRect, nodePos) {
        this.valueEditorClose?.();
        const editor = document.createElement("div");
        editor.classList.add("no8d-ui", "no8d-panel");
        const { presetGroup, valueGroup } = this.createEditorGroups(editor);
        this.activeEditor = { element: editor, height: EDITOR_HEIGHT };
        this.activeEditorAction = "mask_color";
        setDirty();
        this.positionBottomEditor(editor, event, nodePos);
        this.bindEditorEvents(editor);

        const presets = ["#ff5a5f", "#ffd54f", DEFAULT_MASK_COLOR];
        const presetButtons = [];
        for (const color of presets) {
            const preset = document.createElement("button");
            preset.classList.add("no8d-color-swatch");
            preset.type = "button";
            preset.style.cssText = `width:32px;height:32px;border:1px solid #777;border-radius:3px;background:${color};cursor:pointer;`;
            preset.addEventListener("click", () => update(color));
            preset.dataset.value = color.toLowerCase();
            presetButtons.push(preset);
            presetGroup.append(preset);
        }

        const spectrum = document.createElement("input");
        spectrum.type = "range";
        spectrum.min = "0";
        spectrum.max = "360";
        spectrum.step = "1";
        spectrum.value = String(rgbToHue(...hexToRgb(this.maskColor)));
        spectrum.style.cssText = [
            "flex:1 1 auto", "min-width:120px", "height:14px", "appearance:none",
            "border:1px solid #777", "border-radius:3px",
            "background:linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
            "cursor:pointer",
        ].join(";");

        const hexInput = document.createElement("input");
        hexInput.type = "text";
        hexInput.value = this.maskColor.toUpperCase();
        hexInput.maxLength = 7;
        hexInput.style.cssText = "width:86px;height:28px;box-sizing:border-box;padding:3px 7px;color:#eee;background:#181818;border:1px solid #666;border-radius:3px;";

        const update = (value) => {
            const normalized = String(value || "").trim();
            if (!/^#[0-9a-f]{6}$/i.test(normalized)) return;
            this.maskColor = normalized.toLowerCase();
            spectrum.value = String(rgbToHue(...hexToRgb(this.maskColor)));
            hexInput.value = this.maskColor.toUpperCase();
            for (const preset of presetButtons) {
                const selected = preset.dataset.value === this.maskColor;
                preset.style.outline = selected ? "2px solid #2563eb" : "none";
                preset.style.outlineOffset = selected ? "1px" : "0";
            }
            this.clearMaskOverlay();
                setDirty();
        };
        update(this.maskColor);
        spectrum.addEventListener("input", () => update(hueToHex(spectrum.value)));
        hexInput.addEventListener("input", () => update(hexInput.value));

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            editor.remove();
            document.removeEventListener("pointerdown", outside, true);
            if (this.valueEditorClose === close) this.valueEditorClose = null;
            if (this.activeEditor?.element === editor) this.activeEditor = null;
            if (this.activeEditorAction === "mask_color") this.activeEditorAction = null;
            setDirty();
        };
        const outside = (outsideEvent) => {
            if (!editor.contains(outsideEvent.target)) setTimeout(close, 0);
        };
        hexInput.addEventListener("keydown", (keyEvent) => {
            if (shouldPassKeyToComfy(keyEvent)) return;
            keyEvent.stopPropagation();
            if (keyEvent.key === "Enter") {
                update(hexInput.value);
                close();
            } else if (keyEvent.key === "Escape") close();
        });
        valueGroup.append(spectrum, hexInput);
        document.body.append(editor);
        this.valueEditorClose = close;
        setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    }

    openRatioEditor(event, _buttonRect, nodePos) {
        this.valueEditorClose?.();
        const editor = document.createElement("div");
        editor.className = "no8d-generate-ratio-editor no8d-ui no8d-panel";
        const { presetGroup, valueGroup } = this.createEditorGroups(editor);
        valueGroup.remove();
        presetGroup.style.flex = "1 1 auto";
        presetGroup.style.justifyContent = "center";
        this.activeEditor = { element: editor, height: EDITOR_HEIGHT };
        this.activeEditorAction = "canvas_ratio";
        this.positionBottomEditor(editor, event, nodePos);
        this.bindEditorEvents(editor);

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            editor.remove();
            document.removeEventListener("pointerdown", outside, true);
            if (this.valueEditorClose === close) this.valueEditorClose = null;
            if (this.activeEditor?.element === editor) this.activeEditor = null;
            if (this.activeEditorAction === "canvas_ratio") this.activeEditorAction = null;
            setDirty();
        };
        const outside = (outsideEvent) => {
            if (!editor.contains(outsideEvent.target)) setTimeout(close, 0);
        };
        for (const ratio of Object.keys(ASPECT_RATIOS)) {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = ratio;
            const selected = ratio === this.aspectRatio;
            button.style.cssText = [
                "min-width:54px", "height:32px", "padding:0 8px", "color:#ddd",
                `background:${selected ? "#2563eb" : "#292929"}`,
                `border:1px solid ${selected ? "#2563eb" : "#555"}`,
                "border-radius:3px", "cursor:pointer",
            ].join(";");
            button.addEventListener("click", () => {
                this.aspectRatio = ratio;
                this.updateCanvasDimensions();
                close();
            });
            presetGroup.append(button);
        }
        document.body.append(editor);
        this.valueEditorClose = close;
        setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
    }

    openNumberEditor(action, event, buttonRect, nodePos) {
        this.valueEditorClose?.();
        const min = action === "brush_size" ? 1
            : action === "mask_feather" ? 0 : 5;
        const max = action === "brush_size" ? 512
            : 100;
        const editor = document.createElement("div");
        editor.className = "no8d-generate-value-editor no8d-ui no8d-panel";
        const { presetGroup, valueGroup } = this.createEditorGroups(editor);
        this.activeEditor = { element: editor, height: EDITOR_HEIGHT };
        this.activeEditorAction = action;
        setDirty();
        this.positionBottomEditor(editor, event, nodePos);

        const presetValues = action === "brush_size"
            ? [40, 80, 160]
            : action === "mask_feather"
                ? [30, 60, 90]
                : [20, 40, 60];
        const presetButtons = [];
        for (const value of presetValues) {
            const preset = document.createElement("button");
            preset.type = "button";
            preset.textContent = String(value);
            preset.style.cssText = "min-width:46px;height:32px;padding:0 10px;color:#ddd;background:#292929;border:1px solid #555;border-radius:3px;cursor:pointer;";
            preset.addEventListener("click", () => update(value));
            preset.dataset.value = String(value);
            presetButtons.push(preset);
            presetGroup.append(preset);
        }

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(min);
        slider.max = String(max);
        slider.step = "1";
        slider.value = String(this.propertyValue(action));
        slider.style.cssText = "flex:1 1 auto; min-width:0; accent-color:#2563eb;";

        const input = document.createElement("input");
        input.type = "number";
        input.value = slider.value;
        input.min = String(min);
        input.max = String(max);
        input.step = "1";
        selectNumberOnFocus(input);
        input.style.cssText = [
            "width:72px", "height:28px", "box-sizing:border-box", "padding:3px 6px",
            "color:#eee", "background:#181818", "border:1px solid #555", "border-radius:4px",
        ].join(";");

        this.bindEditorEvents(editor);
        const update = (value) => {
            const numeric = Math.min(max, Math.max(min, Number(value)));
            if (!Number.isFinite(numeric)) return;
            slider.value = String(numeric);
            input.value = String(numeric);
            this.setProperty(action, numeric);
            for (const preset of presetButtons) {
                const selected = Number(preset.dataset.value) === numeric;
                preset.style.background = selected ? "#2563eb" : "#292929";
                preset.style.borderColor = selected ? "#2563eb" : "#555";
            }
        };
        update(this.propertyValue(action));
        slider.addEventListener("input", () => update(slider.value));
        slider.addEventListener("change", () => {
            input.focus();
            input.select();
        });
        slider.addEventListener("pointerup", () => {
            requestAnimationFrame(() => {
                input.focus();
                input.select();
            });
        });
        input.addEventListener("input", () => {
            if (input.value === "") return;
            const numeric = Number(input.value);
            if (!Number.isFinite(numeric)) return;
            const clamped = Math.min(max, Math.max(min, numeric));
            slider.value = String(clamped);
            this.setProperty(action, clamped);
        });
        input.addEventListener("keydown", (keyEvent) => {
            if (keyEvent.key !== "ArrowUp" && keyEvent.key !== "ArrowDown") return;
            keyEvent.preventDefault();
            keyEvent.stopPropagation();
            const direction = keyEvent.key === "ArrowUp" ? 1 : -1;
            const step = keyEvent.shiftKey ? 10 : 1;
            update(Number(input.value || this.propertyValue(action)) + direction * step);
            input.select();
        });

        let closed = false;
        const close = () => {
            if (closed) return;
            closed = true;
            if (input.value !== "" && Number.isFinite(Number(input.value))) update(input.value);
            editor.remove();
            document.removeEventListener("pointerdown", outside, true);
            if (this.valueEditorClose === close) this.valueEditorClose = null;
            if (this.activeEditor?.element === editor) this.activeEditor = null;
            if (this.activeEditorAction === action) this.activeEditorAction = null;
            setDirty();
            if (action === "mask_feather" && this.maskDirty) {
                this.scheduleMaskCommit();
            }
        };
        const outside = (outsideEvent) => {
            if (!editor.contains(outsideEvent.target)) setTimeout(close, 0);
        };
        editor.addEventListener("keydown", (keyEvent) => {
            if (shouldPassKeyToComfy(keyEvent)) return;
            keyEvent.stopPropagation();
            if (keyEvent.key === "Enter" || keyEvent.key === "Escape") close();
        });
        valueGroup.append(slider, input);
        document.body.append(editor);
        this.valueEditorClose = close;
        setTimeout(() => document.addEventListener("pointerdown", outside, true), 0);
        input.focus();
        input.select();
    }

    canvasPointer(pos) {
        if (!this.canvasRect?.[4]) return null;
        return [
            (pos[0] - this.canvasRect[0]) / this.canvasRect[4],
            (pos[1] - this.canvasRect[1]) / this.canvasRect[4],
        ];
    }

    transformHit(pos) {
        if (!this.transformActive || !pointInRect(pos, this.canvasRect)) return null;
        const visibleRect = this.visibleTransformRect();
        if (!visibleRect) return null;
        const [x, y, width, height] = visibleRect;
        const right = x + width;
        const bottom = y + height;
        const tolerance = Math.max(7, TRANSFORM_HANDLE_SIZE);
        const nearX = (value, target) => Math.abs(value - target) <= tolerance;
        const nearY = (value, target) => Math.abs(value - target) <= tolerance;
        const withinX = pos[0] >= x - tolerance && pos[0] <= right + tolerance;
        const withinY = pos[1] >= y - tolerance && pos[1] <= bottom + tolerance;

        if (nearX(pos[0], x) && nearY(pos[1], y)) return "nw";
        if (nearX(pos[0], right) && nearY(pos[1], y)) return "ne";
        if (nearX(pos[0], x) && nearY(pos[1], bottom)) return "sw";
        if (nearX(pos[0], right) && nearY(pos[1], bottom)) return "se";
        if (withinX && nearY(pos[1], y)) return "n";
        if (withinX && nearY(pos[1], bottom)) return "s";
        if (withinY && nearX(pos[0], x)) return "w";
        if (withinY && nearX(pos[0], right)) return "e";
        return pointInRect(pos, visibleRect) ? "move" : null;
    }

    visibleTransformRect() {
        if (!this.contentRect || !this.canvasRect) return null;
        const left = Math.max(this.contentRect[0], this.canvasRect[0]);
        const top = Math.max(this.contentRect[1], this.canvasRect[1]);
        const right = Math.min(
            this.contentRect[0] + this.contentRect[2],
            this.canvasRect[0] + this.canvasRect[2],
        );
        const bottom = Math.min(
            this.contentRect[1] + this.contentRect[3],
            this.canvasRect[1] + this.canvasRect[3],
        );
        if (right <= left || bottom <= top) return null;
        return [left, top, right - left, bottom - top];
    }

    setTransformCursor(hit, dragging = false) {
        const cursors = {
            nw: "nwse-resize",
            se: "nwse-resize",
            ne: "nesw-resize",
            sw: "nesw-resize",
            n: "ns-resize",
            s: "ns-resize",
            e: "ew-resize",
            w: "ew-resize",
            move: dragging ? "grabbing" : "grab",
        };
        const cursor = cursors[hit] || "";
        const revision = ++this.transformCursorRevision;
        const applyCursor = () => {
            if (revision !== this.transformCursorRevision) return;
            const canvas = app.canvas?.canvas;
            if (!canvas?.style) return;
            if (cursor) canvas.style.setProperty("cursor", cursor, "important");
            else canvas.style.removeProperty("cursor");
        };
        // LiteGraph also writes the canvas cursor during pointer handling.
        // Apply once now and once after that handler has completed so hover
        // feedback is visible before the user starts dragging.
        applyCursor();
        requestAnimationFrame(applyCursor);
    }

    releaseTransformCursor() {
        this.transformCursorRevision += 1;
        app.canvas?.canvas?.style?.removeProperty("cursor");
    }

    isNodeResizeCorner(pos) {
        const width = Number(this.node?.size?.[0]) || 0;
        const height = Number(this.node?.size?.[1]) || 0;
        if (!width || !height || !Array.isArray(pos)) return false;
        const nearHorizontalEdge = pos[0] <= NODE_RESIZE_CORNER_SIZE
            || pos[0] >= width - NODE_RESIZE_CORNER_SIZE;
        const nearVerticalEdge = pos[1] <= NODE_RESIZE_CORNER_SIZE
            || pos[1] >= height - NODE_RESIZE_CORNER_SIZE;
        return nearHorizontalEdge && nearVerticalEdge;
    }

    updateHover(pos) {
        if (this.transformDrag || this.activeStroke) return;
        this.hoverImagePoint = this.imagePoint(pos);
        this.setTransformCursor(
            this.transformActive ? this.transformHit(pos) : null,
        );
        setCursorDirty();
    }

    clearHover() {
        if (this.transformDrag || this.activeStroke) return;
        this.hoverImagePoint = null;
        this.setTransformCursor(null);
        setCursorDirty();
    }

    beginTransformDrag(pos) {
        if (!this.transformActive || !this.contentRect) return false;
        if (this.outpaintResultVisible) {
            this.promoteOutpaintResultToEditingBase();
        }
        const hit = this.transformHit(pos);
        if (!hit) return false;
        const pointer = this.canvasPointer(pos);
        if (!pointer) return false;
        this.transformDrag = {
            handle: hit,
            pointer,
            transform: { ...this.ensureImageTransform() },
        };
        this.setTransformCursor(hit, true);
        return true;
    }

    snapImageTransform(transform) {
        const threshold = Math.min(this.canvasWidth, this.canvasHeight) * 0.05;
        const snapAxis = (position, size, canvasSize) => {
            const candidates = [0, canvasSize - size];
            const nearest = candidates.reduce((best, candidate) => (
                Math.abs(candidate - position) < Math.abs(best - position) ? candidate : best
            ));
            return Math.abs(nearest - position) <= threshold ? nearest : position;
        };
        return {
            ...transform,
            x: snapAxis(transform.x, transform.width, this.canvasWidth),
            y: snapAxis(transform.y, transform.height, this.canvasHeight),
        };
    }

    updateTransformDrag(pos, disableSnap = false) {
        const drag = this.transformDrag;
        const pointer = this.canvasPointer(pos);
        if (!drag || !pointer) return false;
        const original = drag.transform;
        const deltaX = pointer[0] - drag.pointer[0];
        const deltaY = pointer[1] - drag.pointer[1];
        if (drag.handle === "move") {
            this.imageTransform = {
                ...original,
                x: original.x + deltaX,
                y: original.y + deltaY,
            };
        } else {
            const ratio = original.width / original.height;
            const left = original.x;
            const right = original.x + original.width;
            const top = original.y;
            const bottom = original.y + original.height;
            const horizontal = drag.handle.includes("w")
                ? original.width - deltaX
                : drag.handle.includes("e") ? original.width + deltaX : null;
            const vertical = drag.handle.includes("n")
                ? original.height - deltaY
                : drag.handle.includes("s") ? original.height + deltaY : null;
            let width = horizontal;
            if (width == null && vertical != null) width = vertical * ratio;
            if (horizontal != null && vertical != null) {
                width = Math.abs(horizontal / original.width) >= Math.abs(vertical / original.height)
                    ? horizontal : vertical * ratio;
            }
            width = Math.max(16, Number(width) || 16);
            const height = width / ratio;
            let x = left;
            let y = top;
            if (drag.handle.includes("w")) x = right - width;
            else if (!drag.handle.includes("e")) x = left + (original.width - width) / 2;
            if (drag.handle.includes("n")) y = bottom - height;
            else if (!drag.handle.includes("s")) y = top + (original.height - height) / 2;
            this.imageTransform = { x, y, width, height };
        }
        if (!disableSnap) this.imageTransform = this.snapImageTransform(this.imageTransform);
        this.clearMaskOverlay();
        this.maskDirty = true;
        setCursorDirty();
        return true;
    }

    mouse(event, pos) {
        // ComfyUI passes custom-widget mouse positions in node-local
        // coordinates and keeps routing an active drag through CanvasPointer.
        const nodePos = pos;
        const type = String(event?.type || "");
        if (type.includes("contextmenu") || (type.includes("down") && event.button !== 0)) return false;
        // The custom canvas widget fills nearly the whole node. Never consume
        // pointer events in ComfyUI's native corner resize handles.
        if (!this.transformDrag && !this.activeStroke && this.isNodeResizeCorner(nodePos)) {
            this.releaseTransformCursor();
            return false;
        }

        if (type.includes("move")) {
            if (this.transformDrag || this.activeStroke) {
                this.hoverImagePoint = this.imagePoint(nodePos, true);
                if (this.transformActive) {
                    const hit = this.transformDrag?.handle || this.transformHit(nodePos);
                    this.setTransformCursor(hit, Boolean(this.transformDrag));
                }
                setCursorDirty();
            } else {
                this.updateHover(nodePos);
            }
        } else if ((type.includes("leave") || type.includes("out")) && !this.activeStroke) {
            this.clearHover();
        }

        if (type.includes("down")) {
            const button = (this.buttons || []).find((item) => pointInRect(nodePos, item.rect));
            if (button) {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (button.enabled === false) return true;
                if (button.action === "canvas_ratio") {
                    if (this.activeEditorAction === button.action) this.closeActiveEditor();
                    else this.openRatioEditor(event, button.rect, nodePos);
                } else if (["canvas_swap", "transform"].includes(button.action)) {
                    this.runAction(button.action);
                } else if (["brush", "eraser"].includes(button.action)) {
                    const wasActive = this.tool === button.action;
                    this.runAction(button.action);
                    if (!wasActive) this.openNumberEditor("brush_size", event, button.rect, nodePos);
                } else if (button.action === "lasso") {
                    this.runAction(button.action);
                } else if (["brush_size", "mask_feather", "mask_opacity"].includes(button.action)) {
                    if (this.activeEditorAction === button.action) this.closeActiveEditor();
                    else this.openNumberEditor(button.action, event, button.rect, nodePos);
                } else if (button.action === "mask_color") {
                    if (this.activeEditorAction === button.action) this.closeActiveEditor();
                    else this.openColorPicker(event, button.rect, nodePos);
                } else {
                    this.runAction(button.action);
                }
                return true;
            }
            if (this.beginTransformDrag(nodePos)) {
                event.preventDefault?.();
                event.stopPropagation?.();
                return true;
            }
            if (event.button !== 0 || !this.hasActiveTool()) return false;
            if (!this.maskBaseWidth || !this.maskBaseHeight) {
                this.maskBaseWidth = this.canvasWidth;
                this.maskBaseHeight = this.canvasHeight;
            }
            const point = this.imagePoint(nodePos);
            if (!point) return false;
            this.hoverImagePoint = point;
            this.activeStroke = {
                op: this.tool === "eraser" ? "subtract" : "add",
                kind: this.tool === "lasso" ? "lasso" : "brush",
                brushSize: this.currentToolSize(),
                points: [point],
            };
            this.strokes.push(this.activeStroke);
            this.markMaskDirty();
            this.clearMaskOverlay();
                setDirty();
            return true;
        }

        if (type.includes("move") && this.transformDrag) {
            return this.updateTransformDrag(nodePos, Boolean(event.altKey));
        }

        if (type.includes("move") && this.activeStroke) {
            const point = this.imagePoint(nodePos, true);
            if (point) this.activeStroke.points.push(point);
            this.clearMaskOverlay();
                this.maskDirty = true;
            setCursorDirty();
            return true;
        }

        if ((type.includes("up") || type.includes("cancel")) && this.transformDrag) {
            this.updateTransformDrag(nodePos, Boolean(event.altKey));
            this.transformDrag = null;
            this.setTransformCursor(this.transformHit(nodePos));
            this.markMaskDirty();
            this.scheduleMaskCommit();
            this.value = this.getValue();
            return true;
        }

        if ((type.includes("up") || type.includes("cancel")) && this.activeStroke) {
            if (type.includes("up")) {
                const point = this.imagePoint(nodePos, true);
                if (point) this.activeStroke.points.push(point);
            }
            this.activeStroke = null;
            this.scheduleMaskCommit();
            return true;
        }
        return pointInRect(nodePos, this.rect);
    }

    async setPreview(ref, options = {}) {
        if (this.disposed) return;
        const token = ++this.previewLoadToken;
        const keepEditingBase = this.isMaskModeActive();
        const previousImage = this.image;
        const previousPreview = this.previewImage;
        const previousSource = this.sourceImage;
        const previousSourcePreview = this.sourcePreviewImage;
        const image = await loadImage(ref);
        if (this.disposed || token !== this.previewLoadToken) {
            releaseDecodedImage(image);
            return;
        }
        const preview = makePreviewCanvas(image);
        this.image = image;
        this.previewImage = preview;
        if (!keepEditingBase) {
            this.outpaintResultVisible = false;
            this.sourceImage = image;
            this.sourcePreviewImage = preview;
            this.sourceImageFile = "";
            this.baseImageFile = "";
            this.maskImageFile = "";
            this.syncCanvasToImageSize(image);
            this.imageTransform = null;
            this.fitImageTransformToCanvas();
        } else {
            this.outpaintResultVisible = this.isOutpaintModeActive()
                && image.naturalWidth === this.canvasWidth
                && image.naturalHeight === this.canvasHeight;
        }
        syncNativeImageState(this.node, ref, image, options.refs);
        if (previousImage && previousImage !== image && previousImage !== this.sourceImage) {
            releaseDecodedImage(previousImage);
        }
        if (previousPreview && previousPreview !== preview && previousPreview !== this.sourcePreviewImage) {
            releasePreviewCanvas(previousPreview);
        }
        if (!keepEditingBase && previousSource && previousSource !== image && previousSource !== previousImage) {
            releaseDecodedImage(previousSource);
        }
        if (!keepEditingBase && previousSourcePreview && previousSourcePreview !== preview
            && previousSourcePreview !== previousPreview) {
            releasePreviewCanvas(previousSourcePreview);
        }
        if (options.clearMask) this.clearMaskState();
        else {
            const maskNeedsCommit = this.maskDirty;
            this.invalidateMaskCommit();
            this.activeStroke = null;
            this.clearMaskOverlay();
            this.maskDirty = maskNeedsCommit;
        }
        if (this.maskDirty) this.scheduleMaskCommit();
        setDirty();
    }
}

function findNodeFromExecutionId(id) {
    const executionId = String(id ?? "").split(".")[0];
    if (!executionId) return null;
    const parts = executionId.split(":").filter(Boolean);
    let graph = app.rootGraph || app.graph;
    let node = null;
    for (let index = 0; index < parts.length; index += 1) {
        const part = parts[index];
        node = graph?.getNodeById?.(part) || graph?.getNodeById?.(Number(part));
        if (!node) return null;
        if (index < parts.length - 1) graph = node.subgraph;
    }
    return node;
}

function findGenerateNodeForPreviewEvent(detail) {
    const displayNode = findNodeFromExecutionId(detail?.display_node);
    if (isGenerateNode(displayNode)) return displayNode;
    const directNode = findNodeFromExecutionId(detail?.node);
    return isGenerateNode(directNode) ? directNode : null;
}

async function applyGeneratePreview(node, message) {
    const widget = node?._no8dGenerateCanvas;
    if (!widget) return false;
    const refs = refsFromMessage(message);
    if (!refs.length) return false;
    const ref = refs[refs.length - 1];
    const key = `${ref.type || "temp"}\n${ref.subfolder || ""}\n${ref.filename}`;
    if (node._no8dGeneratePreviewLoad?.key === key) {
        await node._no8dGeneratePreviewLoad.promise;
        return true;
    }
    const promise = widget.setPreview(ref, { clearMask: false, refs });
    node._no8dGeneratePreviewLoad = { key, promise };
    try {
        await promise;
        suppressNativePreview(node);
        setDirty();
    } finally {
        if (node._no8dGeneratePreviewLoad?.promise === promise) {
            node._no8dGeneratePreviewLoad = null;
        }
    }
    return true;
}

app.registerExtension({
    name: "NO8D.Generate",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        // ComfyUI's default background hook creates its own IMAGE_PREVIEW
        // widget for image outputs. This node renders that output in its
        // editable canvas instead, so the native preview must not be created.
        nodeType.prototype.onDrawBackground = function () {};
        wrapBypassRefresh(nodeType);
        const originalFindResizeDirection = nodeType.prototype.findResizeDirection;
        nodeType.prototype.findResizeDirection = function (x, y) {
            if (this.resizable === false) return undefined;
            const rect = this.boundingRect;
            if (rect?.containsXy?.(x, y) && typeof rect.findContainingCorner === "function") {
                return rect.findContainingCorner(x, y, NODE_RESIZE_CORNER_SIZE);
            }
            return originalFindResizeDirection?.apply(this, arguments);
        };
        // Legacy custom-widget mouse callbacks only receive pointermove after
        // pointerdown in current LiteGraph. Node hover callbacks are the
        // supported path for pre-drag edge/corner cursor feedback.
        const originalOnMouseMove = nodeType.prototype.onMouseMove;
        nodeType.prototype.onMouseMove = function (event, pos, canvas) {
            const widget = this._no8dGenerateCanvas;
            if (widget?.isNodeResizeCorner?.(pos)) {
                // Release our forced image-transform cursor before LiteGraph
                // selects its own node-resize cursor.
                widget.releaseTransformCursor?.();
                return originalOnMouseMove?.apply(this, arguments);
            }
            const result = originalOnMouseMove?.apply(this, arguments);
            widget?.updateHover?.(pos);
            return result;
        };
        const originalOnMouseLeave = nodeType.prototype.onMouseLeave;
        nodeType.prototype.onMouseLeave = function () {
            this._no8dGenerateCanvas?.clearHover?.();
            originalOnMouseLeave?.apply(this, arguments);
        };
        const originalOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function () {
            originalOnExecuted?.apply(this, arguments);
            suppressNativePreview(this);
            // Expanded output nodes are attributed to this display node by
            // ComfyUI.  Handling the node callback directly avoids depending
            // on the transient expanded-node id format used by the global
            // `executed` websocket event.
            applyGeneratePreview(this, arguments[0]).catch((error) => {
                console.error("[NO8D Generate] node preview load failed", error);
            });
        };
        const originalOnRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            this._no8dGenerateCanvas?.dispose?.();
            this._no8dGenerateCanvas = null;
            originalOnRemoved?.apply(this, arguments);
        };
        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            originalOnConfigure?.apply(this, arguments);
            migrateGenerateSlots(this);
            hideToolbarWidgets(this);
            requestAnimationFrame(() => {
                createSamplerPanel(this);
                this._no8dGenerateSyncSampler?.();
                refreshBypassElements(this);
                restorePreview(this);
            });
        };
    },

    getCustomWidgets() {
        return {
            [CANVAS_TYPE](node, inputName, inputData) {
                const widget = new NO8DGenerateCanvasWidget(node, inputName, inputData[0]);
                node.addCustomWidget(widget);
                node._no8dGenerateCanvas = widget;
                restorePreview(node);
                return { widget };
            },
        };
    },

    nodeCreated(node) {
        if (!isGenerateNode(node)) return;
        migrateGenerateSlots(node);
        suppressNativePreview(node);
        hideToolbarWidgets(node);
        createSamplerPanel(node);
        refreshBypassElements(node);
        restorePreview(node);
        if ((Number(node.size?.[0]) || 0) < MIN_WIDTH) {
            node.setSize?.([MIN_WIDTH, Number(node.size?.[1]) || node.computeSize?.()[1] || 0]);
        }
    },

    setup() {
        activeLocale = no8dLocale();
        setTimeout(() => refreshAllGenerateLabels(true), 500);
        window.addEventListener("storage", () => refreshAllGenerateLabels(true));
        window.addEventListener("languagechange", () => refreshAllGenerateLabels(true));
        api.addEventListener("executed", async ({ detail }) => {
            const node = findGenerateNodeForPreviewEvent(detail);
            if (!node) return;
            try {
                await applyGeneratePreview(node, detail?.output || detail);
            } catch (error) {
                console.error("[NO8D Generate] preview load failed", error);
            }
        });
    },
});
