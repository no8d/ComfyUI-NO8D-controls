import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale, t } from "./no8d_i18n.js";
import { refreshBypassElements, registerBypassElement, wrapBypassRefresh } from "./no8d_bypass.js";

const NODE_CLASS = "NO8DLoadImages";
const HIDDEN_WIDGETS = new Set(["image_files", "output_files"]);
const DEPRECATED_WIDGETS = new Set(["output_all"]);
const WIDGET_LABELS = {
    image_files: "imageLoaderFiles",
};
const SLOT_LABELS = {
    images: "imageLoaderImages",
};
const LOADER_MIN_WIDTH = 390;
const LOADER_MIN_HEIGHT = 180;
const THUMB_MIN_SIZE = 80;
const THUMB_MAX_SIZE = 400;
const THUMB_DEFAULT_SIZE = 200;
const DRAG_MIME = "application/x-no8d-image-loader-index";

let activeLocale = "";

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
.no8d-image-loader-preview:focus {
    border-color: #3b82f6 !important;
    box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.35);
}
.dom-widget.no8d-image-loader-widget {
    box-sizing: border-box;
    overflow: hidden;
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
        widget.serialize = true;
    }
    hideInternalWidgets(node);
}

function thumbSize(node) {
    const value = Number(node.properties?.no8d_image_loader_thumb_size);
    return Number.isFinite(value) ? Math.max(THUMB_MIN_SIZE, Math.min(THUMB_MAX_SIZE, value)) : THUMB_DEFAULT_SIZE;
}

function imageKey(ref) {
    return [ref?.type || "input", ref?.subfolder || "", ref?.name || ""].join("/");
}

function imageEnabled(ref) {
    return ref?.enabled !== false;
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

function setImageAndOutputRefs(node, imageRefs, outputRefs = [], { markGraph = true } = {}) {
    ensureInternalWidgets(node);
    const image = imageWidget(node);
    const output = outputWidget(node);
    if (!image || !output) return;
    image.value = JSON.stringify(imageRefs);
    output.value = JSON.stringify(outputRefs);
    image.callback?.(image.value);
    output.callback?.(output.value);
    node.properties = node.properties || {};
    node.properties.no8d_image_loader_output_keys = outputRefs.map(imageKey);
    renderLoader(node);
    if (markGraph) node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function clearStoredOutputRefs(node) {
    ensureInternalWidgets(node);
    const output = outputWidget(node);
    if (!output) return;
    if (output.value === "[]") return;
    output.value = "[]";
    output.callback?.(output.value);
    node.properties = node.properties || {};
    node.properties.no8d_image_loader_output_keys = [];
}

function stageSelectedOutputRefs(node) {
    ensureInternalWidgets(node);
    const output = outputWidget(node);
    if (!output) return [];
    const selected = selectedRefs(node);
    output.value = JSON.stringify(selected);
    output.callback?.(output.value);
    node.properties = node.properties || {};
    node.properties.no8d_image_loader_output_keys = selected.map(imageKey);
    return selected;
}

function selectedRefs(node) {
    const refs = parseRefs(node);
    return [...selectedSet(node)]
        .sort((a, b) => a - b)
        .map((index) => refs[index])
        .filter(Boolean);
}

function totalSizeText(refs) {
    const total = refs.reduce((sum, ref) => sum + (Number(ref?.size) || 0), 0);
    return total ? `${(total / 1024 / 1024).toFixed(2)} MB` : "";
}

function updateSelectionUi(node) {
    const els = node._no8dImageLoaderEls;
    if (!els) return;
    const refs = parseRefs(node);
    const selected = selectedSet(node);
    const selectedInfo = selectedRefs(node);
    let detailText = "";
    if (selectedInfo.length === 1) {
        detailText = formatImageDetails(selectedInfo[0]);
    } else if (selectedInfo.length > 1) {
        const total = totalSizeText(selectedInfo);
        detailText = total ? `${selectedInfo.length} ${t("imageLoaderSelectedCount")} | ${total}` : `${selectedInfo.length} ${t("imageLoaderSelectedCount")}`;
    }
    els.status.textContent = refs.length
        ? `${refs.length} ${t("imageLoaderSelected")}, ${selected.size} ${t("imageLoaderSelectedCount")}`
        : t("imageLoaderEmpty");
    els.details.textContent = detailText;
    for (const img of els.preview.querySelectorAll("[data-no8d-loader-thumb]")) {
        const index = Number(img.dataset.index);
        const isSelected = selected.has(index);
        img.style.border = `${isSelected ? 3 : 1}px solid ${isSelected ? "#3b82f6" : "#4b5563"}`;
    }
}

function selectedSet(node) {
    if (!node._no8dImageLoaderSelected) node._no8dImageLoaderSelected = new Set();
    return node._no8dImageLoaderSelected;
}

function requestScrollToIndex(node, index) {
    const value = Number(index);
    if (!Number.isFinite(value) || value < 0) return;
    node._no8dImageLoaderPendingScrollIndex = Math.floor(value);
}

function ensureIndexVisible(node, index) {
    const preview = node?._no8dImageLoaderEls?.preview;
    if (!preview) return false;
    const item = preview.querySelector(`[data-no8d-loader-item][data-index="${Number(index)}"]`);
    if (!item) return false;

    const margin = 8;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    const left = item.offsetLeft;
    const right = left + item.offsetWidth;
    const viewTop = preview.scrollTop;
    const viewBottom = viewTop + preview.clientHeight;
    const viewLeft = preview.scrollLeft;
    const viewRight = viewLeft + preview.clientWidth;
    let nextTop = viewTop;
    let nextLeft = viewLeft;

    if (top < viewTop + margin) nextTop = Math.max(0, top - margin);
    else if (bottom > viewBottom - margin) nextTop = Math.max(0, bottom - preview.clientHeight + margin);

    if (left < viewLeft + margin) nextLeft = Math.max(0, left - margin);
    else if (right > viewRight - margin) nextLeft = Math.max(0, right - preview.clientWidth + margin);

    if (nextTop !== viewTop || nextLeft !== viewLeft) {
        preview.scrollTo({ top: nextTop, left: nextLeft, behavior: "auto" });
    }
    return true;
}

function syncSelection(node, selected) {
    node._no8dImageLoaderSelected = selected;
    updateSelectionUi(node);
    if (selected.size === 1) ensureIndexVisible(node, [...selected][0]);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function removeSelected(node) {
    const refs = parseRefs(node);
    const selected = selectedSet(node);
    if (!selected.size) return;
    const next = refs.filter((_, index) => !selected.has(index));
    node._no8dImageLoaderSelected = new Set();
    setImageAndOutputRefs(node, next, []);
}

function clearImages(node) {
    node._no8dImageLoaderSelected = new Set();
    setImageAndOutputRefs(node, [], []);
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
    if (ref.modified) params.set("v", String(ref.modified));
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    return api.apiURL(`/no8d-control/api/load-images/thumbnail?${params.toString()}`);
}

function originalImageUrl(ref) {
    if (!ref?.name) return "";
    const params = new URLSearchParams();
    params.set("filename", ref.name);
    params.set("type", ref.type || "input");
    if (ref.subfolder) params.set("subfolder", ref.subfolder);
    return api.apiURL(`/view?${params.toString()}`);
}

function openOriginalImage(ref) {
    const url = originalImageUrl(ref);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
}

async function imageFileMeta(file) {
    const meta = { size: file?.size || 0 };
    if (!file) return meta;
    if (typeof createImageBitmap === "function") {
        try {
            const bitmap = await createImageBitmap(file);
            meta.width = bitmap.width;
            meta.height = bitmap.height;
            bitmap.close?.();
            return meta;
        } catch (_) {
            // Fall back to an object URL image below.
        }
    }
    return await new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        const done = () => {
            URL.revokeObjectURL(url);
            resolve(meta);
        };
        img.onload = () => {
            meta.width = img.naturalWidth || 0;
            meta.height = img.naturalHeight || 0;
            done();
        };
        img.onerror = done;
        img.src = url;
    });
}

function formatImageDetails(ref) {
    if (!ref) return "";
    const parts = [ref.name || ""];
    const width = Number(ref.width);
    const height = Number(ref.height);
    const size = Number(ref.size);
    if (width && height) parts.push(`${width}x${height}`);
    if (size) parts.push(`${(size / 1024 / 1024).toFixed(2)} MB`);
    if (ref.type) parts.push(ref.type);
    return parts.filter(Boolean).join("  |  ");
}

function reorderRefs(node, fromIndex, toIndex) {
    const refs = parseRefs(node);
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= refs.length || toIndex >= refs.length) return;
    const [moved] = refs.splice(fromIndex, 1);
    refs.splice(toIndex, 0, moved);
    const selected = new Set();
    selected.add(toIndex);
    node._no8dImageLoaderSelected = selected;
    node._no8dImageLoaderAnchor = toIndex;
    requestScrollToIndex(node, toIndex);
    setImageAndOutputRefs(node, refs, []);
}

function toggleImageEnabled(node, index) {
    const refs = parseRefs(node);
    const ref = refs[index];
    if (!ref || typeof ref !== "object") return;
    refs[index] = { ...ref, enabled: !imageEnabled(ref) };
    requestScrollToIndex(node, index);
    setImageAndOutputRefs(node, refs, []);
}

function dropIndexFromPoint(preview, event) {
    const direct = event.target?.closest?.("[data-no8d-loader-item]");
    if (direct?.dataset?.index != null) return Number(direct.dataset.index);
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const item of preview.querySelectorAll("[data-no8d-loader-item]")) {
        const rect = item.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = event.clientX - cx;
        const dy = event.clientY - cy;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = item;
        }
    }
    return best?.dataset?.index == null ? -1 : Number(best.dataset.index);
}

function imageFilesFromList(files) {
    return Array.from(files || []).filter((file) => file?.type?.startsWith("image/"));
}

function clipboardImageFiles(event) {
    const itemFiles = Array.from(event?.clipboardData?.items || [])
        .filter((item) => item?.kind === "file")
        .map((item) => item.getAsFile?.())
        .filter(Boolean);
    const itemImages = imageFilesFromList(itemFiles);
    return itemImages.length ? itemImages : imageFilesFromList(event?.clipboardData?.files);
}

function showLoadingPreview(node, text) {
    const els = node._no8dImageLoaderEls;
    if (!els?.preview) return;
    els.preview.replaceChildren();
    if (els.selectionBox) els.preview.appendChild(els.selectionBox);
    els.preview.style.alignItems = "center";
    els.preview.style.justifyContent = "center";
    const loading = document.createElement("div");
    loading.textContent = text;
    loading.style.cssText = [
        "color:#9ca3af",
        "font-size:13px",
        "line-height:18px",
        "text-align:center",
        "padding:12px",
    ].join(";");
    els.preview.appendChild(loading);
}

function uploadImages(node, files, { append = false } = {}) {
    const els = node._no8dImageLoaderEls;
    const status = els?.status;
    const load = els?.load;
    const run = async () => {
        const imageFiles = imageFilesFromList(files);
        if (!imageFiles.length) return;
        if (status) status.textContent = t("imageLoaderUploading");
        showLoadingPreview(node, t("imageLoaderUploading"));
        if (load) load.disabled = true;
        try {
            const refs = append ? parseRefs(node) : [];
            const firstAddedIndex = refs.length;
            for (const file of imageFiles) {
                const meta = await imageFileMeta(file);
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
                    enabled: true,
                    width: meta.width || 0,
                    height: meta.height || 0,
                    size: meta.size || 0,
                });
            }
            node._no8dImageLoaderSelected = new Set();
            requestScrollToIndex(node, append ? firstAddedIndex : 0);
            setImageAndOutputRefs(node, refs, []);
        } catch (error) {
            console.error("[NO8D-Load-images]", error);
            if (status) status.textContent = t("imageLoaderUploadFailed");
        } finally {
            if (load) load.disabled = false;
        }
    };
    return run();
}

function hasFileDrag(event) {
    return Array.from(event?.dataTransfer?.types || []).includes("Files");
}

function installDropUpload(node, element) {
    const allowFileDrop = (event) => {
        if (!hasFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
    };
    element.addEventListener("dragenter", allowFileDrop);
    element.addEventListener("dragover", allowFileDrop);
    element.addEventListener("drop", async (event) => {
        const imageFiles = imageFilesFromList(event.dataTransfer?.files);
        if (!imageFiles.length) return;
        event.preventDefault();
        event.stopPropagation();
        await uploadImages(node, imageFiles, { append: true });
    });
}

function installPasteUpload(node, element) {
    element.addEventListener("paste", async (event) => {
        const imageFiles = clipboardImageFiles(event);
        if (!imageFiles.length) return;
        event.preventDefault();
        event.stopPropagation();
        await uploadImages(node, imageFiles, { append: true });
    });
}

function previewPoint(preview, event) {
    const rect = preview.getBoundingClientRect();
    const scaleX = rect.width / Math.max(preview.offsetWidth, 1);
    const scaleY = rect.height / Math.max(preview.offsetHeight, 1);
    return {
        x: ((event.clientX - rect.left) / Math.max(scaleX, 0.001)) + preview.scrollLeft,
        y: ((event.clientY - rect.top) / Math.max(scaleY, 0.001)) + preview.scrollTop,
    };
}

function eyeIcon(enabled) {
    return enabled
        ? '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>'
        : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 6.2A11.2 11.2 0 0 1 12 6c6.5 0 10 6 10 6a17.8 17.8 0 0 1-2.1 2.8"/><path d="M6.6 6.6C3.7 8.3 2 12 2 12s3.5 6 10 6a10.7 10.7 0 0 0 4.1-.8"/></svg>';
}

function makeThumbItem(node, ref, index, size, selected) {
    const isSelected = selected.has(index);
    const isEnabled = imageEnabled(ref);
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
    item.dataset.no8dLoaderItem = "1";
    item.draggable = true;
    item.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        node._no8dImageLoaderEls?.preview?.focus?.({ preventScroll: true });
    });
    item.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(DRAG_MIME, String(index));
        event.dataTransfer.effectAllowed = "move";
        item.style.opacity = "0.45";
    });
    item.addEventListener("dragend", () => {
        item.style.opacity = "";
    });
    item.addEventListener("dragover", (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes(DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("drop", (event) => {
        const raw = event.dataTransfer?.getData(DRAG_MIME);
        if (raw == null || raw === "") return;
        event.preventDefault();
        event.stopPropagation();
        reorderRefs(node, Number(raw), index);
    });
    item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail > 1) return;
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
            if (current.size === 1 && current.has(index)) next.delete(index);
            else next.add(index);
            node._no8dImageLoaderAnchor = index;
        }
        syncSelection(node, next);
    });
    item.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openOriginalImage(ref);
    });

    const thumbFrame = document.createElement("div");
    thumbFrame.style.cssText = [
        "position:relative",
        `width:${size}px`,
        `height:${size}px`,
        "flex:0 0 auto",
    ].join(";");

    const img = document.createElement("img");
    img.loading = "lazy";
    img.decoding = "async";
    img.draggable = false;
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
    img.title = [ref.name || "", t("imageLoaderOpenOriginal")].filter(Boolean).join("\n");
    img.dataset.no8dLoaderThumb = "1";
    img.dataset.index = String(index);
    img.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        "object-fit:contain",
        `border:${isSelected ? 3 : 1}px solid ${isSelected ? "#3b82f6" : "#4b5563"}`,
        "border-radius:4px",
        "background:#050505",
        "display:block",
        "box-sizing:border-box",
        `opacity:${isEnabled ? 1 : 0.3}`,
        `filter:${isEnabled ? "none" : "grayscale(1)"}`,
    ].join(";");

    const enabledToggle = document.createElement("button");
    enabledToggle.type = "button";
    enabledToggle.draggable = false;
    enabledToggle.innerHTML = eyeIcon(isEnabled);
    enabledToggle.title = t(isEnabled ? "imageLoaderDisableImage" : "imageLoaderEnableImage");
    enabledToggle.setAttribute("aria-label", enabledToggle.title);
    enabledToggle.style.cssText = [
        "position:absolute",
        "top:5px",
        "right:5px",
        "z-index:1",
        "width:26px",
        "height:26px",
        "padding:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "border:1px solid rgba(255,255,255,0.55)",
        "border-radius:6px",
        `background:${isEnabled ? "rgba(15,23,42,0.78)" : "rgba(127,29,29,0.88)"}`,
        `color:${isEnabled ? "#e0f2fe" : "#fecaca"}`,
        "cursor:pointer",
        "box-shadow:0 1px 4px rgba(0,0,0,0.55)",
    ].join(";");
    enabledToggle.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        node._no8dImageLoaderEls?.preview?.focus?.({ preventScroll: true });
    });
    enabledToggle.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleImageEnabled(node, index);
    });
    enabledToggle.addEventListener("dblclick", (event) => {
        event.preventDefault();
        event.stopPropagation();
    });
    thumbFrame.append(img, enabledToggle);
    item.appendChild(thumbFrame);

    const name = document.createElement("div");
    name.textContent = ref.name || "";
    name.title = ref.name || "";
    name.style.cssText = [
        "width:100%",
        "font-size:10px",
        "line-height:12px",
        `color:${isEnabled ? "#9ca3af" : "#6b7280"}`,
        "overflow:hidden",
        "white-space:nowrap",
        "text-overflow:ellipsis",
        "text-align:center",
    ].join(";");
    item.appendChild(name);
    return item;
}

function setThumbSize(node, value) {
    node.properties = node.properties || {};
    node.properties.no8d_image_loader_thumb_size = Math.max(THUMB_MIN_SIZE, Math.min(THUMB_MAX_SIZE, Number(value) || THUMB_DEFAULT_SIZE));
    renderLoader(node);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function toggleMaxThumbSize(node) {
    node.properties = node.properties || {};
    const current = thumbSize(node);
    if (current >= THUMB_MAX_SIZE) {
        const previous = Number(node.properties.no8d_image_loader_prev_thumb_size);
        setThumbSize(node, Number.isFinite(previous) && previous < THUMB_MAX_SIZE ? previous : THUMB_DEFAULT_SIZE);
        return;
    }
    node.properties.no8d_image_loader_prev_thumb_size = current;
    setThumbSize(node, THUMB_MAX_SIZE);
}

function makeIconButton(label, icon, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = icon;
    button.style.cssText = [
        "width:36px",
        "height:32px",
        "padding:0",
        "border:1px solid #4b5563",
        "border-radius:6px",
        "background:#2b2b2b",
        "color:#bfdbfe",
        "cursor:pointer",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "flex:0 0 36px",
        "box-sizing:border-box",
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
        "position:relative",
        "width:100%",
        "max-width:100%",
        "height:100%",
        "box-sizing:border-box",
        "overflow:hidden",
        "font-family:Arial, sans-serif",
        "color:#d1d5db",
    ].join(";");
    registerBypassElement(node, root);
    installDropUpload(node, root);

    const panel = document.createElement("div");
    panel.style.cssText = [
        "position:absolute",
        "inset:0",
        "display:flex",
        "flex-direction:column",
        "gap:8px",
        "width:100%",
        "height:100%",
        "min-width:0",
        "min-height:0",
        "overflow:hidden",
        "box-sizing:border-box",
        "padding:4px 8px 4px",
    ].join(";");
    root.appendChild(panel);

    const row = document.createElement("div");
    row.style.cssText = [
        "display:grid",
        "grid-template-columns:36px minmax(0, 1fr) 36px",
        "align-items:center",
        "column-gap:5px",
        "row-gap:10px",
        "width:100%",
        "min-width:0",
        "box-sizing:border-box",
    ].join(";");

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/bmp,image/tiff";
    input.multiple = true;
    input.style.display = "none";

    const folderIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2h7.5A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"/><path d="M3 9h18"/></svg>';
    const maxIcon = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H3v5"/><path d="M3 3l7 7"/><path d="M16 3h5v5"/><path d="M21 3l-7 7"/><path d="M8 21H3v-5"/><path d="M3 21l7-7"/><path d="M16 21h5v-5"/><path d="M21 21l-7-7"/></svg>';

    const load = makeIconButton(t("imageLoaderLoad"), folderIcon, () => input.click());
    load.style.borderColor = "#3b82f6";

    const maxSize = makeIconButton(t("imageLoaderMaxThumbSize"), maxIcon, () => toggleMaxThumbSize(node));
    maxSize.style.borderColor = "#3b82f6";

    const sizeLabel = document.createElement("div");
    sizeLabel.style.cssText = "color:#cbd5e1; white-space:nowrap; font-weight:600; flex:0 0 auto;";

    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = String(THUMB_MIN_SIZE);
    sizeRange.max = String(THUMB_MAX_SIZE);
    sizeRange.step = "5";
    sizeRange.value = String(thumbSize(node));
    sizeRange.style.cssText = "flex:1 1 auto; min-width:0; width:100%;";
    let resizeTimer = null;
    sizeRange.addEventListener("pointerdown", (event) => event.stopPropagation());
    sizeRange.addEventListener("input", () => {
        node.properties = node.properties || {};
        const nextSize = Number(sizeRange.value);
        node.properties.no8d_image_loader_thumb_size = nextSize;
        if (nextSize < THUMB_MAX_SIZE) {
            node.properties.no8d_image_loader_prev_thumb_size = nextSize;
        }
        sizeLabel.textContent = t("imageLoaderThumbSize");
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => renderLoader(node), 180);
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    });
    sizeRange.addEventListener("change", () => {
        clearTimeout(resizeTimer);
        renderLoader(node);
    });

    const sizeControl = document.createElement("div");
    sizeControl.style.cssText = [
        "display:flex",
        "align-items:center",
        "column-gap:5px",
        "row-gap:10px",
        "min-width:0",
        "width:100%",
        "box-sizing:border-box",
    ].join(";");
    sizeControl.append(sizeLabel, sizeRange);
    row.append(load, sizeControl, maxSize, input);

    const preview = document.createElement("div");
    preview.className = "no8d-image-loader-preview";
    preview.tabIndex = 0;
    preview.title = t("imageLoaderPasteHint");
    preview.style.cssText = [
        "display:flex",
        "gap:10px",
        "align-content:flex-start",
        "width:100%",
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
    installDropUpload(node, preview);
    installPasteUpload(node, preview);

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
        boxStart = previewPoint(preview, event);
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
        const { x, y } = previewPoint(preview, event);
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
    preview.addEventListener("dragover", (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes(DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
    });
    preview.addEventListener("drop", (event) => {
        const raw = event.dataTransfer?.getData(DRAG_MIME);
        if (raw == null || raw === "") return;
        event.preventDefault();
        event.stopPropagation();
        const toIndex = dropIndexFromPoint(preview, event);
        reorderRefs(node, Number(raw), toIndex);
    });
    const finishBoxSelect = (event) => {
        if (!boxStart) return;
        event.preventDefault();
        const boxRect = selectionBox.getBoundingClientRect();
        const next = new Set();
        const current = selectedSet(node);
        for (const item of preview.querySelectorAll("[data-index]")) {
            const itemRect = item.getBoundingClientRect();
            const overlaps = itemRect.left <= boxRect.right
                && itemRect.right >= boxRect.left
                && itemRect.top <= boxRect.bottom
                && itemRect.bottom >= boxRect.top;
            if (overlaps) next.add(Number(item.dataset.index));
        }
        const finalSelection = (event.ctrlKey || event.metaKey) ? new Set(current) : next;
        if (event.ctrlKey || event.metaKey) {
            for (const index of next) finalSelection.delete(index);
        }
        selectionBox.style.display = "none";
        boxStart = null;
        syncSelection(node, finalSelection);
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
        await uploadImages(node, files);
        input.value = "";
    });

    const footer = document.createElement("div");
    footer.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:0",
        "min-height:16px",
        "color:#9ca3af",
        "font-size:12px",
        "line-height:14px",
        "overflow:hidden",
    ].join(";");

    const status = document.createElement("div");
    status.style.cssText = [
        "overflow:hidden",
        "white-space:nowrap",
        "text-overflow:ellipsis",
    ].join(";");

    const details = document.createElement("div");
    details.style.cssText = [
        "min-height:0",
        "overflow:hidden",
        "white-space:nowrap",
        "text-overflow:ellipsis",
    ].join(";");
    footer.append(status, details);

    panel.append(row, preview, footer);
    node._no8dImageLoaderEls = { root, panel, load, maxSize, status, sizeLabel, sizeRange, preview, details, selectionBox };
    return root;
}

function syncLoaderFrame(node) {
    const els = node?._no8dImageLoaderEls;
    if (!els) return;
    const wrapper = els.root.closest(".dom-widget");
    if (wrapper) {
        wrapper.classList.add("no8d-image-loader-widget");
        wrapper.style.boxSizing = "border-box";
        wrapper.style.overflow = "hidden";
    }
    els.root.style.width = "100%";
    els.root.style.maxWidth = "100%";
    els.root.style.height = "100%";
    if (els.panel) {
        els.panel.style.width = "100%";
        els.panel.style.height = "100%";
    }
}

function renderLoader(node) {
    const els = node._no8dImageLoaderEls;
    if (!els) return;
    syncLoaderFrame(node);
    clearStaleSlots(node);
    const seq = (node._no8dImageLoaderRenderSeq || 0) + 1;
    node._no8dImageLoaderRenderSeq = seq;
    const scrollTop = els.preview.scrollTop || 0;
    const scrollLeft = els.preview.scrollLeft || 0;
    const pendingScrollIndex = Number.isInteger(node._no8dImageLoaderPendingScrollIndex)
        ? node._no8dImageLoaderPendingScrollIndex
        : null;
    node._no8dImageLoaderPendingScrollIndex = null;
    const refs = parseRefs(node);
    const targetScrollIndex = pendingScrollIndex == null || !refs.length
        ? null
        : Math.max(0, Math.min(refs.length - 1, pendingScrollIndex));
    const selected = selectedSet(node);
    clearStoredOutputRefs(node);
    const size = thumbSize(node);
    els.load.title = t("imageLoaderLoad");
    els.load.setAttribute("aria-label", t("imageLoaderLoad"));
    els.maxSize.title = t("imageLoaderMaxThumbSize");
    els.maxSize.setAttribute("aria-label", t("imageLoaderMaxThumbSize"));
    els.preview.title = t("imageLoaderPasteHint");
    els.sizeLabel.textContent = t("imageLoaderThumbSize");
    if (Number(els.sizeRange.value) !== size) {
        els.sizeRange.value = String(size);
    }
    const selectedInfo = selectedRefs(node);
    let detailText = "";
    if (selectedInfo.length === 1) {
        detailText = formatImageDetails(selectedInfo[0]);
    } else if (selectedInfo.length > 1) {
        const total = totalSizeText(selectedInfo);
        detailText = total ? `${selectedInfo.length} ${t("imageLoaderSelectedCount")} | ${total}` : `${selectedInfo.length} ${t("imageLoaderSelectedCount")}`;
    }
    els.status.textContent = refs.length
        ? `${refs.length} ${t("imageLoaderSelected")}, ${selected.size} ${t("imageLoaderSelectedCount")}`
        : t("imageLoaderEmpty");
    els.details.textContent = detailText;
    els.preview.replaceChildren();
    if (els.selectionBox) els.preview.appendChild(els.selectionBox);
    els.preview.style.alignItems = "flex-start";
    els.preview.style.justifyContent = "flex-start";
    if (!refs.length) {
        const empty = document.createElement("div");
        empty.textContent = `${t("imageLoaderEmpty")} · ${t("imageLoaderPasteHint")}`;
        empty.style.cssText = "color:#6b7280; font-size:12px;";
        els.preview.appendChild(empty);
        return;
    }
    let index = 0;
    const appendBatch = () => {
        if (seq !== node._no8dImageLoaderRenderSeq) return;
        const fragment = document.createDocumentFragment();
        const end = Math.min(index + 12, refs.length);
        for (; index < end; index += 1) {
            fragment.appendChild(makeThumbItem(node, refs[index], index, size, selected));
        }
        els.preview.appendChild(fragment);
        if (index === end) {
            els.preview.scrollTop = scrollTop;
            els.preview.scrollLeft = scrollLeft;
        }
        if (index < refs.length) {
            requestAnimationFrame(appendBatch);
        } else if (targetScrollIndex != null) {
            requestAnimationFrame(() => ensureIndexVisible(node, targetScrollIndex));
        }
    };
    appendBatch();
}

function hideInternalWidgets(node) {
    let changed = false;
    for (const widget of node.widgets || []) {
        if (!HIDDEN_WIDGETS.has(widget.name) && !DEPRECATED_WIDGETS.has(widget.name)) continue;
        widget.options = widget.options || {};
        if (!widget.options.hidden) changed = true;
        if (!widget.options.collapsed) changed = true;
        if (widget.type !== "converted-widget") changed = true;
        if (!widget.hidden) changed = true;
        if (!widget.serialize) changed = true;
        widget.options.hidden = true;
        widget.options.collapsed = true;
        widget.type = "converted-widget";
        widget.hidden = true;
        widget.serialize = true;
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
    }
    return changed;
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

function applyLabels(node) {
    if (nodeClass(node) !== NODE_CLASS) return;
    let changed = false;
    const title = t("imageLoaderTitle");
    if (node.title !== title) {
        node.title = title;
        changed = true;
    }
    for (const widget of node.widgets || []) {
        const key = WIDGET_LABELS[widget.name];
        if (!key) continue;
        const label = t(key);
        if (widget.label !== label || widget.options?.label !== label) changed = true;
        widget.label = label;
        widget.options = widget.options || {};
        widget.options.label = label;
    }
    changed = applySlotLabels(node.inputs) || changed;
    changed = applySlotLabels(node.outputs) || changed;
    renderLoader(node);
    if (changed) {
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
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
    widget.beforeQueued = () => {
        stageSelectedOutputRefs(node);
    };
    Object.defineProperty(widget, "width", {
        configurable: true,
        get() {
            return this.node?.width || this.node?.size?.[0] || LOADER_MIN_WIDTH;
        },
        set() {},
    });
    node._no8dImageLoaderWidget = widget;
    syncLoaderFrame(node);
    refreshBypassElements(node);
    requestAnimationFrame(() => syncLoaderFrame(node));
    renderLoader(node);
}

app.registerExtension({
    name: "NO8D.Control.ImageLoader",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllLabelsIfNeeded(true), 500);
        window.addEventListener("storage", () => applyAllLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllLabelsIfNeeded(true));
    },
    async nodeCreated(node) {
        if (nodeClass(node) !== NODE_CLASS) return;
        installLoaderUi(node);
        applyLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;
        wrapBypassRefresh(nodeType);
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            installLoaderUi(this);
            applyLabels(this);
            refreshBypassElements(this);
        };
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            onResize?.apply(this, arguments);
            if (!this._no8dImageLoaderEls) return;
            syncLoaderFrame(this);
            this.graph?.setDirtyCanvas?.(true, true);
            app?.canvas?.setDirty?.(true, true);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => {
                installLoaderUi(this);
                applyLabels(this);
                refreshBypassElements(this);
            }, 0);
        };
    },
});
