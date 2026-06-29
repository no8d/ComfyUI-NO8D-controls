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
        promptSettingsTitle: "Prompt",
        promptWritingRules: "Prompt writing rules",
        defaultPromptApi: "Default prompt API",
        promptApiConfiguration: "Prompt API configuration",
        ruleManager: "Rule Manager",
        apiManager: "API Manager",
        promptRuleManagerTitle: "NO8D Prompt Rule Manager",
        promptApiManagerTitle: "NO8D Prompt API Manager",
        ruleManagerHint: "This text is sent to the language model as the writing rule for the selected node rule.",
        kreaCaptionRule: "Natural language",
        ideogramCaptionRule: "JSON structure",
        addRule: "+ Add rule",
        deleteRule: "Delete rule",
        ruleName: "Rule name",
        ruleMode: "Output format",
        ruleModeNatural: "Natural language",
        ruleModeJson: "JSON structure",
        customRuleName: "Custom caption rule",
        cannotDeleteBuiltinRule: "Built-in rules cannot be deleted.",
        duplicateRuleName: "Rule name already exists.",
        cancel: "Cancel",
        save: "Save",
        searchModel: "Search model",
        noModelsFound: "No models found.",
        noApiService: "No API service",
        addService: "+ Add service",
        noApiServiceConfigured: "No API service configured.",
        serviceName: "Service name",
        baseUrl: "Base URL",
        apiKey: "API key",
        savedApiKey: "Saved API key",
        pasteApiKey: "Paste API key",
        validateApi: "Validate API",
        models: "Models",
        noModelsConfigured: "No model selected. Validate the API, then choose one model from the dropdown.",
        selectedModel: "Selected model",
        apiValidated: "API validated",
        apiValidationFailed: "API validation failed",
        promptRulesSaved: "NO8D prompt rules saved",
        promptApiSaved: "NO8D Prompt API saved",
        defaultApiSaved: "NO8D default API saved",
        saveFailed: "Save failed",
        loading: "Loading...",
        promptConfigLoadFailed: "Failed to load Prompt config",
        promptViewAuto: "Auto output",
        promptViewSend: "Send",
        promptViewSendTitle: "Send the current edited prompt to the output",
        promptViewPlaceholder: "Prompt output will appear here",
        promptPlusTitle: "NO8D-Prompt-plus",
        promptBatchPlusTitle: "NO8D-Batch-Prompt-plus",
        promptViewTitle: "NO8D-Prompt-view",
        promptRules: "Prompt rule",
        promptSeed: "Seed",
        promptSeedControl: "Seed control",
        promptStylePreset: "Style",
        promptLengthPreset: "Length",
        promptOutputLanguage: "Output language",
        promptExtraRules: "Extra rules",
        promptTextInput: "Text",
        promptImagesInput: "Images",
        promptImageInput: "Image",
        promptPositiveOutput: "Positive",
        promptCaptionsOutput: "Captions",
        promptCombinedOutput: "Combined",
        promptEditedText: "Prompt",
        promptSendSeq: "Send sequence",
        imageLoaderTitle: "NO8D-Load-images",
        imageLoaderFiles: "Selected images",
        imageLoaderLoad: "Load images",
        imageLoaderClear: "Clear",
        imageLoaderDeleteSelected: "Delete selected",
        imageLoaderSelectSingle: "Single",
        imageLoaderSelectMulti: "Multi",
        imageLoaderSelectBox: "Box",
        imageLoaderEmpty: "No images selected",
        imageLoaderSelected: "images selected",
        imageLoaderSelectedCount: "selected",
        imageLoaderOutputSingle: "Output single image",
        imageLoaderThumbSize: "Thumbnail size",
        imageLoaderThumbFailed: "Thumbnail failed",
        imageLoaderUploading: "Uploading...",
        imageLoaderUploadFailed: "Image upload failed",
        imageLoaderImages: "Images",
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
        promptSettingsTitle: "提示词",
        promptWritingRules: "提示词撰写规则",
        defaultPromptApi: "默认提示词 API",
        promptApiConfiguration: "提示词 API 配置",
        ruleManager: "规则管理器",
        apiManager: "API 管理器",
        promptRuleManagerTitle: "NO8D 提示词规则管理器",
        promptApiManagerTitle: "NO8D 提示词 API 管理器",
        ruleManagerHint: "这里的文本会作为节点所选规则的撰写规范发送给大语言模型。",
        kreaCaptionRule: "自然语言",
        ideogramCaptionRule: "json结构",
        addRule: "+ 添加规则",
        deleteRule: "删除规则",
        ruleName: "规则名称",
        ruleMode: "输出格式",
        ruleModeNatural: "自然语言",
        ruleModeJson: "json结构",
        customRuleName: "自定义 caption 规则",
        cannotDeleteBuiltinRule: "内置规则不能删除。",
        duplicateRuleName: "规则名称已存在。",
        cancel: "取消",
        save: "保存",
        searchModel: "搜索模型",
        noModelsFound: "没有找到模型。",
        noApiService: "没有 API 服务",
        addService: "+ 添加服务",
        noApiServiceConfigured: "尚未配置 API 服务。",
        serviceName: "服务名称",
        baseUrl: "Base URL",
        apiKey: "API key",
        savedApiKey: "已保存 API key",
        pasteApiKey: "粘贴 API key",
        validateApi: "验证 API",
        models: "模型",
        noModelsConfigured: "尚未选择模型。请先验证 API，然后在下拉菜单中选择一个模型。",
        selectedModel: "已选模型",
        apiValidated: "API 验证通过",
        apiValidationFailed: "API 验证失败",
        promptRulesSaved: "NO8D 提示词规则已保存",
        promptApiSaved: "NO8D 提示词 API 已保存",
        defaultApiSaved: "NO8D 默认 API 已保存",
        saveFailed: "保存失败",
        loading: "加载中...",
        promptConfigLoadFailed: "加载提示词配置失败",
        promptViewAuto: "自动输出",
        promptViewSend: "发送",
        promptViewSendTitle: "将当前编辑后的提示词发送到输出",
        promptViewPlaceholder: "提示词输出会显示在这里",
        promptPlusTitle: "NO8D-提示词扩写",
        promptBatchPlusTitle: "NO8D-批量提示词反推",
        promptViewTitle: "NO8D-提示词预览",
        promptRules: "提示词规则",
        promptSeed: "种子",
        promptSeedControl: "生成控制",
        promptStylePreset: "风格",
        promptLengthPreset: "长度",
        promptOutputLanguage: "输出语言",
        promptExtraRules: "附加规则",
        promptTextInput: "文本",
        promptImagesInput: "图像",
        promptImageInput: "图像",
        promptPositiveOutput: "正向提示词",
        promptCaptionsOutput: "提示词列表",
        promptCombinedOutput: "合并文本",
        promptEditedText: "提示词",
        promptSendSeq: "发送序号",
        imageLoaderTitle: "NO8D-图像载入",
        imageLoaderFiles: "已选图像",
        imageLoaderLoad: "载入图像",
        imageLoaderClear: "清空",
        imageLoaderDeleteSelected: "删除选中",
        imageLoaderSelectSingle: "单选",
        imageLoaderSelectMulti: "复选",
        imageLoaderSelectBox: "框选",
        imageLoaderEmpty: "尚未选择图像",
        imageLoaderSelected: "张图像已选择",
        imageLoaderSelectedCount: "张已选中",
        imageLoaderOutputSingle: "输出单张图像",
        imageLoaderThumbSize: "缩略图尺寸",
        imageLoaderThumbFailed: "缩略图加载失败",
        imageLoaderUploading: "上传中...",
        imageLoaderUploadFailed: "图像上传失败",
        imageLoaderImages: "图像",
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
