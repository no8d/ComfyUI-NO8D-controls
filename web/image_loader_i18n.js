import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const NODE_CLASS = "NO8DLoadImages";
const HIDDEN_WIDGETS = new Set(["image_files"]);
const WIDGET_LABELS = {
    image_files: "imageLoaderFiles",
};
const SLOT_LABELS = {
    images: "imageLoaderImages",
};
const LOADER_MIN_WIDTH = 360;
const LOADER_MIN_HEIGHT = 180;

let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function imageWidget(node) {
    return (node.widgets || []).find((widget) => widget.name === "image_files");
}

function thumbSize(node) {
    const value = Number(node.properties?.no8d_image_loader_thumb_size);
    return Number.isFinite(value) ? Math.max(56, Math.min(220, value)) : 96;
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

function setRefs(node, refs) {
    const widget = imageWidget(node);
    if (!widget) return;
    widget.value = JSON.stringify(refs);
    widget.callback?.(widget.value);
    renderLoader(node);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function viewUrl(ref) {
    if (!ref?.name) return "";
    const params = new URLSearchParams();
    params.set("filename", ref.name);
    params.set("type", ref.type || "input");
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    return api.apiURL(`/view?${params.toString()}`);
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
    const root = document.createElement("div");
    root.className = "no8d-image-loader";
    root.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:8px",
        "width:100%",
        "height:100%",
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

    const clear = makeButton(t("imageLoaderClear"), () => setRefs(node, []));

    const status = document.createElement("div");
    status.style.cssText = "flex:1; min-width:0; color:#9ca3af; overflow:hidden; white-space:nowrap; text-overflow:ellipsis;";

    row.append(load, clear, status, input);

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
    sizeRange.addEventListener("pointerdown", (event) => event.stopPropagation());
    sizeRange.addEventListener("input", () => {
        node.properties = node.properties || {};
        node.properties.no8d_image_loader_thumb_size = Number(sizeRange.value);
        renderLoader(node);
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    });
    sizeRow.append(sizeLabel, sizeRange);

    const preview = document.createElement("div");
    preview.style.cssText = [
        "display:flex",
        "gap:10px",
        "align-content:flex-start",
        "min-height:96px",
        "height:100%",
        "flex:1 1 auto",
        "padding:8px",
        "border:1px solid #333",
        "border-radius:6px",
        "background:#111",
        "overflow-x:auto",
        "overflow-y:auto",
        "box-sizing:border-box",
        "flex-wrap:wrap",
    ].join(";");

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
    node._no8dImageLoaderEls = { root, load, clear, status, sizeLabel, sizeRange, preview };
    return root;
}

function renderLoader(node) {
    const els = node._no8dImageLoaderEls;
    if (!els) return;
    const refs = parseRefs(node);
    const size = thumbSize(node);
    els.load.textContent = t("imageLoaderLoad");
    els.clear.textContent = t("imageLoaderClear");
    els.sizeLabel.textContent = `${t("imageLoaderThumbSize")}: ${Math.round(size)}px`;
    if (Number(els.sizeRange.value) !== size) {
        els.sizeRange.value = String(size);
    }
    els.status.textContent = refs.length ? `${refs.length} ${t("imageLoaderSelected")}` : t("imageLoaderEmpty");
    els.preview.replaceChildren();
    els.preview.style.alignItems = "flex-start";
    if (!refs.length) {
        const empty = document.createElement("div");
        empty.textContent = t("imageLoaderEmpty");
        empty.style.cssText = "color:#6b7280; font-size:12px;";
        els.preview.appendChild(empty);
        return;
    }
    for (const ref of refs) {
        const item = document.createElement("div");
        item.style.cssText = [
            "display:flex",
            "flex-direction:column",
            "gap:4px",
            "align-items:center",
            "flex:0 0 auto",
            `width:${Math.max(64, size + 12)}px`,
        ].join(";");

        const img = document.createElement("img");
        img.loading = "lazy";
        img.decoding = "async";
        img.src = thumbUrl(ref, size);
        img.onerror = () => {
            img.onerror = null;
            img.src = viewUrl(ref);
        };
        img.title = ref.name || "";
        img.style.cssText = [
            `width:${size}px`,
            `height:${size}px`,
            "object-fit:contain",
            "border:1px solid #3b82f6",
            "border-radius:4px",
            "background:#050505",
            "flex:0 0 auto",
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
        els.preview.appendChild(item);
    }
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
    hideInternalWidgets(node);
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
