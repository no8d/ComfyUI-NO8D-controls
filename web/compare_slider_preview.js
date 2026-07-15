import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DABPreview";
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;
const EDGE_PAD = 10;
const NATIVE_PREVIEW_WIDGET = "$$canvas-image-preview";
const EMPTY_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
const BADGE_HEIGHT = 22;
const BADGE_INSET = 8;
const BADGE_GAP = 6;
const FOOTER_HEIGHT = 32;

const legacyDomStyle = document.createElement("style");
legacyDomStyle.textContent = `
    .dom-widget.no8d-compare-fit-widget,
    .dom-widget.no8d-compare-widget {
        pointer-events: none !important;
        overflow: hidden !important;
    }
`;
document.head.appendChild(legacyDomStyle);

function isTargetNode(node) {
    const type = node?.constructor?.comfyClass || node?.comfyClass || node?.type;
    return type === NODE_NAME;
}

function imageRefs(refs) {
    return Array.isArray(refs) ? refs.filter((ref) => ref?.filename) : [];
}

function imageRefsFromMessage(message, key) {
    if (!message || typeof message !== "object") return [];
    const direct = imageRefs(message[key]);
    if (direct.length) return direct;
    const uiRefs = imageRefs(message.ui?.[key]);
    if (uiRefs.length) return uiRefs;
    const outputRefs = imageRefs(message.output?.[key]);
    if (outputRefs.length) return outputRefs;
    for (const value of Object.values(message)) {
        if (value && typeof value === "object") {
            const nested = imageRefsFromMessage(value, key);
            if (nested.length) return nested;
        }
    }
    return [];
}

function imageKey(ref) {
    return `${ref?.type || ""}/${ref?.subfolder || ""}/${ref?.filename || ""}`;
}

function makeViewUrl(ref) {
    const params = new URLSearchParams(ref || {});
    return api.apiURL(`/view?${params.toString()}`);
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function fitRect(img, rect) {
    const naturalWidth = img?.naturalWidth || img?.width;
    const naturalHeight = img?.naturalHeight || img?.height;
    if (!naturalWidth || !naturalHeight) return null;
    const [, , boxW, boxH] = rect;
    const scale = Math.min(boxW / naturalWidth, boxH / naturalHeight);
    const w = Math.max(1, naturalWidth * scale);
    const h = Math.max(1, naturalHeight * scale);
    return [
        rect[0] + (boxW - w) / 2,
        rect[1] + (boxH - h) / 2,
        w,
        h,
    ];
}

function drawContainedImage(ctx, img, rect) {
    const fit = fitRect(img, rect);
    if (!fit) return null;
    ctx.drawImage(img, fit[0], fit[1], fit[2], fit[3]);
    return fit;
}

function imageDimensionLabel(entry, side) {
    const width = Number(entry?.img?.naturalWidth) || 0;
    const height = Number(entry?.img?.naturalHeight) || 0;
    return width && height ? `${side} · ${width} × ${height}` : "";
}

function drawDimensionBadge(ctx, entry, side, rect, align, maxWidth) {
    const label = imageDimensionLabel(entry, side);
    if (!label) return null;
    ctx.font = "12px sans-serif";
    const badgeWidth = Math.min(ctx.measureText(label).width + 14, maxWidth);
    const x = align === "right"
        ? rect[0] + rect[2] - badgeWidth - BADGE_INSET
        : rect[0] + BADGE_INSET;
    const y = rect[1] + (rect[3] - BADGE_HEIGHT) / 2;
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.beginPath();
    ctx.roundRect?.(x, y, badgeWidth, BADGE_HEIGHT, 5);
    if (!ctx.roundRect) ctx.rect(x, y, badgeWidth, BADGE_HEIGHT);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + badgeWidth / 2, y + BADGE_HEIGHT / 2, Math.max(1, badgeWidth - 10));
    return [x, y, badgeWidth, BADGE_HEIGHT];
}

function releaseDecodedImage(img) {
    if (!img) return;
    img.onload = null;
    img.onerror = null;
    try {
        img.src = EMPTY_IMAGE_SRC;
    } catch (_) {}
}

function imageUsedOutsideSlot(node, slot, img) {
    const images = node?._no8dABImages || {};
    return Object.entries(images).some(([key, entry]) => key !== slot && entry?.img === img);
}

function releasePreviewEntry(node, slot, entry) {
    if (!entry) return;
    if (entry.img && !imageUsedOutsideSlot(node, slot, entry.img)) releaseDecodedImage(entry.img);
}

function releaseUniqueEntry(entry) {
    if (!entry) return;
    if (entry.img) releaseDecodedImage(entry.img);
}

function loadPreviewImage(node, slot, ref) {
    const key = ref?.filename ? imageKey(ref) : "";
    node._no8dABImages = node._no8dABImages || {};
    const oldEntry = node._no8dABImages[slot];
    if (!key) {
        node._no8dABImages[slot] = null;
        releasePreviewEntry(node, slot, oldEntry);
        syncNativeImageState(node);
        return;
    }
    if (oldEntry?.key === key) return;
    const reusable = Object.entries(node._no8dABImages)
        .find(([otherSlot, entry]) => otherSlot !== slot && entry?.key === key)?.[1];
    if (reusable) {
        node._no8dABImages[slot] = reusable;
        releasePreviewEntry(node, slot, oldEntry);
        syncNativeImageState(node);
        app.graph?.setDirtyCanvas?.(true, false);
        return;
    }
    const img = new Image();
    img.onload = () => {
        const entry = node._no8dABImages?.[slot];
        if (entry?.key !== key) return;
        syncNativeImageState(node);
        app.graph?.setDirtyCanvas?.(true, true);
    };
    img.onerror = () => {
        if (node._no8dABImages?.[slot]?.key === key) {
            node._no8dABImages[slot] = null;
            syncNativeImageState(node);
        }
        app.graph?.setDirtyCanvas?.(true, true);
    };
    img.src = makeViewUrl(ref);
    node._no8dABImages[slot] = { key, ref, img };
    releasePreviewEntry(node, slot, oldEntry);
}

function suppressNativePreviewWidget(node) {
    if (!node) return;
    node.preview = undefined;
    const widgets = node.widgets || [];
    const index = widgets.findIndex((widget) => widget?.name === NATIVE_PREVIEW_WIDGET);
    if (index >= 0) {
        widgets[index].onRemove?.();
        widgets.splice(index, 1);
    }
}

function syncNativeImageState(node) {
    if (!node) return;
    suppressNativePreviewWidget(node);
    const images = node._no8dABImages || {};
    const entries = [images.a, images.b].filter((entry) => entry?.img?.naturalWidth);
    node.imgs = entries.map((entry) => entry.img);
    node.images = entries.map((entry) => entry.ref);
    if (!node.imgs.length) {
        node.imageIndex = 0;
    } else if (node.imageIndex == null || node.imageIndex >= node.imgs.length) {
        node.imageIndex = 0;
    }
}

function clearNativeImageState(node) {
    if (!node) return;
    suppressNativePreviewWidget(node);
    node.imgs = undefined;
    node.images = undefined;
    node.imageIndex = 0;
}

function persistPreviewRefs(node) {
    const images = node?._no8dABImages || {};
    node.properties = node.properties || {};
    node.properties.no8d_ab_preview = {
        a: images.a?.ref ? { ...images.a.ref } : null,
        b: images.b?.ref ? { ...images.b.ref } : null,
    };
}

function setPreviousSingleRef(node, ref) {
    node._no8dABPreviousSingleRef = ref?.filename ? { ...ref } : null;
}

function listLength(node) {
    const lists = node?._no8dABRefLists || {};
    return Math.max(lists.a?.length || 0, lists.b?.length || 0);
}

function refAt(list, index) {
    if (!Array.isArray(list) || !list.length) return null;
    if (index < 0) return null;
    return list[Math.min(Math.max(0, index), list.length - 1)];
}

function applyListIndex(node, index) {
    const total = listLength(node);
    if (!total) return;
    node._no8dABListIndex = clamp(index, 0, total - 1);
    const lists = node._no8dABRefLists || {};
    const aList = lists.a || [];
    const bList = lists.b || [];
    const onlyA = aList.length > 1 && !bList.length;
    const onlyB = bList.length > 1 && !aList.length;
    const currentA = onlyB ? refAt(bList, node._no8dABListIndex - 1) : refAt(aList, node._no8dABListIndex);
    const currentB = onlyA ? refAt(aList, node._no8dABListIndex - 1) : refAt(bList, node._no8dABListIndex);
    if (currentA) loadPreviewImage(node, "a", currentA);
    else loadPreviewImage(node, "a", null);
    if (currentB) loadPreviewImage(node, "b", currentB);
    else loadPreviewImage(node, "b", null);
}

function restorePreviewRefs(node) {
    const refs = node?.properties?.no8d_ab_preview;
    if (!refs) return;
    if (refs.a?.filename) loadPreviewImage(node, "a", refs.a);
    if (refs.b?.filename) loadPreviewImage(node, "b", refs.b);
}

function selectNativeImageAt(node, pos) {
    const widget = node?._no8dCompareWidget;
    const images = node?._no8dABImages || {};
    const hasA = Boolean(images.a?.img?.naturalWidth);
    const hasB = Boolean(images.b?.img?.naturalWidth);
    if (!widget || (!hasA && !hasB)) return;

    if (hasA && hasB) {
        const rect = widget.imageRect || widget.rect;
        const splitX = rect[0] + rect[2] * (node._no8dSplit ?? 50) / 100;
        node.imageIndex = pos[0] <= splitX ? 0 : 1;
    } else {
        node.imageIndex = 0;
    }
    node.overIndex = node.imageIndex;
}

function receivePreviewRefs(node, message) {
    if (!node || !message) return;
    const aRefs = imageRefsFromMessage(message, "a_images");
    const bRefs = imageRefsFromMessage(message, "b_images");
    const total = Math.max(aRefs.length, bRefs.length);

    if (total > 1) {
        node._no8dABRefLists = {
            a: aRefs.map((ref) => ({ ...ref })),
            b: bRefs.map((ref) => ({ ...ref })),
        };
        applyListIndex(node, total - 1);
        if (!bRefs.length && aRefs.length) setPreviousSingleRef(node, aRefs[aRefs.length - 1]);
        else if (!aRefs.length && bRefs.length) setPreviousSingleRef(node, bRefs[bRefs.length - 1]);
        persistPreviewRefs(node);
        app.graph?.setDirtyCanvas?.(true, true);
        return;
    }

    node._no8dABRefLists = null;
    node._no8dABListIndex = 0;
    const currentA = aRefs[0];
    const currentB = bRefs[0];

    if (currentA && currentB) {
        loadPreviewImage(node, "a", currentA);
        loadPreviewImage(node, "b", currentB);
    } else if (currentA) {
        const previous = node._no8dABPreviousSingleRef;
        loadPreviewImage(node, "b", previous);
        loadPreviewImage(node, "a", currentA);
        setPreviousSingleRef(node, currentA);
    } else if (currentB) {
        const previous = node._no8dABPreviousSingleRef;
        loadPreviewImage(node, "a", previous);
        loadPreviewImage(node, "b", currentB);
        setPreviousSingleRef(node, currentB);
    }
    persistPreviewRefs(node);
    app.graph?.setDirtyCanvas?.(true, true);
}

function hasComparableImages(node) {
    const images = node?._no8dABImages || {};
    return Boolean(images.a?.img?.naturalWidth || images.b?.img?.naturalWidth);
}

function pointInRect(pos, rect) {
    if (!rect) return false;
    if (pos[0] < rect[0] || pos[0] > rect[0] + rect[2]) return false;
    if (pos[1] < rect[1] || pos[1] > rect[1] + rect[3]) return false;
    return true;
}

function isPrimaryButtonDown(event) {
    return Boolean((event?.buttons ?? 1) & 1);
}

function updateNodeSplit(node, pos) {
    const widget = node?._no8dCompareWidget;
    if (!widget || !hasComparableImages(node)) return false;
    return widget.setSplitFromPos(pos);
}

function startSplitDrag(node, event, pos) {
    const widget = node?._no8dCompareWidget;
    if (!widget || event?.button !== 0 || !pointInRect(pos, widget.rect) || !hasComparableImages(node)) return false;
    node._no8dABDragging = true;
    widget.dragging = true;
    updateNodeSplit(node, pos);
    return true;
}

function continueSplitDrag(node, event, pos) {
    const widget = node?._no8dCompareWidget;
    if (!widget) return false;
    if (!isPrimaryButtonDown(event)) {
        node._no8dABDragging = false;
        widget.dragging = false;
        return pointInRect(pos, widget.rect);
    }
    if (!node._no8dABDragging && !widget.dragging) return pointInRect(pos, widget.rect);
    node._no8dABDragging = true;
    widget.dragging = true;
    updateNodeSplit(node, pos);
    return true;
}

function stopSplitDrag(node) {
    const widget = node?._no8dCompareWidget;
    const wasDragging = Boolean(node?._no8dABDragging || widget?.dragging);
    if (node) node._no8dABDragging = false;
    if (widget) widget.dragging = false;
    return wasDragging;
}

class NO8DCompareWidget {
    constructor(node) {
        this.type = "custom";
        this.name = "no8d_ab_preview";
        this.options = {};
        this.value = "";
        this.node = node;
        this.dragging = false;
        this.rect = [0, 0, MIN_WIDTH, MIN_HEIGHT];
        this.imageRect = null;
    }

    computeSize(width) {
        return [Math.max(MIN_WIDTH, width), MIN_HEIGHT];
    }

    setSplitFromPos(pos) {
        const rect = this.imageRect || this.rect;
        if (!rect?.[2]) return false;
        this.node._no8dSplit = ((pos[0] - rect[0]) / rect[2]) * 100;
        app.graph?.setDirtyCanvas?.(true, false);
        return true;
    }

    drawComparison(ctx, baseRect, splitX, a, b, hasA, hasB) {
        const imageLeft = baseRect[0];
        const imageRight = baseRect[0] + baseRect[2];
        const clippedSplitX = clamp(splitX, imageLeft, imageRight);

        if (hasB) {
            ctx.save();
            if (!hasA) {
                ctx.beginPath();
                ctx.rect(clippedSplitX, baseRect[1], imageRight - clippedSplitX, baseRect[3]);
                ctx.clip();
            }
            drawContainedImage(ctx, b, baseRect);
            ctx.restore();
        }
        if (hasA && clippedSplitX > imageLeft) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(imageLeft, baseRect[1], clippedSplitX - imageLeft, baseRect[3]);
            ctx.clip();
            drawContainedImage(ctx, a, baseRect);
            ctx.restore();
        }
        if (splitX >= imageLeft && splitX <= imageRight) {
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(splitX, baseRect[1]);
            ctx.lineTo(splitX, baseRect[1] + baseRect[3]);
            ctx.stroke();
        }
    }

    nodePosFromEventPos(pos) {
        if (!Array.isArray(pos)) return pos;
        if (pointInRect(pos, this.rect)) return pos;
        return [pos[0] + this.rect[0], pos[1] + this.rect[1]];
    }

    mouse(event, pos) {
        const nodePos = this.nodePosFromEventPos(pos);
        const type = String(event?.type || "");
        if (type.includes("contextmenu") || (type.includes("down") && event.button !== 0)) {
            return false;
        }
        if (type.includes("down") && event.button === 0 && pointInRect(nodePos, this.pageRect)) {
            const total = listLength(this.node);
            if (total > 1) {
                applyListIndex(this.node, ((Number(this.node._no8dABListIndex) || 0) + 1) % total);
                persistPreviewRefs(this.node);
                app.graph?.setDirtyCanvas?.(true, true);
                return true;
            }
        }
        if (type.includes("up") || type.includes("cancel")) {
            return stopSplitDrag(this.node);
        }
        if (!pointInRect(nodePos, this.rect)) {
            if (type.includes("move")) return continueSplitDrag(this.node, event, nodePos);
            return Boolean(this.dragging);
        }
        if (type.includes("down") && event.button === 0) {
            return startSplitDrag(this.node, event, nodePos);
        }
        if (type.includes("move")) {
            return continueSplitDrag(this.node, event, nodePos);
        }
        return Boolean(this.dragging);
    }

    draw(ctx, node, width, y) {
        const fullWidth = node.size?.[0] || width;
        const fullHeight = node.size?.[1] || MIN_HEIGHT;
        const rect = [
            EDGE_PAD,
            y + EDGE_PAD,
            Math.max(1, fullWidth - EDGE_PAD * 2),
            Math.max(1, fullHeight - y - EDGE_PAD * 2),
        ];
        this.rect = rect;
        this.imageRect = null;

        ctx.save();
        ctx.fillStyle = "#101010";
        ctx.fillRect(rect[0], rect[1], rect[2], rect[3]);

        const images = node._no8dABImages || {};
        const aEntry = images.a;
        const bEntry = images.b;
        const a = aEntry?.img;
        const b = bEntry?.img;
        const hasA = Boolean(aEntry?.img?.naturalWidth);
        const hasB = Boolean(bEntry?.img?.naturalWidth);

        if (!hasA && !hasB) {
            ctx.fillStyle = "#ddd";
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(t("abNoComparableImage"), rect[0] + rect[2] / 2, rect[1] + rect[3] / 2);
            ctx.restore();
            return;
        }

        const imageAreaHeight = Math.max(1, rect[3] - FOOTER_HEIGHT);
        const imageAreaRect = [rect[0], rect[1], rect[2], imageAreaHeight];
        const footerRect = [rect[0], rect[1] + imageAreaHeight, rect[2], FOOTER_HEIGHT];
        const baseRect = fitRect(a || b, imageAreaRect) || imageAreaRect;
        this.imageRect = baseRect;
        const splitX = baseRect[0] + baseRect[2] * (node._no8dSplit ?? 50) / 100;
        this.drawComparison(ctx, baseRect, splitX, a, b, hasA, hasB);
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(footerRect[0], footerRect[1] + 0.5);
        ctx.lineTo(footerRect[0] + footerRect[2], footerRect[1] + 0.5);
        ctx.stroke();
        const total = listLength(node);
        ctx.font = "12px sans-serif";
        const pageLabel = total > 1 ? `${(Number(node._no8dABListIndex) || 0) + 1}/${total}` : "";
        const pageBadgeWidth = pageLabel ? ctx.measureText(pageLabel).width + 14 : 0;
        const centerReserve = pageBadgeWidth ? pageBadgeWidth + BADGE_GAP * 2 : BADGE_GAP;
        const splitFooterSpace = (hasA && hasB) || pageBadgeWidth > 0;
        const dimensionBadgeMaxWidth = splitFooterSpace
            ? Math.max(1, (footerRect[2] - BADGE_INSET * 2 - centerReserve) / 2)
            : Math.max(1, footerRect[2] - BADGE_INSET * 2 - centerReserve);
        if (hasA) drawDimensionBadge(ctx, aEntry, "A", footerRect, "left", dimensionBadgeMaxWidth);
        if (hasB) drawDimensionBadge(ctx, bEntry, "B", footerRect, "right", dimensionBadgeMaxWidth);
        if (total > 1) {
            const labelWidth = pageBadgeWidth;
            const labelHeight = BADGE_HEIGHT;
            const x = footerRect[0] + (footerRect[2] - labelWidth) / 2;
            const yPos = footerRect[1] + (footerRect[3] - labelHeight) / 2;
            this.pageRect = [x, yPos, labelWidth, labelHeight];
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.beginPath();
            ctx.roundRect?.(x, yPos, labelWidth, labelHeight, 5);
            if (!ctx.roundRect) ctx.rect(x, yPos, labelWidth, labelHeight);
            ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(pageLabel, x + labelWidth / 2, yPos + labelHeight / 2);
        } else {
            this.pageRect = null;
        }
        ctx.restore();
    }
}

function installWidget(node) {
    if (node._no8dCompareWidget || typeof node.addCustomWidget !== "function") return;
    node._no8dSplit = node._no8dSplit ?? 50;
    node._no8dCompareWidget = node.addCustomWidget(new NO8DCompareWidget(node));
    node.size = node.size || [MIN_WIDTH, MIN_HEIGHT];
    node.size[0] = Math.max(node.size[0] || MIN_WIDTH, MIN_WIDTH);
    node.size[1] = Math.max(node.size[1] || MIN_HEIGHT, MIN_HEIGHT);
}

function syncWidgetLabels(node) {
    const autoOutput = (node.widgets || []).find((widget) => widget?.name === "auto_output");
    if (!autoOutput) return;
    const label = t("abAutoOutput");
    autoOutput.label = label;
    autoOutput.options = autoOutput.options || {};
    autoOutput.options.label = label;
}

function orderWidgets(node) {
    if (!Array.isArray(node.widgets)) return;
    const previewIndex = node.widgets.findIndex((widget) => widget === node._no8dCompareWidget);
    const autoOutputIndex = node.widgets.findIndex((widget) => widget?.name === "auto_output");
    if (previewIndex < 0 || autoOutputIndex < 0 || autoOutputIndex < previewIndex) return;
    const [autoOutput] = node.widgets.splice(autoOutputIndex, 1);
    node.widgets.splice(previewIndex, 0, autoOutput);
}

function removeLegacyDomWidgets(node) {
    if (!node) return;
    if (node._no8dCompareEls?.root) {
        node._no8dCompareEls.root.remove?.();
        node._no8dCompareEls = null;
    }
    if (!Array.isArray(node.widgets)) return;
    node.widgets = node.widgets.filter((widget) => {
        if (widget?.name !== "no8d_compare_slider") return true;
        widget.element?.remove?.();
        widget.inputEl?.remove?.();
        widget.domElement?.remove?.();
        return false;
    });
}

function activateNode(node) {
    if (!isTargetNode(node)) return;
    if (node.properties) delete node.properties.no8d_ab_previous_single;
    suppressNativePreviewWidget(node);
    removeLegacyDomWidgets(node);
    syncWidgetLabels(node);
    installWidget(node);
    orderWidgets(node);
    restorePreviewRefs(node);
    syncNativeImageState(node);
}

function disposeNode(node) {
    if (!node) return;
    const images = node._no8dABImages || {};
    for (const entry of new Set([images.a, images.b].filter(Boolean))) {
        releaseUniqueEntry(entry);
    }
    removeLegacyDomWidgets(node);
    clearNativeImageState(node);
    node._no8dABImages = {};
    node._no8dABRefLists = {};
    node._no8dABPreviousSingleRef = null;
    node._no8dABDragging = false;
    node._no8dCompareWidget = null;
}

app.registerExtension({
    name: "NO8D.Control.ABPreview",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            activateNode(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => activateNode(this), 0);
        };
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            disposeNode(this);
            onRemoved?.apply(this, arguments);
        };
        const onResize = nodeType.prototype.onResize;
        nodeType.prototype.onResize = function () {
            removeLegacyDomWidgets(this);
            onResize?.apply(this, arguments);
            activateNode(this);
            app.graph?.setDirtyCanvas?.(true, true);
        };
        const onDrawBackground = nodeType.prototype.onDrawBackground;
        nodeType.prototype.onDrawBackground = function () {
            const imgs = this.imgs;
            const images = this.images;
            this.imgs = undefined;
            this.images = undefined;
            try {
                return onDrawBackground?.apply(this, arguments);
            } finally {
                this.imgs = imgs;
                this.images = images;
            }
        };
        const onMouseDown = nodeType.prototype.onMouseDown;
        nodeType.prototype.onMouseDown = function (event, pos) {
            if (isTargetNode(this) && event?.button === 2) selectNativeImageAt(this, pos);
            if (isTargetNode(this) && startSplitDrag(this, event, pos)) return true;
            return onMouseDown?.apply(this, arguments);
        };
        const onMouseMove = nodeType.prototype.onMouseMove;
        nodeType.prototype.onMouseMove = function (event, pos) {
            if (isTargetNode(this) && continueSplitDrag(this, event, pos)) return true;
            return onMouseMove?.apply(this, arguments);
        };
        const onMouseUp = nodeType.prototype.onMouseUp;
        nodeType.prototype.onMouseUp = function () {
            if (isTargetNode(this) && stopSplitDrag(this)) return true;
            return onMouseUp?.apply(this, arguments);
        };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            removeLegacyDomWidgets(this);
            if (!isTargetNode(this)) onExecuted?.apply(this, arguments);
            activateNode(this);
            receivePreviewRefs(this, message);
        };
    },
    async nodeCreated(node) {
        activateNode(node);
    },
});
