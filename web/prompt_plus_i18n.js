import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const PROMPT_PLUS = "NO8DPromptPlus";
const PROMPT_BATCH_PLUS = "NO8DBatchPromptPlus";
const PROMPT_VIEW = "NO8DPromptView";
const PROMPT_NODE_CLASSES = new Set([PROMPT_PLUS, PROMPT_BATCH_PLUS]);
const STALE_PROMPT_PLUS_WIDGETS = new Set(["user_prompt", "token_range", "auto_run", "seed_control"]);
const SEED_CONTROL_VALUES = new Set(["fixed", "randomize", "increment", "decrement"]);

const WIDGET_LABELS = {
    prompt_rules: "promptRules",
    seed: "promptSeed",
    extra_rules: "promptExtraRules",
    style_preset: "promptStylePreset",
    length_preset: "promptLengthPreset",
    output_language: "promptOutputLanguage",
    text: "promptTextInput",
    auto_output: "promptViewAuto",
    edited_text: "promptEditedText",
    send_seq: "promptSendSeq",
};
const SLOT_LABELS = {
    text: "promptTextInput",
    images: "promptImagesInput",
    image: "promptImageInput",
    positive: "promptPositiveOutput",
    captions: "promptCaptionsOutput",
    combined: "promptCombinedOutput",
};
const PROMPT_RULE_DISPLAY = {
    "自然语言": "Natural language",
    "json结构": "JSON structure",
};
const STYLE_DISPLAY = {
    "业余摄影": "Amateur photography",
    "专业摄影": "Professional photography",
    "影视摄影": "Cinematic photography",
    "日式动漫": "Japanese anime",
    "美式动漫": "American animation",
    "插画艺术": "Illustration art",
    "油画艺术": "Oil painting",
    "3d写实": "3D realism",
    "3d卡通": "3D cartoon",
};
const LENGTH_DISPLAY = {
    "标准": "Standard",
    "详细": "Detailed",
};
const LANGUAGE_DISPLAY = {
    "英文": "English",
    "中文": "Chinese",
};
const LENGTH_VALUES = new Set([...Object.keys(LENGTH_DISPLAY), ...Object.values(LENGTH_DISPLAY)]);
const LANGUAGE_VALUES = new Set([...Object.keys(LANGUAGE_DISPLAY), ...Object.values(LANGUAGE_DISPLAY)]);
const PROMPT_PLUS_WIDGET_ORDER = ["prompt_rules", "style_preset", "length_preset", "output_language", "extra_rules", "seed"];
let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function removeStalePromptPlusWidgets(node) {
    const cls = nodeClass(node);
    if (!PROMPT_NODE_CLASSES.has(cls) || !Array.isArray(node.widgets)) return;
    node.widgets = node.widgets.filter((widget) => !STALE_PROMPT_PLUS_WIDGETS.has(widget.name) && !(cls === PROMPT_PLUS && widget.name === "output_language"));
    const seed = node.widgets.find((widget) => widget.name === "seed");
    if (seed && !Number.isFinite(Number(seed.value))) seed.value = 0;
    const length = node.widgets.find((widget) => widget.name === "length_preset");
    if (length && !LENGTH_VALUES.has(String(length.value || "").trim())) length.value = "标准";
    const language = node.widgets.find((widget) => widget.name === "output_language");
    if (language && !LANGUAGE_VALUES.has(String(language.value || "").trim())) language.value = "英文";
    for (const widget of node.widgets) {
        if (typeof widget.name === "string" && /control_after_generate/i.test(widget.name)) {
            const value = String(widget.value || "").trim();
            if (!SEED_CONTROL_VALUES.has(value)) widget.value = "fixed";
        }
    }
    const extra = node.widgets.find((widget) => widget.name === "extra_rules");
    if (extra && /^(true|false|fixed|randomize|increment|decrement)$/i.test(String(extra.value || "").trim())) {
        extra.value = "";
    }
}

function orderPromptPlusWidgets(node) {
    if (!PROMPT_NODE_CLASSES.has(nodeClass(node)) || !Array.isArray(node.widgets)) return;
    const rank = new Map(PROMPT_PLUS_WIDGET_ORDER.map((name, index) => [name, index]));
    const widgetRank = (widget) => {
        if (typeof widget.name === "string" && /control_after_generate/i.test(widget.name)) return 999;
        return rank.has(widget.name) ? rank.get(widget.name) : PROMPT_PLUS_WIDGET_ORDER.length;
    };
    node.widgets.sort((a, b) => {
        const ai = widgetRank(a);
        const bi = widgetRank(b);
        if (ai !== bi) return ai - bi;
        return 0;
    });
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

function canonicalOptionValue(value, displayMap) {
    const text = String(value ?? "");
    if (Object.hasOwn(displayMap, text)) return text;
    for (const [canonical, translated] of Object.entries(displayMap)) {
        if (translated === text) return canonical;
    }
    return text;
}

function localizeOptionValue(value, displayMap) {
    const canonical = canonicalOptionValue(value, displayMap);
    return no8dLocale() === "zh" ? canonical : (displayMap[canonical] || canonical);
}

function localizeComboOptions(widget, displayMap) {
    widget.value = localizeOptionValue(widget.value, displayMap);
    const values = widget.options?.values;
    if (Array.isArray(values)) {
        widget.options.values = [...new Set(values.map((value) => localizeOptionValue(value, displayMap)))];
    }
}

function applyWidgetLabels(node) {
    const cls = nodeClass(node);
    if (!PROMPT_NODE_CLASSES.has(cls) && cls !== PROMPT_VIEW) return;
    removeStalePromptPlusWidgets(node);
    orderPromptPlusWidgets(node);
    if (cls === PROMPT_PLUS) node.title = t("promptPlusTitle");
    if (cls === PROMPT_BATCH_PLUS) node.title = t("promptBatchPlusTitle");
    if (cls === PROMPT_VIEW) node.title = t("promptViewTitle");
    for (const widget of node.widgets || []) {
        if (widget._no8dPromptSend) {
            widget.name = t("promptViewSend");
            widget.label = t("promptViewSend");
            widget.options = widget.options || {};
            widget.options.label = t("promptViewSend");
            continue;
        }
        if (typeof widget.name === "string" && /control_after_generate/i.test(widget.name)) {
            const label = t("promptSeedControl");
            widget.label = label;
            widget.options = widget.options || {};
            widget.options.label = label;
            continue;
        }
        const key = WIDGET_LABELS[widget.name];
        if (!key) continue;
        const label = t(key);
        widget.label = label;
        widget.options = widget.options || {};
        widget.options.label = label;
        if (widget.name === "prompt_rules") localizeComboOptions(widget, PROMPT_RULE_DISPLAY);
        if (widget.name === "style_preset") localizeComboOptions(widget, STYLE_DISPLAY);
        if (widget.name === "length_preset") localizeComboOptions(widget, LENGTH_DISPLAY);
        if (widget.name === "output_language") localizeComboOptions(widget, LANGUAGE_DISPLAY);
    }
    applySlotLabels(node.inputs);
    applySlotLabels(node.outputs);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function applyAllPromptLabels() {
    for (const node of app?.graph?._nodes || []) applyWidgetLabels(node);
}

function applyAllPromptLabelsIfNeeded(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeLocale) return;
    activeLocale = locale;
    applyAllPromptLabels();
}

app.registerExtension({
    name: "NO8D.Control.PromptNodeI18N",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllPromptLabelsIfNeeded(true), 500);
        setTimeout(() => applyAllPromptLabelsIfNeeded(true), 1500);
        window.addEventListener("storage", () => applyAllPromptLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllPromptLabelsIfNeeded(true));
        setInterval(applyAllPromptLabelsIfNeeded, 1000);
    },
    async nodeCreated(node) {
        applyWidgetLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (![PROMPT_PLUS, PROMPT_BATCH_PLUS, PROMPT_VIEW].includes(nodeData.name)) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onCreated) onCreated.apply(this, arguments);
            applyWidgetLabels(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => applyWidgetLabels(this), 0);
        };
    },
});
