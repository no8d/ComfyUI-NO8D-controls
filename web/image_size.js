import { app } from "../../scripts/app.js";
import { prepareLegacyCanvas, legacyCanvasPosition, releaseLegacyCanvas } from "./no8d_canvas.js";
import { api } from "../../scripts/api.js";
import { t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DImageSize";
const CANVAS_TYPE = "NO8D_IMAGE_SIZE_CANVAS";
const CANVAS_HEIGHT = 300;
const MIN_WIDTH = 380;
const HANDLE_SIZE = 12;
const ASPECT_RATIOS = {
    "1:1": [1, 1], "1:2": [1, 2], "2:3": [2, 3], "3:4": [3, 4],
    "4:5": [4, 5], "9:16": [9, 16], "9:21": [9, 21],
};

function nodeClass(node) {
    return node?.constructor?.comfyClass || node?.comfyClass || node?.type || "";
}

function findWidget(node, name) {
    return (node?.widgets || []).find((widget) => widget.name === name);
}

function token(value) {
    return String(value ?? "").trim().toLocaleLowerCase().replace(/[\s\-_/]+/g, "");
}

function methodKind(value) {
    const valueToken = token(value);
    if (["pad", "填充", "补边"].includes(valueToken)) return "pad";
    if (["crop", "裁切", "fillcrop", "keepproportion", "保持比例"].includes(valueToken)) return "crop";
    return "stretch";
}

function isMethodValue(value) {
    return [
        "pad", "填充", "补边", "crop", "裁切", "fillcrop", "keepproportion",
        "保持比例", "stretch", "拉伸",
    ].includes(token(value));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function setWidgetVisible(widget, visible) {
    if (!widget) return false;
    if (!("_no8dOriginalComputeSize" in widget)) widget._no8dOriginalComputeSize = widget.computeSize;
    if (!("_no8dOriginalDraw" in widget)) widget._no8dOriginalDraw = widget.draw;
    const hidden = !visible;
    const changed = widget.hidden !== hidden || widget.options?.hidden !== hidden;
    widget.hidden = hidden;
    widget.options = widget.options || {};
    widget.options.hidden = hidden;
    widget.computeSize = visible ? (widget._no8dOriginalComputeSize || undefined) : () => [0, -4];
    widget.draw = visible ? (widget._no8dOriginalDraw || undefined) : () => {};
    return changed;
}

function invalidateVueWidgets(node) {
    if (!window.LiteGraph?.vueNodesMode) return;
    try {
        const widgets = [...(node.widgets || [])];
        node.widgets = [];
        node.widgets = widgets;
    } catch (_) {}
}

function setVueWidgetExcluded(widget, excluded) {
    if (!widget) return false;
    widget.options = widget.options || {};
    if (!("_no8dOriginalCanvasOnly" in widget)) {
        widget._no8dOriginalCanvasOnly = widget.options.canvasOnly;
    }
    const next = excluded ? true : widget._no8dOriginalCanvasOnly;
    if (widget.options.canvasOnly === next) return false;
    if (next === undefined) delete widget.options.canvasOnly;
    else widget.options.canvasOnly = next;
    return true;
}

function currentRatio(node) {
    const selected = String(findWidget(node, "aspect_ratio")?.value || "1:1");
    let ratio = ASPECT_RATIOS[selected];
    const image = node?._no8dImageSizeCanvas?.image;
    if (!ratio && image?.naturalWidth && image?.naturalHeight) ratio = [image.naturalWidth, image.naturalHeight];
    if (!ratio) ratio = [1, 1];
    const canInvert = methodKind(findWidget(node, "method")?.value) !== "stretch";
    return canInvert && findWidget(node, "invert_ratio")?.value ? [ratio[1], ratio[0]] : ratio;
}

function aligned(value, multiple) {
    return Math.max(multiple, Math.round(Number(value || multiple) / multiple) * multiple);
}

function syncDimensions(node, driver = "short") {
    if (node?._no8dImageSizeSyncing) return;
    const shortWidget = findWidget(node, "short_side");
    const longWidget = findWidget(node, "long_side");
    if (!shortWidget || !longWidget) return;
    node._no8dImageSizeSyncing = true;
    try {
        const multiple = Number(findWidget(node, "multiple_of")?.value) >= 16 ? 16 : 8;
        const ratio = currentRatio(node);
        const shortRatio = Math.min(ratio[0], ratio[1]);
        const longRatio = Math.max(ratio[0], ratio[1]);
        if (driver === "long") {
            longWidget.value = aligned(longWidget.value, multiple);
            shortWidget.value = aligned(longWidget.value * shortRatio / longRatio, multiple);
        } else {
            shortWidget.value = aligned(shortWidget.value, multiple);
            longWidget.value = aligned(shortWidget.value * longRatio / shortRatio, multiple);
        }
    } finally {
        node._no8dImageSizeSyncing = false;
    }
}

function refreshControls(node) {
    if (nodeClass(node) !== NODE_NAME) return;
    const method = methodKind(findWidget(node, "method")?.value);
    let visibilityChanged = false;
    for (const name of ["width", "height", "long_side", "condition", "force_size"]) {
        visibilityChanged = setWidgetVisible(findWidget(node, name), false) || visibilityChanged;
    }
    for (const name of [
        "auto_output", "aspect_ratio", "short_side", "multiple_of",
        "interpolation", "method",
    ]) {
        visibilityChanged = setWidgetVisible(findWidget(node, name), true) || visibilityChanged;
    }
    visibilityChanged = setWidgetVisible(findWidget(node, "invert_ratio"), method !== "stretch") || visibilityChanged;
    const fillColor = findWidget(node, "fill_color");
    visibilityChanged = setWidgetVisible(fillColor, false) || visibilityChanged;
    visibilityChanged = setVueWidgetExcluded(fillColor, true) || visibilityChanged;
    const canvas = findWidget(node, "crop_canvas");
    if (canvas) {
        canvas.visible = method !== "stretch";
        visibilityChanged = setWidgetVisible(canvas, canvas.visible) || visibilityChanged;
    }
    node.setSize?.([
        Math.max(MIN_WIDTH, Number(node.size?.[0]) || MIN_WIDTH),
        Math.max(160, Number(node.computeSize?.()[1]) || 160),
    ]);
    node.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    if (visibilityChanged) invalidateVueWidgets(node);
    canvas?.triggerDraw?.();
}

function nestedCanvasValue(raw) {
    let parsed = {};
    try { parsed = JSON.parse(raw || "{}"); } catch (_) {}
    const flat = {
        x: Number.isFinite(Number(parsed.x)) ? Number(parsed.x) : 0.5,
        y: Number.isFinite(Number(parsed.y)) ? Number(parsed.y) : 0.5,
        scale: Number.isFinite(Number(parsed.scale)) ? Number(parsed.scale) : 1,
    };
    return JSON.stringify({
        crop: parsed.crop || flat,
        fill: parsed.fill || { x: 0.5, y: 0.5, scale: 1 },
    });
}

function migrateWidgetValues(info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values) || !values.length) return;
    // Current auto-output-first layout.
    if (typeof values[0] === "boolean" && isMethodValue(values[6])) {
        values[4] = String(values[4] ?? 8);
        return;
    }
    // Previous shared-controls layout.
    if (isMethodValue(values[6])) {
        info.widgets_values = [
            true, values[0] ?? "1:1", values[2] ?? 512, values[3] ?? 512,
            String(values[4] ?? 8), values[5] ?? "lanczos", values[6] ?? "stretch",
            values[1] ?? false, nestedCanvasValue(values[7]), values[8] ?? "#000000",
            values[9] ?? 0, values[10] ?? 0, values[11] ?? "always", values[12] ?? false,
        ];
        return;
    }
    if (!isMethodValue(values[0])) {
        if (typeof values[0] === "boolean") {
            info.widgets_values = [
                true, values[7] ?? "1:1", 512, 512, String(values[6] ?? 8),
                values[3] ?? "lanczos", values[4] ?? "stretch", values[8] ?? false,
                nestedCanvasValue(values[9]), "#000000", values[1] ?? 0,
                values[2] ?? 0, values[5] ?? "always", values[0],
            ];
            return;
        }
        if (typeof values[0] === "number") {
            const hasCropControls = typeof values[6] === "boolean";
            info.widgets_values = [
                true, hasCropControls ? (values[8] ?? "1:1") : "1:1", 512, 512,
                String(values[5] ?? 8), values[2] ?? "lanczos", values[3] ?? "stretch", false,
                nestedCanvasValue(hasCropControls ? values[7] : null), "#000000",
                values[0] ?? 0, values[1] ?? 0, values[4] ?? "always",
                hasCropControls ? values[6] : false,
            ];
        }
        return;
    }
    // Previous method-first layout.
    info.widgets_values = [
        true, values[5] ?? "1:1", 512, 512, String(values[1] ?? 8),
        values[10] ?? "lanczos", values[0] ?? "stretch", values[6] ?? false,
        nestedCanvasValue(values[7]), values[8] ?? "#000000", values[3] ?? 0, values[4] ?? 0,
        values[11] ?? "always", values[2] ?? false,
    ];
}

function wrapRefresh(widget, node, callbackAfter = null) {
    if (!widget || widget._no8dImageSizeRefreshWrapped) return;
    const callback = widget.callback;
    widget.callback = function () {
        const result = callback?.apply(this, arguments);
        callbackAfter?.();
        queueMicrotask(() => refreshControls(node));
        return result;
    };
    widget._no8dImageSizeRefreshWrapped = true;
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

function collectDownstreamNodeIds(node) {
    const graph = node?.graph || app?.graph;
    const result = new Set();
    const pending = [];
    for (const output of node?.outputs || []) {
        for (const linkId of output.links || []) {
            const link = graph?.links?.[linkId];
            if (link?.target_id != null) pending.push(link.target_id);
        }
    }
    while (pending.length) {
        const id = pending.shift();
        if (id == null || result.has(String(id))) continue;
        result.add(String(id));
        const next = graph?.getNodeById?.(id);
        for (const output of next?.outputs || []) {
            for (const linkId of output.links || []) {
                const link = graph?.links?.[linkId];
                if (link?.target_id != null) pending.push(link.target_id);
            }
        }
    }
    if (!result.size && node?.id != null) result.add(String(node.id));
    return [...result];
}

async function runDownstreamQueueHooks(nodeIds, hookName) {
    const targets = new Set((nodeIds || []).map(String));
    for (const node of app?.graph?._nodes || []) {
        if (!targets.has(String(node?.id))) continue;
        for (const widget of node.widgets || []) {
            const hook = widget?.[hookName];
            if (typeof hook === "function") await hook.call(widget, { isPartialExecution: false });
        }
    }
}

async function sendProcessedImage(node) {
    try {
        if (typeof app.graphToPrompt !== "function" || typeof app.api?.queuePrompt !== "function") {
            throw new Error("ComfyUI queue API is unavailable");
        }
        const downstreamNodeIds = collectDownstreamNodeIds(node);
        await runDownstreamQueueHooks(downstreamNodeIds, "beforeQueued");
        const prompt = await app.graphToPrompt();
        const imageSizeNode = prompt?.output?.[String(node.id)];
        if (!imageSizeNode?.inputs) throw new Error("NO8D image size node is not present in the queued prompt");
        imageSizeNode.inputs.auto_output = true;
        await app.api.queuePrompt(0, prompt, { partialExecutionTargets: downstreamNodeIds });
        await runDownstreamQueueHooks(downstreamNodeIds, "afterQueued");
    } catch (error) {
        app.extensionManager?.toast?.add?.({
            severity: "warn",
            summary: t("imageSizeSend"),
            detail: error?.message || String(error),
            life: 3000,
        });
    }
}

function containedRect(imageWidth, imageHeight, rect) {
    const scale = Math.min(rect[2] / imageWidth, rect[3] / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return [rect[0] + (rect[2] - width) / 2, rect[1] + (rect[3] - height) / 2, width, height];
}

function parseColor(value) {
    const text = String(value || "#000000").trim();
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text) ? text : "#000000";
}

class ImageSizeCanvasWidget {
    constructor(node, name, type) {
        this.node = node;
        this.name = name;
        this.type = type;
        this.options = {};
        this.value = '{"crop":{"x":0.5,"y":0.5,"scale":1},"fill":{"x":0.5,"y":0.5,"scale":1}}';
        this.visible = false;
        this.image = null;
        this.rect = [0, 0, MIN_WIDTH, CANVAS_HEIGHT];
        this.canvasRect = null;
        this.imageRect = null;
        this.activeRect = null;
        this.dragMode = null;
        this.dragOffset = [0, 0];
        this.loadToken = 0;
    }

    mode() {
        return methodKind(findWidget(this.node, "method")?.value);
    }

    stateKey(mode = this.mode()) {
        return mode === "pad" ? "fill" : "crop";
    }

    states() {
        try {
            const parsed = JSON.parse(this.value || "{}");
            if (parsed.crop || parsed.fill) return parsed;
            return { crop: parsed, fill: { x: 0.5, y: 0.5, scale: 1 } };
        } catch (_) {
            return { crop: { x: 0.5, y: 0.5, scale: 1 }, fill: { x: 0.5, y: 0.5, scale: 1 } };
        }
    }

    state(mode = this.mode()) {
        const source = this.states()[this.stateKey(mode)] || {};
        const maximum = mode === "pad" ? 4 : 1;
        return {
            x: clamp(Number.isFinite(Number(source.x)) ? Number(source.x) : 0.5, 0, 1),
            y: clamp(Number.isFinite(Number(source.y)) ? Number(source.y) : 0.5, 0, 1),
            scale: clamp(Number.isFinite(Number(source.scale)) ? Number(source.scale) : 1, 0.05, maximum),
        };
    }

    setState(mode, x, y, scale) {
        const states = this.states();
        const maximum = mode === "pad" ? 4 : 1;
        states[this.stateKey(mode)] = {
            x: Math.round(clamp(x, 0, 1) * 10000) / 10000,
            y: Math.round(clamp(y, 0, 1) * 10000) / 10000,
            scale: Math.round(clamp(scale, 0.05, maximum) * 10000) / 10000,
        };
        this.value = JSON.stringify(states);
        this.node.graph?.setDirtyCanvas?.(true, true);
        app.canvas?.setDirty?.(true, true);
        this.triggerDraw?.();
    }

    computeSize(width) {
        return [Math.max(MIN_WIDTH, width), this.visible ? CANVAS_HEIGHT : -4];
    }

    computeLayoutSize() {
        const height = this.visible ? CANVAS_HEIGHT : 0;
        return { minWidth: MIN_WIDTH, minHeight: height, maxHeight: height };
    }

    async setPreview(ref) {
        if (!ref?.filename) return;
        const tokenValue = ++this.loadToken;
        const image = await loadImage(ref);
        if (tokenValue !== this.loadToken) return;
        this.image = image;
        syncDimensions(this.node, "short");
        app.canvas?.setDirty?.(true, true);
        this.triggerDraw?.();
    }

    targetSize() {
        const ratio = currentRatio(this.node);
        const shortSide = Number(findWidget(this.node, "short_side")?.value) || 512;
        const longSide = Number(findWidget(this.node, "long_side")?.value) || shortSide;
        if (ratio[0] === ratio[1]) return [shortSide, shortSide];
        return ratio[0] < ratio[1] ? [shortSide, longSide] : [longSide, shortSide];
    }

    cropGeometry() {
        const sourceWidth = this.image.naturalWidth;
        const sourceHeight = this.image.naturalHeight;
        const [targetWidth, targetHeight] = this.targetSize();
        const targetRatio = targetWidth / targetHeight;
        const sourceRatio = sourceWidth / sourceHeight;
        const maximumWidth = sourceRatio > targetRatio ? sourceHeight * targetRatio : sourceWidth;
        const maximumHeight = sourceRatio > targetRatio ? sourceHeight : sourceWidth / targetRatio;
        const state = this.state("crop");
        const width = maximumWidth * state.scale;
        const height = maximumHeight * state.scale;
        const left = clamp(state.x * sourceWidth - width / 2, 0, sourceWidth - width);
        const top = clamp(state.y * sourceHeight - height / 2, 0, sourceHeight - height);
        return { left, top, width, height };
    }

    cropDisplayRect() {
        const crop = this.cropGeometry();
        const scaleX = this.imageRect[2] / this.image.naturalWidth;
        const scaleY = this.imageRect[3] / this.image.naturalHeight;
        return [
            this.imageRect[0] + crop.left * scaleX, this.imageRect[1] + crop.top * scaleY,
            crop.width * scaleX, crop.height * scaleY,
        ];
    }

    fillGeometry() {
        const [targetWidth, targetHeight] = this.targetSize();
        const contain = Math.min(targetWidth / this.image.naturalWidth, targetHeight / this.image.naturalHeight);
        const state = this.state("pad");
        const width = this.image.naturalWidth * contain * state.scale;
        const height = this.image.naturalHeight * contain * state.scale;
        return {
            left: state.x * targetWidth - width / 2,
            top: state.y * targetHeight - height / 2,
            width, height,
        };
    }

    fillDisplayRect() {
        const geometry = this.fillGeometry();
        const [targetWidth, targetHeight] = this.targetSize();
        const scaleX = this.canvasRect[2] / targetWidth;
        const scaleY = this.canvasRect[3] / targetHeight;
        return [
            this.canvasRect[0] + geometry.left * scaleX, this.canvasRect[1] + geometry.top * scaleY,
            geometry.width * scaleX, geometry.height * scaleY,
        ];
    }

    drawHandles(ctx) {
        if (!this.activeRect) return;
        const [x, y, width, height] = this.activeRect;
        ctx.strokeStyle = "#00ddff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        ctx.fillStyle = "#00ddff";
        for (const [handleX, handleY] of this.handlePoints()) {
            ctx.fillRect(handleX - HANDLE_SIZE / 2, handleY - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
        }
    }

    drawFooterButton(ctx, rect, label, color = null) {
        ctx.fillStyle = "#292929";
        ctx.fillRect(...rect);
        let textX = rect[0] + 9;
        if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(rect[0] + 5, rect[1] + 5, 14, 14);
            ctx.strokeStyle = "#888";
            ctx.strokeRect(rect[0] + 5, rect[1] + 5, 14, 14);
            textX = rect[0] + 25;
        }
        ctx.fillStyle = "#ddd";
        ctx.font = "12px sans-serif";
        ctx.fillText(label, textX, rect[1] + 16);
    }

    draw(ctx, _node, width, y, height) {
        width = globalThis.LiteGraph?.vueNodesMode
            ? prepareLegacyCanvas(ctx, width, height || CANVAS_HEIGHT, this) : (_node.size?.[0] || width);
        if (globalThis.LiteGraph?.vueNodesMode) height = this.renderHeight || height;
        if (!this.visible) return;
        const widgetHeight = Math.max(CANVAS_HEIGHT, Number(height) || CANVAS_HEIGHT);
        this.rect = [10, y + 4, Math.max(1, width - 20), widgetHeight - 8];
        this.colorButtonRect = null;
        this.sendButtonRect = null;
        ctx.save();
        ctx.fillStyle = "#111";
        ctx.fillRect(...this.rect);
        const footerY = this.rect[1] + this.rect[3] - 32;
        const sendLabel = t("imageSizeSend");
        ctx.font = "12px sans-serif";
        const sendWidth = Math.max(72, ctx.measureText(sendLabel).width + 18);
        this.sendButtonRect = [this.rect[0] + this.rect[2] - sendWidth - 8, footerY, sendWidth, 24];
        this.drawFooterButton(ctx, this.sendButtonRect, sendLabel);
        if (this.mode() === "pad") {
            const color = parseColor(findWidget(this.node, "fill_color")?.value);
            const label = t("imageSizeFillColor");
            const buttonWidth = Math.max(92, ctx.measureText(label).width + 42);
            this.colorButtonRect = [this.rect[0] + 8, footerY, buttonWidth, 24];
            this.drawFooterButton(ctx, this.colorButtonRect, label, color);
        }
        const contentTop = this.rect[1] + 8;
        if (!this.image?.naturalWidth) {
            ctx.fillStyle = "#aaa";
            ctx.font = "12px sans-serif";
            ctx.fillText(t("imageSizeRunForPreview"), this.rect[0] + 12, contentTop + 14);
            ctx.restore();
            return;
        }
        const inner = [this.rect[0] + 8, contentTop, this.rect[2] - 16, footerY - contentTop - 8];
        if (this.mode() === "crop") {
            this.imageRect = containedRect(this.image.naturalWidth, this.image.naturalHeight, inner);
            this.canvasRect = null;
            ctx.drawImage(this.image, ...this.imageRect);
            this.activeRect = this.cropDisplayRect();
            ctx.fillStyle = "rgba(0,0,0,.58)";
            ctx.beginPath();
            ctx.rect(...this.imageRect);
            ctx.rect(...this.activeRect);
            ctx.fill("evenodd");
            this.drawHandles(ctx);
        } else {
            const [targetWidth, targetHeight] = this.targetSize();
            this.canvasRect = containedRect(targetWidth, targetHeight, inner);
            this.imageRect = null;
            ctx.fillStyle = parseColor(findWidget(this.node, "fill_color")?.value);
            ctx.fillRect(...this.canvasRect);
            this.activeRect = this.fillDisplayRect();
            ctx.save();
            ctx.beginPath();
            ctx.rect(...this.canvasRect);
            ctx.clip();
            ctx.drawImage(this.image, ...this.activeRect);
            ctx.restore();
            this.drawHandles(ctx);
            ctx.strokeStyle = "#666";
            ctx.lineWidth = 1;
            ctx.strokeRect(...this.canvasRect);
        }
        ctx.restore();
    }

    handlePoints() {
        if (!this.activeRect) return [];
        const [x, y, width, height] = this.activeRect;
        return [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    }

    nodePosition(pos) {
        if (!Array.isArray(pos)) return pos;
        const inside = pos[0] >= this.rect[0] && pos[0] <= this.rect[0] + this.rect[2]
            && pos[1] >= this.rect[1] && pos[1] <= this.rect[1] + this.rect[3];
        return inside ? pos : [pos[0] + this.rect[0], pos[1] + this.rect[1]];
    }

    cropPoint(pos) {
        return [
            ((pos[0] - this.imageRect[0]) / this.imageRect[2]) * this.image.naturalWidth,
            ((pos[1] - this.imageRect[1]) / this.imageRect[3]) * this.image.naturalHeight,
        ];
    }

    fillPoint(pos) {
        const [targetWidth, targetHeight] = this.targetSize();
        return [
            ((pos[0] - this.canvasRect[0]) / this.canvasRect[2]) * targetWidth,
            ((pos[1] - this.canvasRect[1]) / this.canvasRect[3]) * targetHeight,
        ];
    }

    updateMove(pos) {
        const mode = this.mode();
        const point = mode === "crop" ? this.cropPoint(pos) : this.fillPoint(pos);
        const base = mode === "crop"
            ? [this.image.naturalWidth, this.image.naturalHeight]
            : this.targetSize();
        const state = this.state(mode);
        this.setState(
            mode,
            (point[0] - this.dragOffset[0]) / base[0],
            (point[1] - this.dragOffset[1]) / base[1],
            state.scale,
        );
    }

    updateResize(pos) {
        const mode = this.mode();
        const state = this.state(mode);
        if (mode === "crop") {
            const point = this.cropPoint(pos);
            const geometry = this.cropGeometry();
            const centerX = geometry.left + geometry.width / 2;
            const centerY = geometry.top + geometry.height / 2;
            const maximum = this.cropGeometryAtScaleOne();
            const scale = Math.max(
                Math.abs(point[0] - centerX) * 2 / maximum.width,
                Math.abs(point[1] - centerY) * 2 / maximum.height,
            );
            this.setState("crop", centerX / this.image.naturalWidth, centerY / this.image.naturalHeight, scale);
        } else {
            const point = this.fillPoint(pos);
            const geometry = this.fillGeometry();
            const centerX = geometry.left + geometry.width / 2;
            const centerY = geometry.top + geometry.height / 2;
            const containWidth = geometry.width / state.scale;
            const containHeight = geometry.height / state.scale;
            const scale = Math.max(
                Math.abs(point[0] - centerX) * 2 / containWidth,
                Math.abs(point[1] - centerY) * 2 / containHeight,
            );
            const [targetWidth, targetHeight] = this.targetSize();
            this.setState("pad", centerX / targetWidth, centerY / targetHeight, scale);
        }
    }

    cropGeometryAtScaleOne() {
        const states = this.states();
        const saved = states.crop || {};
        states.crop = { ...saved, scale: 1 };
        const original = this.value;
        this.value = JSON.stringify(states);
        const geometry = this.cropGeometry();
        this.value = original;
        return geometry;
    }

    openColorPicker() {
        const widget = findWidget(this.node, "fill_color");
        if (!widget) return;
        const input = document.createElement("input");
        input.type = "color";
        input.value = parseColor(widget.value);
        input.style.position = "fixed";
        input.style.opacity = "0";
        input.style.pointerEvents = "none";
        document.body.appendChild(input);
        const update = () => {
            widget.value = input.value;
            widget.callback?.(input.value);
            this.node.graph?.setDirtyCanvas?.(true, true);
            this.triggerDraw?.();
        };
        const cleanup = () => input.remove();
        input.addEventListener("input", update);
        input.addEventListener("change", () => { update(); cleanup(); }, { once: true });
        input.addEventListener("blur", () => setTimeout(cleanup, 0), { once: true });
        input.click();
    }

    mouse(event, pos) {
        if (!this.visible) return false;
        pos = this.renderCanvas && this.renderCanvas !== app.canvas?.canvas
            ? legacyCanvasPosition(this.renderCanvas, event, pos) : this.nodePosition(pos);
        const eventType = String(event?.type || "");
        if (eventType.includes("down") && event.button === 0 && this.colorButtonRect) {
            const [x, y, width, height] = this.colorButtonRect;
            if (pos[0] >= x && pos[0] <= x + width && pos[1] >= y && pos[1] <= y + height) {
                this.openColorPicker();
                return true;
            }
        }
        if (eventType.includes("down") && event.button === 0 && this.sendButtonRect) {
            const [x, y, width, height] = this.sendButtonRect;
            if (pos[0] >= x && pos[0] <= x + width && pos[1] >= y && pos[1] <= y + height) {
                sendProcessedImage(this.node);
                return true;
            }
        }
        if (!this.activeRect) return false;
        if (eventType.includes("down") && event.button === 0) {
            const handle = this.handlePoints().some(([x, y]) => Math.hypot(pos[0] - x, pos[1] - y) <= HANDLE_SIZE);
            const [x, y, width, height] = this.activeRect;
            const inside = pos[0] >= x && pos[0] <= x + width && pos[1] >= y && pos[1] <= y + height;
            if (!handle && !inside) return false;
            this.dragMode = handle ? "resize" : "move";
            if (this.dragMode === "move") {
                const mode = this.mode();
                const point = mode === "crop" ? this.cropPoint(pos) : this.fillPoint(pos);
                const geometry = mode === "crop" ? this.cropGeometry() : this.fillGeometry();
                this.dragOffset = [
                    point[0] - (geometry.left + geometry.width / 2),
                    point[1] - (geometry.top + geometry.height / 2),
                ];
            }
            return true;
        }
        if (eventType.includes("move") && this.dragMode) {
            if (this.dragMode === "resize") this.updateResize(pos);
            else this.updateMove(pos);
            return true;
        }
        if (eventType.includes("up") && this.dragMode) {
            if (this.dragMode === "resize") this.updateResize(pos);
            else this.updateMove(pos);
            this.dragMode = null;
            return true;
        }
        return false;
    }
}

function activate(node) {
    if (nodeClass(node) !== NODE_NAME) return;
    for (const name of [
        "auto_output", "method", "aspect_ratio", "invert_ratio", "multiple_of", "interpolation", "fill_color",
    ]) {
        wrapRefresh(findWidget(node, name), node, () => {
            if (["aspect_ratio", "invert_ratio", "multiple_of"].includes(name)) syncDimensions(node, "short");
        });
    }
    wrapRefresh(findWidget(node, "short_side"), node, () => syncDimensions(node, "short"));
    wrapRefresh(findWidget(node, "long_side"), node, () => syncDimensions(node, "long"));
    syncDimensions(node, "short");
    refreshControls(node);
    const ref = node.properties?.no8d_image_size_source
        || app.nodeOutputs?.[node.id]?.source_images?.[0];
    if (ref && !node._no8dImageSizeCanvas?.image) {
        node._no8dImageSizeCanvas?.setPreview(ref).catch((error) => {
            console.warn("[NO8D image size] preview restore failed", error);
        });
    }
}

app.registerExtension({
    name: "NO8D.Control.ImageSizeCanvas",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            releaseLegacyCanvas(this._no8dImageSizeCanvas);
            return onRemoved?.apply(this, arguments);
        };
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            activate(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            migrateWidgetValues(info);
            onConfigure?.apply(this, arguments);
            setTimeout(() => activate(this), 0);
        };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            onExecuted?.apply(this, arguments);
            const ref = message?.source_images?.[0];
            if (ref) {
                this.properties = this.properties || {};
                this.properties.no8d_image_size_source = ref;
            }
            this._no8dImageSizeCanvas?.setPreview(ref).catch((error) => {
                console.warn("[NO8D image size] preview load failed", error);
            });
            this.imgs = undefined;
            this.images = undefined;
        };
        const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function () {
            const imgs = this.imgs;
            const images = this.images;
            this.imgs = undefined;
            this.images = undefined;
            try { return onDrawBackground?.apply(this, arguments); }
            finally { this.imgs = imgs; this.images = images; }
        };
    },
    getCustomWidgets() {
        return {
            [CANVAS_TYPE](node, inputName, inputData) {
                const widget = new ImageSizeCanvasWidget(node, inputName, inputData[0]);
                node.addCustomWidget(widget);
                node._no8dImageSizeCanvas = widget;
                return { widget };
            },
        };
    },
    nodeCreated(node) {
        activate(node);
    },
});
