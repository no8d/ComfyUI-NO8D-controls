import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale } from "./no8d_i18n.js";

const NODE_NAME = "NO8DKreaStyleSelector";
const API_PREFIX = "/no8d/krea-style-selector";
const MIN_WIDTH = 440;
const MIN_HEIGHT = 560;
const DEFAULT_WIDTH = 850;
const DEFAULT_HEIGHT = 1120;
const PAGE_SIZE = 9;
const BASE_PREVIEW_SIZE = 256;
const BASE_LABEL_FONT_SIZE = 15;
const BASE_LABEL_HEIGHT = 48;
const CATEGORY_LABELS_EN = {
    "写实摄影": "Photography",
    "动漫插图": "Anime & Illustration",
    "手绘艺术": "Hand-Drawn Art",
    "数字艺术": "Digital Art",
    "全部": "All",
    "收藏夹": "Favorites",
    "历史记录": "History",
};
const UI_TEXT = {
    loading: ["正在加载风格列表…", "Loading style list…"],
    selected: ["已选择", "Selected"],
    styles: ["种风格", "styles"],
    search: ["搜索当前分类的名称或提示词…", "Search names or prompts in this category…"],
    clearSearch: ["清空搜索", "Clear search"],
    results: ["个搜索结果", "results"],
    noResults: ["当前分类没有匹配的风格", "No matching styles in this category"],
    addStyle: ["新增自定义风格", "Add custom style"],
    manageStyles: ["管理自定义风格", "Manage custom styles"],
    library: ["载入词库", "Load library"],
    addEntry: ["添加条目", "Add entry"],
    organizeLibrary: ["整理词库", "Organize library"],
    defineLibrary: ["定义词库", "Define library"],
    libraryName: ["词库名称", "Library name"],
    outputPrefix: ["输出前缀", "Output prefix"],
    renameLibrary: ["重命名词库", "Rename library"],
    newLibraryName: ["新词库名称", "New library name"],
    reload: ["重新载入词库", "Reload libraries"],
    customStyles: ["自定义风格库", "Custom style library"],
    libraryManager: ["词库标签管理", "Library tabs"],
    viewTable: ["查看表格", "View table"],
    noCustomStyles: ["还没有自定义风格", "No custom styles yet"],
    editStyle: ["编辑风格", "Edit style"],
    copyStyle: ["复制为新风格", "Duplicate as new style"],
    deleteStyle: ["删除风格", "Delete style"],
    deleteLibrary: ["删除词库", "Delete library"],
    customBadge: ["自定义", "Custom"],
    englishName: ["英文名称（工作流中使用）", "English name (used in workflows)"],
    chineseName: ["中文名称", "Chinese name"],
    name: ["名称", "Name"],
    cardTitle: ["词卡标题", "Card title"],
    category: ["标签分类", "Category tab"],
    prompt: ["风格提示词", "Style prompt"],
    previewImage: ["示意图（可选择、拖入或粘贴）", "Preview (choose, drop, or paste)"],
    chooseImage: ["选择图片", "Choose image"],
    save: ["保存", "Save"],
    saveAs: ["另存修改", "Save as copy"],
    cancel: ["取消", "Cancel"],
    saved: ["自定义风格已保存", "Custom style saved"],
    deleted: ["自定义风格已删除", "Custom style deleted"],
    importWildcards: ["导入词库", "Import library"],
    exportWildcards: ["导出当前词库", "Export current library"],
    batchExport: ["导出词库", "Export libraries"],
    importFavorites: ["导入收藏记录", "Import favorites"],
    exportFavorites: ["导出收藏记录", "Export favorites"],
    importFile: ["TXT、CSV 或 XLSX 文件", "TXT, CSV, or XLSX file"],
    googleSheetsUrl: ["公开 Google Sheets 地址", "Public Google Sheets URL"],
    previewImport: ["解析并预览", "Parse and preview"],
    confirmImport: ["确认导入", "Import"],
    confirm: ["确定", "Confirm"],
    importCount: ["识别到 {count} 条", "{count} rows found"],
    importedCount: ["已导入 {count} 条，跳过 {skipped} 条", "Imported {count}; skipped {skipped}"],
    confirmDelete: ["确定删除这个自定义风格吗？", "Delete this custom style?"],
    saveFailed: ["保存失败", "Save failed"],
    addFavorite: ["加入收藏", "Add to favorites"],
    removeFavorite: ["取消收藏", "Remove from favorites"],
    copyPrompt: ["复制提示词", "Copy prompt"],
    copyCard: ["复制词卡", "Duplicate card"],
    exportSelected: ["导出", "Export"],
    selectAll: ["全选", "Select all"],
    newCard: ["新建词卡", "New card"],
    exportPage: ["导出本页", "Export page"],
    exportAll: ["导出全部", "Export all"],
    clearPageRecords: ["清除本页记录", "Clear page records"],
    clearAllRecords: ["清除所有记录", "Clear all records"],
    refreshPage: ["刷新本页", "Refresh page"],
    outputAll: ["输出当前标签全部提示词", "Output all prompts in this tab"],
    deleteSelected: ["删除", "Delete"],
    removeHistory: ["移除历史记录", "Remove from history"],
    noSelection: ["尚未选择词卡", "No cards selected"],
    previousPage: ["上一页（PageUp）", "Previous page (PageUp)"],
    nextPage: ["下一页（PageDown）", "Next page (PageDown)"],
    page: ["第 {page} 页", "Page {page}"],
    firstPage: ["已经是第一页", "Already on the first page"],
    lastPage: ["已经是最后一页", "Already on the last page"],
    firstItem: ["已经是第一页第一张", "Already on the first item of the first page"],
    lastItem: ["已经是最后一页最后一张", "Already on the last item of the last page"],
    loadFailed: ["风格数据加载失败", "Failed to load style data"],
};
// `category` is kept here only to migrate nodes created by the first preview-based release.
const HIDDEN_WIDGETS = new Set(["category", "style", "library", "random_mode", "output_all", "selected_styles", "selection_cleared", "search_query"]);

let catalogPromise = null;

function tr(key, values = {}) {
    const pair = UI_TEXT[key] || [key, key];
    let text = pair[no8dLocale() === "zh" ? 0 : 1];
    for (const [name, value] of Object.entries(values)) text = text.replace(`{${name}}`, value);
    return text;
}

function getCatalog() {
    catalogPromise ??= api.fetchApi(`${API_PREFIX}/styles`).then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    });
    return catalogPromise;
}

function ensureStyleSheet() {
    let style = document.getElementById("no8d-krea-style-selector-style");
    if (!style) {
        style = document.createElement("style");
        style.id = "no8d-krea-style-selector-style";
        document.head.appendChild(style);
    }
    style.textContent = `
.dom-widget.no8d-krea-style-selector-widget { box-sizing:border-box; overflow:hidden; }
.no8d-krea-style-grid { scrollbar-width:thin; scrollbar-color:#6b7280 #111318; }
.no8d-krea-style-grid::-webkit-scrollbar { width:9px; }
.no8d-krea-style-grid::-webkit-scrollbar-track { background:#111318; }
.no8d-krea-style-grid::-webkit-scrollbar-thumb { background:#6b7280; border:2px solid #111318; border-radius:999px; }
.no8d-krea-style-card { outline:none !important; }
.no8d-krea-style-card:hover { border-color:#6b7280 !important; background:#272a31 !important; }
.no8d-krea-style-card.selected { border-color:#41454e !important; box-shadow:none !important; background:#202b3d !important; }
.no8d-krea-style-card.multi-selected { border-color:#2563eb !important; box-shadow:0 0 0 2px #2563eb inset !important; }
.no8d-krea-style-card:hover .no8d-krea-style-name { background:#30343c !important; color:#fff !important; }
.no8d-krea-style-card.selected .no8d-krea-style-name { background:#2563eb !important; color:#fff !important; }
.no8d-ui button:not(.no8d-krea-style-card):not(:disabled):hover { background:#2563eb !important; border-color:#2563eb !important; color:#fff !important; }
.no8d-krea-style-tab:not(:disabled):hover { background:#2563eb !important; border-color:#2563eb !important; color:#fff !important; }
.no8d-krea-style-tab.selected { color:#fff !important; border-color:#2563eb !important; background:#2563eb !important; }
`;
}

function findWidget(node, name) {
    return (node.widgets || []).find((widget) => widget.name === name);
}

function hideNativeWidgets(node) {
    let changed = false;
    for (const widget of node.widgets || []) {
        if (!HIDDEN_WIDGETS.has(widget.name)) continue;
        if (!widget.hidden || widget.type !== "converted-widget" || !widget.options?.hidden) changed = true;
        widget.options = widget.options || {};
        widget.options.hidden = true;
        widget.options.collapsed = true;
        widget.type = "converted-widget";
        widget.hidden = true;
        widget.serialize = true;
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
    }
    if (changed) {
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
}

function setWidgetValue(widget, value) {
    if (!widget || widget.value === value) return;
    widget.value = value;
    widget.callback?.(value);
}

function syncSelectedStyles(node) {
    const names = Array.from(node._no8dKreaSelection || []);
    setWidgetValue(findWidget(node, "selected_styles"), JSON.stringify(names));
    setWidgetValue(findWidget(node, "selection_cleared"), Boolean(node._no8dKreaSelectionCleared && names.length === 0));
}

function syncSearchQuery(node) {
    setWidgetValue(findWidget(node, "search_query"), node._no8dKreaSearch || "");
}

function selectOnly(node, name) {
    node._no8dKreaSelection = name ? new Set([name]) : new Set();
    node._no8dKreaSelectionAnchor = name || null;
    node._no8dKreaSelectionCleared = !name;
    syncSelectedStyles(node);
}

function markGraphChanged(node) {
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function stopCanvasEvents(root) {
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel", "contextmenu", "keydown", "keyup", "keypress", "paste"]) {
        root.addEventListener(type, (event) => event.stopPropagation());
    }
}

function installUnifiedButtonHover(root) {
    const setHover = (button, active) => {
        if (button.disabled || button.classList.contains("no8d-krea-style-card")) return;
        if (active) {
            if (!button._no8dHoverStyle) {
                button._no8dHoverStyle = ["background", "border-color", "color"].map((property) => ({
                    property,
                    value: button.style.getPropertyValue(property),
                    priority: button.style.getPropertyPriority(property),
                }));
            }
            button.style.setProperty("background", "#2563eb", "important");
            button.style.setProperty("border-color", "#2563eb", "important");
            button.style.setProperty("color", "#fff", "important");
        } else if (button._no8dHoverStyle) {
            for (const { property, value, priority } of button._no8dHoverStyle) {
                if (value) button.style.setProperty(property, value, priority);
                else button.style.removeProperty(property);
            }
            delete button._no8dHoverStyle;
        }
    };
    root.addEventListener("mouseover", (event) => {
        const button = event.target.closest?.("button");
        if (!button || !root.contains(button) || button.contains(event.relatedTarget)) return;
        setHover(button, true);
    });
    root.addEventListener("mouseout", (event) => {
        const button = event.target.closest?.("button");
        if (!button || !root.contains(button) || button.contains(event.relatedTarget)) return;
        setHover(button, false);
    });
}

function makeUi(node) {
    const root = document.createElement("div");
    root.classList.add("no8d-ui");
    root.tabIndex = 0;
    root.style.cssText = "width:100%;height:100%;max-width:100%;box-sizing:border-box;padding:8px;overflow:hidden;";
    stopCanvasEvents(root);
    installUnifiedButtonHover(root);

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;box-sizing:border-box;";

    const libraryBar = document.createElement("div");
    libraryBar.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) 48px 48px;gap:9px;align-items:center;flex:0 0 44px;";
    const libraryLabel = document.createElement("span");
    libraryLabel.textContent = tr("library");
    const libraryActions = document.createElement("div");
    libraryActions.style.cssText = "display:flex;align-items:center;gap:7px;";
    const reloadLibraries = document.createElement("button");
    reloadLibraries.type = "button";
    reloadLibraries.textContent = "↻";
    reloadLibraries.title = tr("reload");
    reloadLibraries.style.cssText = "width:34px;height:32px;padding:0;font:700 17px sans-serif;";
    const importLibrary = document.createElement("button");
    importLibrary.type = "button";
    importLibrary.textContent = tr("importWildcards");
    importLibrary.title = tr("importWildcards");
    importLibrary.style.cssText = "height:32px;padding:0 13px;white-space:nowrap;font:700 12px sans-serif;";
    reloadLibraries.addEventListener("click", async () => {
        await refreshCatalog(node);
        notify("success", tr("reload"));
    });
    importLibrary.addEventListener("click", () => openImportDialog(node));
    libraryActions.append(importLibrary, reloadLibraries);
    libraryBar.append(libraryLabel, libraryActions);

    const tabs = document.createElement("div");
    tabs.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;flex:0 0 auto;";

    const searchWrap = document.createElement("div");
    searchWrap.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px;min-height:44px;";
    const searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.placeholder = tr("search");
    searchInput.autocomplete = "off";
    searchInput.spellcheck = false;
    searchInput.style.cssText = "width:100%;height:44px;padding:6px 13px;font:16px sans-serif;";
    const searchClear = document.createElement("button");
    searchClear.type = "button";
    searchClear.textContent = tr("clearSearch");
    searchClear.title = tr("clearSearch");
    searchClear.style.cssText = "height:32px;padding:0 11px;white-space:nowrap;font:600 12px sans-serif;";
    const addStyle = document.createElement("button");
    addStyle.type = "button";
    addStyle.textContent = tr("addEntry");
    addStyle.title = tr("addStyle");
    addStyle.style.cssText = "height:32px;padding:0 13px;white-space:nowrap;background:#2563eb;color:#fff;font:700 12px sans-serif;";
    const manageStyles = document.createElement("button");
    manageStyles.type = "button";
    manageStyles.textContent = tr("organizeLibrary");
    manageStyles.title = tr("manageStyles");
    manageStyles.style.cssText = "height:32px;padding:0 13px;white-space:nowrap;font:700 12px sans-serif;";
    const randomMode = document.createElement("button");
    randomMode.type = "button";
    randomMode.textContent = "⤨";
    randomMode.title = no8dLocale() === "zh" ? "随机输出当前标签" : "Randomize current tab";
    randomMode.style.cssText = "width:48px;height:44px;padding:0;font:700 21px sans-serif;";
    const outputAll = document.createElement("button");
    outputAll.type = "button";
    outputAll.textContent = "☷";
    outputAll.title = tr("outputAll");
    outputAll.setAttribute("aria-label", tr("outputAll"));
    outputAll.style.cssText = "width:48px;height:44px;padding:0;font:700 22px sans-serif;";
    searchInput.addEventListener("keydown", (event) => {
        event.stopPropagation();
        if (event.key === "Escape" && searchInput.value) {
            searchInput.value = "";
            node._no8dKreaSearch = "";
            syncSearchQuery(node);
            node._no8dKreaStylePage = 0;
            render(node);
            markGraphChanged(node);
        }
    });
    searchInput.addEventListener("input", () => {
        node._no8dKreaSearch = searchInput.value;
        syncSearchQuery(node);
        node._no8dKreaStylePage = 0;
        render(node);
        markGraphChanged(node);
    });
    searchClear.addEventListener("pointerdown", (event) => event.preventDefault());
    searchClear.addEventListener("click", () => {
        searchInput.value = "";
        node._no8dKreaSearch = "";
        syncSearchQuery(node);
        node._no8dKreaStylePage = 0;
        render(node);
        markGraphChanged(node);
        searchInput.focus({ preventScroll: true });
    });
    addStyle.addEventListener("click", () => openStyleEditor(node));
    manageStyles.addEventListener("click", async () => {
        try { await refreshCatalog(node); } catch {}
        openStyleManager(node);
    });
    randomMode.addEventListener("click", () => {
        const widget = findWidget(node, "random_mode");
        const enabled = !widget?.value;
        setWidgetValue(widget, enabled);
        if (enabled) setWidgetValue(findWidget(node, "output_all"), false);
        render(node);
        markGraphChanged(node);
    });
    outputAll.addEventListener("click", () => {
        const widget = findWidget(node, "output_all");
        const enabled = !widget?.value;
        setWidgetValue(widget, enabled);
        if (enabled) setWidgetValue(findWidget(node, "random_mode"), false);
        render(node);
        markGraphChanged(node);
    });
    manageStyles.textContent = "⚙";
    manageStyles.style.cssText = "width:48px;height:44px;padding:0;font:700 21px sans-serif;";
    libraryBar.replaceChildren(searchInput, outputAll, randomMode);

    const status = document.createElement("div");
    status.style.cssText = "flex:0 0 auto;min-height:18px;color:#d4d4d8;font:12px/18px sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    status.textContent = tr("loading");

    const grid = document.createElement("div");
    grid.className = "no8d-krea-style-grid no8d-panel";
    grid.style.cssText = "position:relative;flex:1 1 auto;min-height:0;overflow:hidden;padding:6px;box-sizing:border-box;background:#111318;border:1px solid #34373e;border-radius:7px;";
    grid.addEventListener("contextmenu", (event) => {
        if (event.target.closest?.(".no8d-krea-style-card")) return;
        event.preventDefault();
        event.stopPropagation();
        openPageContextMenu(node, event);
    });

    const pager = document.createElement("div");
    pager.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;flex:0 0 34px;min-height:34px;";

    panel.append(tabs, libraryBar, status, grid, pager);
    root.append(panel);
    node._no8dKreaStyleEls = { root, panel, libraryBar, libraryLabel, importLibrary, reloadLibraries, tabs, searchWrap, searchInput, searchClear, addStyle, manageStyles, outputAll, randomMode, status, grid, pager };
    root.addEventListener("keydown", (event) => handleGalleryKey(node, event));
    if (typeof ResizeObserver !== "undefined") {
        node._no8dKreaResizeObserver = new ResizeObserver(() => {
            for (const page of grid.querySelectorAll(".no8d-krea-style-page")) fitPageLayer(grid, page);
        });
        node._no8dKreaResizeObserver.observe(grid);
    }
    return root;
}

function syncFrame(node) {
    const els = node?._no8dKreaStyleEls;
    if (!els) return;
    const wrapper = els.root.closest(".dom-widget");
    if (wrapper) {
        wrapper.classList.add("no8d-krea-style-selector-widget");
        wrapper.style.boxSizing = "border-box";
        wrapper.style.overflow = "hidden";
    }
    els.root.style.width = "100%";
    els.root.style.maxWidth = "100%";
    els.root.style.height = "100%";
    els.panel.style.width = "100%";
    els.panel.style.height = "100%";
}

function previewUrl(name, version = 2) {
    return api.apiURL(`${API_PREFIX}/preview?style=${encodeURIComponent(name)}&v=${encodeURIComponent(version)}`);
}

function emptyPreviewUrl() {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#15181d"/><rect x="58" y="62" width="140" height="132" rx="12" fill="none" stroke="#4b5563" stroke-width="5"/><path d="M72 175l37-40 28 27 22-23 25 36" fill="none" stroke="#6b7280" stroke-width="6" stroke-linejoin="round"/><circle cx="157" cy="101" r="13" fill="#6b7280"/></svg>`);
}

function normalizeSearch(value) {
    return String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase();
}

function filteredItems(node, catalog, library) {
    let items;
    if (library === "收藏夹") items = catalog.styles.filter((item) => item.favorite);
    else if (library === "历史记录") items = catalog.styles.filter((item) => item.history_index != null).sort((a, b) => a.history_index - b.history_index);
    else items = catalog.styles.filter((item) => item.library === library);
    const query = normalizeSearch(node._no8dKreaSearch);
    if (!query) return items;
    return items.filter((item) => [item.name, item.name_zh, item.search_text]
        .some((value) => normalizeSearch(value).includes(query)));
}

function isRecordLibrary(node, library = node._no8dKreaLibrary) {
    return Boolean(node._no8dKreaStyleCatalog?.virtual_libraries?.includes(library));
}

function notify(severity, summary, detail = "") {
    app.extensionManager?.toast?.add?.({ severity, summary, detail, life: 3200 });
}

async function refreshCatalog(node, selectName = null, { preservePage = false } = {}) {
    catalogPromise = null;
    node._no8dKreaStyleCatalog = await getCatalog();
    const styleWidget = findWidget(node, "style");
    if (selectName) {
        setWidgetValue(styleWidget, selectName);
        const selected = node._no8dKreaStyleCatalog.styles.find((item) => item.name === selectName);
        const items = filteredItems(node, node._no8dKreaStyleCatalog, selected?.library || node._no8dKreaLibrary);
        const index = items.findIndex((item) => item.name === selectName);
        node._no8dKreaStylePage = index >= 0 ? Math.floor(index / PAGE_SIZE) : 0;
    } else if (!preservePage) {
        node._no8dKreaStylePage = 0;
    }
    render(node);
}

async function refreshAllKreaCatalogs() {
    const nodes = (app.graph?._nodes || []).filter((node) => (node.comfyClass || node.type) === NODE_NAME && node._no8dKreaStyleEls);
    if (!nodes.length) return;
    catalogPromise = null;
    const catalog = await getCatalog();
    for (const node of nodes) {
        node._no8dKreaStyleCatalog = catalog;
        render(node);
    }
    app.graph?.setDirtyCanvas?.(true, true);
}

async function setFavorite(node, items, favorite) {
    const response = await api.fetchApi(`${API_PREFIX}/favorite`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: items.map((item) => item.name), favorite }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await refreshCatalog(node, null, { preservePage: true });
}

async function removeHistory(node, items) {
    const response = await api.fetchApi(`${API_PREFIX}/history/remove`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ names: items.map((item) => item.name) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    await refreshCatalog(node, null, { preservePage: true });
}

async function copyPrompts(items) {
    const text = items.map((item) => item.search_text ?? item.prompt ?? "").join("\n");
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch {
        // Comfy Desktop may expose Clipboard API without granting its permission.
        // Fall through to the native editable-element path below.
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.style.cssText = "position:fixed;left:-10000px;top:-10000px;opacity:0;";
    document.body.append(input);
    input.focus({ preventScroll: true });
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    if (!copied) {
        throw new Error(no8dLocale() === "zh" ? "无法访问系统剪贴板" : "Unable to access the system clipboard");
    }
}

async function exportStyles(items, filename = "styles.xlsx") {
    const response = await api.fetchApi(`${API_PREFIX}/styles/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: items.map((item) => item.name) }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function deleteUserStyles(node, items) {
    const userItems = items.filter((item) => item.source === "user" && item.id);
    if (!userItems.length) return;
    const message = no8dLocale() === "zh"
        ? `确定删除 ${userItems.length} 张用户词卡吗？`
        : `Delete ${userItems.length} user card(s)?`;
    if (!window.confirm(message)) return;
    for (const item of userItems) {
        const response = await api.fetchApi(`${API_PREFIX}/custom/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    }
    node._no8dKreaSelection = new Set();
    node._no8dKreaSelectionAnchor = null;
    await refreshCatalog(node, null, { preservePage: true });
}

function openContextMenu(entries, event) {
    document.querySelectorAll(".no8d-krea-card-menu").forEach((menu) => menu.remove());
    const menu = document.createElement("div");
    menu.className = "no8d-ui no8d-krea-card-menu";
    menu.style.cssText = "position:fixed;z-index:10020;min-width:156px;padding:5px;border:1px solid #4b4f58;border-radius:7px;background:var(--comfy-menu-bg,#242424);color:var(--fg-color,#eee);box-shadow:0 8px 28px rgba(0,0,0,.55);";
    for (const entry of entries) {
        if (entry.separator) {
            const separator = document.createElement("div");
            separator.style.cssText = "height:1px;margin:4px;background:#41454e;";
            menu.append(separator);
            continue;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = entry.label;
        button.disabled = Boolean(entry.disabled);
        button.style.cssText = `display:block;width:100%;padding:8px 11px;border:0;border-radius:5px;background:transparent;color:${entry.danger ? "#f87171" : "inherit"};font:600 13px sans-serif;text-align:left;cursor:${entry.disabled ? "default" : "pointer"};opacity:${entry.disabled ? ".45" : "1"};`;
        if (!entry.disabled) {
            button.addEventListener("mouseenter", () => {
                button.style.setProperty("background", entry.danger ? "#7f1d1d" : "#2563eb", "important");
                button.style.setProperty("border-color", entry.danger ? "#f87171" : "#2563eb", "important");
                button.style.setProperty("color", "#fff", "important");
            });
            button.addEventListener("mouseleave", () => {
                button.style.setProperty("background", "transparent", "important");
                button.style.removeProperty("border-color");
                button.style.removeProperty("color");
            });
            button.addEventListener("click", async () => {
                menu.remove();
                try { await entry.action(); }
                catch (error) { notify("error", tr("saveFailed"), error.message || String(error)); }
            });
        }
        menu.append(button);
    }
    document.body.append(menu);
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(margin, Math.min(event.clientX, window.innerWidth - rect.width - margin))}px`;
    menu.style.top = `${Math.max(margin, Math.min(event.clientY, window.innerHeight - rect.height - margin))}px`;
    const close = (closeEvent) => {
        if (!menu.contains(closeEvent.target)) menu.remove();
    };
    setTimeout(() => document.addEventListener("pointerdown", close, { once: true, capture: true }), 0);
}

function openCardContextMenu(node, item, event, viewLibrary = node._no8dKreaLibrary) {
    const selectedNames = node._no8dKreaSelection || new Set();
    const targets = selectedNames.has(item.name) && selectedNames.size > 1
        ? node._no8dKreaStyleCatalog.styles.filter((candidate) => selectedNames.has(candidate.name))
        : [item];
    const shouldFavorite = !targets.every((target) => target.favorite);
    const suffix = targets.length > 1 ? ` (${targets.length})` : "";
    const isFavorites = viewLibrary === "收藏夹";
    const isHistory = viewLibrary === "历史记录";
    if (isFavorites || isHistory) {
        const entries = [
            { label: `${tr("copyPrompt")}${suffix}`, action: () => copyPrompts(targets) },
            { label: `${tr("exportSelected")}${suffix}`, action: () => exportStyles(targets, targets.length === 1 ? `${item.name}.xlsx` : "selected-styles.xlsx") },
            { separator: true },
        ];
        if (isFavorites) entries.push({ label: `${tr("removeFavorite")}${suffix}`, action: () => setFavorite(node, targets, false) });
        if (isHistory) entries.push(
            { label: `${shouldFavorite ? tr("addFavorite") : tr("removeFavorite")}${suffix}`, action: () => setFavorite(node, targets, shouldFavorite) },
            { label: `${tr("removeHistory")}${suffix}`, danger: true, action: () => removeHistory(node, targets) },
        );
        openContextMenu(entries, event);
        return;
    }
    const entries = [
        { label: tr("editStyle"), disabled: targets.length !== 1, action: () => openStyleEditor(node, item) },
        { label: `${tr("exportSelected")}${suffix}`, action: () => exportStyles(targets, targets.length === 1 ? `${item.name}.xlsx` : "selected-styles.xlsx") },
        { separator: true },
        { label: `${shouldFavorite ? tr("addFavorite") : tr("removeFavorite")}${suffix}`, action: () => setFavorite(node, targets, shouldFavorite) },
    ];
    const userCount = targets.filter((target) => target.source === "user").length;
    if (userCount) entries.push(
        { separator: true },
        { label: `${tr("deleteSelected")}${userCount > 1 ? ` (${userCount})` : ""}`, danger: true, action: () => deleteUserStyles(node, targets) },
    );
    openContextMenu(entries, event);
}

function currentPageItems(node) {
    const items = filteredItems(node, node._no8dKreaStyleCatalog, node._no8dKreaLibrary);
    const page = Math.max(0, node._no8dKreaStylePage || 0);
    return items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
}

async function refreshCurrentPage(node) {
    const page = node._no8dKreaStylePage || 0;
    catalogPromise = null;
    node._no8dKreaStyleCatalog = await getCatalog();
    node._no8dKreaStylePage = page;
    render(node);
}

function openPageContextMenu(node, event) {
    const allItems = filteredItems(node, node._no8dKreaStyleCatalog, node._no8dKreaLibrary);
    const pageItems = currentPageItems(node);
    const disabled = allItems.length === 0;
    const virtual = isRecordLibrary(node);
    const entries = [
        { label: tr("selectAll"), disabled, action: () => {
            node._no8dKreaSelection = new Set(allItems.map((item) => item.name));
            node._no8dKreaSelectionAnchor = allItems[0]?.name || null;
            syncSelectedStyles(node);
            render(node);
            markGraphChanged(node);
        } },
    ];
    if (virtual) {
        const clearRecords = (items) => node._no8dKreaLibrary === "历史记录"
            ? removeHistory(node, items)
            : setFavorite(node, items, false);
        entries.push(
            { separator: true },
            { label: tr("clearPageRecords"), disabled: pageItems.length === 0, danger: true, action: () => clearRecords(pageItems) },
            { label: tr("clearAllRecords"), disabled, danger: true, action: () => clearRecords(allItems) },
            { label: tr("refreshPage"), action: () => refreshCurrentPage(node) },
        );
    } else {
        const exportName = String(node._no8dKreaLibrary || "all").replace(/[\\/:*?"<>|]/g, "_");
        entries.push(
            { label: tr("newCard"), action: () => openStyleEditor(node) },
            { separator: true },
            { label: tr("exportPage"), disabled: pageItems.length === 0, action: () => exportStyles(pageItems, `page-${(node._no8dKreaStylePage || 0) + 1}.xlsx`) },
            { label: tr("exportAll"), disabled, action: () => exportStyles(allItems, `${exportName}-all.xlsx`) },
            { label: tr("refreshPage"), action: () => refreshCurrentPage(node) },
        );
    }
    openContextMenu(entries, event);
}

function modal(titleText, width = "760px") {
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;background:rgba(0,0,0,.62);";
    const dialog = document.createElement("div");
    dialog.tabIndex = -1;
    dialog.className = "no8d-ui no8d-panel";
    dialog.style.cssText = `display:grid;grid-template-rows:auto minmax(0,1fr);width:min(${width},100%);max-height:calc(100vh - 48px);overflow:hidden;border:1px solid #4b4f58;border-radius:9px;background:var(--comfy-menu-bg,#242424);color:var(--fg-color,#eee);box-shadow:0 18px 56px rgba(0,0,0,.55);`;
    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #41454e;font:700 16px sans-serif;";
    const title = document.createElement("span");
    title.textContent = titleText;
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.style.cssText = "width:32px;height:30px;padding:0;font:700 18px sans-serif;";
    close.onclick = () => overlay.remove();
    header.append(title, close);
    const body = document.createElement("div");
    body.style.cssText = "min-height:0;overflow:auto;padding:16px;box-sizing:border-box;";
    dialog.append(header, body);
    overlay.append(dialog);
    overlay.addEventListener("pointerdown", (event) => {
        if (event.target === overlay) overlay.remove();
    });
    stopCanvasEvents(overlay);
    installUnifiedButtonHover(overlay);
    overlay.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.isComposing) return;
        event.preventDefault();
        overlay.remove();
    });
    document.body.append(overlay);
    return { overlay, body };
}

function formField(labelText, control) {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;flex-direction:column;gap:6px;min-width:0;color:#e4e4e7;font:600 13px sans-serif;";
    const caption = document.createElement("span");
    caption.textContent = labelText;
    control.style.cssText += ";width:100%;box-sizing:border-box;";
    label.append(caption, control);
    return label;
}

async function saveCustomStyle(data, preview) {
    const body = new FormData();
    body.append("data", JSON.stringify(data));
    if (preview) body.append("preview", preview, preview.name || "preview.png");
    const response = await api.fetchApi(`${API_PREFIX}/custom`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result.style;
}

async function saveCardOverride(data, preview) {
    const body = new FormData();
    body.append("data", JSON.stringify(data));
    if (preview) body.append("preview", preview, preview.name || "preview.png");
    const response = await api.fetchApi(`${API_PREFIX}/card/update`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

function openStyleEditor(node, source = null, duplicate = false, onSaved = null) {
    // Favorites and history only hold references. They must never be an entry
    // point for editing, copying, or creating source-library cards.
    if (isRecordLibrary(node)) return;
    const item = source || {};
    const { overlay, body } = modal(source && !duplicate ? tr("editStyle") : tr("addStyle"));
    const form = document.createElement("form");
    form.style.cssText = "display:grid;grid-template-columns:280px minmax(0,1fr);gap:18px;align-items:start;";
    const localized = no8dLocale() === "zh";
    const name = document.createElement("input");
    name.required = true;
    const visibleName = localized ? (item.name_zh || item.name || "") : (item.name || "");
    name.value = duplicate ? `${visibleName} ${localized ? "副本" : "Copy"}` : visibleName;
    // Built-in English names are stable workflow IDs. Their localized title remains editable.
    name.disabled = item.source === "builtin" && !duplicate && !localized;
    const category = item.category || "全部";
    const library = document.createElement("input");
    library.required = true;
    const virtualLibraries = node._no8dKreaStyleCatalog.virtual_libraries || [];
    const ordinaryLibrary = virtualLibraries.includes(node._no8dKreaLibrary)
        ? node._no8dKreaLibraryReturn?.library || node._no8dKreaStyleCatalog.libraries.find((name) => !virtualLibraries.includes(name))
        : node._no8dKreaLibrary;
    const prompt = document.createElement("textarea");
    prompt.required = true;
    prompt.value = item.search_text || "";
    prompt.style.cssText = "min-height:260px;resize:vertical;";
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/png,image/jpeg,image/webp";
    file.hidden = true;
    let previewFile = null;
    let objectUrl = null;
    const previewBox = document.createElement("div");
    previewBox.tabIndex = 0;
    previewBox.style.cssText = "display:flex;align-items:center;justify-content:center;width:100%;min-height:280px;aspect-ratio:1/1;border:1px dashed #6b7280;border-radius:7px;background:#111318;color:#9ca3af;cursor:pointer;overflow:hidden;";
    const previewImage = document.createElement("img");
    previewImage.alt = "";
    previewImage.style.cssText = "display:none;width:100%;height:100%;aspect-ratio:1/1;object-fit:cover;";
    const previewHint = document.createElement("span");
    previewHint.textContent = tr("chooseImage");
    previewBox.append(previewImage, previewHint);
    if (item.has_preview) {
        previewImage.src = previewUrl(item.name, item.preview_version);
        previewImage.style.display = "block";
        previewHint.style.display = "none";
    }
    const useFile = (candidate) => {
        if (!candidate || !["image/png", "image/jpeg", "image/webp"].includes(candidate.type)) return;
        previewFile = candidate;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(candidate);
        previewImage.src = objectUrl;
        previewImage.style.display = "block";
        previewHint.style.display = "none";
    };
    file.onchange = () => useFile(file.files?.[0]);
    previewBox.onclick = () => file.click();
    previewBox.ondragover = (event) => { event.preventDefault(); previewBox.style.borderColor = "#2563eb"; };
    previewBox.ondragleave = () => { previewBox.style.borderColor = "#6b7280"; };
    previewBox.ondrop = (event) => { event.preventDefault(); previewBox.style.borderColor = "#6b7280"; useFile(event.dataTransfer?.files?.[0]); };
    previewBox.onpaste = (event) => useFile([...event.clipboardData.items].find((entry) => entry.type.startsWith("image/"))?.getAsFile());
    const promptField = formField(tr("prompt"), prompt);
    const previewField = formField(tr("previewImage"), previewBox);
    previewField.style.cssText += ";grid-column:1;grid-row:1;";
    const details = document.createElement("div");
    details.style.cssText = "display:flex;flex-direction:column;gap:14px;grid-column:2;grid-row:1;min-width:0;";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:9px;grid-column:1/-1;padding-top:4px;";
    const saveError = document.createElement("div");
    saveError.style.cssText = "display:none;grid-column:1/-1;color:#fca5a5;font:600 13px/18px sans-serif;";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = tr("cancel");
    cancel.onclick = () => overlay.remove();
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = tr("save");
    save.style.cssText = "background:#2563eb;color:#fff;font-weight:700;";
    const saveAs = document.createElement("button");
    saveAs.type = "button";
    saveAs.textContent = tr("saveAs");
    actions.append(cancel, saveAs, save);
    details.append(formField(tr("name"), name), promptField);
    form.append(previewField, details, file, saveError, actions);
    const persist = async (asCopy) => {
        saveError.style.display = "none";
        save.disabled = true;
        saveAs.disabled = true;
        try {
            let selectedName;
            if (source?.source === "builtin" && !duplicate && !asCopy) {
                await saveCardOverride({ original_name: source.name, title: localized ? name.value : (source.name_zh || source.name), prompt: prompt.value }, previewFile);
                selectedName = source.name;
            } else {
                let effectivePreview = previewFile;
                if (duplicate && !effectivePreview && source?.has_preview) {
                    const previewResponse = await fetch(previewUrl(source.name, source.preview_version));
                    if (previewResponse.ok) {
                        const blob = await previewResponse.blob();
                        effectivePreview = new File([blob], `${source.name}-copy`, { type: blob.type || "image/png" });
                    }
                }
                const sourceName = source?.name || "";
                const sourceTitle = source?.name_zh || sourceName;
                const baseName = sourceName || name.value || "Style";
                let copyName = `${baseName} Copy`;
                let suffix = 2;
                while (node._no8dKreaStyleCatalog.styles.some((entry) => entry.name.toLocaleLowerCase() === copyName.toLocaleLowerCase())) copyName = `${baseName} Copy ${suffix++}`;
                const targetName = asCopy ? copyName : (source && localized ? sourceName : name.value);
                const targetTitle = asCopy ? `${name.value} ${localized ? "副本" : "Copy"}` : (source && !localized ? sourceTitle : name.value);
                const targetLibrary = source?.source === "builtin" ? "custom" : source?.library || ordinaryLibrary || "custom";
                const saved = await saveCustomStyle({
                    id: !duplicate && !asCopy && source && source.source === "user" ? source.id : null,
                    name: targetName,
                    name_zh: targetTitle,
                    category,
                    library: targetLibrary,
                    prompt: prompt.value,
                    insert_after_id: asCopy && source?.source === "user" ? source.id : null,
                }, effectivePreview);
                node._no8dKreaLibrary = saved.library;
                selectedName = saved.name;
                // A new card must be visible immediately, even if the user had
                // an old search filter active before opening the editor.
                if (!source || asCopy) {
                    node._no8dKreaSearch = "";
                    syncSearchQuery(node);
                }
            }
            overlay.remove();
            // Close the modal before rebuilding the gallery so its focus layer cannot
            // intercept input while a newly created card and its preview are rendered.
            await new Promise((resolve) => requestAnimationFrame(resolve));
            await refreshCatalog(node, selectedName);
            notify("success", tr("saved"));
            onSaved?.();
            markGraphChanged(node);
        } catch (error) {
            const message = error.message || String(error);
            saveError.textContent = `${tr("saveFailed")}: ${message}`;
            saveError.style.display = "block";
            notify("error", tr("saveFailed"), message);
        } finally {
            save.disabled = false;
            saveAs.disabled = false;
        }
    };
    form.onsubmit = (event) => { event.preventDefault(); persist(false); };
    save.onclick = (event) => { event.preventDefault(); persist(false); };
    saveAs.onclick = (event) => { event.preventDefault(); persist(true); };
    overlay.addEventListener("DOMNodeRemoved", () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, { once: true });
    body.append(form);
    requestAnimationFrame(() => {
        if (!overlay.isConnected) return;
        name.focus({ preventScroll: true });
        name.select();
    });
}

function openRenameLibrary(node, oldName, onSaved = null) {
    const { overlay, body } = modal(tr("renameLibrary"), "460px");
    const form = document.createElement("form");
    form.style.cssText = "display:flex;flex-direction:column;gap:14px;";
    const input = document.createElement("input");
    input.required = true;
    input.value = oldName;
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = tr("cancel");
    cancel.onclick = () => overlay.remove();
    const save = document.createElement("button");
    save.type = "submit";
    save.textContent = tr("save");
    save.style.cssText = "background:#2563eb;color:#fff;font-weight:700;";
    actions.append(cancel, save);
    form.append(formField(tr("newLibraryName"), input), actions);
    form.onsubmit = async (event) => {
        event.preventDefault();
        const newName = input.value.trim();
        if (!newName || newName === oldName) return;
        save.disabled = true;
        try {
            const response = await api.fetchApi(`${API_PREFIX}/library/rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ old_name: oldName, new_name: newName }) });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            node._no8dKreaLibrary = result.library;
            await refreshCatalog(node);
            overlay.remove();
            onSaved?.();
            markGraphChanged(node);
        } catch (error) {
            notify("error", tr("saveFailed"), error.message || String(error));
            save.disabled = false;
        }
    };
    body.append(form);
    input.select();
}

function openImportDialog(node, onImported = null) {
    const file = document.createElement("input");
    file.type = "file";
    file.accept = ".txt,.csv,.xlsx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    file.style.display = "none";
    file.addEventListener("change", async () => {
        const selected = file.files?.[0];
        if (!selected) return;
        const library = selected.name.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N} .+_-]+/gu, "_") || "library";
        try {
            const form = new FormData();
            form.append("file", selected);
            form.append("library", library);
            const response = await api.fetchApi(`${API_PREFIX}/import/commit`, { method: "POST", body: form });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
            node._no8dKreaLibrary = library;
            await refreshCatalog(node, result.first);
            notify("success", tr("importedCount", { count: result.imported, skipped: result.skipped }));
            onImported?.();
            markGraphChanged(node);
        } catch (error) {
            notify("error", tr("saveFailed"), error.message || String(error));
        }
        file.remove();
    }, { once: true });
    document.body.append(file);
    window.addEventListener("focus", () => setTimeout(() => {
        if (!file.files?.length) file.remove();
    }, 500), { once: true });
    file.click();
}

function openStyleManager(node) {
    const { overlay, body } = modal(tr("libraryManager"), "960px");
    const selectedLibraries = new Set();
    let draggedLibrary = null;
    const makeDraft = () => node._no8dKreaStyleCatalog.libraries
        .filter((library) => !node._no8dKreaStyleCatalog.virtual_libraries?.includes(library))
        .map((library) => ({
            library,
            name: library,
            deleted: false,
        }));
    let draft = makeDraft();

    const download = async (response, fallbackName) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = fallbackName;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const importFavorites = () => {
        const file = document.createElement("input");
        file.type = "file";
        file.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        file.style.display = "none";
        file.onchange = async () => {
            const selected = file.files?.[0];
            if (!selected) return file.remove();
            try {
                const form = new FormData();
                form.append("file", selected);
                const response = await api.fetchApi(`${API_PREFIX}/favorites/import`, { method: "POST", body: form });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                await refreshCatalog(node);
                renderManager();
            } catch (error) {
                notify("error", tr("saveFailed"), error.message || String(error));
            }
            file.remove();
        };
        document.body.append(file);
        file.click();
    };
    const renderManager = () => {
        body.replaceChildren();
        const toolbar = document.createElement("div");
        toolbar.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;";
        const importButton = document.createElement("button");
        importButton.type = "button";
        importButton.textContent = tr("importWildcards");
        importButton.onclick = () => openImportDialog(node, () => {
            draft = makeDraft();
            selectedLibraries.clear();
            renderManager();
        });
        const batchExport = document.createElement("button");
        batchExport.type = "button";
        batchExport.textContent = `${tr("batchExport")} (${selectedLibraries.size})`;
        batchExport.disabled = selectedLibraries.size === 0;
        batchExport.onclick = async () => {
            try {
                await download(await api.fetchApi(`${API_PREFIX}/libraries/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libraries: Array.from(selectedLibraries) }) }), "no8d-libraries.zip");
            } catch (error) { notify("error", tr("saveFailed"), error.message || String(error)); }
        };
        toolbar.append(importButton, batchExport);
        body.append(toolbar);

        const list = document.createElement("div");
        list.style.cssText = "display:flex;flex-direction:column;gap:8px;";
        const favoriteRow = document.createElement("div");
        favoriteRow.style.cssText = "display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid #41454e;border-radius:7px;background:#1b1e23;";
        const favoriteInfo = document.createElement("div");
        favoriteInfo.innerHTML = `<div style="font:700 14px sans-serif;color:#f4f4f5;">${no8dLocale() === "zh" ? "收藏夹" : "Favorites"}</div><div style="margin-top:5px;color:#9ca3af;font:12px sans-serif;">${filteredItems({ ...node, _no8dKreaSearch: "" }, node._no8dKreaStyleCatalog, "收藏夹").length} ${tr("styles")}</div>`;
        const favoriteActions = document.createElement("div");
        favoriteActions.style.cssText = "display:flex;gap:6px;";
        const importFavoriteButton = document.createElement("button");
        importFavoriteButton.type = "button";
        importFavoriteButton.textContent = tr("importFavorites");
        importFavoriteButton.onclick = importFavorites;
        const exportFavoriteButton = document.createElement("button");
        exportFavoriteButton.type = "button";
        exportFavoriteButton.textContent = tr("exportFavorites");
        exportFavoriteButton.onclick = async () => {
            try { await download(await api.fetchApi(`${API_PREFIX}/favorites/export`), "no8d-favorites.xlsx"); }
            catch (error) { notify("error", tr("saveFailed"), error.message || String(error)); }
        };
        favoriteActions.append(importFavoriteButton, exportFavoriteButton);
        favoriteRow.append(favoriteInfo, favoriteActions);
        list.append(favoriteRow);

        for (const entry of draft) {
            if (entry.deleted) continue;
            const count = filteredItems({ ...node, _no8dKreaSearch: "" }, node._no8dKreaStyleCatalog, entry.library).length;
            const row = document.createElement("div");
            row.draggable = true;
            row.style.cssText = "display:grid;grid-template-columns:22px auto minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid #41454e;border-radius:7px;background:#1b1e23;";
            const handle = document.createElement("span");
            handle.textContent = "⠿";
            handle.title = no8dLocale() === "zh" ? "拖动调整词库顺序" : "Drag to reorder libraries";
            handle.style.cssText = "color:#6b7280;font:700 24px/16px sans-serif;cursor:grab;user-select:none;";
            const select = document.createElement("input");
            select.type = "checkbox";
            select.checked = selectedLibraries.has(entry.library);
            select.title = tr("batchExport");
            select.style.cssText = "width:18px;height:18px;accent-color:#2563eb;";
            select.onchange = () => {
                if (select.checked) selectedLibraries.add(entry.library);
                else selectedLibraries.delete(entry.library);
                renderManager();
            };
            const info = document.createElement("div");
            info.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;min-width:0;text-align:center;";
            const title = document.createElement("div");
            title.textContent = entry.name;
            title.title = no8dLocale() === "zh" ? "双击修改词库名称" : "Double-click to rename library";
            title.style.cssText = "font:700 14px sans-serif;color:#f4f4f5;cursor:text;";
            title.ondblclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const input = document.createElement("input");
                input.value = entry.name;
                input.maxLength = 160;
                input.style.cssText = "width:100%;height:30px;font:700 14px sans-serif;";
                const finish = (commit) => {
                    const nextName = input.value.trim();
                    if (commit && nextName) entry.name = nextName;
                    renderManager();
                };
                input.onkeydown = (keyEvent) => {
                    keyEvent.stopPropagation();
                    if (keyEvent.key === "Enter") { keyEvent.preventDefault(); finish(true); }
                    if (keyEvent.key === "Escape") { keyEvent.preventDefault(); finish(false); }
                };
                input.onblur = () => finish(true);
                title.replaceWith(input);
                input.focus({ preventScroll: true });
                input.select();
            };
            const meta = document.createElement("div");
            meta.textContent = `${count} ${tr("styles")}`;
            meta.style.cssText = "color:#9ca3af;font:12px sans-serif;white-space:nowrap;";
            info.append(title, meta);
            const actions = document.createElement("div");
            actions.style.cssText = "display:flex;gap:6px;";
            const remove = document.createElement("button");
            remove.type = "button";
            remove.textContent = "×";
            remove.title = tr("deleteLibrary");
            remove.style.cssText = "width:30px;padding:0;color:#f87171;font:700 20px sans-serif;";
            remove.onclick = () => {
                entry.deleted = true;
                selectedLibraries.delete(entry.library);
                renderManager();
            };
            actions.append(remove);
            row.addEventListener("dragstart", (event) => { draggedLibrary = entry.library; event.dataTransfer.effectAllowed = "move"; });
            row.addEventListener("dragover", (event) => event.preventDefault());
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                if (!draggedLibrary || draggedLibrary === entry.library) return;
                const from = draft.findIndex((candidate) => candidate.library === draggedLibrary);
                const to = draft.indexOf(entry);
                if (from < 0 || to < 0) return;
                draft.splice(to, 0, draft.splice(from, 1)[0]);
                renderManager();
            });
            row.append(handle, select, info, actions);
            list.append(row);
        }
        body.append(list);
        const footer = document.createElement("div");
        footer.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #41454e;";
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.textContent = tr("cancel");
        cancel.onclick = () => overlay.remove();
        const confirm = document.createElement("button");
        confirm.type = "button";
        confirm.textContent = tr("confirm");
        confirm.style.cssText = "background:#2563eb;color:#fff;font-weight:700;";
        confirm.onclick = async () => {
            confirm.disabled = true;
            try {
                const response = await api.fetchApi(`${API_PREFIX}/libraries/manage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ libraries: draft.map(({ library, name, deleted }) => ({ library, name, delete: deleted })) }) });
                const result = await response.json().catch(() => ({}));
                if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
                node._no8dKreaLibrary = "";
                await refreshCatalog(node);
                markGraphChanged(node);
                overlay.remove();
            } catch (error) {
                notify("error", tr("saveFailed"), error.message || String(error));
                confirm.disabled = false;
            }
        };
        footer.append(cancel, confirm);
        body.append(footer);
    };
    renderManager();
}

function pageButton(text, title, disabled, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.dataset.disabled = disabled ? "true" : "false";
    button.setAttribute("aria-disabled", disabled ? "true" : "false");
    button.style.cssText = "min-width:34px;height:28px;padding:0 9px;border:1px solid #4b4f58;border-radius:6px;background:#26292f;color:#f4f4f5;font:700 13px sans-serif;cursor:pointer;";
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", onClick);
    return button;
}

function showBoundaryFeedback(node, direction, message) {
    const els = node._no8dKreaStyleEls;
    const page = els.grid.querySelector(".no8d-krea-style-page");
    const feedbackId = (node._no8dKreaFeedbackId || 0) + 1;
    node._no8dKreaFeedbackId = feedbackId;
    if (page?.animate) {
        const offset = direction < 0 ? 18 : -18;
        page.animate(
            [
                { transform: "translateX(0)" },
                { transform: `translateX(${offset}px)`, offset: 0.45 },
                { transform: "translateX(0)" },
            ],
            { duration: 240, easing: "cubic-bezier(.36,.07,.19,.97)" },
        );
    }
    const previousText = els.status.textContent;
    els.status.textContent = message;
    els.status.style.color = "#fbbf24";
    setTimeout(() => {
        if (node._no8dKreaFeedbackId !== feedbackId) return;
        els.status.textContent = previousText;
        els.status.style.color = "#d4d4d8";
    }, 1200);
}

function makePageLayer() {
    const page = document.createElement("div");
    page.className = "no8d-krea-style-page";
    page.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(3,max-content);gap:8px;align-content:start;justify-content:center;width:100%;box-sizing:border-box;";
    return page;
}

function fitPageLayer(viewport, page) {
    const labelHeightFor = (size) => Math.max(32, Math.round(size * BASE_LABEL_HEIGHT / BASE_PREVIEW_SIZE));
    const widthLimit = Math.max(80, Math.floor((viewport.clientWidth - 58) / 3));
    const cellHeightLimit = Math.max(130, Math.floor((viewport.clientHeight - 28) / 3));
    let low = 80;
    let high = widthLimit;
    while (low < high) {
        const candidate = Math.ceil((low + high) / 2);
        if (candidate + labelHeightFor(candidate) + 10 <= cellHeightLimit) low = candidate;
        else high = candidate - 1;
    }
    const imageSize = low;
    const cardWidth = imageSize + 10;
    const fontSize = Math.max(10, imageSize * BASE_LABEL_FONT_SIZE / BASE_PREVIEW_SIZE);
    const lineHeight = Math.round(fontSize * 1.2);
    const labelHeight = labelHeightFor(imageSize);
    page.style.gridTemplateColumns = `repeat(3,${cardWidth}px)`;
    for (const card of page.querySelectorAll(".no8d-krea-style-card")) {
        card.style.width = `${cardWidth}px`;
        const image = card.querySelector("img");
        if (image) {
            image.style.width = `${imageSize}px`;
            image.style.height = `${imageSize}px`;
        }
        const label = card.querySelector(".no8d-krea-style-name");
        if (label) {
            const scale = imageSize / BASE_PREVIEW_SIZE;
            label.style.minHeight = `${labelHeight}px`;
            label.style.fontSize = `${fontSize.toFixed(2)}px`;
            label.style.lineHeight = `${lineHeight}px`;
            label.style.padding = `${Math.max(4, 7 * scale).toFixed(1)}px ${Math.max(5, 8 * scale).toFixed(1)}px`;
        }
    }
}

async function showPage(node, nextPage, direction) {
    const viewport = node._no8dKreaStyleEls.grid;
    fitPageLayer(viewport, nextPage);
    const transitionId = (node._no8dKreaTransitionId || 0) + 1;
    node._no8dKreaTransitionId = transitionId;
    const existingPages = [...viewport.querySelectorAll(".no8d-krea-style-page")];
    let previousPage = node._no8dKreaVisiblePage;
    if (!previousPage?.isConnected) previousPage = existingPages.at(-1) || null;
    for (const page of existingPages) {
        page.getAnimations().forEach((animation) => animation.cancel());
        if (page !== previousPage) page.remove();
    }
    if (previousPage) {
        previousPage.style.position = "relative";
        previousPage.style.inset = "auto";
        previousPage.style.width = "100%";
        previousPage.style.transform = "none";
    }
    if (!previousPage || !direction || typeof nextPage.animate !== "function") {
        viewport.replaceChildren(nextPage);
        node._no8dKreaVisiblePage = nextPage;
        return;
    }
    const images = [...nextPage.querySelectorAll("img")];
    await Promise.race([
        Promise.all(images.map((image) => image.decode?.().catch(() => {}) || Promise.resolve())),
        new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
    if (node._no8dKreaTransitionId !== transitionId) return;
    previousPage.style.position = "absolute";
    previousPage.style.inset = "6px";
    previousPage.style.width = "auto";
    nextPage.style.position = "absolute";
    nextPage.style.inset = "6px";
    nextPage.style.width = "auto";
    viewport.append(nextPage);
    node._no8dKreaVisiblePage = nextPage;
    const offset = direction > 0 ? 100 : -100;
    const options = { duration: 300, easing: "cubic-bezier(.22,.61,.36,1)", fill: "forwards" };
    const outgoing = previousPage.animate(
        [{ transform: "translateX(0)" }, { transform: `translateX(${-offset}%)` }],
        options,
    );
    const incoming = nextPage.animate(
        [{ transform: `translateX(${offset}%)` }, { transform: "translateX(0)" }],
        options,
    );
    await Promise.allSettled([outgoing.finished, incoming.finished]);
    if (node._no8dKreaTransitionId !== transitionId) return;
    nextPage.getAnimations().forEach((animation) => animation.cancel());
    nextPage.style.position = "relative";
    nextPage.style.inset = "auto";
    nextPage.style.width = "100%";
    viewport.replaceChildren(nextPage);
    node._no8dKreaVisiblePage = nextPage;
}

function selectPage(node, page, direction, localIndex = 0) {
    const catalog = node._no8dKreaStyleCatalog;
    const styleWidget = findWidget(node, "style");
    const selected = catalog.styles.find((item) => item.name === styleWidget.value);
    const items = filteredItems(node, catalog, selected?.library || node._no8dKreaLibrary);
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const targetPage = Math.max(0, Math.min(page, pageCount - 1));
    const target = items[Math.min(targetPage * PAGE_SIZE + localIndex, items.length - 1)];
    if (!target) return;
    setWidgetValue(styleWidget, target.name);
    selectOnly(node, target.name);
    node._no8dKreaStylePage = targetPage;
    render(node, direction);
    node._no8dKreaStyleEls.root.focus({ preventScroll: true });
    markGraphChanged(node);
}

function handleGalleryKey(node, event) {
    const keys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
    if (!keys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) return;
    const catalog = node._no8dKreaStyleCatalog;
    const styleWidget = findWidget(node, "style");
    if (!catalog || !styleWidget) return;
    const selected = catalog.styles.find((item) => item.name === styleWidget.value);
    const items = filteredItems(node, catalog, selected?.library || node._no8dKreaLibrary);
    const index = items.findIndex((item) => item.name === styleWidget.value);
    if (index < 0) {
        if (items.length) {
            const target = event.key === "End" ? items.at(-1) : items[0];
            setWidgetValue(styleWidget, target.name);
            selectOnly(node, target.name);
            node._no8dKreaStylePage = event.key === "End" ? Math.floor((items.length - 1) / PAGE_SIZE) : 0;
            render(node, event.key === "End" ? 1 : -1);
            node._no8dKreaStyleEls.root.focus({ preventScroll: true });
            markGraphChanged(node);
        }
        event.preventDefault();
        event.stopPropagation();
        return;
    }
    const page = Math.floor(index / PAGE_SIZE);
    const local = index % PAGE_SIZE;
    const pageCount = Math.ceil(items.length / PAGE_SIZE);
    let next = index;
    let direction = 0;
    if (event.key === "Home") {
        if (index === 0) showBoundaryFeedback(node, -1, tr("firstItem"));
        else selectPage(node, 0, -1, 0);
    } else if (event.key === "End") {
        if (index === items.length - 1) showBoundaryFeedback(node, 1, tr("lastItem"));
        else selectPage(node, pageCount - 1, 1, PAGE_SIZE - 1);
    } else if (event.key === "PageDown") {
        if (page < pageCount - 1) selectPage(node, page + 1, 1, local);
        else showBoundaryFeedback(node, 1, tr("lastPage"));
    } else if (event.key === "PageUp") {
        if (page > 0) selectPage(node, page - 1, -1, local);
        else showBoundaryFeedback(node, -1, tr("firstPage"));
    } else {
        if ((event.key === "ArrowRight" || event.key === "ArrowDown") && local === PAGE_SIZE - 1) next = index + 1;
        else if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && local === 0) next = index - 1;
        else if (event.key === "ArrowRight") next = index + 1;
        else if (event.key === "ArrowLeft") next = index - 1;
        else if (event.key === "ArrowDown" && local < 6) next = index + 3;
        else if (event.key === "ArrowUp" && local >= 3) next = index - 3;
        next = Math.max(0, Math.min(next, items.length - 1));
        direction = Math.sign(Math.floor(next / PAGE_SIZE) - page);
        if (next !== index) {
            setWidgetValue(styleWidget, items[next].name);
            selectOnly(node, items[next].name);
            node._no8dKreaStylePage = Math.floor(next / PAGE_SIZE);
            render(node, direction);
            node._no8dKreaStyleEls.root.focus({ preventScroll: true });
            markGraphChanged(node);
        } else if (index === 0 && (event.key === "ArrowLeft" || event.key === "ArrowUp")) {
            showBoundaryFeedback(node, -1, tr("firstPage"));
        } else if (index === items.length - 1 && (event.key === "ArrowRight" || event.key === "ArrowDown")) {
            showBoundaryFeedback(node, 1, tr("lastPage"));
        }
    }
    event.preventDefault();
    event.stopPropagation();
}

function render(node, slideDirection = 0) {
    hideNativeWidgets(node);
    const catalog = node._no8dKreaStyleCatalog;
    const els = node._no8dKreaStyleEls;
    const styleWidget = findWidget(node, "style");
    if (!catalog || !els || !styleWidget) return;

    syncFrame(node);
    const selectedItem = catalog.styles.find((item) => item.name === styleWidget.value);
    const isZh = no8dLocale() === "zh";
    const displayName = (item) => (isZh ? item.name_zh : null) || item.name;
    const output = node.outputs?.[0];
    if (output) {
        output.label = isZh ? "提示词" : "prompt";
        output.localized_name = output.label;
    }
    const firstOrdinaryLibrary = catalog.libraries.find((name) => !catalog.virtual_libraries?.includes(name)) || "";
    const library = node._no8dKreaLibrary && catalog.libraries.includes(node._no8dKreaLibrary)
        ? node._no8dKreaLibrary
        : selectedItem?.library || firstOrdinaryLibrary;
    node._no8dKreaLibrary = library;
    setWidgetValue(findWidget(node, "library"), library);
    els.libraryLabel.textContent = tr("library");
    els.importLibrary.textContent = tr("importWildcards");
    els.importLibrary.title = tr("importWildcards");
    els.reloadLibraries.title = tr("reload");
    const libraryItems = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, library);
    const items = filteredItems(node, catalog, library);
    if (!node._no8dKreaSelectionCleared && !libraryItems.some((item) => item.name === styleWidget.value)) {
        setWidgetValue(styleWidget, libraryItems[0]?.name || "");
    }
    const query = normalizeSearch(node._no8dKreaSearch);
    els.searchInput.placeholder = tr("search");
    els.searchInput.value = node._no8dKreaSearch || "";
    els.searchClear.title = tr("clearSearch");
    els.searchClear.textContent = tr("clearSearch");
    els.addStyle.title = tr("addStyle");
    els.addStyle.textContent = tr("addEntry");
    els.manageStyles.title = tr("manageStyles");
    els.manageStyles.textContent = "⚙";
    els.manageStyles.title = tr("organizeLibrary");
    const randomEnabled = Boolean(findWidget(node, "random_mode")?.value);
    const outputAllEnabled = Boolean(findWidget(node, "output_all")?.value);
    els.outputAll.classList.toggle("selected", outputAllEnabled);
    els.outputAll.style.background = outputAllEnabled ? "#2563eb" : "";
    els.outputAll.style.color = outputAllEnabled ? "#fff" : "";
    els.randomMode.classList.toggle("selected", randomEnabled);
    els.randomMode.style.background = randomEnabled ? "#2563eb" : "";
    els.randomMode.style.color = randomEnabled ? "#fff" : "";
    els.searchClear.style.visibility = query ? "visible" : "hidden";
    els.tabs.replaceChildren();
    els.tabs.style.gridTemplateColumns = "minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) 48px";
    const virtualLibraries = catalog.virtual_libraries || ["收藏夹", "历史记录"];
    const switchLibrary = (name) => {
        const enteringVirtual = virtualLibraries.includes(name);
        const currentIsVirtual = virtualLibraries.includes(library);
        if (enteringVirtual && name === library) {
            const previous = node._no8dKreaLibraryReturn;
            const fallback = catalog.libraries.find((candidate) => !virtualLibraries.includes(candidate));
            const restoredLibrary = previous?.library && catalog.libraries.includes(previous.library)
                ? previous.library
                : fallback;
            if (!restoredLibrary) return;
            node._no8dKreaLibrary = restoredLibrary;
            setWidgetValue(findWidget(node, "library"), restoredLibrary);
            const restoredItems = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, restoredLibrary);
            const restoredStyle = restoredItems.some((candidate) => candidate.name === previous?.style)
                ? previous.style
                : restoredItems[0]?.name || "";
            setWidgetValue(styleWidget, restoredStyle);
            node._no8dKreaSelection = new Set(previous?.selection || (restoredStyle ? [restoredStyle] : []));
            node._no8dKreaSelectionAnchor = previous?.anchor || restoredStyle || null;
            syncSelectedStyles(node);
            node._no8dKreaStylePage = Math.max(0, previous?.page || 0);
            node._no8dKreaLibraryReturn = null;
            render(node, -1);
        } else {
            if (enteringVirtual && !currentIsVirtual) {
                node._no8dKreaLibraryReturn = {
                    library,
                    style: styleWidget.value,
                    page: node._no8dKreaStylePage || 0,
                    selection: Array.from(node._no8dKreaSelection || []),
                    anchor: node._no8dKreaSelectionAnchor || null,
                };
            } else if (!enteringVirtual) {
                node._no8dKreaLibraryReturn = null;
            }
            node._no8dKreaLibrary = name;
            setWidgetValue(findWidget(node, "library"), name);
            const first = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, name)[0];
            setWidgetValue(styleWidget, first?.name || "");
            selectOnly(node, first?.name || "");
            node._no8dKreaStylePage = 0;
            render(node, name === library ? 0 : 1);
        }
        els.root.focus({ preventScroll: true });
        markGraphChanged(node);
    };
    for (const name of virtualLibraries) {
        const count = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, name).length;
        const button = document.createElement("button");
        button.type = "button";
        button.disabled = count === 0;
        button.className = `no8d-krea-style-tab${name === library ? " selected" : ""}`;
        button.textContent = isZh ? name : CATEGORY_LABELS_EN[name] || name;
        button.style.cssText = "min-width:0;height:44px;padding:0 10px;border:1px solid #4b4f58;border-radius:7px;background:#26292f;color:#d4d4d8;font:700 15px sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;";
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => switchLibrary(name));
        els.tabs.append(button);
    }
    const ordinaryLibraries = catalog.libraries.filter((name) => !catalog.virtual_libraries?.includes(name));
    const displayedLibrary = ordinaryLibraries.includes(library)
        ? library
        : node._no8dKreaLibraryReturn?.library;
    const activeLibrary = ordinaryLibraries.includes(displayedLibrary)
        ? displayedLibrary
        : ordinaryLibraries[0] || "";
    const libraryPicker = document.createElement("div");
    libraryPicker.style.cssText = "position:relative;min-width:0;";
    const pickerButton = document.createElement("button");
    pickerButton.type = "button";
    pickerButton.setAttribute("aria-haspopup", "listbox");
    pickerButton.setAttribute("aria-expanded", "false");
    const activeCount = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, activeLibrary).length;
    pickerButton.textContent = `${isZh ? activeLibrary : CATEGORY_LABELS_EN[activeLibrary] || activeLibrary} ${activeCount}`;
    pickerButton.style.cssText = "display:flex;align-items:center;justify-content:space-between;width:100%;height:44px;min-width:0;padding:0 12px;border:1px solid #4b4f58;border-radius:7px;background:#26292f;color:#f4f4f5;font:700 15px sans-serif;cursor:pointer;";
    const arrow = document.createElement("span");
    arrow.textContent = "⌄";
    arrow.style.cssText = "margin-left:10px;font-size:21px;line-height:1;";
    pickerButton.append(arrow);
    const pickerMenu = document.createElement("div");
    pickerMenu.setAttribute("role", "listbox");
    pickerMenu.style.cssText = "display:none;position:absolute;z-index:10030;top:calc(100% + 2px);left:0;right:0;max-height:360px;overflow:auto;padding:3px;border:1px solid #4b4f58;border-radius:7px;background:#202329;box-shadow:0 12px 30px rgba(0,0,0,.5);";
    const closePicker = () => {
        pickerMenu.style.display = "none";
        pickerButton.setAttribute("aria-expanded", "false");
        window.removeEventListener("pointerdown", closeOnOutside, true);
    };
    const closeOnOutside = (event) => {
        if (!libraryPicker.contains(event.target)) closePicker();
    };
    for (const name of ordinaryLibraries) {
        const count = filteredItems({ ...node, _no8dKreaSearch: "" }, catalog, name).length;
        const option = document.createElement("button");
        option.type = "button";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(name === activeLibrary));
        option.textContent = `${isZh ? name : CATEGORY_LABELS_EN[name] || name} ${count}`;
        option.style.cssText = `display:block;width:100%;min-height:38px;padding:8px 10px;border:0;border-radius:5px;background:${name === activeLibrary ? "#2563eb" : "transparent"};color:#fff;font:700 15px sans-serif;text-align:left;cursor:pointer;`;
        option.onclick = () => {
            closePicker();
            switchLibrary(name);
        };
        pickerMenu.append(option);
    }
    pickerButton.onclick = () => {
        const open = pickerMenu.style.display !== "none";
        if (open) closePicker();
        else {
            pickerMenu.style.display = "block";
            pickerButton.setAttribute("aria-expanded", "true");
            setTimeout(() => window.addEventListener("pointerdown", closeOnOutside, true), 0);
        }
    };
    pickerButton.onkeydown = (event) => {
        if (event.key === "Escape") { event.preventDefault(); closePicker(); }
    };
    libraryPicker.append(pickerButton, pickerMenu);
    els.tabs.prepend(libraryPicker);
    els.tabs.append(els.manageStyles);

    const selectedIndex = items.findIndex((item) => item.name === styleWidget.value);
    const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const inferredPage = selectedIndex >= 0 ? Math.floor(selectedIndex / PAGE_SIZE) : 0;
    const page = Math.max(0, Math.min(node._no8dKreaStylePage ?? inferredPage, pageCount - 1));
    node._no8dKreaStylePage = page;
    const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const pageLayer = makePageLayer();
    if (!pageItems.length) {
        const empty = document.createElement("div");
        empty.textContent = tr("noResults");
        empty.style.cssText = "grid-column:1/-1;display:flex;align-items:center;justify-content:center;height:100%;color:#9ca3af;font:600 15px sans-serif;text-align:center;";
        pageLayer.style.gridTemplateColumns = "1fr";
        pageLayer.style.gridTemplateRows = "1fr";
        pageLayer.style.height = "100%";
        pageLayer.append(empty);
    }
    for (const item of pageItems) {
        const card = document.createElement("button");
        card.type = "button";
        const multiSelected = node._no8dKreaSelection?.has(item.name) || false;
        card.className = `no8d-krea-style-card${item.name === styleWidget.value ? " selected" : ""}${multiSelected ? " multi-selected" : ""}`;
        card.dataset.styleName = item.name;
        card.title = displayName(item);
        card.style.cssText = "position:relative;display:flex;flex-direction:column;width:100%;min-width:0;height:auto;box-sizing:border-box;padding:4px;border:1px solid #41454e;border-radius:6px;background:#1b1e23;color:#e4e4e7;cursor:pointer;overflow:hidden;";

        const image = document.createElement("img");
        image.src = item.has_preview ? previewUrl(item.name, item.preview_version) : emptyPreviewUrl();
        image.alt = displayName(item);
        image.loading = "eager";
        image.style.cssText = "display:block;width:100%;height:auto;aspect-ratio:1/1;flex:0 0 auto;object-fit:cover;border-radius:4px;background:#0d0f12;";

        const label = document.createElement("span");
        label.className = "no8d-krea-style-name";
        label.textContent = displayName(item);
        label.style.cssText = "display:flex;width:100%;min-height:48px;padding:7px 8px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:0 0 4px 4px;background:#24272d;color:#f4f4f5;font:700 15px/17px sans-serif;letter-spacing:.1px;text-align:center;overflow:hidden;overflow-wrap:anywhere;";
        card.append(image, label);
        if (item.favorite) {
            const favoriteBadge = document.createElement("span");
            favoriteBadge.textContent = "★";
            favoriteBadge.title = no8dLocale() === "zh" ? "已收藏" : "Favorite";
            favoriteBadge.style.cssText = "position:absolute;top:8px;right:8px;color:#fbbf24;font:700 22px sans-serif;text-shadow:0 1px 4px #000;";
            card.append(favoriteBadge);
        }
        card.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            openCardContextMenu(node, item, event, library);
        });
        card.addEventListener("dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!isRecordLibrary(node, library)) openStyleEditor(node, item);
        });
        card.addEventListener("pointerdown", (event) => event.preventDefault());
        card.addEventListener("click", (event) => {
            const additive = event.ctrlKey || event.metaKey;
            const range = event.shiftKey && node._no8dKreaSelectionAnchor;
            if (range) {
                const anchorIndex = items.findIndex((candidate) => candidate.name === node._no8dKreaSelectionAnchor);
                const itemIndex = items.findIndex((candidate) => candidate.name === item.name);
                const selection = additive ? new Set(node._no8dKreaSelection || []) : new Set();
                if (anchorIndex >= 0 && itemIndex >= 0) {
                    const [start, end] = anchorIndex <= itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
                    for (const candidate of items.slice(start, end + 1)) selection.add(candidate.name);
                } else {
                    selection.add(item.name);
                }
                node._no8dKreaSelection = selection;
                node._no8dKreaSelectionCleared = false;
            } else if (additive) {
                const selection = new Set(node._no8dKreaSelection || []);
                if (selection.has(item.name)) selection.delete(item.name);
                else selection.add(item.name);
                node._no8dKreaSelection = selection;
                node._no8dKreaSelectionAnchor = item.name;
                node._no8dKreaSelectionCleared = selection.size === 0;
            } else {
                const selection = node._no8dKreaSelection || new Set();
                if (selection.size === 1 && selection.has(item.name)) {
                    node._no8dKreaSelection = new Set();
                    node._no8dKreaSelectionAnchor = null;
                    node._no8dKreaSelectionCleared = true;
                    setWidgetValue(styleWidget, "");
                } else {
                    node._no8dKreaSelection = new Set([item.name]);
                    node._no8dKreaSelectionAnchor = item.name;
                    node._no8dKreaSelectionCleared = false;
                }
            }
            setWidgetValue(styleWidget, node._no8dKreaSelection.size ? item.name : "");
            syncSelectedStyles(node);
            render(node);
            els.root.focus({ preventScroll: true });
            markGraphChanged(node);
        });
        pageLayer.append(card);
    }
    fitPageLayer(els.grid, pageLayer);
    const currentItem = catalog.styles.find((item) => item.name === styleWidget.value);
    const countLabel = query ? `${items.length} ${tr("results")}` : `${items.length} ${tr("styles")}`;
    els.status.textContent = `${currentItem ? `${tr("selected")}: ${displayName(currentItem)}` : tr("noSelection")}　|　${countLabel}`;
    els.pager.style.visibility = items.length ? "visible" : "hidden";
    els.pager.replaceChildren(
        pageButton("‹", tr("previousPage"), page === 0, () => page === 0
            ? showBoundaryFeedback(node, -1, tr("firstPage"))
            : selectPage(node, page - 1, -1)),
        ...Array.from({ length: pageCount }, (_, index) => pageButton(
            String(index + 1),
            tr("page", { page: index + 1 }),
            false,
            () => selectPage(node, index, Math.sign(index - page)),
        )),
        pageButton("›", tr("nextPage"), page === pageCount - 1, () => page === pageCount - 1
            ? showBoundaryFeedback(node, 1, tr("lastPage"))
            : selectPage(node, page + 1, 1)),
    );
    for (const button of els.pager.children) {
        if (button.textContent === String(page + 1)) {
            button.classList.add("selected");
            button.setAttribute("aria-current", "page");
        }
        if (button.dataset.disabled === "true") button.style.opacity = ".35";
    }
    showPage(node, pageLayer, slideDirection);
}

function installUi(node) {
    if (node._no8dKreaStyleWidget || typeof node.addDOMWidget !== "function") return;
    ensureStyleSheet();
    hideNativeWidgets(node);
    const root = makeUi(node);
    const widget = node.addDOMWidget("no8d_krea_style_selector", "style_selector", root, {
        serialize: false,
        hideOnZoom: false,
    });
    widget.serialize = false;
    widget.computeLayoutSize = () => ({
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        maxWidth: 1_000_000,
        maxHeight: 1_000_000,
    });
    Object.defineProperty(widget, "width", {
        configurable: true,
        get() {
            return this.node?.width || this.node?.size?.[0] || DEFAULT_WIDTH;
        },
        set() {},
    });
    node._no8dKreaStyleWidget = widget;
    syncFrame(node);
    if ((node.size?.[0] || 0) < MIN_WIDTH || (node.size?.[1] || 0) < MIN_HEIGHT) {
        node.setSize([
            Math.max(node.size?.[0] || DEFAULT_WIDTH, MIN_WIDTH),
            Math.max(node.size?.[1] || DEFAULT_HEIGHT, MIN_HEIGHT),
        ]);
    }
    getCatalog()
        .then((catalog) => {
            hideNativeWidgets(node);
            node._no8dKreaStyleCatalog = catalog;
            const styleWidget = findWidget(node, "style");
            const clearedWidget = findWidget(node, "selection_cleared");
            node._no8dKreaSearch = String(findWidget(node, "search_query")?.value || "");
            node._no8dKreaSelectionCleared = Boolean(clearedWidget?.value);
            if (!node._no8dKreaSelectionCleared && !catalog.styles.some((item) => item.name === styleWidget?.value)) {
                setWidgetValue(styleWidget, catalog.styles[0]?.name || "");
            }
            try {
                const savedSelection = JSON.parse(findWidget(node, "selected_styles")?.value || "[]");
                node._no8dKreaSelection = new Set(
                    Array.isArray(savedSelection)
                        ? savedSelection.filter((name) => catalog.styles.some((item) => item.name === name))
                        : [],
                );
            } catch {
                node._no8dKreaSelection = new Set();
            }
            if (!node._no8dKreaSelection.size && styleWidget?.value) selectOnly(node, styleWidget.value);
            else syncSelectedStyles(node);
            render(node);
        })
        .catch((error) => {
            node._no8dKreaStyleEls.status.textContent = `${tr("loadFailed")}: ${error.message || error}`;
        });
    requestAnimationFrame(() => syncFrame(node));
}

app.registerExtension({
    name: "NO8D.Control.KreaStyleSelector",
    setup() {
        api.addEventListener("execution_success", () => {
            refreshAllKreaCatalogs().catch((error) => console.error("[NO8D Krea] history refresh failed", error));
        });
    },
    async nodeCreated(node) {
        if ((node.comfyClass || node.type) !== NODE_NAME) return;
        installUi(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            installUi(this);
        };
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            onResize?.apply(this, arguments);
            syncFrame(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => {
                hideNativeWidgets(this);
                installUi(this);
                render(this);
            }, 0);
        };
    },
});
