import { app } from "../../scripts/app.js";

const TEXT = {
    en: {
        sampler: "Sampler",
        scheduler: "Sched",
        denoise: "Denoise",
        steps: "Steps",
        cfg: "CFG",
        seed: "Seed",
        seedControl: "Seed control",
        brush: "Brush",
        brushMask: "Brush mask",
        lassoMask: "Lasso mask",
        brushIcon: "✎",
        lassoIcon: "➰",
        invertMaskIcon: "◐",
        refreshMaskIcon: "⟳",
        color: "Color",
        feather: "Feather",
        brushSize: "Brush size",
        invertMask: "Invert mask",
        refreshMask: "Clear mask",
        replacePreview: "Click to replace preview image",
        sliderStackTitle: "NO8D-LoRA stack",
        addLora: "Add LoRA",
        invertEnabled: "Invert",
        invertEnabledTitle: "Invert enabled/disabled states",
        dragReorder: "Drag to reorder",
        editRange: "Edit slider range",
        minValue: "Min",
        maxValue: "Max",
        apply: "Apply",
        applyRange: "Apply slider range",
        deleteLora: "Delete this LoRA",
        openImage: "Open image",
        copyImage: "Copy image",
        saveImage: "Save image",
        liteTitle: "NO8D-Inpainting",
    },
    zh: {
        sampler: "采样器",
        scheduler: "Sched",
        denoise: "降噪",
        steps: "Steps",
        cfg: "CFG",
        seed: "随机种子",
        seedControl: "生成控制",
        brush: "手绘",
        brushMask: "手绘遮罩",
        lassoMask: "套索遮罩",
        brushIcon: "✎",
        lassoIcon: "➰",
        invertMaskIcon: "◐",
        refreshMaskIcon: "⟳",
        color: "颜色",
        feather: "羽化",
        brushSize: "画笔大小",
        invertMask: "反转遮罩",
        refreshMask: "清除遮罩",
        replacePreview: "点击替换预览图",
        sliderStackTitle: "NO8D-LoRA stack",
        addLora: "添加 LoRA",
        invertEnabled: "反选",
        invertEnabledTitle: "睁眼/闭眼状态反选",
        dragReorder: "拖动改变排序",
        editRange: "设置滑块范围",
        minValue: "最小值",
        maxValue: "最大值",
        apply: "应用",
        applyRange: "应用新的滑块范围",
        deleteLora: "删除这条 LoRA",
        openImage: "打开图像",
        copyImage: "复制图像",
        saveImage: "保存图像",
        liteTitle: "NO8D-Inpainting",
    },
};

function callByPath(path, ...args) {
    try {
        const parts = path.split(".");
        const fnName = parts.pop();
        let owner = app;
        for (const part of parts) owner = owner?.[part];
        const fn = owner?.[fnName];
        return typeof fn === "function" ? fn.apply(owner, args) : null;
    } catch (_) {
        return null;
    }
}

function normalizeLocale(value) {
    if (value == null) return null;
    let text = String(value).trim();
    if (!text) return null;
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "string") text = parsed;
        else if (parsed && typeof parsed === "object") {
            text = String(parsed.locale || parsed.language || parsed.value || parsed.id || "");
        }
    } catch (_) {}
    text = text.trim().toLowerCase();
    if (!text) return null;
    if (/^(en|english)([-_a-z]*)?$/.test(text) || text.includes("english")) return "en";
    if (/^(zh|cn|chinese)([-_a-z]*)?$/.test(text) || /中文|简体|繁体|chinese/.test(text)) return "zh";
    return null;
}

function localStorageLocale() {
    const preferredKeys = [
        "Comfy.Locale",
        "Comfy.Language",
        "ComfyUI.Locale",
        "ComfyUI.Language",
        "locale",
        "language",
        "i18nextLng",
    ];
    try {
        for (const key of preferredKeys) {
            const lang = normalizeLocale(localStorage.getItem(key));
            if (lang) return lang;
        }
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i) || "";
            if (!/comfy|i18n|locale|language/i.test(key)) continue;
            const lang = normalizeLocale(localStorage.getItem(key));
            if (lang) return lang;
        }
    } catch (_) {}
    return null;
}

function visibleComfyLocale() {
    const text = (document.body?.innerText || "").slice(0, 30000);
    if (/\bcontrol before generate\b|\bcontrol after generate\b|\bQueue\b|\bRun\b|\bManager\b/i.test(text)) return "en";
    if (/生成前控制|生成后控制|运行|队列|管理扩展功能|刷新节点/.test(text)) return "zh";
    return null;
}

export function no8dLocale() {
    const explicit = [
        callByPath("extensionManager.setting.get", "Comfy.Locale"),
        callByPath("extensionManager.setting.get", "Comfy.Language"),
        callByPath("ui.settings.getSettingValue", "Comfy.Locale"),
        callByPath("ui.settings.getSettingValue", "Comfy.Language"),
        callByPath("ui.settings.getSettingValue", "locale"),
        callByPath("ui.settings.getSettingValue", "language"),
    ];
    for (const value of explicit) {
        const lang = normalizeLocale(value);
        if (lang) return lang;
    }
    return visibleComfyLocale()
        || localStorageLocale()
        || normalizeLocale(document.documentElement.lang)
        || "en";
}

export function t(key) {
    const lang = no8dLocale();
    return TEXT[lang]?.[key] || TEXT.en[key] || key;
}
