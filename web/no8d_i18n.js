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
        colorValue: "Color value",
        feather: "Feather value",
        maskOpacity: "Opacity",
        growMaskBy: "Grow mask",
        brushSize: "Brush size",
        invertMask: "Invert mask",
        refreshMask: "Clear mask",
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
        toggleLora: "Enable or disable this LoRA",
        triggerWords: "Trigger",
        triggerWordsPlaceholder: "Trigger words",
        openImage: "Open image",
        copyImage: "Copy image",
        saveImage: "Save image",
        abNoComparableImage: "No comparable images",
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
        newServiceName: "New service",
        noApiServiceConfigured: "No API service configured.",
        serviceType: "Service type",
        openaiCompatibleService: "OpenAI-compatible API",
        localLlmService: "Local LLM (Ollama)",
        baseUrl: "Base URL",
        apiKey: "API key",
        savedApiKey: "Saved API key",
        pasteApiKey: "Paste API key",
        notRequired: "Not required",
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
        promptFixedText: "Fixed prompt",
        promptNodeTitle: "NO8D-Prompt",
        promptViewTitle: "NO8D-Prompt-view",
        promptRules: "Prompt rule",
        promptSeed: "Seed",
        promptSeedControl: "Seed control",
        promptStylePreset: "Style",
        promptCompositionPreset: "Shot scale",
        promptLengthPreset: "Length",
        promptOutputLanguage: "Output language",
        promptExtraRules: "Input text",
        promptTextInput: "Text",
        promptImagesInput: "Images",
        promptImageInput: "Image",
        promptPositiveOutput: "Positive",
        promptOutput: "prompt",
        promptEditedText: "Prompt",
        promptSendSeq: "Send sequence",
        imageLoaderTitle: "NO8D-Load-images",
        imageLoaderFiles: "Selected images",
        imageLoaderLoad: "Load images",
        imageLoaderEmpty: "No images selected",
        imageLoaderSelected: "images selected",
        imageLoaderSelectedCount: "selected",
        imageLoaderThumbSize: "Thumbnail size",
        imageLoaderMaxThumbSize: "Max thumbnail size",
        imageLoaderThumbFailed: "Thumbnail failed",
        imageLoaderUploading: "Loading...",
        imageLoaderUploadFailed: "Image upload failed",
        imageLoaderImages: "Images",
        saveFolderPath: "Folder path",
        saveImageFormat: "Image format",
        saveQuality: "Quality",
        saveEmbedMetadata: "Embed metadata",
        saveNamingRules: "Naming rules",
        saveAddPart: "Add rule",
        saveDeletePart: "Delete this part",
        saveFixedText: "Fixed text",
        saveVar_none: "None",
        saveVar_original_name: "Original filename",
        saveVar_datetime: "Date + time",
        saveVar_size_class: "Size class",
        emptyLatentTitle: "NO8D-Empty latent",
        emptyLatentModelType: "Model family",
        emptyLatentAspectRatio: "Aspect ratio",
        emptyLatentShortSide: "Short side",
        emptyLatentInvertRatio: "Invert ratio",
        emptyLatentManualWidth: "Manual width",
        emptyLatentManualHeight: "Manual height",
        emptyLatentBatchSize: "Batch size",
        emptyLatentOutput: "latent",
        emptyLatentWidth: "width",
        emptyLatentHeight: "height",
        saveTitle: "NO8D save",
        noImage: "No image",
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
        colorValue: "颜色值",
        feather: "羽化值",
        maskOpacity: "透明度",
        growMaskBy: "遮罩扩展",
        brushSize: "画笔大小",
        invertMask: "反转遮罩",
        refreshMask: "清除遮罩",
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
        toggleLora: "临时启用/关闭此 LoRA",
        triggerWords: "触发词",
        triggerWordsPlaceholder: "填写该 LoRA 的触发词",
        openImage: "打开图像",
        copyImage: "复制图像",
        saveImage: "保存图像",
        abNoComparableImage: "没有可以对比的图像",
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
        addService: "+ 新增服务",
        newServiceName: "新增服务",
        noApiServiceConfigured: "尚未配置 API 服务。",
        serviceType: "服务类型",
        openaiCompatibleService: "OpenAI 兼容 API",
        localLlmService: "本地 LLM（Ollama）",
        baseUrl: "Base URL",
        apiKey: "API key",
        savedApiKey: "已保存 API key",
        pasteApiKey: "粘贴 API key",
        notRequired: "无需填写",
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
        promptFixedText: "固定提示词",
        promptNodeTitle: "NO8D-Prompt",
        promptViewTitle: "NO8D-提示词预览",
        promptRules: "提示词规则",
        promptSeed: "种子",
        promptSeedControl: "生成控制",
        promptStylePreset: "风格",
        promptCompositionPreset: "主体景别",
        promptLengthPreset: "长度",
        promptOutputLanguage: "输出语言",
        promptExtraRules: "输入文本",
        promptTextInput: "文本",
        promptImagesInput: "图像",
        promptImageInput: "图像",
        promptPositiveOutput: "正向提示词",
        promptOutput: "提示词",
        promptEditedText: "提示词",
        promptSendSeq: "发送序号",
        imageLoaderTitle: "NO8D-图像载入",
        imageLoaderFiles: "已选图像",
        imageLoaderLoad: "载入图像",
        imageLoaderEmpty: "尚未选择图像",
        imageLoaderSelected: "张图像已选择",
        imageLoaderSelectedCount: "张已选中",
        imageLoaderThumbSize: "缩略图尺寸",
        imageLoaderMaxThumbSize: "最大缩略图尺寸",
        imageLoaderThumbFailed: "缩略图加载失败",
        imageLoaderUploading: "加载中...",
        imageLoaderUploadFailed: "图像上传失败",
        imageLoaderImages: "图像",
        saveFolderPath: "文件夹路径",
        saveImageFormat: "图像格式",
        saveQuality: "质量",
        saveEmbedMetadata: "写入元数据",
        saveNamingRules: "命名规则",
        saveAddPart: "添加规则",
        saveDeletePart: "删除这一套",
        saveFixedText: "固定文本",
        saveVar_none: "无",
        saveVar_original_name: "原文件名",
        saveVar_datetime: "日期+时间",
        saveVar_size_class: "尺寸等级",
        emptyLatentTitle: "NO8D-空 latent",
        emptyLatentModelType: "模型类型",
        emptyLatentAspectRatio: "画面比例",
        emptyLatentShortSide: "短边尺寸",
        emptyLatentInvertRatio: "反转比例",
        emptyLatentManualWidth: "手动宽度",
        emptyLatentManualHeight: "手动高度",
        emptyLatentBatchSize: "批次数量",
        emptyLatentOutput: "latent",
        emptyLatentWidth: "宽度",
        emptyLatentHeight: "高度",
        saveTitle: "NO8D-图文保存",
        noImage: "没有图像",
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
