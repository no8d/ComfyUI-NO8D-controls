import { app } from "../../scripts/app.js";

const NODE_NAME = "NO8DABPreview";
const MIN_WIDTH = 260;
const MIN_HEIGHT = 320;
const HISTORY_LIMIT = 8;
const HISTORY_STORAGE_KEY = "NO8D_AB_PREVIEW_HISTORY";

const passThroughStyle = document.createElement("style");
passThroughStyle.textContent = `
    .dom-widget.no8d-compare-fit-widget { pointer-events: none !important; box-sizing: border-box; overflow: hidden; }
    .no8d-compare-control { pointer-events: auto; }
`;
document.head.appendChild(passThroughStyle);

function menuOptionKey(option) {
    if (option == null) return "";
    return typeof option === "string" ? option : String(option.content || "");
}

function nativeImageMenuOptions(canvas, image) {
    if (!image?.src || typeof globalThis.LiteGraph?.createNode !== "function") return [];
    const helper = globalThis.LiteGraph.createNode("PreviewImage");
    if (!helper || typeof helper.getExtraMenuOptions !== "function") return [];

    const withoutImage = [];
    helper.getExtraMenuOptions(canvas, withoutImage);
    helper.imgs = [image];
    helper.imageIndex = 0;
    const withImage = [];
    helper.getExtraMenuOptions(canvas, withImage);

    const baseline = new Set(withoutImage.map(menuOptionKey));
    const added = new Set();
    return withImage.filter((option) => {
        const key = menuOptionKey(option);
        if (option == null || !key || baseline.has(key) || added.has(key)) return false;
        added.add(key);
        return true;
    });
}

function installNativeImageMenu(node, image) {
    const original = node.getExtraMenuOptions;
    node.getExtraMenuOptions = function (canvas, options = []) {
        const target = Array.isArray(options) ? options : [];
        const returned = original?.call(this, canvas, target);
        const existing = new Set(target.map(menuOptionKey));
        for (const option of nativeImageMenuOptions(canvas, image)) {
            const key = menuOptionKey(option);
            if (!existing.has(key)) {
                target.push(option);
                existing.add(key);
            }
        }
        return returned;
    };
}

function isTargetNode(node) {
    const type = node?.constructor?.comfyClass || node?.comfyClass || node?.type;
    return type === NODE_NAME;
}

function imageRefs(refs) {
    return Array.isArray(refs) ? refs.filter((ref) => ref?.filename) : [];
}

function previewImageRefs(refs) {
    return imageRefs(refs);
}

function imageKey(ref) {
    return `${ref?.type || ""}/${ref?.subfolder || ""}/${ref?.filename || ""}`;
}

function makeViewUrl(ref) {
    const params = new URLSearchParams(ref || {});
    return `/view?${params.toString()}`;
}

function loadHistory() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(HISTORY_STORAGE_KEY) || "[]");
        return previewImageRefs(parsed).slice(-HISTORY_LIMIT);
    } catch (_) {
        return [];
    }
}

function saveHistory(history) {
    try {
        sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(previewImageRefs(history).slice(-HISTORY_LIMIT)));
    } catch (_) {}
}

function rememberHistory(node, refs) {
    node._no8dHistory = node._no8dHistory || loadHistory();
    for (const ref of previewImageRefs(refs)) {
        const key = imageKey(ref);
        node._no8dHistory = node._no8dHistory.filter((item) => imageKey(item) !== key);
        node._no8dHistory.push({
            filename: ref.filename,
            subfolder: ref.subfolder || "",
            type: ref.type || "temp",
        });
    }
    node._no8dHistory = node._no8dHistory.slice(-HISTORY_LIMIT);
    saveHistory(node._no8dHistory);
}

function setImage(img, ref) {
    if (!img) return;
    if (ref?.filename) {
        const key = imageKey(ref);
        if (img._no8dLoadedKey !== key || !img.complete) {
            img.style.visibility = "hidden";
        }
        img.onload = () => {
            img.style.visibility = "visible";
            img._no8dLoadedKey = key;
        };
        img.src = makeViewUrl(ref);
        if (img.complete) {
            img.style.visibility = "visible";
            img._no8dLoadedKey = key;
        }
        img.style.display = "block";
    } else {
        img.removeAttribute("src");
        img.style.visibility = "hidden";
        img.style.display = "none";
    }
}

function renderCompare(node) {
    const els = node._no8dCompareEls;
    if (!els) return;
    syncCompareFrame(node);

    const left = node._no8dLeftRef || node._no8dCurrentRef;
    const right = node._no8dRightRef || node._no8dSelectedRef || left;
    setImage(els.before, right);
    setImage(els.after, left);

    const hasImage = Boolean(left?.filename);
    els.empty.style.display = hasImage ? "none" : "block";
    els.stage.style.display = hasImage ? "flex" : "none";
    els.swapButton.style.display = hasImage ? "flex" : "none";
    els.swapButton.title = "Swap visible images";
    els.afterClip.style.clipPath = `inset(0 ${100 - node._no8dSplit}% 0 0)`;
    els.handle.style.left = `${node._no8dSplit}%`;
}

function syncCompareFrame(node) {
    const els = node._no8dCompareEls;
    if (!els) return;

    const wrapper = els.root.closest(".dom-widget");
    if (wrapper) {
        wrapper.classList.remove("no8d-compare-widget");
        wrapper.classList.add("no8d-compare-fit-widget");
        wrapper.style.boxSizing = "border-box";
        wrapper.style.overflow = "hidden";
    }
    els.root.style.width = "100%";
    els.root.style.maxWidth = "100%";
    els.root.style.height = "100%";
}

function renderHistory(node) {
    const els = node._no8dCompareEls;
    if (!els) return;

    els.history.innerHTML = "";
    for (const ref of node._no8dHistory || []) {
        const thumb = document.createElement("img");
        thumb.src = makeViewUrl(ref);
        thumb.title = ref.filename || "";
        thumb.classList.add("no8d-compare-control");
        thumb.style.cssText = [
            "height:100%",
            "aspect-ratio:1/1",
            "object-fit:cover",
            "flex:0 0 auto",
            "box-sizing:border-box",
            "cursor:pointer",
            "background:#111",
            imageKey(ref) === imageKey(node._no8dSelectedRef) ? "border:2px solid #3b82f6" : "border:1px solid #333",
        ].join(";");
        thumb.addEventListener("pointerdown", (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
        });
        thumb.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            node._no8dSelectedRef = ref;
            node._no8dRightRef = ref;
            node._no8dFollowPrevious = imageKey(ref) === imageKey(node._no8dPreviousRef);
            renderCompare(node);
            renderHistory(node);
        });
        thumb.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation?.();
        });
        els.history.appendChild(thumb);
    }
    els.history.scrollLeft = els.history.scrollWidth;
}

async function createCompareWidget(node) {
    const root = document.createElement("div");
    root.style.cssText = [
        "width:100%",
        "max-width:100%",
        "height:100%",
        "position:relative",
        "box-sizing:border-box",
        "overflow:hidden",
        "pointer-events:none",
    ].join(";");
    root.dataset.no8dCompareRoot = "1";
    root._no8dCompareNode = node;

    const panel = document.createElement("div");
    panel.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "display:flex",
        "flex-direction:column",
        "background:#101010",
        "overflow:hidden",
        "box-sizing:border-box",
        "pointer-events:none",
    ].join(";");
    root.appendChild(panel);

    const preview = document.createElement("div");
    preview.style.cssText = [
        "position:relative",
        "flex:9 1 0",
        "min-height:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:#111",
        "overflow:hidden",
    ].join(";");

    const stage = document.createElement("div");
    stage.style.cssText = [
        "position:relative",
        "width:100%",
        "height:100%",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "overflow:hidden",
    ].join(";");

    const before = document.createElement("img");
    before.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "object-fit:contain",
        "object-position:center",
        "user-select:none",
        "pointer-events:none",
    ].join(";");

    const afterClip = document.createElement("div");
    afterClip.style.cssText = [
        "position:absolute",
        "inset:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "overflow:hidden",
        "pointer-events:none",
    ].join(";");

    const after = document.createElement("img");
    after.style.cssText = [
        "position:absolute",
        "inset:0",
        "width:100%",
        "height:100%",
        "object-fit:contain",
        "object-position:center",
        "user-select:none",
        "pointer-events:none",
    ].join(";");

    const handle = document.createElement("div");
    handle.classList.add("no8d-compare-control");
    handle.style.cssText = [
        "position:absolute",
        "top:0",
        "bottom:0",
        "width:24px",
        "transform:translateX(-12px)",
        "background:linear-gradient(90deg, transparent 11px, #58a6ff 11px, #58a6ff 13px, transparent 13px)",
        "cursor:ew-resize",
        "touch-action:none",
        "user-select:none",
        "pointer-events:auto",
        "z-index:3",
    ].join(";");

    const knob = document.createElement("div");
    knob.textContent = "\u2194";
    knob.style.cssText = [
        "position:absolute",
        "left:50%",
        "top:50%",
        "transform:translate(-50%, -50%)",
        "width:24px",
        "height:24px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "border:1px solid #58a6ff",
        "border-radius:4px",
        "background:#1f2937",
        "color:#fff",
        "font-size:14px",
        "line-height:1",
        "box-sizing:border-box",
    ].join(";");
    handle.appendChild(knob);

    const swapButton = document.createElement("button");
    swapButton.classList.add("no8d-compare-control");
    swapButton.type = "button";
    swapButton.textContent = "\u21c4";
    swapButton.style.cssText = [
        "position:absolute",
        "left:10px",
        "bottom:10px",
        "width:48px",
        "height:48px",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "border:1px solid #333",
        "border-radius:4px",
        "background:rgba(24,24,24,0.86)",
        "color:#fff",
        "font-size:36px",
        "line-height:1",
        "cursor:pointer",
        "pointer-events:auto",
        "z-index:4",
        "box-sizing:border-box",
    ].join(";");

    const empty = document.createElement("div");
    empty.textContent = "\u6ca1\u6709\u53ef\u4ee5\u5bf9\u6bd4\u7684\u56fe\u50cf";
    empty.style.cssText = "color:#ddd; font-size:12px; text-align:center;";

    const history = document.createElement("div");
    history.style.cssText = [
        "flex:1 1 0",
        "min-height:44px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "gap:12px",
        "padding:12px 10px 8px",
        "overflow-x:auto",
        "overflow-y:hidden",
        "border-top:1px solid #222",
        "background:#181818",
        "box-sizing:border-box",
    ].join(";");

    afterClip.appendChild(after);
    stage.appendChild(before);
    stage.appendChild(afterClip);
    stage.appendChild(handle);
    stage.appendChild(swapButton);
    preview.appendChild(stage);
    preview.appendChild(empty);
    panel.appendChild(preview);
    panel.appendChild(history);

    const updateSplit = (event) => {
        const rect = preview.getBoundingClientRect();
        const split = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
        node._no8dSplit = Math.min(100, Math.max(0, split));
        renderCompare(node);
    };
    let dragPointerId = null;
    const dragSplit = (event) => {
        if (event.pointerId !== dragPointerId) return;
        if (!node._no8dCurrentRef?.filename) return;
        event.preventDefault();
        event.stopPropagation();
        updateSplit(event);
    };
    const stopDragging = (event) => {
        if (event.pointerId !== dragPointerId) return;
        event.preventDefault();
        event.stopPropagation();
        try { handle.releasePointerCapture(event.pointerId); } catch (_) {}
        dragPointerId = null;
    };
    handle.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || !node._no8dCurrentRef?.filename) return;
        dragPointerId = event.pointerId;
        try { handle.setPointerCapture(event.pointerId); } catch (_) {}
        dragSplit(event);
    });
    handle.addEventListener("pointermove", dragSplit);
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
    swapButton.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
    });
    swapButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const left = node._no8dLeftRef || node._no8dCurrentRef;
        const right = node._no8dRightRef || node._no8dSelectedRef || left;
        node._no8dLeftRef = right;
        node._no8dRightRef = left;
        renderCompare(node);
    });
    node._no8dCompareEls = { root, panel, preview, stage, before, afterClip, after, handle, swapButton, empty, history };
    installNativeImageMenu(node, after);
    node._no8dSplit = 50;
    node._no8dHistory = loadHistory();
    node._no8dSelectedRef = node._no8dHistory[node._no8dHistory.length - 1] || null;

    const widget = node.addDOMWidget("no8d_compare_slider", "preview", root, {
        serialize: false,
        hideOnZoom: false,
    });
    widget.serialize = false;
    node._no8dCompareWidget = widget;
    widget.computeLayoutSize = () => ({
        minWidth: MIN_WIDTH,
        minHeight: MIN_HEIGHT,
        maxWidth: 1_000_000,
        maxHeight: 1_000_000,
    });
    const markWrapper = () => {
        syncCompareFrame(node);
    };
    markWrapper();
    requestAnimationFrame(markWrapper);

    renderHistory(node);
    if (node._no8dSelectedRef) {
        node._no8dCurrentRef = node._no8dSelectedRef;
        node._no8dPreviousRef = node._no8dSelectedRef;
        node._no8dLeftRef = node._no8dSelectedRef;
        node._no8dRightRef = node._no8dSelectedRef;
        node._no8dFollowPrevious = true;
    }
    renderCompare(node);
}

app.registerExtension({
    name: "NO8D.Control.ABPreview",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            onResize?.apply(this, arguments);
            if (!this._no8dCompareEls) return;
            syncCompareFrame(this);
            renderCompare(this);
            app.graph?.setDirtyCanvas?.(true, true);
        };
    },
    async nodeCreated(node) {
        if (!isTargetNode(node) || typeof node.addDOMWidget !== "function") return;
        await createCompareWidget(node);

        const originalOnExecuted = node.onExecuted;
        node.onExecuted = function (message) {
            originalOnExecuted?.call(this, message);
            const currentRefs = previewImageRefs(message?.a_images);
            const previousRefs = previewImageRefs(message?.b_images);
            const previousRef = previousRefs[previousRefs.length - 1] || this._no8dCurrentRef;
            const shouldFollowPrevious = !this._no8dRightRef
                || this._no8dFollowPrevious
                || imageKey(this._no8dRightRef) === imageKey(this._no8dPreviousRef);
            this._no8dCurrentRef = currentRefs[currentRefs.length - 1] || null;
            this._no8dPreviousRef = previousRef;
            this._no8dLeftRef = this._no8dCurrentRef;
            rememberHistory(this, currentRefs);
            if (shouldFollowPrevious) {
                this._no8dSelectedRef = this._no8dPreviousRef || this._no8dCurrentRef;
                this._no8dRightRef = this._no8dSelectedRef;
                this._no8dFollowPrevious = true;
            }
            renderCompare(this);
            renderHistory(this);
            requestAnimationFrame(() => {
                syncCompareFrame(this);
                renderCompare(this);
                renderHistory(this);
                app.graph?.setDirtyCanvas?.(true, true);
            });
            app.graph?.setDirtyCanvas?.(true, true);
        };
    },
});
