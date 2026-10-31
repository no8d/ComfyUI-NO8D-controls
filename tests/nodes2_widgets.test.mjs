import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

function loadWidget(file, className, vueNodesMode) {
    const context = vm.createContext({
        app: { registerExtension(extension) { this.extension = extension; }, graph: { setDirtyCanvas() {} }, canvas: { setDirty() {} } },
        api: {}, t: (key) => key,
        prepareLegacyCanvas: (_ctx, width) => width,
        document: { createElement: () => ({}), head: { appendChild() {} } },
        LiteGraph: { vueNodesMode },
        window: { LiteGraph: { vueNodesMode } },
    });
    const source = readFileSync(new URL(`../web/${file}`, import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "");
    vm.runInContext(`${source}\nglobalThis.Widget = ${className};`, context);
    return context;
}

test("comparison fits the supplied Nodes 2.0 widget bounds", () => {
    const { Widget } = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    const node = { size: [900, 1200] };
    const widget = new Widget(node);
    const ctx = new Proxy({}, { get: () => () => {} });
    widget.draw(ctx, node, 400, 1, 320);
    assert.deepEqual(Array.from(widget.rect), [10, 11, 380, 300]);
});

test("comparison keeps classic node-filling layout", () => {
    const { Widget } = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", false);
    const node = { size: [900, 1200] };
    const widget = new Widget(node);
    widget.draw(new Proxy({}, { get: () => () => {} }), node, 400, 80, 320);
    assert.deepEqual(Array.from(widget.rect), [10, 90, 880, 1100]);
});

test("comparison drag redraws the Vue canvas without waiting for graph draw", () => {
    const { Widget } = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    const node = {};
    const widget = node._no8dCompareWidget = new Widget(node);
    let draws = 0;
    widget.triggerDraw = () => draws++;
    widget.imageRect = [10, 10, 200, 200];
    widget.setSplitFromPos([60, 50]);
    assert.equal(node._no8dSplit, 25);
    assert.equal(draws, 1);
});

test("comparison yields to canvas pan without moving the split", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    const node = { _no8dSplit: 50, _no8dABImages: { a: { img: { naturalWidth: 200 } } } };
    const widget = node._no8dCompareWidget = new context.Widget(node);
    widget.rect = widget.imageRect = [0, 0, 200, 200];
    context.app.canvas.read_only = true;
    assert.equal(widget.mouse({ type: "pointerdown", button: 0 }, [150, 50]), false);
    assert.equal(node._no8dSplit, 50);
    context.app.canvas.read_only = false;
    assert.equal(widget.mouse({ type: "pointerdown", button: 0 }, [150, 50]), true);
    assert.equal(node._no8dSplit, 75);
    context.app.canvas._spaceKeyHeld = true;
    assert.equal(widget.mouse({ type: "pointermove", buttons: 1 }, [180, 50]), false);
    assert.equal(node._no8dSplit, 75);
    assert.equal(widget.dragging, false);
});

test("Nodes 2.0 pan forwards pointer down to the native canvas", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    context.PointerEvent = class { constructor(type, init) { this.type = type; this.clientX = init.clientX; } };
    let forwarded, stopped = false;
    context.app.canvas.canvas = { focus() {}, dispatchEvent: (event) => { forwarded = event; } };
    context.app.canvas.read_only = true;
    context.forwardCanvasPan({ type: "pointerdown", button: 0, clientX: 123,
        stopImmediatePropagation() { stopped = true; }, preventDefault() {} });
    assert.equal(stopped, true);
    assert.equal(forwarded.clientX, 123);
});

test("starting a comparison drag focuses LiteGraph before space is pressed", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    let focused = false, prevented = false;
    context.app.canvas.canvas = { focus(options) { focused = options.preventScroll; } };
    context.forwardCanvasPan({ type: "pointerdown", button: 0,
        preventDefault() { prevented = true; } });
    assert.equal(focused, true);
    assert.equal(prevented, true, "the browser must not move focus back to the preview");
});

test("holding space during split drag transfers the gesture to canvas pan", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    context.PointerEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
    const node = { _no8dSplit: 60, _no8dABDragging: true };
    const widget = node._no8dCompareWidget = new context.Widget(node);
    widget.dragging = true;
    const forwarded = [];
    context.app.canvas.canvas = { dispatchEvent: (event) => forwarded.push(event) };
    const move = { type: "pointermove", button: -1, buttons: 1, clientX: 180, clientY: 90,
        pointerId: 7, pointerType: "mouse", isPrimary: true,
        stopImmediatePropagation() {}, preventDefault() {} };
    context.forwardCanvasPan(move, node);
    assert.equal(forwarded.length, 0, "ordinary split dragging stays in the widget");
    context.app.canvas._spaceKeyHeld = true;
    context.forwardCanvasPan(move, node);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].type, "pointerdown");
    assert.equal(forwarded[0].button, 0);
    assert.equal(forwarded[0].pointerId, 7);
    assert.equal(forwarded[0].clientX, 180);
    assert.equal(node._no8dSplit, 60);
    assert.equal(widget.dragging, false);
    context.forwardCanvasPan(move, node);
    assert.equal(forwarded.length, 1, "handoff starts the native gesture only once");
});

test("releasing space while holding the mouse returns capture to comparison", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    context.PointerEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
    const listeners = new Map(), events = [];
    context.window.addEventListener = (type, handler) => listeners.set(type, handler);
    context.window.removeEventListener = (type) => listeners.delete(type);
    context.app.canvas.canvas = { dispatchEvent: (event) => events.push(["canvas", event.type]) };
    const node = { _no8dABDragging: true };
    const widget = node._no8dCompareWidget = new context.Widget(node);
    widget.renderCanvas = { dispatchEvent: (event) => events.push(["preview", event.type]) };
    const move = { type: "pointermove", button: -1, buttons: 1, pointerId: 7,
        clientX: 150, clientY: 80, stopImmediatePropagation() {}, preventDefault() {} };
    context.app.canvas._spaceKeyHeld = true;
    context.forwardCanvasPan(move, node);
    assert.equal(listeners.size, 3);
    widget.resumeSplitDrag(move);
    assert.equal(events.length, 1, "holding space continues native panning");
    context.app.canvas._spaceKeyHeld = null;
    widget.resumeSplitDrag(move);
    assert.deepEqual(events, [["canvas", "pointerdown"], ["canvas", "pointerup"], ["preview", "pointerdown"]]);
    assert.equal(listeners.size, 0);
    assert.equal(widget.panPointerId, null);
});

test("releasing the mouse during pan ends tracking without restarting comparison", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    let removed = 0;
    context.window.removeEventListener = () => removed++;
    const widget = new context.Widget({});
    widget.panPointerId = 3;
    widget.resumeSplitDrag({ type: "pointerup", buttons: 0, pointerId: 3 });
    assert.equal(widget.panPointerId, null);
    assert.equal(removed, 3);
});

test("crop movement saves state and redraws the Vue canvas", () => {
    const { Widget } = loadWidget("image_size.js", "ImageSizeCanvasWidget", true);
    const widget = new Widget({ widgets: [] }, "crop_canvas", "custom");
    let draws = 0;
    widget.triggerDraw = () => draws++;
    widget.setState("crop", 0.25, 0.75, 0.5);
    assert.deepEqual(JSON.parse(widget.value).crop, { x: 0.25, y: 0.75, scale: 0.5 });
    assert.equal(draws, 1);
});

test("bypass refresh follows the native mode setter without a canvas frame", () => {
    const context = vm.createContext({});
    const source = readFileSync(new URL("../web/no8d_bypass.js", import.meta.url), "utf8")
        .replace(/^export /gm, "");
    vm.runInContext(source, context);
    class NativeNode {
        get mode() { return this._mode ?? 0; }
        set mode(value) { this._mode = value; this.nativeWrites = (this.nativeWrites || 0) + 1; }
    }
    class CustomNode extends NativeNode {}
    let refreshes = 0;
    context.wrapBypassRefresh(CustomNode, () => refreshes++);
    const node = new CustomNode();
    node.mode = 4;
    assert.equal(node.mode, 4);
    assert.equal(node.nativeWrites, 1);
    assert.equal(refreshes, 1);
    node.mode = 0;
    assert.equal(node.mode, 0);
    assert.equal(refreshes, 2);
});

test("zoomed Vue canvas uses layout width and an explicit layout height", () => {
    const context = vm.createContext({ app: { canvas: { canvas: {} } }, LiteGraph: { vueNodesMode: true } });
    const source = readFileSync(new URL("../web/no8d_canvas.js", import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    vm.runInContext(source, context);
    const canvas = { parentElement: { clientWidth: 576 }, width: 518, style: {} };
    let transform;
    const ctx = { canvas, getTransform: () => ({ a: 2 }), setTransform: (...args) => { transform = args; } };
    assert.equal(context.prepareLegacyCanvas(ctx, 259, 330), 576);
    assert.equal(canvas.width, 1152);
    assert.equal(canvas.style.height, "332px");
    assert.deepEqual(transform, [2, 0, 0, 2, 0, 0]);
    canvas.getBoundingClientRect = () => ({ left: 100, top: 200, width: 288, height: 166 });
    const event = { clientX: 172, clientY: 283 };
    const down = context.legacyCanvasPosition(canvas, event, [144, 166]);
    const up = context.legacyCanvasPosition(canvas, event, [144, 900]);
    assert.deepEqual(Array.from(down), [144, 166]);
    assert.deepEqual(Array.from(up), Array.from(down), "pointerup ignores the bridge's graph-relative fallback");
    context.LiteGraph.vueNodesMode = false;
    assert.equal(context.prepareLegacyCanvas(ctx, 259, 330), 259, "classic rendering keeps its supplied width");
    assert.deepEqual(Array.from(context.legacyCanvasPosition(canvas, event, [144, 900])), [144, 900]);
});

test("image-size source preview survives workflow property serialization", async () => {
    const context = loadWidget("image_size.js", "ImageSizeCanvasWidget", true);
    class Node {}
    await context.app.extension.beforeRegisterNodeDef(Node, { name: "NO8DImageSize" });
    const ref = { filename: "source.png", type: "temp", subfolder: "" };
    const node = new Node();
    node._no8dImageSizeCanvas = { setPreview: async () => {} };
    node.onExecuted({ source_images: [ref] });
    const restored = { type: "NO8DImageSize", widgets: [], properties: JSON.parse(JSON.stringify(node.properties)) };
    let restoredRef;
    restored._no8dImageSizeCanvas = { setPreview: async (value) => { restoredRef = value; } };
    context.activate(restored);
    assert.deepEqual(restoredRef, ref);
});

test("Vue canvas follows stretched row height, shrinks, and releases resize tracking", () => {
    let resize;
    let disconnected = 0;
    let draws = 0;
    const context = vm.createContext({
        app: { canvas: { canvas: {} } }, LiteGraph: { vueNodesMode: true },
        getComputedStyle: () => ({ marginLeft: "-12px" }),
        ResizeObserver: class {
            constructor(callback) { resize = callback; }
            observe() {}
            disconnect() { disconnected++; }
        },
    });
    const source = readFileSync(new URL("../web/no8d_canvas.js", import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    vm.runInContext(source, context);
    const row = { clientWidth: 600, clientHeight: 800 };
    const canvas = { parentElement: row, width: 1200, height: 644, style: {} };
    const ctx = { canvas, getTransform: () => ({ a: 2 }), setTransform() {} };
    const widget = { triggerDraw: () => draws++ };
    context.prepareLegacyCanvas(ctx, 600, 320, widget);
    assert.equal(canvas.height, 1600);
    assert.equal(canvas.style.left, "12px", "native negative margin is neutralized for symmetric content insets");
    assert.equal(widget.renderHeight, 798);
    assert.equal(canvas.style.height, "800px");
    row.clientHeight = 450;
    resize();
    assert.equal(draws, 1, "height-only resize requests a fresh draw");
    context.prepareLegacyCanvas(ctx, 600, 320, widget);
    assert.equal(canvas.height, 900);
    assert.equal(widget.renderHeight, 448);
    assert.equal(row.clientHeight, 450, "drawing never writes the row's layout height");
    context.releaseLegacyCanvas(widget);
    assert.equal(disconnected, 1);
});

test("comparison restores native cached outputs for root and subgraph nodes", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    context.URLSearchParams = URLSearchParams;
    context.api.apiURL = (url) => url;
    let loaded = 0;
    context.Image = class {
        set src(value) { this.url = value; this.naturalWidth = 64; this.naturalHeight = 32; this.onload?.(); loaded++; }
    };
    const createNode = (id) => ({ id, type: "NO8DABPreview", widgets: [],
        addCustomWidget(widget) { this.widgets.push(widget); return widget; } });
    const root = createNode(1), nested = createNode(3);
    context.app.rootGraph = { getNodeById: (id) => id === "1" ? root : id === "2" ? { subgraph: { getNodeById: () => nested } } : null };
    const ref = { filename: "cached.png", type: "temp", subfolder: "" };
    context.app.extension.onNodeOutputsUpdated({ "1": { a_images: [ref] }, "2:3": { a_images: [ref], b_images: [ref] } });
    assert.equal(root.imgs.length, 1, "even an immediately decoded cached image reaches native state");
    assert.equal(nested.imgs.length, 2);
    assert.equal(nested.properties.no8d_ab_preview.a.filename, "cached.png");
    assert.equal(loaded, 2, "matching A/B references share a decoded image");
});



test("comparison activation restores outputs that arrived before node creation", () => {
    const context = loadWidget("compare_slider_preview.js", "NO8DCompareWidget", true);
    context.URLSearchParams = URLSearchParams;
    context.api.apiURL = (url) => url;
    context.Image = class { set src(value) { this.naturalWidth = 64; this.onload?.(); } };
    const output = { a_images: [{ filename: "early.png", type: "temp" }] };
    context.app.nodeOutputs = { "1": output };
    let node;
    context.app.rootGraph = { getNodeById: () => node };
    context.app.extension.onNodeOutputsUpdated(context.app.nodeOutputs);
    node = { id: 1, type: "NO8DABPreview", widgets: [], addCustomWidget(widget) { return widget; } };
    context.activateNode(node);
    assert.equal(node._no8dABImages.a.ref.filename, "early.png");
    assert.equal(node.imgs.length, 1);
});

test("image loader hides internal values without converting them to sockets", () => {
    const context = vm.createContext({ app: { registerExtension() {} }, Set });
    const source = readFileSync(new URL("../web/image_loader_i18n.js", import.meta.url), "utf8")
        .replace(/^import .*;\r?\n/gm, "");
    vm.runInContext(source, context);
    const widgets = ["image_files", "output_files", "crop_multiple"].map((name) => ({ name, type: "converted-widget", value: name === "crop_multiple" ? "16" : "[]" }));
    context.hideInternalWidgets({ widgets });
    for (const widget of widgets) {
        assert.equal(widget.type, "hidden");
        assert.equal(widget.hidden, true);
        assert.equal(widget.serialize, true, "internal values still reach saved workflows and the backend");
    }
    assert.equal(widgets[2].value, "16");
});
