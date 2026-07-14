import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";
import { refreshBypassElements, registerWidgetBypassElements, wrapBypassRefresh } from "./no8d_bypass.js";

const PROMPT_NODE = "NO8DBatchPromptPlus";
const PROMPT_VIEW = "NO8DPromptView";
const PROMPT_NODE_CLASSES = new Set([PROMPT_NODE]);
const STALE_PROMPT_WIDGETS = new Set(["user_prompt", "token_range", "auto_run", "seed_control"]);
const SEED_CONTROL_VALUES = new Set(["fixed", "randomize", "increment", "decrement"]);

const WIDGET_LABELS = {
    prompt_rules: "promptRules",
    seed: "promptSeed",
    extra_rules: "promptExtraRules",
    style_preset: "promptStylePreset",
    composition_preset: "promptCompositionPreset",
    length_preset: "promptLengthPreset",
    output_language: "promptOutputLanguage",
    text: "promptTextInput",
    auto_output: "promptViewAuto",
    fixed_text: "promptFixedText",
    edited_text: "promptEditedText",
    send_seq: "promptSendSeq",
};
const SLOT_LABELS = {
    text: "promptTextInput",
    images: "promptImagesInput",
    image: "promptImageInput",
    positive: "promptPositiveOutput",
    prompt: "promptOutput",
};
const PROMPT_RULE_DISPLAY = {
    "自然语言": "Natural language",
    "json结构": "JSON structure",
};
const STYLE_DISPLAY = {
    "自行判断": "Auto",
    "写实摄影": "Realistic photography",
    "动漫插图": "Anime illustration",
    "手绘艺术": "Hand-drawn art",
    "数字艺术": "Digital art",
};
const COMPOSITION_DISPLAY = {
    "自行判断": "Auto",
    "大特写": "Extreme close-up",
    "特写": "Close-up",
    "近景": "Medium close-up",
    "中景": "Medium shot",
    "全景": "Full shot",
    "大远景": "Extreme wide shot",
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
const PROMPT_WIDGET_ORDER = ["prompt_rules", "style_preset", "composition_preset", "length_preset", "output_language", "fixed_text", "extra_rules", "seed"];
const COMPOSITION_VALUE_ALIASES = {
    "Close shot": "Medium close-up",
    "Medium wide shot": "Full shot",
    "Wide shot": "Full shot",
    "中近景": "中景",
    "中远景": "全景",
    "远景": "全景",
};
const STYLE_VALUE_ALIASES = {
    "业余摄影": "写实摄影",
    "专业摄影": "写实摄影",
    "影视摄影": "写实摄影",
    "Amateur photography": "写实摄影",
    "Professional photography": "写实摄影",
    "Cinematic photography": "写实摄影",
    "日式动漫": "动漫插图",
    "美式动漫": "动漫插图",
    "3d卡通": "动漫插图",
    "Japanese anime": "动漫插图",
    "American animation": "动漫插图",
    "3D cartoon": "动漫插图",
    "艺术手绘": "手绘艺术",
    "数字绘画": "数字艺术",
    "Traditional hand-drawn art": "手绘艺术",
    "Digital painting": "数字艺术",
    "油画艺术": "手绘艺术",
    "Oil painting": "手绘艺术",
    "插画艺术": "数字艺术",
    "3d写实": "数字艺术",
    "Illustration art": "数字艺术",
    "3D realism": "数字艺术",
};
let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function removeStalePromptPlusWidgets(node) {
    const cls = nodeClass(node);
    if (!PROMPT_NODE_CLASSES.has(cls) || !Array.isArray(node.widgets)) return;
    node.widgets = node.widgets.filter((widget) => !STALE_PROMPT_WIDGETS.has(widget.name));
    const seed = node.widgets.find((widget) => widget.name === "seed");
    if (seed && !Number.isFinite(Number(seed.value))) seed.value = 0;
    const length = node.widgets.find((widget) => widget.name === "length_preset");
    if (length && !LENGTH_VALUES.has(String(length.value || "").trim())) length.value = "标准";
    const language = node.widgets.find((widget) => widget.name === "output_language");
    if (language && !LANGUAGE_VALUES.has(String(language.value || "").trim())) language.value = "英文";
    const composition = node.widgets.find((widget) => widget.name === "composition_preset");
    if (composition) {
        const value = String(composition.value || "").trim();
        if (COMPOSITION_VALUE_ALIASES[value]) composition.value = COMPOSITION_VALUE_ALIASES[value];
    }
    const style = node.widgets.find((widget) => widget.name === "style_preset");
    if (style) {
        const value = String(style.value || "").trim();
        if (STYLE_VALUE_ALIASES[value]) style.value = STYLE_VALUE_ALIASES[value];
    }
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
    const rank = new Map(PROMPT_WIDGET_ORDER.map((name, index) => [name, index]));
    const widgetRank = (widget) => {
        if (typeof widget.name === "string" && /control_after_generate/i.test(widget.name)) return 999;
        return rank.has(widget.name) ? rank.get(widget.name) : PROMPT_WIDGET_ORDER.length;
    };
    node.widgets.sort((a, b) => {
        const ai = widgetRank(a);
        const bi = widgetRank(b);
        if (ai !== bi) return ai - bi;
        return 0;
    });
}

function applySlotLabels(slots) {
    let changed = false;
    for (const slot of slots || []) {
        const key = SLOT_LABELS[slot.name];
        if (!key) continue;
        const label = t(key);
        if (slot.label !== label || slot.localized_name !== label) changed = true;
        slot.label = label;
        slot.localized_name = label;
    }
    return changed;
}

function canonicalOptionValue(value, displayMap) {
    const text = String(value ?? "");
    if ((displayMap === STYLE_DISPLAY || displayMap === COMPOSITION_DISPLAY) && ["none", "None", "Auto", "自动判断", "无"].includes(text)) {
        return "自行判断";
    }
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
    let changed = false;
    removeStalePromptPlusWidgets(node);
    orderPromptPlusWidgets(node);
    const title = cls === PROMPT_NODE ? t("promptNodeTitle") : cls === PROMPT_VIEW ? t("promptViewTitle") : "";
    if (title && node.title !== title) {
        node.title = title;
        changed = true;
    }
    for (const widget of node.widgets || []) {
        if (widget._no8dPromptSend) {
            const label = t("promptViewSend");
            if (widget.name !== label || widget.label !== label || widget.options?.label !== label) changed = true;
            widget.name = label;
            widget.label = label;
            widget.options = widget.options || {};
            widget.options.label = label;
            continue;
        }
        if (typeof widget.name === "string" && /control_after_generate/i.test(widget.name)) {
            const label = t("promptSeedControl");
            if (widget.label !== label || widget.options?.label !== label) changed = true;
            widget.label = label;
            widget.options = widget.options || {};
            widget.options.label = label;
            continue;
        }
        const key = WIDGET_LABELS[widget.name];
        if (!key) continue;
        const label = t(key);
        if (widget.label !== label || widget.options?.label !== label) changed = true;
        widget.label = label;
        widget.options = widget.options || {};
        widget.options.label = label;
        if (widget.name === "extra_rules") {
            widget.options.placeholder = label;
            if (widget.inputEl) widget.inputEl.placeholder = label;
        }
        if (widget.name === "prompt_rules") localizeComboOptions(widget, PROMPT_RULE_DISPLAY);
        if (widget.name === "style_preset") localizeComboOptions(widget, STYLE_DISPLAY);
        if (widget.name === "composition_preset") localizeComboOptions(widget, COMPOSITION_DISPLAY);
        if (widget.name === "length_preset") localizeComboOptions(widget, LENGTH_DISPLAY);
        if (widget.name === "output_language") localizeComboOptions(widget, LANGUAGE_DISPLAY);
    }
    changed = applySlotLabels(node.inputs) || changed;
    changed = applySlotLabels(node.outputs) || changed;
    registerWidgetBypassElements(node, [
        "prompt_rules",
        "style_preset",
        "composition_preset",
        "length_preset",
        "output_language",
        "fixed_text",
        "extra_rules",
        "seed",
    ]);
    refreshBypassElements(node);
    if (changed) {
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
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
        window.addEventListener("storage", () => applyAllPromptLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllPromptLabelsIfNeeded(true));
    },
    async nodeCreated(node) {
        applyWidgetLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (![PROMPT_NODE, PROMPT_VIEW].includes(nodeData.name)) return;
        wrapBypassRefresh(nodeType);
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
