import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const PROMPT_PLUS = "NO8DPromptPlus";
const PROMPT_VIEW = "NO8DPromptView";
const STALE_PROMPT_PLUS_WIDGETS = new Set(["user_prompt", "output_language", "token_range", "auto_run", "seed_control"]);
const SEED_CONTROL_VALUES = new Set(["fixed", "randomize", "increment", "decrement"]);

const WIDGET_LABELS = {
    prompt_rules: "promptRules",
    seed: "promptSeed",
    extra_rules: "promptExtraRules",
    style_preset: "promptStylePreset",
    text: "promptTextInput",
    auto_output: "promptViewAuto",
    edited_text: "promptEditedText",
    send_seq: "promptSendSeq",
};
const SLOT_LABELS = {
    text: "promptTextInput",
    image: "promptImageInput",
    positive: "promptPositiveOutput",
};
const PROMPT_PLUS_WIDGET_ORDER = ["prompt_rules", "style_preset", "extra_rules", "seed"];
let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function removeStalePromptPlusWidgets(node) {
    if (nodeClass(node) !== PROMPT_PLUS || !Array.isArray(node.widgets)) return;
    node.widgets = node.widgets.filter((widget) => !STALE_PROMPT_PLUS_WIDGETS.has(widget.name));
    const seed = node.widgets.find((widget) => widget.name === "seed");
    if (seed && !Number.isFinite(Number(seed.value))) seed.value = 0;
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
    if (nodeClass(node) !== PROMPT_PLUS || !Array.isArray(node.widgets)) return;
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

function applyWidgetLabels(node) {
    const cls = nodeClass(node);
    if (cls !== PROMPT_PLUS && cls !== PROMPT_VIEW) return;
    removeStalePromptPlusWidgets(node);
    orderPromptPlusWidgets(node);
    if (cls === PROMPT_PLUS) node.title = t("promptPlusTitle");
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
        if (![PROMPT_PLUS, PROMPT_VIEW].includes(nodeData.name)) return;
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
