import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const NODE_TITLE_KEYS = {
    NO8DLoraStack: "sliderStackTitle",
    NO8DGenerate: "generateTitle",
    NO8DABPreview: "abPreviewTitle",
    NO8DBatchPromptPlus: "promptNodeTitle",
    NO8DPromptView: "promptViewTitle",
    NO8DLoadImages: "imageLoaderTitle",
    NO8DSaveImageTextDataset: "saveTitle",
    NO8DEmptyLatent: "emptyLatentTitle",
    NO8DImageGrid: "imageGridTitle",
    NO8DImageTitle: "imageTitleTitle",
    NO8DKreaStyleSelector: "kreaStyleTitle",
};

const NODE_DESCRIPTION_KEYS = {
    NO8DImageGrid: "imageGridDescription",
    NO8DImageTitle: "imageTitleDescription",
    NO8DKreaStyleSelector: "kreaStyleDescription",
};

const WIDGET_LABELS = {
    NO8DImageGrid: {
        layout: "imageGridLayout",
        crop_mode: "imageGridCropMode",
        columns: "imageGridColumns",
        spacing: "imageGridSpacing",
        background_color: "imageGridBackground",
    },
    NO8DImageTitle: {
        titles: "imageTitleTitles",
        title_bar_color: "imageTitleBarColor",
        title_bar_opacity: "imageTitleBarOpacity",
        title_position: "imageTitlePosition",
        title_bar_height: "imageTitleBarHeight",
        font_size: "imageTitleFontSize",
        text_padding: "imageTitlePadding",
        text_color: "imageTitleTextColor",
        text_align: "imageTitleTextAlign",
    },
};

const COMBO_LABELS = {
    NO8DImageGrid: {
        layout: [
            ["imageGridHorizontal", "Horizontal", "横向"],
            ["imageGridVertical", "Vertical", "纵向"],
            ["imageGridGrid", "Grid", "网格"],
        ],
        crop_mode: [
            ["imageGridCropNone", "None", "none"],
            ["imageGridCropStandard", "Standard crop", "标准裁切"],
            ["imageGridCropLeft", "Left crop", "居左裁切"],
            ["imageGridCropCenter", "Center crop", "居中裁切"],
            ["imageGridCropRight", "Right crop", "居右裁切"],
        ],
    },
    NO8DImageTitle: {
        title_position: [
            ["imageTitleOutsideTop", "Outside top", "图外顶部"],
            ["imageTitleInsideTop", "Inside top", "图内顶部"],
            ["imageTitleMiddle", "Middle", "中部"],
            ["imageTitleInsideBottom", "Inside bottom", "图内底部"],
            ["imageTitleOutsideBottom", "Outside bottom", "图外底部"],
        ],
        text_align: [
            ["imageTitleAlignLeft", "Left", "居左"],
            ["imageTitleAlignCenter", "Center", "居中"],
            ["imageTitleAlignRight", "Right", "居右"],
        ],
    },
};

const INPUT_LABELS = {
    NO8DImageTitle: { images: "imageTitleImages" },
};

const PERCENT_WIDGETS = new Set(["title_bar_opacity", "title_bar_height"]);
const PERCENT_DISPLAY = Symbol("no8dPercentDisplay");

function applyPercentDisplay(widget) {
    if (!PERCENT_WIDGETS.has(widget.name) || widget[PERCENT_DISPLAY]) return false;
    Object.defineProperty(widget, "_displayValue", {
        configurable: true,
        get() {
            const precision = this.options?.precision ?? 0;
            return `${Number(this.value).toFixed(precision)}%`;
        },
    });
    widget[PERCENT_DISPLAY] = true;
    return true;
}

let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function titleForClass(className) {
    const key = NODE_TITLE_KEYS[className];
    return key ? t(key) : "";
}

function applyNodeTitle(node) {
    const className = nodeClass(node);
    const title = titleForClass(className);
    let changed = false;
    if (title && node.title !== title) {
        node.title = title;
        changed = true;
    }
    const widgetLabels = WIDGET_LABELS[className] || {};
    const comboLabels = COMBO_LABELS[className] || {};
    for (const widget of node.widgets || []) {
        if (className === "NO8DImageTitle") changed = applyPercentDisplay(widget) || changed;
        const labelKey = widgetLabels[widget.name];
        if (labelKey) {
            const label = t(labelKey);
            widget.label = label;
            widget.options = widget.options || {};
            widget.options.label = label;
            changed = true;
        }
        const entries = comboLabels[widget.name];
        if (!entries) continue;
        const current = String(widget.value ?? "");
        const entry = entries.find(([, english, chinese]) => current === english || current === chinese);
        if (entry) widget.value = t(entry[0]);
        widget.options = widget.options || {};
        widget.options.values = entries.map(([key]) => t(key));
        changed = true;
    }
    const inputLabels = INPUT_LABELS[className] || {};
    for (const input of node.inputs || []) {
        const key = inputLabels[input.name];
        if (!key) continue;
        const label = t(key);
        input.label = label;
        input.localized_name = label;
        changed = true;
    }
    return changed;
}

function applyAllNodeTitles(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeLocale) return;
    activeLocale = locale;
    let changed = false;
    for (const node of app?.graph?._nodes || []) {
        changed = applyNodeTitle(node) || changed;
    }
    if (changed) {
        app?.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
}

app.registerExtension({
    name: "NO8D.Control.NodeTitlesI18N",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllNodeTitles(true), 500);
        window.addEventListener("storage", () => applyAllNodeTitles(true));
        window.addEventListener("languagechange", () => applyAllNodeTitles(true));
    },
    async nodeCreated(node) {
        applyNodeTitle(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        const title = titleForClass(nodeData?.name);
        if (!title) return;
        nodeData.display_name = title;
        nodeData.title = title;
        const descriptionKey = NODE_DESCRIPTION_KEYS[nodeData?.name];
        if (descriptionKey) nodeData.description = t(descriptionKey);
        if (!WIDGET_LABELS[nodeData.name]) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            applyNodeTitle(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => {
                if (!applyNodeTitle(this)) return;
                this.graph?.setDirtyCanvas?.(true, true);
                app?.canvas?.setDirty?.(true, true);
            }, 0);
        };
    },
});
