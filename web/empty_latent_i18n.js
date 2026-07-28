import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DEmptyLatent";
const LEGACY_MODEL_TYPES = new Set([
    "SD / SDXL",
    "SD3 / Flux / Krea2",
    "Flux2",
]);

const WIDGET_LABELS = {
    aspect_ratio: "emptyLatentAspectRatio",
    short_side: "emptyLatentShortSide",
    invert_ratio: "emptyLatentInvertRatio",
    manual_short_side: "emptyLatentManualShortSide",
    manual_long_side: "emptyLatentManualLongSide",
    batch_size: "emptyLatentBatchSize",
};

const SLOT_LABELS = {
    latent: "emptyLatentOutput",
    width: "emptyLatentWidth",
    height: "emptyLatentHeight",
};

let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function migrateLegacyWidgetValues(info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values) || !LEGACY_MODEL_TYPES.has(String(values[0] || ""))) return;

    const [, shortSide, aspectRatio, invertRatio, manualWidth, manualHeight, batchSize] = values;
    const [ratioWidth, ratioHeight] = String(aspectRatio || "1:1").split(":").map(Number);
    const isLandscape = Boolean(invertRatio) ? ratioWidth < ratioHeight : ratioWidth > ratioHeight;
    const width = Number(manualWidth) || 0;
    const height = Number(manualHeight) || 0;

    let manualShortSide = 0;
    let manualLongSide = 0;
    if (width > 0 && height > 0) {
        manualShortSide = Math.min(width, height);
        manualLongSide = Math.max(width, height);
    } else if (width > 0) {
        if (isLandscape) manualLongSide = width;
        else manualShortSide = width;
    } else if (height > 0) {
        if (isLandscape) manualShortSide = height;
        else manualLongSide = height;
    }

    info.widgets_values = [
        aspectRatio,
        shortSide,
        invertRatio,
        manualShortSide,
        manualLongSide,
        batchSize,
    ];
}

function applySlotLabels(slots) {
    for (const slot of slots || []) {
        const key = SLOT_LABELS[slot.name];
        if (!key) continue;
        const label = t(key);
        slot.label = label;
        slot.localized_name = label;
    }
}

function applyLabels(node) {
    if (nodeClass(node) !== NODE_NAME) return;
    node.title = t("emptyLatentTitle");
    for (const widget of node.widgets || []) {
        const key = WIDGET_LABELS[widget.name];
        if (!key) continue;
        const label = t(key);
        widget.label = label;
        widget.options = widget.options || {};
        widget.options.label = label;
    }
    applySlotLabels(node.outputs);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function applyAllLabels() {
    for (const node of app?.graph?._nodes || []) applyLabels(node);
}

function applyAllLabelsIfNeeded(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeLocale) return;
    activeLocale = locale;
    applyAllLabels();
}

app.registerExtension({
    name: "NO8D.Control.EmptyLatentI18N",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllLabelsIfNeeded(true), 500);
        window.addEventListener("storage", () => applyAllLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllLabelsIfNeeded(true));
    },
    async nodeCreated(node) {
        applyLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onCreated) onCreated.apply(this, arguments);
            applyLabels(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            migrateLegacyWidgetValues(arguments[0]);
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => applyLabels(this), 0);
        };
    },
});
