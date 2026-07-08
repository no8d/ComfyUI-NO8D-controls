import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { shouldPassKeyToComfy } from "./no8d_comfy_events.js";
import { no8dLocale, t } from "./no8d_i18n.js";

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
const MAX_PREVIEW_EDGE = 1280;
let activeLocale = "";

function isGenerateNode(node) {
    const type = node?.constructor?.comfyClass || node?.comfyClass || node?.type;
    return type === NODE_NAME;
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

function forceSeedControlBeforeQueue(node) {
    const control = seedControlWidget(node);
    if (!control || control._no8dGenerateBeforeQueue) return;
    const nativeBefore = control.beforeQueued;
    const nativeAfter = control.afterQueued;
    control.beforeQueued = function (options) {
        nativeBefore?.call(this, options);
        if (String(this.value || "randomize") !== "fixed") nativeAfter?.call(this, options);
        node._no8dGenerateSyncSampler?.();
    };
    control.afterQueued = function () {};
    control._no8dGenerateBeforeQueue = true;
}

function createSamplerPanel(node) {
    if (node._no8dGenerateSamplerPanel || typeof node.addDOMWidget !== "function") return;
    const root = document.createElement("div");
    root.style.cssText = [
        "display:grid", "grid-template-rows:repeat(2,36px)", "gap:6px",
        "box-sizing:border-box", "width:100%", "height:96px", "padding:9px 8px",
        "--comfy-widget-min-height:96px", "--comfy-widget-max-height:96px",
        "background:#171717", "color:#ddd", "font:12px sans-serif",
    ].join(";");

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
        lock.style.background = locked ? "#102b4f" : "#303030";
        lock.style.borderColor = locked ? "#3b82f6" : "#666";
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
    forceSeedControlBeforeQueue(node);
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
    const direct = imageRefs(message.images);
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

async function uploadBlob(blob, filename) {
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

function fitRect(image, rect) {
    if (!image?.naturalWidth || !image?.naturalHeight) return null;
    const scale = Math.min(rect[2] / image.naturalWidth, rect[3] / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    return [
        rect[0] + (rect[2] - width) / 2,
        rect[1] + (rect[3] - height) / 2,
        width,
        height,
        scale,
    ];
}

function hexToRgb(hex) {
    const value = String(hex || DEFAULT_MASK_COLOR).replace("#", "");
    const normalized = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
    const number = Number.parseInt(normalized, 16);
    if (!Number.isFinite(number)) return [102, 204, 255];
    return [number >> 16, (number >> 8) & 255, number & 255];
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

function drawScaledStrokeGeometry(ctx, stroke, scale) {
    if (!stroke?.points?.length) return;
    const scaledStroke = {
        ...stroke,
        brushSize: stroke.brushSize * scale,
        points: stroke.points.map((point) => [point[0] * scale, point[1] * scale]),
    };
    drawStrokeGeometry(ctx, scaledStroke);
}

class NO8DGenerateCanvasWidget {
    constructor(node, name, type) {
        this.node = node;
        this.name = name;
        this.type = type;
        this.options = {};
        this.value = "";
        this.image = null;
        this.previewImage = null;
        this.renderCache = null;
        this.imageRect = null;
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
        this.baseImageFile = "";
        this.maskImageFile = "";
        this.maskOverlay = null;
        this.interactiveMaskCanvas = null;
        this.maskDirty = false;
        this.pending = null;
        this.maskCommitTimer = null;
        this.valueEditorClose = null;
        this.activeEditor = null;
        this.activeEditorAction = null;
        this.flashAction = null;
    }

    computeLayoutSize() {
        return {
            minWidth: 1,
            minHeight: 220,
            maxHeight: 1000000,
        };
    }

    getValue() {
        return JSON.stringify({
            base_image_file: this.baseImageFile,
            mask_image_file: this.maskImageFile,
            mask_active: this.strokes.length > 0 || this.invert,
            brush_size: this.brushSize,
            eraser_size: this.eraserSize,
            mask_opacity: this.maskOpacity,
            mask_color: this.maskColor,
        });
    }

    hasMaskContent() {
        return this.strokes.length > 0 || this.invert;
    }

    clearMaskState() {
        this.strokes = [];
        this.activeStroke = null;
        this.hoverImagePoint = null;
        this.invert = false;
        this.baseImageFile = "";
        this.maskImageFile = "";
        this.maskOverlay = null;
        this.maskDirty = false;
        this.pending = null;
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        if (this.interactiveMaskCanvas) {
            releasePreviewCanvas(this.interactiveMaskCanvas);
            this.interactiveMaskCanvas = null;
        }
        this.clearRenderCache();
    }

    clearRenderCache() {
        if (this.renderCache?.canvas) releasePreviewCanvas(this.renderCache.canvas);
        this.renderCache = null;
    }

    setValue(value) {
        this.value = String(value || "");
        try {
            const state = JSON.parse(this.value || "{}");
            this.baseImageFile = String(state.base_image_file || "");
            this.maskImageFile = String(state.mask_image_file || "");
            this.brushSize = Math.max(1, Number(state.brush_size) || 80);
            this.eraserSize = Math.max(1, Number(state.eraser_size) || 80);
            this.maskOpacity = Math.min(1, Math.max(0.05, Number(state.mask_opacity) || DEFAULT_MASK_OPACITY));
            this.maskColor = /^#[0-9a-f]{6}$/i.test(state.mask_color) ? state.mask_color : DEFAULT_MASK_COLOR;
            if (this.baseImageFile && !this.image) {
                loadImage({ filename: this.baseImageFile, type: "input" })
                    .then((image) => {
                        this.image = image;
                        this.previewImage = makePreviewCanvas(image);
                        this.clearRenderCache();
                        setDirty();
                    })
                    .catch(() => {});
            }
        } catch (_) {}
    }

    async serializeValue() {
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        if (this.pending) await this.pending;
        if (this.maskDirty) await this.commitMask();
        this.value = this.getValue();
        return this.value;
    }

    nodePos(pos) {
        if (pointInRect(pos, this.rect)) return pos;
        return [pos[0] + this.rect[0], pos[1] + this.rect[1]];
    }

    imagePoint(pos) {
        if (!pointInRect(pos, this.imageRect) || !this.imageRect?.[4]) return null;
        return [
            (pos[0] - this.imageRect[0]) / this.imageRect[4],
            (pos[1] - this.imageRect[1]) / this.imageRect[4],
        ];
    }

    drawMask(ctx) {
        if (!this.imageRect || !this.image?.naturalWidth || !this.image?.naturalHeight) return;
        if (!this.hasMaskContent()) {
            this.maskOverlay = null;
            return;
        }
        if (this.activeStroke) {
            this.drawInteractiveMask(ctx);
            return;
        }
        if (this.maskOverlay) {
            ctx.drawImage(this.maskOverlay, this.imageRect[0], this.imageRect[1], this.imageRect[2], this.imageRect[3]);
            return;
        }
        const core = this.makeBinaryMask();
        const overlay = this.renderMask();
        if (!core || !overlay) return;
        const overlayCtx = overlay.getContext("2d");
        const pixels = overlayCtx.getImageData(0, 0, overlay.width, overlay.height);
        const corePixels = core.getContext("2d").getImageData(0, 0, core.width, core.height);
        const [red, green, blue] = hexToRgb(this.maskColor);
        for (let index = 0; index < pixels.data.length; index += 4) {
            const maskLevel = pixels.data[index] / 255;
            const coreLevel = corePixels.data[index + 3] / 255;
            pixels.data[index] = red;
            pixels.data[index + 1] = green;
            pixels.data[index + 2] = blue;
            const featherRingVisible = Math.min(1, Math.max(0, maskLevel / 0.05));
            const ringOpacity = this.maskOpacity * 0.5;
            const previewOpacity = ringOpacity * featherRingVisible
                + (this.maskOpacity - ringOpacity) * coreLevel;
            pixels.data[index + 3] = Math.round(255 * previewOpacity);
        }
        overlayCtx.putImageData(pixels, 0, 0);
        this.maskOverlay = overlay;
        ctx.drawImage(overlay, this.imageRect[0], this.imageRect[1], this.imageRect[2], this.imageRect[3]);
    }

    drawInteractiveMask(ctx) {
        const displayWidth = Math.max(1, Math.round(this.imageRect[2]));
        const displayHeight = Math.max(1, Math.round(this.imageRect[3]));
        const sourceWidth = this.image.naturalWidth;
        const sourceHeight = this.image.naturalHeight;
        if (!sourceWidth || !sourceHeight) return;

        const layer = this.getInteractiveMaskCanvas(displayWidth, displayHeight);
        const layerCtx = layer.getContext("2d");
        layerCtx.setTransform(1, 0, 0, 1, 0, 0);
        layerCtx.globalCompositeOperation = "source-over";
        layerCtx.clearRect(0, 0, displayWidth, displayHeight);
        const scaleX = displayWidth / sourceWidth;
        const scaleY = displayHeight / sourceHeight;
        const scale = Math.min(scaleX, scaleY);

        if (this.invert) {
            layerCtx.fillStyle = "#fff";
            layerCtx.fillRect(0, 0, displayWidth, displayHeight);
        }
        for (const stroke of this.strokes) {
            if (!stroke.points.length) continue;
            const visible = this.invert ? stroke.op !== "add" : stroke.op === "add";
            layerCtx.globalCompositeOperation = visible ? "source-over" : "destination-out";
            layerCtx.strokeStyle = visible ? "#fff" : "#000";
            layerCtx.fillStyle = layerCtx.strokeStyle;
            layerCtx.lineCap = "round";
            layerCtx.lineJoin = "round";
            layerCtx.lineWidth = stroke.brushSize * scale;
            drawScaledStrokeGeometry(layerCtx, stroke, scale);
        }

        layerCtx.globalCompositeOperation = "source-in";
        const [red, green, blue] = hexToRgb(this.maskColor);
        layerCtx.fillStyle = `rgba(${red}, ${green}, ${blue}, ${this.maskOpacity})`;
        layerCtx.fillRect(0, 0, displayWidth, displayHeight);

        ctx.drawImage(layer, this.imageRect[0], this.imageRect[1], this.imageRect[2], this.imageRect[3]);
    }

    getInteractiveMaskCanvas(width, height) {
        const canvas = this.interactiveMaskCanvas || document.createElement("canvas");
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        this.interactiveMaskCanvas = canvas;
        return canvas;
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

    makeBinaryMask() {
        if (!this.image?.naturalWidth || !this.image?.naturalHeight) return null;
        if (!this.hasMaskContent()) return null;
        const overlay = document.createElement("canvas");
        overlay.width = this.image.naturalWidth;
        overlay.height = this.image.naturalHeight;
        const overlayCtx = overlay.getContext("2d");
        overlayCtx.lineCap = "round";
        overlayCtx.lineJoin = "round";
        if (this.invert) {
            overlayCtx.fillStyle = "#fff";
            overlayCtx.fillRect(0, 0, overlay.width, overlay.height);
        }
        for (const stroke of this.strokes) {
            if (!stroke.points.length) continue;
            const visible = this.invert ? stroke.op !== "add" : stroke.op === "add";
            overlayCtx.globalCompositeOperation = visible ? "source-over" : "destination-out";
            overlayCtx.strokeStyle = visible ? "#fff" : "#000";
            overlayCtx.fillStyle = overlayCtx.strokeStyle;
            overlayCtx.lineWidth = stroke.brushSize;
            drawStrokeGeometry(overlayCtx, stroke);
        }
        return overlay;
    }

    drawToolbar(ctx) {
        const [x, y, width, height] = this.toolbarRect;
        ctx.fillStyle = "#191919";
        ctx.fillRect(x, y, width, height);
        this.buttons = [];
        const groupPadding = 4;
        const itemGap = 4;
        const toolWidth = 30;
        const propertyWidth = 88;
        const toolActive = this.hasActiveTool();
        const drawGroup = (left, groupWidth) => {
            ctx.fillStyle = "#232323";
            ctx.fillRect(left, y + 8, groupWidth, height - 16);
            ctx.strokeStyle = "#3d3d3d";
            ctx.lineWidth = 1;
            ctx.strokeRect(left + 0.5, y + 8.5, groupWidth - 1, height - 17);
        };

        const toolGroupWidth = groupPadding * 2 + toolWidth * 3 + itemGap * 2;
        let groupLeft = x + 8;
        drawGroup(groupLeft, toolGroupWidth);
        let left = groupLeft + groupPadding;
        for (const action of ["lasso", "brush", "eraser"]) {
            const rect = [left, y + 12, toolWidth, height - 24];
            this.buttons.push({ action, rect });
            ctx.fillStyle = action === this.tool ? "#2563eb" : "#303030";
            ctx.fillRect(...rect);
            this.drawToolIcon(ctx, action, rect);
            left += toolWidth + itemGap;
        }

        const propertyGroupWidth = groupPadding * 2 + propertyWidth * 3 + 6 * 2;
        groupLeft = x + (width - propertyGroupWidth) / 2;
        drawGroup(groupLeft, propertyGroupWidth);
        left = groupLeft + groupPadding;
        const featherPercent = Math.round(Number(findWidget(this.node, "mask_feather")?.value || 0));
        left = this.drawProperty(ctx, "mask_feather", t("feather"), `${featherPercent}%`, left, y, propertyWidth, height, toolActive);
        left = this.drawProperty(ctx, "mask_opacity", t("maskOpacity"), `${Math.round(this.maskOpacity * 100)}%`, left, y, propertyWidth, height, toolActive);
        const colorStart = left;
        this.drawProperty(ctx, "mask_color", t("colorValue"), "", left, y, propertyWidth, height, toolActive);
        const swatchRect = [colorStart + propertyWidth - 22, y + 17, 14, height - 34];
        swatchRect[0] = colorStart + propertyWidth - 18;
        swatchRect[1] = y + (height - 10) / 2;
        swatchRect[2] = 10;
        swatchRect[3] = 10;
        ctx.fillStyle = toolActive ? this.maskColor : "#555";
        ctx.fillRect(...swatchRect);
        ctx.strokeStyle = "#777";
        ctx.lineWidth = 1;
        ctx.strokeRect(...swatchRect);

        const actionGroupWidth = groupPadding * 2 + toolWidth * 2 + itemGap;
        groupLeft = x + width - 8 - actionGroupWidth;
        drawGroup(groupLeft, actionGroupWidth);
        let right = groupLeft + actionGroupWidth - groupPadding;
        for (const action of ["clear", "invert"]) {
            right -= toolWidth;
            const rect = [right, y + 12, toolWidth, height - 24];
            this.buttons.push({ action, rect, enabled: toolActive });
            const active = toolActive && this.flashAction === action;
            ctx.fillStyle = active ? "#2563eb" : "#303030";
            ctx.fillRect(...rect);
            this.drawToolIcon(ctx, action, rect, toolActive);
            right -= itemGap;
        }

    }

    getFeatherWidth() {
        const percent = Math.min(100, Math.max(0, Number(findWidget(this.node, "mask_feather")?.value || 0)));
        return (this.currentToolSize() / 2) * (percent / 100);
    }

    drawBrushCursor(ctx) {
        if (!this.activeStroke || !this.hoverImagePoint || !this.imageRect?.[4] || this.tool === "lasso") return;
        const scale = this.imageRect[4];
        const x = this.imageRect[0] + this.hoverImagePoint[0] * scale;
        const y = this.imageRect[1] + this.hoverImagePoint[1] * scale;
        const feather = this.getFeatherWidth();
        const toolSize = this.currentToolSize();
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

    renderCacheKey(previewRect, imageRect) {
        return [
            Math.round(previewRect[2]), Math.round(previewRect[3]),
            Math.round(imageRect[0] - previewRect[0]), Math.round(imageRect[1] - previewRect[1]),
            Math.round(imageRect[2]), Math.round(imageRect[3]),
            this.image?.src || "",
            this.previewImage?.width || this.image?.naturalWidth || 0,
            this.previewImage?.height || this.image?.naturalHeight || 0,
            this.hasMaskContent() ? "mask" : "nomask",
            this.maskOpacity,
            this.maskColor,
        ].join("|");
    }

    getRenderedPreview(previewRect, imageRect) {
        const key = this.renderCacheKey(previewRect, imageRect);
        if (this.renderCache?.key === key) return this.renderCache.canvas;

        this.clearRenderCache();
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(previewRect[2]));
        canvas.height = Math.max(1, Math.round(previewRect[3]));
        const cacheCtx = canvas.getContext("2d");
        cacheCtx.fillStyle = "#080808";
        cacheCtx.fillRect(0, 0, canvas.width, canvas.height);

        const localImageRect = [
            imageRect[0] - previewRect[0],
            imageRect[1] - previewRect[1],
            imageRect[2],
            imageRect[3],
            imageRect[4],
        ];
        cacheCtx.drawImage(this.previewImage || this.image, localImageRect[0], localImageRect[1], localImageRect[2], localImageRect[3]);

        if (this.hasMaskContent()) {
            const previousRect = this.imageRect;
            this.imageRect = localImageRect;
            this.drawMask(cacheCtx);
            this.imageRect = previousRect;
        }

        this.renderCache = { key, canvas };
        return canvas;
    }

    draw(ctx, node, width, y, height) {
        const widgetHeight = Math.max(220, Number(this.computedHeight) || Number(height) || 220);
        this.rect = [PAD, y + 4, Math.max(1, width - PAD * 2), widgetHeight - 8];
        this.toolbarRect = [this.rect[0], this.rect[1] + this.rect[3] - TOOLBAR_HEIGHT, this.rect[2], TOOLBAR_HEIGHT];
        const previewRect = [this.rect[0], this.rect[1], this.rect[2], this.rect[3] - TOOLBAR_HEIGHT];

        ctx.save();
        ctx.fillStyle = "#080808";
        ctx.fillRect(...previewRect);
        this.imageRect = fitRect(this.image, previewRect);
        if (this.imageRect) {
            const preview = this.getRenderedPreview(previewRect, this.imageRect);
            ctx.drawImage(preview, previewRect[0], previewRect[1], previewRect[2], previewRect[3]);
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
        } else {
            this.clearRenderCache();
            ctx.fillStyle = "#aaa";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "left";
            ctx.textBaseline = "top";
            ctx.fillText(t("noImage"), previewRect[0] + 12, previewRect[1] + 12);
        }
        this.drawToolbar(ctx);
        ctx.restore();
        this.repositionActiveEditor();
    }

    renderMask() {
        const binary = this.makeBinaryMask();
        const feather = this.getFeatherWidth();
        if (!binary || feather <= 0) return binary;
        const canvas = document.createElement("canvas");
        canvas.width = binary.width;
        canvas.height = binary.height;
        const ctx = canvas.getContext("2d");
        const blurred = document.createElement("canvas");
        blurred.width = binary.width;
        blurred.height = binary.height;
        const blurredCtx = blurred.getContext("2d");
        blurredCtx.filter = `blur(${feather}px)`;
        blurredCtx.drawImage(binary, 0, 0);
        blurredCtx.filter = "none";
        const image = blurredCtx.getImageData(0, 0, blurred.width, blurred.height);
        for (let index = 0; index < image.data.length; index += 4) {
            // A Gaussian blur leaves roughly half strength at the original
            // mask boundary. Normalize that boundary back to full strength,
            // then retain the continuous falloff outside it.
            const value = Math.min(255, image.data[index + 3] * 2);
            image.data[index] = value;
            image.data[index + 1] = value;
            image.data[index + 2] = value;
            image.data[index + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        return canvas;
    }

    async commitMask() {
        if (this.maskCommitTimer) {
            clearTimeout(this.maskCommitTimer);
            this.maskCommitTimer = null;
        }
        if (!this.strokes.length && !this.invert) {
            this.maskImageFile = "";
            this.maskDirty = false;
            return;
        }
        if (!this.baseImageFile && this.image?.src) {
            const source = await (await fetch(this.image.src)).blob();
            this.baseImageFile = await uploadBlob(source, `base_${this.node.id}_${Date.now()}.png`);
        }
        const mask = this.renderMask();
        if (!mask) return;
        this.maskImageFile = await uploadBlob(await canvasBlob(mask), `mask_${this.node.id}_${Date.now()}.png`);
        this.maskDirty = false;
    }

    scheduleMaskCommit(delay = 700) {
        if (this.maskCommitTimer) clearTimeout(this.maskCommitTimer);
        this.maskCommitTimer = setTimeout(() => {
            this.maskCommitTimer = null;
            if (!this.maskDirty) return;
            this.pending = this.commitMask().catch((error) => console.error("[NO8D Generate] mask upload failed", error));
        }, delay);
    }

    runAction(action) {
        if (action === "brush" || action === "lasso" || action === "eraser") {
            this.closeActiveEditor();
            this.tool = this.tool === action ? null : action;
        } else if (action === "invert") {
            this.invert = !this.invert;
            this.maskOverlay = null;
            this.clearRenderCache();
            this.maskDirty = true;
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
        if (action === "brush_size") {
            const size = Math.min(512, Math.max(1, Math.round(value)));
            if (this.tool === "eraser") this.eraserSize = size;
            else this.brushSize = size;
        } else if (action === "mask_feather") {
            const widget = findWidget(this.node, "mask_feather");
            if (widget) widget.value = Math.round(Math.min(100, Math.max(0, value)));
            this.maskDirty = true;
        } else {
            this.maskOpacity = Math.min(1, Math.max(0.05, value / 100));
        }
        this.maskOverlay = null;
        this.clearRenderCache();
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
                preset.style.outline = selected ? "2px solid #3b82f6" : "none";
                preset.style.outlineOffset = selected ? "1px" : "0";
            }
            this.maskOverlay = null;
            this.clearRenderCache();
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

    openNumberEditor(action, event, buttonRect, nodePos) {
        this.valueEditorClose?.();
        const min = action === "brush_size" ? 1 : action === "mask_feather" ? 0 : 5;
        const max = action === "brush_size" ? 512 : 100;
        const editor = document.createElement("div");
        editor.className = "no8d-generate-value-editor";
        const { presetGroup, valueGroup } = this.createEditorGroups(editor);
        this.activeEditor = { element: editor, height: EDITOR_HEIGHT };
        this.activeEditorAction = action;
        setDirty();
        this.positionBottomEditor(editor, event, nodePos);

        const presetValues = action === "brush_size"
            ? [40, 80, 160]
            : action === "mask_feather"
                ? [0, 50, 100]
                : [30, 50, 70];
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
        slider.style.cssText = "flex:1 1 auto; min-width:0; accent-color:#3b82f6;";

        const input = document.createElement("input");
        input.type = "number";
        input.value = slider.value;
        input.min = String(min);
        input.max = String(max);
        input.step = "1";
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
                preset.style.borderColor = selected ? "#60a5fa" : "#555";
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

    mouse(event, pos) {
        const nodePos = this.nodePos(pos);
        const type = String(event?.type || "");
        if (type.includes("contextmenu") || (type.includes("down") && event.button !== 0)) return false;

        if (type.includes("move")) {
            this.hoverImagePoint = this.imagePoint(nodePos);
            setCursorDirty();
        } else if (type.includes("leave") || type.includes("out")) {
            this.hoverImagePoint = null;
            setCursorDirty();
        }

        if (type.includes("down")) {
            const button = (this.buttons || []).find((item) => pointInRect(nodePos, item.rect));
            if (button) {
                event.preventDefault?.();
                event.stopPropagation?.();
                if (button.enabled === false) return true;
                if (["brush", "eraser"].includes(button.action)) {
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
            const point = this.imagePoint(nodePos);
            if (!point || event.button !== 0 || !this.hasActiveTool()) return false;
            this.hoverImagePoint = point;
            this.activeStroke = {
                op: this.tool === "eraser" ? "subtract" : "add",
                kind: this.tool === "lasso" ? "lasso" : "brush",
                brushSize: this.currentToolSize(),
                points: [point],
            };
            this.strokes.push(this.activeStroke);
            this.maskOverlay = null;
            this.clearRenderCache();
            this.maskDirty = true;
            setDirty();
            return true;
        }

        if (type.includes("move") && this.activeStroke) {
            const point = this.imagePoint(nodePos);
            if (point) this.activeStroke.points.push(point);
            this.maskOverlay = null;
            this.clearRenderCache();
            this.maskDirty = true;
            setCursorDirty();
            return true;
        }

        if ((type.includes("up") || type.includes("cancel")) && this.activeStroke) {
            this.activeStroke = null;
            this.scheduleMaskCommit();
            return true;
        }
        return pointInRect(nodePos, this.rect);
    }

    async setPreview(ref, options = {}) {
        const previousImage = this.image;
        const previousPreview = this.previewImage;
        this.image = await loadImage(ref);
        this.previewImage = makePreviewCanvas(this.image);
        syncNativeImageState(this.node, ref, this.image, options.refs);
        if (previousImage && previousImage !== this.image) releaseDecodedImage(previousImage);
        if (previousPreview && previousPreview !== this.previewImage) releasePreviewCanvas(previousPreview);
        this.clearRenderCache();
        if (options.clearMask) this.clearMaskState();
        else {
            this.activeStroke = null;
            this.maskOverlay = null;
            this.maskDirty = false;
            this.pending = null;
        }
        setDirty();
    }
}

function findGenerateNodeFromExecutionId(id) {
    const direct = app.graph?.getNodeById?.(id);
    if (isGenerateNode(direct)) return direct;
    const rootId = String(id || "").split(".")[0];
    const root = app.graph?.getNodeById?.(rootId) || app.graph?.getNodeById?.(Number(rootId));
    return isGenerateNode(root) ? root : null;
}

app.registerExtension({
    name: "NO8D.Generate",

    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_NAME) return;

        // ComfyUI's default background hook creates its own IMAGE_PREVIEW
        // widget for image outputs. This node renders that output in its
        // editable canvas instead, so the native preview must not be created.
        nodeType.prototype.onDrawBackground = function () {};
        nodeType.prototype.onExecuted = function () {
            suppressNativePreview(this);
        };
        const originalOnConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            originalOnConfigure?.apply(this, arguments);
            hideToolbarWidgets(this);
            requestAnimationFrame(() => {
                createSamplerPanel(this);
                this._no8dGenerateSyncSampler?.();
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
        suppressNativePreview(node);
        hideToolbarWidgets(node);
        createSamplerPanel(node);
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
            const node = findGenerateNodeFromExecutionId(detail?.node);
            const widget = node?._no8dGenerateCanvas;
            if (!widget) return;
            const refs = refsFromMessage(detail?.output || detail);
            if (!refs.length) return;
            try {
                await widget.setPreview(refs[refs.length - 1], { clearMask: true, refs });
                suppressNativePreview(node);
                setDirty();
            } catch (error) {
                console.error("[NO8D Generate] preview load failed", error);
            }
        });
    },
});
