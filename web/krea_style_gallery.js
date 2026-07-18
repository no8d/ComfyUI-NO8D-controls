import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale } from "./no8d_i18n.js";

const NODE_NAME = "NO8DKreaStyleSelector";
const API_PREFIX = "/no8d/krea-style-selector";
const MIN_WIDTH = 850;
const MIN_HEIGHT = 1080;
const DEFAULT_WIDTH = 850;
const DEFAULT_HEIGHT = 1080;
const PAGE_SIZE = 9;
const BASE_PREVIEW_SIZE = 256;
const BASE_LABEL_FONT_SIZE = 15;
const BASE_LABEL_HEIGHT = 48;
const CATEGORY_LABELS_EN = {
    "写实摄影": "Photography",
    "动漫插图": "Anime & Illustration",
    "手绘艺术": "Hand-Drawn Art",
    "数字艺术": "Digital Art",
};
const UI_TEXT = {
    loading: ["正在加载风格列表…", "Loading style list…"],
    selected: ["已选择", "Selected"],
    styles: ["种风格", "styles"],
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
const HIDDEN_WIDGETS = new Set(["category", "style"]);

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
    if (document.getElementById("no8d-krea-style-selector-style")) return;
    const style = document.createElement("style");
    style.id = "no8d-krea-style-selector-style";
    style.textContent = `
.dom-widget.no8d-krea-style-selector-widget { box-sizing:border-box; overflow:hidden; }
.no8d-krea-style-grid { scrollbar-width:thin; scrollbar-color:#6b7280 #111318; }
.no8d-krea-style-grid::-webkit-scrollbar { width:9px; }
.no8d-krea-style-grid::-webkit-scrollbar-track { background:#111318; }
.no8d-krea-style-grid::-webkit-scrollbar-thumb { background:#6b7280; border:2px solid #111318; border-radius:999px; }
.no8d-krea-style-card { outline:none !important; }
.no8d-krea-style-card:hover { border-color:#6b7280 !important; background:#272a31 !important; }
.no8d-krea-style-card.selected { border-color:#41454e !important; box-shadow:none !important; background:#202b3d !important; }
.no8d-krea-style-card:hover .no8d-krea-style-name { background:#30343c !important; color:#fff !important; }
.no8d-krea-style-card.selected .no8d-krea-style-name { background:#2563eb !important; color:#fff !important; }
.no8d-krea-style-tab:hover { background:#343840 !important; }
.no8d-krea-style-tab.selected { color:#fff !important; border-color:#2563eb !important; background:#2563eb !important; }
`;
    document.head.appendChild(style);
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

function markGraphChanged(node) {
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function stopCanvasEvents(root) {
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "wheel"]) {
        root.addEventListener(type, (event) => event.stopPropagation());
    }
}

function makeUi(node) {
    const root = document.createElement("div");
    root.classList.add("no8d-ui");
    root.tabIndex = 0;
    root.style.cssText = "width:100%;height:100%;max-width:100%;box-sizing:border-box;padding:8px;overflow:hidden;";
    stopCanvasEvents(root);

    const panel = document.createElement("div");
    panel.style.cssText = "display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;box-sizing:border-box;";

    const tabs = document.createElement("div");
    tabs.style.cssText = "display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;flex:0 0 auto;";

    const status = document.createElement("div");
    status.style.cssText = "flex:0 0 auto;min-height:18px;color:#d4d4d8;font:12px/18px sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    status.textContent = tr("loading");

    const grid = document.createElement("div");
    grid.className = "no8d-krea-style-grid no8d-panel";
    grid.style.cssText = "position:relative;flex:1 1 auto;min-height:0;overflow:hidden;padding:6px;box-sizing:border-box;background:#111318;border:1px solid #34373e;border-radius:7px;";

    const pager = document.createElement("div");
    pager.style.cssText = "display:flex;align-items:center;justify-content:center;gap:8px;flex:0 0 34px;min-height:34px;";

    panel.append(tabs, status, grid, pager);
    root.append(panel);
    node._no8dKreaStyleEls = { root, panel, tabs, status, grid, pager };
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

function previewUrl(name) {
    return api.apiURL(`${API_PREFIX}/preview?style=${encodeURIComponent(name)}&v=2`);
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
    for (const card of page.children) {
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
    const items = catalog.styles.filter((item) => item.category === selected?.category);
    const pageCount = Math.ceil(items.length / PAGE_SIZE);
    const targetPage = Math.max(0, Math.min(page, pageCount - 1));
    const target = items[Math.min(targetPage * PAGE_SIZE + localIndex, items.length - 1)];
    if (!target) return;
    setWidgetValue(styleWidget, target.name);
    node._no8dKreaStylePage = targetPage;
    render(node, direction);
    node._no8dKreaStyleEls.root.focus({ preventScroll: true });
    markGraphChanged(node);
}

function handleGalleryKey(node, event) {
    const keys = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
    if (!keys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    const catalog = node._no8dKreaStyleCatalog;
    const styleWidget = findWidget(node, "style");
    if (!catalog || !styleWidget) return;
    const selected = catalog.styles.find((item) => item.name === styleWidget.value);
    const items = catalog.styles.filter((item) => item.category === selected?.category);
    const index = items.findIndex((item) => item.name === styleWidget.value);
    if (index < 0) return;
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
    const category = selectedItem?.category || catalog.categories[0];
    const items = catalog.styles.filter((item) => item.category === category);
    if (!items.some((item) => item.name === styleWidget.value)) {
        setWidgetValue(styleWidget, items[0]?.name || "");
    }
    els.tabs.replaceChildren();
    for (const name of catalog.categories) {
        const count = catalog.styles.filter((item) => item.category === name).length;
        const button = document.createElement("button");
        button.type = "button";
        button.className = `no8d-krea-style-tab${name === category ? " selected" : ""}`;
        button.textContent = `${isZh ? name : CATEGORY_LABELS_EN[name] || name} ${count}`;
        button.style.cssText = "min-width:0;height:30px;padding:0 5px;border:1px solid #4b4f58;border-radius:6px;background:#26292f;color:#d4d4d8;font:12px sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;";
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
            const first = catalog.styles.find((item) => item.category === name);
            setWidgetValue(styleWidget, first?.name || "");
            node._no8dKreaStylePage = 0;
            render(node, name === category ? 0 : 1);
            els.root.focus({ preventScroll: true });
            markGraphChanged(node);
        });
        els.tabs.append(button);
    }

    const selectedIndex = Math.max(0, items.findIndex((item) => item.name === styleWidget.value));
    const pageCount = Math.ceil(items.length / PAGE_SIZE);
    const page = Math.max(0, Math.min(node._no8dKreaStylePage ?? Math.floor(selectedIndex / PAGE_SIZE), pageCount - 1));
    node._no8dKreaStylePage = page;
    const pageItems = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const pageLayer = makePageLayer();
    for (const item of pageItems) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `no8d-krea-style-card${item.name === styleWidget.value ? " selected" : ""}`;
        card.title = displayName(item);
        card.style.cssText = "position:relative;display:flex;flex-direction:column;width:100%;min-width:0;height:auto;box-sizing:border-box;padding:4px;border:1px solid #41454e;border-radius:6px;background:#1b1e23;color:#e4e4e7;cursor:pointer;overflow:hidden;";

        const image = document.createElement("img");
        image.src = previewUrl(item.name);
        image.alt = displayName(item);
        image.loading = "eager";
        image.style.cssText = "display:block;width:100%;height:auto;aspect-ratio:1/1;flex:0 0 auto;object-fit:cover;border-radius:4px;background:#0d0f12;";

        const label = document.createElement("span");
        label.className = "no8d-krea-style-name";
        label.textContent = displayName(item);
        label.style.cssText = "display:flex;width:100%;min-height:48px;padding:7px 8px;box-sizing:border-box;align-items:center;justify-content:center;border-radius:0 0 4px 4px;background:#24272d;color:#f4f4f5;font:700 15px/17px sans-serif;letter-spacing:.1px;text-align:center;overflow:hidden;overflow-wrap:anywhere;";

        card.append(image, label);
        card.addEventListener("pointerdown", (event) => event.preventDefault());
        card.addEventListener("click", () => {
            setWidgetValue(styleWidget, item.name);
            for (const other of pageLayer.children) other.classList.remove("selected");
            card.classList.add("selected");
            els.status.textContent = `${tr("selected")}: ${displayName(item)}`;
            els.root.focus({ preventScroll: true });
            markGraphChanged(node);
        });
        pageLayer.append(card);
    }
    fitPageLayer(els.grid, pageLayer);
    const currentItem = catalog.styles.find((item) => item.name === styleWidget.value);
    els.status.textContent = `${tr("selected")}: ${currentItem ? displayName(currentItem) : styleWidget.value}　|　${items.length} ${tr("styles")}`;
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
        node.setSize([Math.max(node.size?.[0] || 0, DEFAULT_WIDTH), Math.max(node.size?.[1] || 0, DEFAULT_HEIGHT)]);
    }
    getCatalog()
        .then((catalog) => {
            hideNativeWidgets(node);
            node._no8dKreaStyleCatalog = catalog;
            const styleWidget = findWidget(node, "style");
            if (!catalog.styles.some((item) => item.name === styleWidget?.value)) {
                setWidgetValue(styleWidget, catalog.styles[0]?.name || "");
            }
            render(node);
        })
        .catch((error) => {
            node._no8dKreaStyleEls.status.textContent = `${tr("loadFailed")}: ${error.message || error}`;
        });
    requestAnimationFrame(() => syncFrame(node));
}

app.registerExtension({
    name: "NO8D.Control.KreaStyleSelector",
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
