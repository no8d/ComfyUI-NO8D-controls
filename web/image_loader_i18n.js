import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const NODE_CLASS = "NO8DLoadImages";
const HIDDEN_WIDGETS = new Set(["image_files", "output_files"]);
const WIDGET_LABELS = {
    image_files: "imageLoaderFiles",
};
const SLOT_LABELS = {
    images: "imageLoaderImages",
};
const LOADER_MIN_WIDTH = 360;
const LOADER_MIN_HEIGHT = 180;

let activeLocale = "";
let renderSeq = 0;

function ensureStyleSheet() {
    if (document.getElementById("no8d-image-loader-style")) return;
    const style = document.createElement("style");
    style.id = "no8d-image-loader-style";
    style.textContent = `
.no8d-image-loader-preview {
    scrollbar-width: thin;
    scrollbar-color: #6b7280 #111;
}
.no8d-image-loader-preview::-webkit-scrollbar {
    width: 10px;
    height: 10px;
}
.no8d-image-loader-preview::-webkit-scrollbar-track {
    background: #111;
}
.no8d-image-loader-preview::-webkit-scrollbar-thumb {
    background: #6b7280;
    border: 2px solid #111;
    border-radius: 999px;
}
`;
    document.head.appendChild(style);
}

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function imageWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "image_files");
}

function outputWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "output_files");
}

function ensureInternalWidgets(node) {
    if (!node.widgets) node.widgets = [];
    for (const name of HIDDEN_WIDGETS) {
        let widget = (node.widgets || []).find((item) => item.name === name);
        if (!widget && typeof node.addWidget === "function") {
            widget = node.addWidget("text", name, "[]", () => {});
        }
        if (!widget) continue;
        if (widget.value == null || widget.value === "") widget.value = "[]";
    }
    hideInternalWidgets(node);
}

function thumbSize(node) {
    const value = Number(node.properties?.no8d_image_loader_thumb_size);
    return Number.isFinite(value) ? Math.max(56, Math.min(220, value)) : 96;
}

function imageKey(ref) {
    return [ref?.type || "input", ref?.subfolder || "", ref?.name || ""].join("/");
}

function parseRefs(node) {
    const widget = imageWidget(node);
    if (!widget?.value) return [];
    try {
        const refs = JSON.parse(widget.value);
        return Array.isArray(refs) ? refs : [];
    } catch (_) {
        return [];
    }
}

function parseOutputRefs(node) {
    const widget = outputWidget(node);
    if (!widget?.value) return [];
    try {
        const refs = JSON.parse(widget.value);
        return Array.isArray(refs) ? refs : [];
    } catch (_) {
        return [];
    }
}

function setRefs(node, refs) {
    ensureInternalWidgets(node);
    const widget = imageWidget(node);
    if (!widget) return;
    widget.value = JSON.stringify(refs);
    widget.callback?.(widget.value);
    renderLoader(node);
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function setOutputRefs(node, refs) {
    ensureInternalWidgets(node);
    const widget = outputWidget(node);
    if (!widget) return;
    widget.value = JSON.stringify(refs);
    widget.callback?.(widget.value);
    renderLoader(node);
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function selectedSet(node) {
    if (!node._no8dImageLoaderSelected) node._no8dImageLoaderSelected = new Set();
    return node._no8dImageLoaderSelected;
}

function syncSelection(node, selected) {
    node._no8dImageLoaderSelected = selected;
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
    renderLoader(node);
}

function removeSelected(node) {
    const refs = parseRefs(node);
    const selected = selectedSet(node);
    if (!selected.size) return;
    const next = refs.filter((_, index) => !selected.has(index));
    const outputKeys = new Set(parseOutputRefs(node).map(imageKey));
    const nextOutput = next.filter((ref) => outputKeys.has(imageKey(ref)));
    node._no8dImageLoaderSelected = new Set();
    setRefs(node, next);
    setOutputRefs(node, nextOutput);
}

function clearImages(node) {
    node._no8dImageLoaderSelected = new Set();
    setOutputRefs(node, []);
    setRefs(node, []);
}

function clearStaleSlots(node) {
    const wantedOutputs = new Set(["images"]);
    if (Array.isArray(node.outputs)) {
        for (let i = node.outputs.length - 1; i >= 0; i -= 1) {
            const output = node.outputs[i];
            if (wantedOutputs.has(output?.name)) continue;
            if (typeof node.removeOutput === "function") node.removeOutput(i);
            else node.outputs.splice(i, 1);
        }
    }
}

function thumbUrl(ref, size) {
    if (!ref?.name) return "";
    const params = new URLSearchParams();
    params.set("name", ref.name);
    params.set("type", ref.type || "input");
    params.set("size", String(Math.round(size)));
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    return api.apiURL(`/no8d-control/api/load-images/thumbnail?${params.toString()}`);
}

function makeThumbItem(node, ref, index, size, selected, outputKeys) {
    const isSelected = selected.has(index);
    const isOutput = outputKeys.has(imageKey(ref));
    const item = document.createElement("div");
    item.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:4px",
        "align-items:center",
        "flex:0 0 auto",
        `width:${Math.max(64, size + 12)}px`,
        "cursor:pointer",
        "user-select:none",
    ].join(";");
    item.dataset.index = String(index);
    item.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        node._no8dImageLoaderEls?.preview?.focus?.({ preventScroll: true });
    });
    item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const refs = parseRefs(node);
        const current = selectedSet(node);
        let next = new Set();
        if (event.shiftKey && Number.isInteger(node._no8dImageLoaderAnchor)) {
            const start = Math.max(0, Math.min(node._no8dImageLoaderAnchor, index));
            const end = Math.min(refs.length - 1, Math.max(node._no8dImageLoaderAnchor, index));
            next = event.ctrlKey || event.metaKey ? new Set(current) : new Set();
            for (let itemIndex = start; itemIndex <= end; itemIndex += 1) next.add(itemIndex);
        } else if (event.ctrlKey || event.metaKey) {
            next = new Set(current);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            node._no8dImageLoaderAnchor = index;
        } else {
            next.add(index);
            node._no8dImageLoaderAnchor = index;
        }
        syncSelection(node, next);
    });
    item.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        setOutputRefs(node, [ref]);
    });

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.src = thumbUrl(ref, size);
    img.onerror = () => {
        const failed = document.createElement("div");
        failed.textContent = t("imageLoaderThumbFailed");
        failed.style.cssText = [
            `width:${size}px`,
            `height:${size}px`,
            "display:flex",
            "align-items:center",
            "justify-content:center",
            "text-align:center",
            "font-size:11px",
            "line-height:14px",
            "color:#9ca3af",
            "border:1px solid #4b5563",
            "border-radius:4px",
            "background:#050505",
            "box-sizing:border-box",
        ].join(";");
        img.replaceWith(failed);
    };
    img.title = ref.name || "";
    img.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        "object-fit:contain",
        `border:${isSelected ? 3 : 1}px solid ${isOutput ? "#22c55e" : isSelected ? "#f59e0b" : "#3b82f6"}`,
        "border-radius:4px",
        "background:#050505",
        "flex:0 0 auto",
        "display:block",
        "box-sizing:border-box",
    ].join(";");
    item.appendChild(img);

    const name = document.createElement("div");
    name.textContent = ref.name || "";
    name.title = ref.name || "";
    name.style.cssText = [
        "width:100%",
        "font-size:10px",
        "line-height:12px",
        "color:#9ca3af",
        "overflow:hidden",
        "white-space:nowrap",
        "text-overflow:ellipsis",
        "text-align:center",
    ].join(";");
    item.appendChild(name);
    return item;
}

function makeButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
        "height:30px",
        "padding:0 14px",
        "border:1px solid #4b5563",
        "border-radius:6px",
        "background:#2b2b2b",
        "color:#f3f4f6",
        "font-weight:600",
        "cursor:pointer",
    ].join(";");
    button.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return button;
}

function makeUi(node) {
    ensureStyleSheet();
    const root = document.createElement("div");
    root.className = "no8d-image-loader";
    root.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:8px",
        "width:100%",
        "height:100%",
        "min-height:0",
        "overflow:hidden",
        "box-sizing:border-box",
        "padding:4px 8px 8px",
        "font-family:Arial, sans-serif",
        "color:#d1d5db",
    ].join(";");

    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:8px; flex-wrap:wrap;";

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/bmp,image/tiff";
    input.multiple = true;
    input.style.display = "none";

    const load = makeButton(t("imageLoaderLoad"), () => input.click());
    load.style.borderColor = "#3b82f6";
    load.style.color = "#bfdbfe";

    const status = document.createElement("div");
    status.style.cssText = "flex:1; min-width:0; color:#9ca3af; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;";

    row.append(load, status, input);

    const sizeRow = document.createElement("div");
    sizeRow.style.cssText = "display:flex; align-items:center; gap:8px;";

    const sizeLabel = document.createElement("div");
    sizeLabel.style.cssText = "color:#cbd5e1; white-space:nowrap; font-weight:600;";

    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = "56";
    sizeRange.max = "220";
    sizeRange.step = "4";
    sizeRange.value = String(thumbSize(node));
    sizeRange.style.cssText = "flex:1; min-width:120px;";
    let resizeTimer = null;
    sizeRange.addEventListener("pointerdown", (event) => event.stopPropagation());
    sizeRange.addEventListener("input", () => {
        node.properties = node.properties || {};
        node.properties.no8d_image_loader_thumb_size = Number(sizeRange.value);
        sizeLabel.textContent = `${t("imageLoaderThumbSize")}: ${Math.round(thumbSize(node))}px`;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderLoader(node), 180);
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    });
    sizeRange.addEventListener("change", () => {
        clearTimeout(resizeTimer);
        renderLoader(node);
    });
    sizeRow.append(sizeLabel, sizeRange);

    const preview = document.createElement("div");
    preview.className = "no8d-image-loader-preview";
    preview.tabIndex = 0;
    preview.style.cssText = [
        "display:flex",
        "gap:10px",
        "align-content:flex-start",
        "min-width:0",
        "min-height:0",
        "height:auto",
        "flex:1 1 0",
        "padding:8px",
        "border:1px solid #333",
        "border-radius:6px",
        "background:#111",
        "overflow-x:auto",
        "overflow-y:scroll",
        "scrollbar-gutter:stable",
        "overscroll-behavior:contain",
        "box-sizing:border-box",
        "flex-wrap:wrap",
        "position:relative",
        "outline:none",
    ].join(";");

    const selectionBox = document.createElement("div");
    selectionBox.style.cssText = [
        "position:absolute",
        "display:none",
        "border:1px solid #38bdf8",
        "background:rgba(56, 189, 248, 0.14)",
        "pointer-events:none",
        "z-index:2",
    ].join(";");
    preview.appendChild(selectionBox);

    let boxStart = null;
    preview.addEventListener("pointerdown", (event) => {
        preview.focus({ preventScroll: true });
        if (event.button !== 0) return;
        if (event.target.closest("[data-index]")) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = preview.getBoundingClientRect();
        boxStart = {
            x: event.clientX - rect.left + preview.scrollLeft,
            y: event.clientY - rect.top + preview.scrollTop,
        };
        preview.setPointerCapture?.(event.pointerId);
        Object.assign(selectionBox.style, {
            display: "block",
            left: `${boxStart.x}px`,
            top: `${boxStart.y}px`,
            width: "0px",
            height: "0px",
        });
    });
    preview.addEventListener("pointermove", (event) => {
        if (!boxStart) return;
        event.preventDefault();
        const rect = preview.getBoundingClientRect();
        const x = event.clientX - rect.left + preview.scrollLeft;
        const y = event.clientY - rect.top + preview.scrollTop;
        const left = Math.min(boxStart.x, x);
        const top = Math.min(boxStart.y, y);
        const width = Math.abs(x - boxStart.x);
        const height = Math.abs(y - boxStart.y);
        Object.assign(selectionBox.style, {
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
    });
    const finishBoxSelect = (event) => {
        if (!boxStart) return;
        event.preventDefault();
        const boxRect = selectionBox.getBoundingClientRect();
        const next = new Set();
        for (const item of preview.querySelectorAll("[data-index]")) {
            const itemRect = item.getBoundingClientRect();
            const overlaps = itemRect.left <= boxRect.right
                && itemRect.right >= boxRect.left
                && itemRect.top <= boxRect.bottom
                && itemRect.bottom >= boxRect.top;
            if (overlaps) next.add(Number(item.dataset.index));
        }
        selectionBox.style.display = "none";
        boxStart = null;
        syncSelection(node, next);
    };
    preview.addEventListener("pointerup", finishBoxSelect);
    preview.addEventListener("pointercancel", finishBoxSelect);
    preview.addEventListener("keydown", (event) => {
        const ctrl = event.ctrlKey || event.metaKey;
        if (ctrl && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();
            syncSelection(node, new Set(parseRefs(node).map((_, index) => index)));
            return;
        }
        if ((event.key === "Delete" || event.key === "Backspace") && ctrl) {
            event.preventDefault();
            event.stopPropagation();
            clearImages(node);
            return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            event.stopPropagation();
            removeSelected(node);
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            syncSelection(node, new Set());
        }
    });

    input.addEventListener("change", async () => {
        const files = Array.from(input.files || []);
        if (!files.length) return;
        status.textContent = t("imageLoaderUploading");
        load.disabled = true;
        try {
            const refs = [];
            for (const file of files) {
                const body = new FormData();
                body.append("image", file);
                body.append("type", "input");
                body.append("overwrite", "false");
                const response = await api.fetchApi("/upload/image", { method: "POST", body });
                if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
                const data = await response.json();
                refs.push({
                    name: data.name,
                    subfolder: data.subfolder || "",
                    type: data.type || "input",
                });
            }
            node._no8dImageLoaderSelected = new Set();
            setOutputRefs(node, []);
            setRefs(node, refs);
        } catch (error) {
            console.error("[NO8D-Load-images]", error);
            status.textContent = t("imageLoaderUploadFailed");
        } finally {
            load.disabled = false;
            input.value = "";
        }
    });

    root.append(row, sizeRow, preview);
    node._no8dImageLoaderEls = { root, load, status, sizeLabel, sizeRange, preview, selectionBox };
    return root;
}

function renderLoader(node) {
    const els = node._no8dImageLoaderEls;
    if (!els) return;
    clearStaleSlots(node);
    const seq = ++renderSeq;
    const refs = parseRefs(node);
    const selected = selectedSet(node);
    const outputRefs = parseOutputRefs(node);
    const outputKeys = new Set(outputRefs.map(imageKey));
    const size = thumbSize(node);
    els.load.textContent = t("imageLoaderLoad");
    els.sizeLabel.textContent = `${t("imageLoaderThumbSize")}: ${Math.round(size)}px`;
    if (Number(els.sizeRange.value) !== size) {
        els.sizeRange.value = String(size);
    }
    const outputText = outputRefs.length ? `, ${t("imageLoaderOutputSingle")}` : "";
    els.status.textContent = refs.length
        ? `${refs.length} ${t("imageLoaderSelected")}, ${selected.size} ${t("imageLoaderSelectedCount")}${outputText}`
        : t("imageLoaderEmpty");
    els.preview.replaceChildren();
    if (els.selectionBox) els.preview.appendChild(els.selectionBox);
    els.preview.style.alignItems = "flex-start";
    if (!refs.length) {
        const empty = document.createElement("div");
        empty.textContent = t("imageLoaderEmpty");
        empty.style.cssText = "color:#6b7280; font-size:12px;";
        els.preview.appendChild(empty);
        return;
    }
    let index = 0;
    const appendBatch = () => {
        if (seq !== renderSeq) return;
        const fragment = document.createDocumentFragment();
        const end = Math.min(index + 12, refs.length);
        for (; index < end; index += 1) {
            fragment.appendChild(makeThumbItem(node, refs[index], index, size, selected, outputKeys));
        }
        els.preview.appendChild(fragment);
        if (index < refs.length) requestAnimationFrame(appendBatch);
    };
    appendBatch();
}

function hideInternalWidgets(node) {
    for (const widget of node.widgets || []) {
        if (!HIDDEN_WIDGETS.has(widget.name)) continue;
        widget.type = "hidden";
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
    }
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

function applyLabels(node) {
    if (nodeClass(node) !== NODE_CLASS) return;
    node.title = t("imageLoaderTitle");
    for (const widget of node.widgets || []) {
        const key = WIDGET_LABELS[widget.name];
        if (!key) continue;
        const label = t(key);
        widget.label = label;
        widget.options = widget.options || {};
        widget.options.label = label;
    }
    applySlotLabels(node.inputs);
    applySlotLabels(node.outputs);
    renderLoader(node);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function applyAllLabels() {
    for (const node of app?.graph?._nodes || []) applyLabels(node);
}

function applyAllLabelsIfNeeded(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeLocale) return;
    activeLocale = locale;
    applyAllLabels();
}

function installLoaderUi(node) {
    if (node._no8dImageLoaderWidget || typeof node.addDOMWidget !== "function") return;
    ensureInternalWidgets(node);
    const root = makeUi(node);
    const widget = node.addDOMWidget("no8d_image_loader", "image_loader", root, {
        serialize: false,
        hideOnZoom: false,
    });
    widget.serialize = false;
    widget.computeLayoutSize = () => ({
        minWidth: LOADER_MIN_WIDTH,
        minHeight: LOADER_MIN_HEIGHT,
        maxWidth: 1_000_000,
        maxHeight: 1_000_000,
    });
    const markWrapper = () => {
        const wrapper = root.closest(".dom-widget");
        if (!wrapper) return;
        wrapper.classList.add("no8d-image-loader-widget");
        wrapper.style.overflow = "hidden";
        wrapper.style.boxSizing = "border-box";
        wrapper.style.minHeight = "0";
        wrapper.style.display = "flex";
        wrapper.style.flexDirection = "column";
    };
    markWrapper();
    requestAnimationFrame(markWrapper);
    node._no8dImageLoaderWidget = widget;
    renderLoader(node);
}

app.registerExtension({
    name: "NO8D.Control.ImageLoader",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllLabelsIfNeeded(true), 500);
        setTimeout(() => applyAllLabelsIfNeeded(true), 1500);
        window.addEventListener("storage", () => applyAllLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllLabelsIfNeeded(true));
        setInterval(applyAllLabelsIfNeeded, 1000);
    },
    async nodeCreated(node) {
        if (nodeClass(node) !== NODE_CLASS) return;
        installLoaderUi(node);
        applyLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            installLoaderUi(this);
            applyLabels(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => {
                installLoaderUi(this);
                applyLabels(this);
            }, 0);
        };
    },
});
