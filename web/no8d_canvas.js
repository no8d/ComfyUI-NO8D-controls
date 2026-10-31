import { app } from "../../scripts/app.js";

// Older WidgetLegacy bridges measure the zoomed width but leave the canvas
// height intrinsic. Use layout pixels for drawing and an explicit CSS height.
export function prepareLegacyCanvas(ctx, width, height, widget) {
    const canvas = ctx?.canvas;
    if (!globalThis.LiteGraph?.vueNodesMode || !canvas
        || canvas === app.canvas?.canvas || !canvas.parentElement) {
        releaseLegacyCanvas(widget);
        return width;
    }
    if (widget && widget.renderCanvas !== canvas) releaseLegacyCanvas(widget);
    const layoutWidth = canvas.parentElement.clientWidth || width;
    // The native bridge cancels the row's horizontal padding with a negative
    // margin. Keep this canvas inside the content box on both sides.
    const marginLeft = typeof getComputedStyle === "function"
        ? parseFloat(getComputedStyle(canvas.parentElement).marginLeft) || 0 : 0;
    canvas.style.left = `${Math.max(0, -marginLeft)}px`;
    const layoutHeight = Math.max(height + 2, canvas.parentElement.clientHeight || 0);
    canvas._no8dLayoutWidth = layoutWidth;
    canvas._no8dLayoutHeight = layoutHeight;
    const scale = ctx.getTransform().a || 2;
    canvas.style.height = `${layoutHeight}px`;
    const pixelWidth = Math.round(layoutWidth * scale);
    const pixelHeight = Math.round(layoutHeight * scale);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
    }
    if (widget) {
        if (widget.renderCanvas !== canvas) {
            widget.renderCanvas = canvas;
            if (typeof ResizeObserver !== "undefined") {
                widget._no8dCanvasResizeObserver = new ResizeObserver(() => {
                    if (globalThis.LiteGraph?.vueNodesMode && canvas.isConnected !== false) widget.triggerDraw?.();
                });
                widget._no8dCanvasResizeObserver.observe(canvas.parentElement);
            }
        }
        widget.renderHeight = layoutHeight - 2;
    }
    return layoutWidth;
}

export function releaseLegacyCanvas(widget) {
    if (!widget) return;
    widget._no8dCanvasResizeObserver?.disconnect();
    widget._no8dCanvasResizeObserver = null;
    widget.renderCanvas = null;
    widget.renderHeight = null;
}

export function legacyCanvasPosition(canvas, event, fallback) {
    if (!globalThis.LiteGraph?.vueNodesMode || !canvas || canvas === app.canvas?.canvas || !Number.isFinite(event?.clientX)
        || !Number.isFinite(event?.clientY)) return fallback;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return fallback;
    return [
        (event.clientX - rect.left) * canvas._no8dLayoutWidth / rect.width,
        (event.clientY - rect.top) * canvas._no8dLayoutHeight / rect.height,
    ];
}
