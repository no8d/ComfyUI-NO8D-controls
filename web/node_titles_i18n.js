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
};

let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function titleForClass(className) {
    const key = NODE_TITLE_KEYS[className];
    return key ? t(key) : "";
}

function applyNodeTitle(node) {
    const title = titleForClass(nodeClass(node));
    if (!title || node.title === title) return false;
    node.title = title;
    return true;
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
    async beforeRegisterNodeDef(_nodeType, nodeData) {
        const title = titleForClass(nodeData?.name);
        if (!title) return;
        nodeData.display_name = title;
        nodeData.title = title;
    },
});
