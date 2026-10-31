import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "web", "generate.js");
const source = fs.readFileSync(sourcePath, "utf8")
    .replace(/^import .*?;\r?\n/gm, "");
const canvasSource = fs.readFileSync(path.join(root, "web", "no8d_canvas.js"), "utf8")
    .replace(/^import .*?;\r?\n/gm, "").replace(/^export /gm, "");

function loadGenerateHelpers(app) {
    const api = { apiURL: (value) => value };
    const registerBypassElement = () => {};
    const factory = new Function(
        "app",
        "api",
        "shouldPassKeyToComfy",
        "no8dLocale",
        "t",
        "refreshBypassElements",
        "registerBypassElement",
        "wrapBypassRefresh",
        "requestAnimationFrame",
        `${canvasSource}\n${source}\nreturn { applyGeneratePreview, NO8DGenerateCanvasWidget, setCursorDirty, setDirty };`,
    );
    return factory(
        app,
        api,
        () => false,
        () => "en",
        (value) => value,
        () => {},
        registerBypassElement,
        () => {},
        (callback) => callback(),
    );
}

const drawCalls = [];
const dirtyCalls = [];
const graphCanvasStyle = {
    setProperty: () => {},
    removeProperty: () => {},
};
const node = {
    type: "NO8DGenerate",
    _no8dGenerateCanvas: {
        triggerDraw: () => drawCalls.push("draw"),
        setPreview: async () => {},
    },
};
const unrelatedNode = {
    type: "OtherNode",
    _no8dGenerateCanvas: { triggerDraw: () => drawCalls.push("wrong") },
};
const app = {
    canvas: { canvas: { style: graphCanvasStyle } },
    graph: {
        _nodes: [node, unrelatedNode],
        setDirtyCanvas: (...args) => dirtyCalls.push(args),
    },
    registerExtension: () => {},
};
const helpers = loadGenerateHelpers(app);

helpers.setDirty();
assert.deepEqual(drawCalls, ["draw"], "dirty graph refreshes the Nodes2.0 legacy canvas bridge");
assert.deepEqual(dirtyCalls, [[true, true]], "dirty graph keeps the classic canvas invalidation");

helpers.setCursorDirty();
assert.deepEqual(drawCalls, ["draw", "draw"], "cursor refresh redraws the Nodes2.0 legacy canvas bridge");
assert.deepEqual(dirtyCalls, [[true, true], [true, false]], "cursor refresh keeps partial classic invalidation");

await helpers.applyGeneratePreview(node, { images: [{ filename: "generated.png", type: "temp" }] });
assert.deepEqual(
    drawCalls,
    ["draw", "draw", "draw"],
    "async preview completion redraws through triggerDraw",
);

const nestedNode = {
    type: "NO8DGenerate",
    _no8dGenerateCanvas: { triggerDraw: () => drawCalls.push("nested") },
};
app.rootGraph = {
    _nodes: [
        node,
        unrelatedNode,
        { type: "SubgraphNode", subgraph: { _nodes: [nestedNode] } },
    ],
};
helpers.setDirty();
assert.deepEqual(
    drawCalls,
    ["draw", "draw", "draw", "draw", "nested"],
    "root graph dirty refresh reaches nested NO8DGenerate nodes",
);

function makeCanvas(rect) {
    const listeners = new Map();
    const styleValues = {};
    return {
        style: {
            setProperty: (name, value) => { styleValues[name] = value; },
            removeProperty: (name) => { delete styleValues[name]; },
        },
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name, callback) => {
            if (listeners.get(name) === callback) listeners.delete(name);
        },
        getBoundingClientRect: () => rect,
        dispatch(name, event) { listeners.get(name)?.(event); },
        hasListener(name) { return listeners.has(name); },
        styleValues,
    };
}

const hoverWidget = new helpers.NO8DGenerateCanvasWidget({ properties: {} }, "canvas", "");
const hoverEvents = [];
hoverWidget.updateHover = (pos, event) => hoverEvents.push({ pos, event });
hoverWidget.clearHover = () => hoverEvents.push({ clear: true });
const vueCanvas = makeCanvas({ left: 10, top: 20, width: 200, height: 100 });
globalThis.LiteGraph = { vueNodesMode: true };
hoverWidget.bindVueHoverCanvas(vueCanvas, 400, 200);
vueCanvas.dispatch("pointermove", { buttons: 0, clientX: 110, clientY: 70 });
vueCanvas.dispatch("pointermove", { buttons: 1, clientX: 150, clientY: 80 });
vueCanvas.dispatch("pointerleave", {});
assert.deepEqual(hoverEvents[0].pos, [200, 100], "Nodes2.0 hover maps CSS pixels to widget coordinates");
assert.deepEqual(hoverEvents[1], { clear: true }, "Nodes2.0 pointerleave clears hover state");
hoverWidget.setTransformCursor("move");
assert.equal(vueCanvas.styleValues.cursor, "grab", "Nodes2.0 cursor targets the legacy widget canvas");
hoverWidget.toolbarRect = [10, 150, 380, 50];
const editor = { style: {} };
hoverWidget.positionBottomEditor(editor, null, null, 40);
assert.equal(editor.style.left, "15px");
assert.equal(editor.style.top, "75px", "tool editor uses the actual Vue widget origin");
assert.equal(editor.style.transform, "scale(0.5)");
globalThis.LiteGraph = { vueNodesMode: true };
assert.equal(hoverWidget.computeLayoutSize().maxHeight, 360, "Vue bridge height has a finite bound");
delete globalThis.LiteGraph;
assert.equal(vueCanvas.hasListener("pointermove"), true);
hoverWidget.dispose();
assert.equal(vueCanvas.hasListener("pointermove"), false, "disposing removes the Nodes2.0 hover listener");

console.log("generate Nodes2.0 behavior tests passed");
