import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { no8dLocale, t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DImageComposer";
const RATIOS = ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "9:21"];
const SHORT_SIDES = [512, 768, 1024, 1280, 1536, 2048];
const HANDLE_SIZE = 12;
const MIN_SCALE = 0.01;
const MAX_SCALE = 20;

const COMPOSER_EN = {
    "打开图层合成器": "Open Image Composer",
    "画布比例": "Aspect ratio", "短边": "Short side", "添加图片": "Add images",
    "撤销": "Undo", "重做": "Redo", "取消": "Cancel", "保存布局": "Save layout",
    "图层（拖动调整顺序）": "Layers (drag to reorder)",
    "点击“添加图片”，或把图片拖入画布，也可以直接粘贴图片。": "Click Add images, drop images onto the canvas, or paste them here.",
    "隐藏图层（V）": "Hide layer (V)", "显示图层（V）": "Show layer (V)",
    "解锁图层（Ctrl+L）": "Unlock layer (Ctrl+L)", "锁定图层（Ctrl+L）": "Lock layer (Ctrl+L)",
    "历史记录": "History", "步": "steps", "暂无编辑记录": "No edits yet",
    "图片属性": "Image properties", "图层已锁定。可在图层列表点击锁图标解锁，或按 Ctrl+L。": "Layer is locked. Use its lock icon or Ctrl+L to unlock it.",
    "缩放倍数": "Scale", "旋转角度": "Rotation", "复位": "Reset",
    "水平镜像": "Flip horizontally", "垂直镜像": "Flip vertically",
    "抠像": "Cutout", "自动抠像": "Auto cutout", "描边": "Outline",
    "描边宽度（像素）": "Outline width (px)", "描边颜色": "Outline color",
    "橡皮擦": "Eraser", "笔刷": "Brush", "删除当前图层": "Delete current layer",
    "调整图层": "Edit layer", "显示/隐藏图层": "Show/hide layer", "锁定/解锁图层": "Lock/unlock layer",
    "调整缩放倍数": "Change scale", "复位缩放倍数": "Reset scale",
    "调整旋转角度": "Change rotation", "复位旋转角度": "Reset rotation",
    "调整描边宽度": "Change outline width", "调整描边颜色": "Change outline color",
    "切换描边": "Toggle outline", "删除图层": "Delete layer", "调整图层顺序": "Reorder layers",
    "擦除图层": "Erase layer", "移动图层": "Move layer",
    "缩放图层": "Scale layer", "旋转图层": "Rotate layer", "调整画布尺寸": "Resize canvas",
    "图片上传失败": "Image upload failed", "图片读取失败": "Could not load image",
    "无法读取原图": "Could not load the original image", "抠图失败": "Cutout failed",
    "抠图完成": "Cutout complete", "图片导入失败": "Could not import images",
    "橡皮擦蒙版保存失败": "Could not save the eraser mask", "布局保存失败": "Could not save layout",
    "未安装 rembg，无法使用抠图功能。请先在 ComfyUI 环境安装 rembg。": "rembg is not installed in the ComfyUI environment, so cutout is unavailable.",
    "上传图片不能超过 64 MB": "Images must be 64 MB or smaller",
    "正在抠图，首次使用可能需要加载模型…": "Removing background; the model may take a moment to load on first use…",
    "正在保存布局…": "Saving layout…",
    "Ctrl＋Z 撤销，Ctrl＋Shift＋Z / Ctrl＋Y 重做（保留 20 步）；V 显示/隐藏图层；空格＋拖动平移；方向键移动 1 像素，Shift＋方向键移动 10 像素；Ctrl＋L 锁定/解锁，Delete 删除。橡皮擦开启时只能擦除当前图层。": "Ctrl+Z undo; Ctrl+Shift+Z / Ctrl+Y redo (20 steps). V show/hide layer; Space+drag pan; arrow keys nudge 1 px, Shift+arrows 10 px; Ctrl+L lock/unlock; Delete remove. Eraser mode affects only the current layer.",
};
let activeComposerLocale = no8dLocale();
let openEditorRefresh = null;
function composerText(text) {
    if (activeComposerLocale === "zh") return text;
    const importing = /^正在导入 (\d+) 张图片…$/.exec(text);
    if (importing) return `Importing ${importing[1]} images…`;
    if (text.startsWith("抠图失败：")) return `Cutout failed: ${text.slice(5)}`;
    return COMPOSER_EN[text] || text;
}
function refreshComposerLocale(force = false) {
    const locale = no8dLocale();
    if (!force && locale === activeComposerLocale) return;
    activeComposerLocale = locale;
    for (const node of app?.graph?._nodes || []) {
        if (!isComposer(node)) continue;
        const button = node._no8dComposerPreview?.button;
        if (button) button.textContent = composerText("打开图层合成器");
    }
    openEditorRefresh?.();
}

const style = document.createElement("style");
style.textContent = `
.no8d-composer-node{width:100%;display:flex;flex-direction:column;gap:7px;box-sizing:border-box;padding:2px 0 4px}.no8d-composer-node-preview{width:100%;height:210px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #444;border-radius:6px;background:#090a0d}.no8d-composer-node-preview canvas{display:block;max-width:100%;max-height:100%}.no8d-composer-node button{height:30px;color:#eee;background:#30343c;border:1px solid #555b66;border-radius:5px;cursor:pointer}.no8d-composer-node button:hover{background:#3a3f48}
.no8d-composer-overlay{position:fixed;inset:0;z-index:10020;background:#000c;display:flex;align-items:center;justify-content:center;font:13px Arial,sans-serif;color:#eee}.no8d-composer-dialog{width:min(96vw,1600px);height:min(94vh,980px);background:#17191d;border:1px solid #414650;border-radius:12px;box-shadow:0 20px 70px #000;display:grid;grid-template-rows:auto 1fr;overflow:hidden}.no8d-composer-toolbar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#22252b;border-bottom:1px solid #363a43}.no8d-composer-toolbar strong{font-size:15px;margin-right:8px}.no8d-composer-toolbar label{display:flex;align-items:center;gap:5px;color:#bbb}.no8d-composer-toolbar select,.no8d-composer-toolbar button,.no8d-composer-sidebar button{color:#eee;background:#30343c;border:1px solid #4b515c;border-radius:6px;padding:6px 10px;cursor:pointer}.no8d-composer-toolbar select{background:#121419}.no8d-composer-toolbar .spacer{flex:1}.no8d-composer-toolbar button.primary{background:#2563eb;border-color:#3b82f6}.no8d-composer-toolbar button:disabled,.no8d-composer-sidebar button:disabled{opacity:.5;cursor:default}.no8d-composer-zoom{min-width:52px;text-align:center;color:#aeb5c0}
.no8d-composer-body{display:grid;grid-template-columns:minmax(0,1fr) 320px;min-height:0}.no8d-composer-stage{min-width:0;min-height:0;overflow:hidden;background-color:#101216;background-image:linear-gradient(45deg,#191c22 25%,transparent 25%),linear-gradient(-45deg,#191c22 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#191c22 75%),linear-gradient(-45deg,transparent 75%,#191c22 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0}.no8d-composer-stage-inner{width:100%;height:100%}.no8d-composer-stage canvas{display:block;width:100%;height:100%;touch-action:none;cursor:default}
.no8d-composer-sidebar{overflow:auto;border-left:1px solid #363a43;background:#202329;padding:12px}.no8d-composer-sidebar h3{font-size:12px;color:#9ca3af;text-transform:uppercase;margin:4px 0 8px}.no8d-composer-layer{display:grid;grid-template-columns:22px 22px 24px minmax(0,1fr);align-items:center;gap:7px;padding:8px;margin-bottom:5px;border:1px solid #3b4049;border-radius:7px;background:#292d34;cursor:pointer}.no8d-composer-layer.selected{border-color:#3b82f6;background:#25344f}.no8d-composer-layer.dragging{opacity:.45}.no8d-composer-layer.drop-before{box-shadow:0 -2px 0 #60a5fa}.no8d-composer-grip{color:#8e96a3;font-size:16px;cursor:grab}.no8d-composer-layer-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.no8d-composer-layer-lock,.no8d-composer-layer-eye{border:0!important;background:transparent!important;padding:0!important;font-size:16px;line-height:1}.no8d-composer-empty{color:#888;text-align:center;margin:24px 8px;line-height:1.6}.no8d-composer-properties{display:flex;flex-direction:column;gap:10px}.no8d-composer-property-row{display:grid;grid-template-columns:1fr auto;align-items:end;gap:7px}.no8d-composer-property-row label{display:flex;flex-direction:column;gap:4px;color:#b8bdc7}.no8d-composer-property-row input{width:100%;box-sizing:border-box;background:#121419;color:#eee;border:1px solid #444a55;border-radius:5px;padding:6px}.no8d-composer-slider-value{width:58px!important;text-align:right;color:#dbeafe;font-variant-numeric:tabular-nums}.no8d-composer-actions{display:grid;grid-template-columns:1fr auto;gap:7px}.no8d-composer-actions button.active{background:#9a3412;border-color:#fb923c}.no8d-composer-mirror{display:grid;grid-template-columns:1fr 1fr;gap:7px}.no8d-composer-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;color:#b8bdc7;cursor:pointer}.no8d-composer-switch input{position:absolute;opacity:0;width:1px;height:1px}.no8d-composer-switch-track{width:36px;height:20px;flex:none;border-radius:20px;background:var(--p-toggleswitch-background,#555b66);position:relative;transition:background .15s}.no8d-composer-switch-track::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:var(--p-toggleswitch-handle-background,#fff);transition:transform .15s}.no8d-composer-switch input:checked+.no8d-composer-switch-track{background:var(--p-toggleswitch-checked-background,#3b82f6)}.no8d-composer-switch input:checked+.no8d-composer-switch-track::after{transform:translateX(16px)}.no8d-composer-switch input:focus-visible+.no8d-composer-switch-track{outline:2px solid #93c5fd;outline-offset:2px}.no8d-composer-switch input:disabled+.no8d-composer-switch-track{opacity:.45}.no8d-composer-stroke{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px}.no8d-composer-stroke label{display:flex;flex-direction:column;gap:4px;color:#b8bdc7}.no8d-composer-stroke input[type=number]{width:100%;box-sizing:border-box;background:#121419;color:#eee;border:1px solid #444a55;border-radius:5px;padding:6px}.no8d-composer-brush{display:flex;align-items:center;gap:8px;color:#b8bdc7}.no8d-composer-brush input{flex:1}.no8d-composer-status{min-height:18px;margin-top:10px;color:#93c5fd;line-height:1.4}.no8d-composer-help{margin-top:8px;color:#9299a5;line-height:1.5}.no8d-composer-file-input{display:none}
`;
document.head.appendChild(style);

function isComposer(node) {
    return (node?.comfyClass || node?.constructor?.comfyClass || node?.type) === NODE_NAME;
}

function getWidget(node, name) {
    return (node.widgets || []).find((item) => item.name === name);
}

function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function normalizeRef(value) {
    if (!value || typeof value !== "object") return null;
    const filename = String(value.filename || value.name || "");
    if (!filename) return null;
    return {
        filename,
        subfolder: String(value.subfolder || ""),
        type: String(value.type || "input"),
        width: Math.max(1, Number(value.width) || 1),
        height: Math.max(1, Number(value.height) || 1),
    };
}

function readState(node) {
    let raw = {};
    try { raw = JSON.parse(String(getWidget(node, "layout_json")?.value || "{}")); } catch (_) { raw = {}; }
    const ratio = RATIOS.includes(raw.ratio) ? raw.ratio : "1:1";
    const shortSide = Math.max(64, Number(raw.short_side) || 1024);
    const layers = Array.isArray(raw.layers) ? raw.layers.map((item, index) => {
        const source = normalizeRef(item.source);
        if (!source) return null;
        return {
            id: String(item.id || `layer-${Date.now()}-${index}`),
            name: String(item.name || source.filename || `图层 ${index + 1}`),
            source,
            cutout_source: normalizeRef(item.cutout_source),
            eraser_mask: normalizeRef(item.eraser_mask),
            x: Number.isFinite(Number(item.x)) ? Number(item.x) : null,
            y: Number.isFinite(Number(item.y)) ? Number(item.y) : null,
            scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(item.scale) || 1)),
            rotation: normalizeAngle(Number(item.rotation) || 0),
            opacity: Math.min(1, Math.max(0, Number.isFinite(Number(item.opacity)) ? Number(item.opacity) : 1)),
            blend_mode: String(item.blend_mode || "normal"),
            visible: item.visible !== false,
            locked: item.locked === true,
            flip_horizontal: item.flip_horizontal === true,
            flip_vertical: item.flip_vertical === true,
            stroke_width: Math.min(40, Math.max(0, Number(item.stroke_width) || 0)),
            stroke_color: /^#[0-9a-f]{6}$/i.test(item.stroke_color) ? item.stroke_color : "#ffffff",
            stroke_enabled: item.stroke_enabled === true || (item.stroke_enabled == null && Number(item.stroke_width) > 0),
        };
    }).filter(Boolean) : [];
    return { ratio, short_side: shortSide, layers };
}

function writeState(node, state) {
    const target = getWidget(node, "layout_json");
    if (!target) return;
    target.value = JSON.stringify(state);
    target.callback?.(target.value);
    node.graph?.change?.();
    app.graph?.setDirtyCanvas?.(true, true);
}

function align8(value) { return Math.max(8, Math.round(Number(value) / 8) * 8); }
function canvasSize(state) {
    const [rw, rh] = String(state.ratio || "1:1").split(":").map(Number);
    const short = align8(state.short_side || 1024);
    if (!rw || !rh) return { width: short, height: short };
    return rw >= rh
        ? { width: align8(short * rw / rh), height: short }
        : { width: short, height: align8(short * rh / rw) };
}

function refUrl(ref) {
    const params = new URLSearchParams({ filename: ref.filename, subfolder: ref.subfolder || "", type: ref.type || "input" });
    return api.apiURL(`/view?${params.toString()}`);
}
function refKey(ref) { return ref ? `${ref.type}/${ref.subfolder}/${ref.filename}` : ""; }
function loadHtmlImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("图片读取失败"));
        image.src = url;
    });
}
async function uploadBlob(blob, filename) {
    const form = new FormData();
    const file = blob instanceof File ? blob : new File([blob], filename, { type: blob.type || "image/png" });
    form.append("image", file, file.name);
    form.append("type", "input");
    form.append("subfolder", "no8d_image_composer");
    form.append("overwrite", "false");
    const response = await api.fetchApi("/upload/image", { method: "POST", body: form });
    if (!response.ok) throw new Error((await response.text()) || "图片上传失败");
    const data = await response.json();
    return { filename: data.name || file.name, subfolder: data.subfolder || "no8d_image_composer", type: data.type || "input" };
}
async function sourceDimensions(file) {
    const url = URL.createObjectURL(file);
    try {
        const image = await loadHtmlImage(url);
        return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
    } finally { URL.revokeObjectURL(url); }
}
function safeName(name) { return String(name || "image.png").replace(/[^a-zA-Z0-9._-]+/g, "_"); }
function makeButton(text, handler, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = composerText(text);
    if (className) button.className = className;
    button.addEventListener("click", handler);
    return button;
}
function makeSwitch(text, checked, disabled, handler) {
    const label = document.createElement("label"); label.className = "no8d-composer-switch";
    const name = document.createElement("span"); name.textContent = composerText(text);
    const input = document.createElement("input"); input.type = "checkbox"; input.setAttribute("role", "switch"); input.checked = checked; input.disabled = disabled;
    input.addEventListener("change", () => handler(input.checked));
    const track = document.createElement("span"); track.className = "no8d-composer-switch-track";
    label.append(name, input, track); return label;
}
function rotatePoint(x, y, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
}
function normalizeAngle(value) {
    return ((Number(value) + 180) % 360 + 360) % 360 - 180;
}
function layerSize(layer, runtime) {
    const image = runtime?.image;
    return { width: image?.naturalWidth || image?.width || layer.source.width || 256, height: image?.naturalHeight || image?.height || layer.source.height || 256 };
}
function layerCenter(layer, size) {
    return { x: Number.isFinite(Number(layer.x)) ? Number(layer.x) : size.width / 2, y: Number.isFinite(Number(layer.y)) ? Number(layer.y) : size.height / 2 };
}

function openEditor(node) {
    refreshComposerLocale(true);
    const state = clone(readState(node));
    let selectedId = state.layers[state.layers.length - 1]?.id || null;
    const selectedIds = new Set(selectedId ? [selectedId] : []);
    let userZoom = 1;
    let viewScale = 1;
    let panX = 0;
    let panY = 0;
    let spaceDown = false;
    let interaction = null;
    let eraserMode = false;
    let pointerPosition = null;
    let brushSize = 80;
    let busy = false;
    let dragLayerId = null;
    const runtime = new Map();
    const undoStack = [];
    const redoStack = [];
    let historyExpanded = false;

    const overlay = document.createElement("div");
    overlay.className = "no8d-composer-overlay";
    overlay.tabIndex = -1;
    const dialog = document.createElement("div");
    dialog.className = "no8d-composer-dialog";
    const toolbar = document.createElement("div");
    toolbar.className = "no8d-composer-toolbar";
    const title = document.createElement("strong");
    title.textContent = t("imageComposerTitle");
    const ratioLabel = document.createElement("label");
    const ratioCaption = document.createElement("span"); ratioCaption.textContent = composerText("画布比例"); ratioLabel.append(ratioCaption);
    const ratioSelect = document.createElement("select");
    for (const ratio of RATIOS) {
        const option = document.createElement("option"); option.value = ratio; option.textContent = ratio; ratioSelect.appendChild(option);
    }
    ratioSelect.value = state.ratio;
    ratioLabel.appendChild(ratioSelect);
    const sideLabel = document.createElement("label");
    const sideCaption = document.createElement("span"); sideCaption.textContent = composerText("短边"); sideLabel.append(sideCaption);
    const sideSelect = document.createElement("select");
    for (const side of SHORT_SIDES) {
        const option = document.createElement("option"); option.value = String(side); option.textContent = String(side); sideSelect.appendChild(option);
    }
    if (!SHORT_SIDES.includes(Number(state.short_side))) {
        const custom = document.createElement("option"); custom.value = String(state.short_side); custom.textContent = String(state.short_side); sideSelect.appendChild(custom);
    }
    sideSelect.value = String(state.short_side);
    sideLabel.appendChild(sideSelect);
    const fileInput = document.createElement("input");
    fileInput.type = "file"; fileInput.accept = "image/*"; fileInput.multiple = true; fileInput.className = "no8d-composer-file-input";
    const addButton = makeButton("添加图片", () => fileInput.click());
    const undoButton = makeButton("撤销", () => undo());
    const redoButton = makeButton("重做", () => redo());
    const zoomText = document.createElement("span"); zoomText.className = "no8d-composer-zoom";
    const spacer = document.createElement("span"); spacer.className = "spacer";
    const cancel = makeButton("取消", close);
    const save = makeButton("保存布局", saveLayout, "primary");
    toolbar.append(title, ratioLabel, sideLabel, addButton, fileInput, undoButton, redoButton, zoomText, spacer, cancel, save);

    const body = document.createElement("div"); body.className = "no8d-composer-body";
    const stage = document.createElement("div"); stage.className = "no8d-composer-stage";
    const stageInner = document.createElement("div"); stageInner.className = "no8d-composer-stage-inner";
    const canvas = document.createElement("canvas"); stageInner.appendChild(canvas); stage.appendChild(stageInner);
    const sidebar = document.createElement("aside"); sidebar.className = "no8d-composer-sidebar";
    body.append(stage, sidebar); dialog.append(toolbar, body); overlay.appendChild(dialog); document.body.appendChild(overlay);
    overlay.focus({ preventScroll: true });

    const currentSize = () => canvasSize(state);
    const selectedLayer = () => state.layers.find((layer) => layer.id === selectedId) || null;
    const selectedLayers = () => state.layers.filter((layer) => selectedIds.has(layer.id));
    const selectedRuntime = () => selectedId ? runtime.get(selectedId) : null;
    let statusText = "";
    let statusError = false;
    function copyCanvas(source) {
        if (!source) return null;
        const copy = document.createElement("canvas"); copy.width = source.width; copy.height = source.height;
        copy.getContext("2d").drawImage(source, 0, 0); return copy;
    }
    function snapshot() {
        return {
            state: clone(state), selectedId, selectedIds: [...selectedIds],
            masks: new Map([...runtime].map(([id, item]) => [id, {
                mask: copyCanvas(item.mask), maskDirty: item.maskDirty,
            }])),
        };
    }
    function updateHistoryButtons() {
        undoButton.disabled = busy || !undoStack.length;
        redoButton.disabled = busy || !redoStack.length;
        undoButton.title = activeComposerLocale === "zh" ? `撤销（Ctrl+Z，剩余 ${undoStack.length} 步）` : `Undo (Ctrl+Z, ${undoStack.length} steps available)`;
        redoButton.title = activeComposerLocale === "zh" ? `重做（Ctrl+Shift+Z / Ctrl+Y，剩余 ${redoStack.length} 步）` : `Redo (Ctrl+Shift+Z / Ctrl+Y, ${redoStack.length} steps available)`;
    }
    function recordHistory(label = "调整图层") {
        const saved = snapshot(); saved.label = label;
        undoStack.push(saved); if (undoStack.length > 20) undoStack.shift();
        redoStack.length = 0; updateHistoryButtons();
    }
    function restoreHistory(saved) {
        state.ratio = saved.state.ratio; state.short_side = saved.state.short_side; state.layers = saved.state.layers;
        selectedId = saved.selectedId; selectedIds.clear(); for (const id of saved.selectedIds) selectedIds.add(id);
        eraserMode = false; interaction = null; runtime.clear();
        for (const layer of state.layers) {
            const previous = saved.masks.get(layer.id);
            runtime.set(layer.id, { image: null, imageKey: "", mask: copyCanvas(previous?.mask), maskKey: previous?.mask ? refKey(layer.eraser_mask) : "",
                processed: null, dirty: true, maskDirty: previous?.maskDirty || false,
                alphaBounds: null, boundsDirty: true });
            ensureRuntime(layer).then(() => redraw());
        }
        ratioSelect.value = state.ratio; sideSelect.value = String(state.short_side);
        redraw(); updateHistoryButtons();
    }
    function undo() {
        if (busy || !undoStack.length) return;
        const previous = undoStack.pop(); const current = snapshot(); current.label = previous.label;
        redoStack.push(current); restoreHistory(previous);
    }
    function redo() {
        if (busy || !redoStack.length) return;
        const next = redoStack.pop(); const current = snapshot(); current.label = next.label;
        undoStack.push(current); restoreHistory(next);
    }
    updateHistoryButtons();
    function setStatus(text, error = false) {
        statusText = text || ""; statusError = error;
        const target = sidebar.querySelector(".no8d-composer-status");
        if (!target) return;
        target.textContent = composerText(statusText);
        target.style.color = error ? "#fca5a5" : "#93c5fd";
    }
    function refreshEditorLocale() {
        title.textContent = t("imageComposerTitle");
        ratioCaption.textContent = composerText("画布比例"); sideCaption.textContent = composerText("短边");
        addButton.textContent = composerText("添加图片"); undoButton.textContent = composerText("撤销");
        redoButton.textContent = composerText("重做"); cancel.textContent = composerText("取消"); save.textContent = composerText("保存布局");
        updateHistoryButtons(); redraw();
        if (busy) setButtonsDisabled(true);
    }
    openEditorRefresh = refreshEditorLocale;

    async function ensureRuntime(layer) {
        let item = runtime.get(layer.id);
        const activeRef = layer.cutout_source || layer.source;
        const key = refKey(activeRef);
        if (!item) {
            item = { image: null, imageKey: "", mask: null, maskKey: "", processed: null, dirty: true, maskDirty: false, alphaBounds: null, boundsDirty: true };
            runtime.set(layer.id, item);
        }
        if (item.imageKey !== key) {
            item.imageKey = key; item.image = null; item.processed = null; item.dirty = true; item.boundsDirty = true;
            try {
                item.image = await loadHtmlImage(refUrl(activeRef));
                layer.source.width = layer.source.width > 1 ? layer.source.width : item.image.naturalWidth;
                layer.source.height = layer.source.height > 1 ? layer.source.height : item.image.naturalHeight;
            } catch (error) { console.warn("NO8D Image Composer: image load failed", error); }
        }
        const maskKey = refKey(layer.eraser_mask);
        if (item.maskKey !== maskKey && !item.maskDirty) {
            item.maskKey = maskKey; item.mask = null; item.processed = null; item.dirty = true; item.boundsDirty = true;
            if (layer.eraser_mask) {
                try {
                    const maskImage = await loadHtmlImage(refUrl(layer.eraser_mask));
                    const dims = layerSize(layer, item);
                    const mask = document.createElement("canvas"); mask.width = dims.width; mask.height = dims.height;
                    mask.getContext("2d").drawImage(maskImage, 0, 0, dims.width, dims.height);
                    item.mask = mask;
                } catch (error) { console.warn("NO8D Image Composer: mask load failed", error); }
            }
        }
        return item;
    }

    function processedImage(layer) {
        const item = runtime.get(layer.id);
        if (!item?.image) return null;
        if (!item.mask || !layer.cutout_source) return item.image;
        if (!item.processed || item.dirty) {
            const dims = layerSize(layer, item);
            const output = document.createElement("canvas"); output.width = dims.width; output.height = dims.height;
            const context = output.getContext("2d"); context.drawImage(item.image, 0, 0, dims.width, dims.height);
            context.globalCompositeOperation = "destination-out"; context.drawImage(item.mask, 0, 0, dims.width, dims.height);
            item.processed = output; item.dirty = false;
        }
        return item.processed;
    }

    function contentBounds(layer) {
        const item = runtime.get(layer.id);
        const dims = layerSize(layer, item);
        if (!item?.image) return { left: 0, top: 0, right: dims.width, bottom: dims.height };
        if (!item.boundsDirty && item.alphaBounds) return item.alphaBounds;
        const drawable = processedImage(layer);
        const probe = document.createElement("canvas"); probe.width = dims.width; probe.height = dims.height;
        const probeContext = probe.getContext("2d", { willReadFrequently: true });
        probeContext.drawImage(drawable, 0, 0, dims.width, dims.height);
        const pixels = probeContext.getImageData(0, 0, dims.width, dims.height).data;
        let left = dims.width; let top = dims.height; let right = -1; let bottom = -1;
        for (let y = 0; y < dims.height; y++) {
            for (let x = 0; x < dims.width; x++) {
                if (pixels[(y * dims.width + x) * 4 + 3] <= 8) continue;
                if (x < left) left = x; if (x > right) right = x;
                if (y < top) top = y; if (y > bottom) bottom = y;
            }
        }
        item.alphaBounds = right < left
            ? { left: dims.width / 2, top: dims.height / 2, right: dims.width / 2, bottom: dims.height / 2 }
            : { left, top, right: right + 1, bottom: bottom + 1 };
        item.boundsDirty = false;
        return item.alphaBounds;
    }

    function selectionRect(layer) {
        const dims = layerSize(layer, runtime.get(layer.id));
        const bounds = contentBounds(layer);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(layer.scale) || 1));
        const stroke = layer.cutout_source && layer.stroke_enabled ? Math.min(40, Math.max(0, Number(layer.stroke_width) || 0)) : 0;
        const left = layer.flip_horizontal ? dims.width - bounds.right : bounds.left;
        const right = layer.flip_horizontal ? dims.width - bounds.left : bounds.right;
        const top = layer.flip_vertical ? dims.height - bounds.bottom : bounds.top;
        const bottom = layer.flip_vertical ? dims.height - bounds.top : bounds.bottom;
        return {
            x: (left - stroke - dims.width / 2) * scale,
            y: (top - stroke - dims.height / 2) * scale,
            width: (right - left + stroke * 2) * scale,
            height: (bottom - top + stroke * 2) * scale,
        };
    }

    function drawImageWithEffects(context, image, layer, width, height) {
        const item = runtime.get(layer.id);
        context.save();
        context.scale(layer.flip_horizontal ? -1 : 1, layer.flip_vertical ? -1 : 1);
        const stroke = layer.cutout_source && layer.stroke_enabled ? Math.min(40, Math.max(0, Number(layer.stroke_width) || 0)) : 0;
        if (stroke && image) {
            const key = `${layer.stroke_color}/${item?.imageKey}/${item?.maskKey}/${item?.maskDirty}/${item?.dirty}`;
            if (item && (item.outlineKey !== key || !item.outline)) {
                const outline = document.createElement("canvas"); outline.width = image.width; outline.height = image.height;
                const outlineContext = outline.getContext("2d"); outlineContext.drawImage(image, 0, 0);
                outlineContext.globalCompositeOperation = "source-in"; outlineContext.fillStyle = layer.stroke_color || "#ffffff";
                outlineContext.fillRect(0, 0, outline.width, outline.height);
                item.outline = outline; item.outlineKey = key;
            }
            context.save();
            const sourceScale = width / image.width;
            for (let step = 0; step < 24; step++) {
                const angle = step * Math.PI / 12;
                context.drawImage(item.outline, -width / 2 + Math.cos(angle) * stroke * sourceScale, -height / 2 + Math.sin(angle) * stroke * sourceScale, width, height);
            }
            context.restore();
        }
        context.drawImage(image, -width / 2, -height / 2, width, height);
        context.restore();
    }

    function drawHandles(context, rect, showHandles) {
        const line = 2 / viewScale; const handle = HANDLE_SIZE / viewScale; const rotationOffset = 32 / viewScale;
        context.globalAlpha = 1; context.globalCompositeOperation = "source-over"; context.strokeStyle = "#3b82f6"; context.fillStyle = "#eff6ff"; context.lineWidth = line;
        context.setLineDash([7 / viewScale, 5 / viewScale]); context.strokeRect(rect.x, rect.y, rect.width, rect.height); context.setLineDash([]);
        if (!showHandles) return;
        for (const [x, y] of [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]) {
            context.fillRect(x - handle / 2, y - handle / 2, handle, handle); context.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
        }
        const centerX = rect.x + rect.width / 2;
        context.beginPath(); context.moveTo(centerX, rect.y); context.lineTo(centerX, rect.y - rotationOffset); context.stroke();
        context.beginPath(); context.arc(centerX, rect.y - rotationOffset, handle * .55, 0, Math.PI * 2); context.fill(); context.stroke();
    }

    function drawLayer(context, layer, selected = false) {
        if (layer.visible === false) return;
        const item = runtime.get(layer.id); const image = processedImage(layer); const dims = layerSize(layer, item);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(layer.scale) || 1)); const center = layerCenter(layer, currentSize());
        layer.x = center.x; layer.y = center.y;
        const width = dims.width * scale; const height = dims.height * scale;
        context.save(); context.translate(center.x, center.y); context.rotate((Number(layer.rotation) || 0) * Math.PI / 180);
        context.globalAlpha = layer.opacity; context.globalCompositeOperation = layer.blend_mode === "normal" ? "source-over" : (layer.blend_mode || "source-over");
        if (image) drawImageWithEffects(context, image, layer, width, height);
        else {
            context.fillStyle = "#475569"; context.fillRect(-width / 2, -height / 2, width, height); context.fillStyle = "#fff";
            context.textAlign = "center"; context.textBaseline = "middle"; context.font = `${Math.max(12, 18 / viewScale)}px sans-serif`; context.fillText(layer.name, 0, 0, Math.max(20, width - 12));
        }
        if (selected) drawHandles(context, selectionRect(layer), true);
        context.restore();
    }

    function redraw(refreshSidebar = true) {
        const size = currentSize(); const availableWidth = Math.max(120, stage.clientWidth - 96); const availableHeight = Math.max(120, stage.clientHeight - 96);
        const fit = Math.min(1, availableWidth / size.width, availableHeight / size.height); viewScale = fit * userZoom;
        const cssWidth = Math.max(1, stage.clientWidth); const cssHeight = Math.max(1, stage.clientHeight); const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.round(cssWidth * pixelRatio); canvas.height = Math.round(cssHeight * pixelRatio);
        canvas.style.width = `${cssWidth}px`; canvas.style.height = `${cssHeight}px`; zoomText.textContent = `${Math.round(userZoom * 100)}%`;
        const context = canvas.getContext("2d"); context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0); context.clearRect(0, 0, cssWidth, cssHeight);
        context.translate(cssWidth / 2 + panX, cssHeight / 2 + panY); context.scale(viewScale, viewScale); context.translate(-size.width / 2, -size.height / 2);
        context.save(); context.shadowColor = "#000"; context.shadowBlur = 28 / viewScale; context.fillStyle = "#000"; context.fillRect(0, 0, size.width, size.height); context.restore();
        for (const layer of state.layers) drawLayer(context, layer, false);
        const activeSelection = selectedLayers().filter((layer) => layer.visible !== false);
        for (const selected of activeSelection) {
            context.save();
            context.translate(selected.x, selected.y);
            context.rotate((Number(selected.rotation) || 0) * Math.PI / 180);
            drawHandles(context, selectionRect(selected), !selected.locked && activeSelection.length === 1);
            context.restore();
        }
        context.strokeStyle = "#94a3b8"; context.lineWidth = 1 / viewScale; context.strokeRect(0, 0, size.width, size.height);
        if (interaction?.mode === "marquee") {
            const left = Math.min(interaction.start.x, interaction.current.x); const top = Math.min(interaction.start.y, interaction.current.y);
            const width = Math.abs(interaction.current.x - interaction.start.x); const height = Math.abs(interaction.current.y - interaction.start.y);
            context.fillStyle = "#3b82f622"; context.strokeStyle = "#60a5fa"; context.lineWidth = 1 / viewScale; context.setLineDash([6 / viewScale, 4 / viewScale]);
            context.fillRect(left, top, width, height); context.strokeRect(left, top, width, height); context.setLineDash([]);
        }
        if (pointerPosition && eraserMode) {
            const layer = selectedLayer();
            if (layer?.cutout_source && !layer.locked) {
                context.beginPath(); context.arc(pointerPosition.x, pointerPosition.y, brushSize * Math.max(MIN_SCALE, layer.scale) / 2, 0, Math.PI * 2);
                context.strokeStyle = "#f8fafc"; context.lineWidth = 1.5 / viewScale; context.stroke();
            }
        }
        if (!spaceDown && interaction?.mode !== "pan") canvas.style.cursor = eraserMode ? "none" : "default";
        if (refreshSidebar) refreshControls();
    }

    function refreshControls() {
        sidebar.replaceChildren();
        const heading = document.createElement("h3"); heading.textContent = composerText("图层（拖动调整顺序）"); sidebar.appendChild(heading);
        if (!state.layers.length) {
            const empty = document.createElement("div"); empty.className = "no8d-composer-empty"; empty.textContent = composerText("点击“添加图片”，或把图片拖入画布，也可以直接粘贴图片。"); sidebar.appendChild(empty);
        } else {
            for (const layer of [...state.layers].reverse()) {
                const row = document.createElement("div"); row.className = `no8d-composer-layer${selectedIds.has(layer.id) ? " selected" : ""}`; row.draggable = true;
                const visible = makeButton("", (event) => {
                    event.stopPropagation(); recordHistory("显示/隐藏图层"); layer.visible = layer.visible === false; redraw();
                }, "no8d-composer-layer-eye");
                visible.innerHTML = layer.visible !== false
                    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>'
                    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8C2.8 9.5 2 12 2 12s3.6 6 10 6c2 0 3.8-.6 5.3-1.4M9 6.4A11.9 11.9 0 0 1 12 6c6.4 0 10 6 10 6s-.7 1.2-2 2.5"/><path d="M3 3l18 18"/></svg>';
                visible.title = composerText(layer.visible !== false ? "隐藏图层（V）" : "显示图层（V）");
                visible.setAttribute("aria-label", visible.title);
                visible.setAttribute("aria-pressed", String(layer.visible !== false));
                const grip = document.createElement("span"); grip.className = "no8d-composer-grip"; grip.textContent = "⠿";
                const lock = makeButton(layer.locked ? "🔒" : "🔓", (event) => {
                    event.stopPropagation(); recordHistory("锁定/解锁图层"); layer.locked = !layer.locked; if (layer.locked && selectedIds.has(layer.id)) eraserMode = false; redraw();
                }, "no8d-composer-layer-lock");
                lock.title = composerText(layer.locked ? "解锁图层（Ctrl+L）" : "锁定图层（Ctrl+L）");
                const name = document.createElement("span"); name.className = "no8d-composer-layer-name"; name.textContent = layer.name;
                row.append(visible, grip, lock, name); row.addEventListener("click", (event) => {
                    if (event.ctrlKey || event.metaKey || event.shiftKey) {
                        if (selectedIds.has(layer.id)) selectedIds.delete(layer.id); else selectedIds.add(layer.id);
                        selectedId = selectedIds.has(layer.id) ? layer.id : ([...selectedIds].at(-1) || null);
                    } else {
                        selectedIds.clear(); selectedIds.add(layer.id); selectedId = layer.id;
                    }
                    eraserMode = false; redraw();
                });
                row.addEventListener("dragstart", (event) => { dragLayerId = layer.id; row.classList.add("dragging"); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", layer.id); });
                row.addEventListener("dragend", () => { dragLayerId = null; row.classList.remove("dragging"); sidebar.querySelectorAll(".drop-before").forEach((item) => item.classList.remove("drop-before")); });
                row.addEventListener("dragover", (event) => { if (!dragLayerId || dragLayerId === layer.id) return; event.preventDefault(); row.classList.add("drop-before"); });
                row.addEventListener("dragleave", () => row.classList.remove("drop-before"));
                row.addEventListener("drop", (event) => { event.preventDefault(); row.classList.remove("drop-before"); reorderLayer(dragLayerId, layer.id); });
                sidebar.appendChild(row);
            }
        }
        const layer = selectedLayer(); if (layer) addProperties(layer);
        const history = document.createElement("details"); history.open = historyExpanded;
        history.addEventListener("toggle", () => { historyExpanded = history.open; });
        const historyTitle = document.createElement("summary"); historyTitle.textContent = activeComposerLocale === "zh" ? `历史记录（${undoStack.length}/20 步）` : `History (${undoStack.length}/20 steps)`;
        history.append(historyTitle);
        const entries = document.createElement("ol"); entries.className = "no8d-composer-help";
        for (const entry of [...undoStack].reverse()) {
            const item = document.createElement("li"); item.textContent = composerText(entry.label); entries.append(item);
        }
        if (!undoStack.length) entries.textContent = composerText("暂无编辑记录");
        history.append(entries); sidebar.append(history);
        const status = document.createElement("div"); status.className = "no8d-composer-status"; sidebar.appendChild(status); setStatus(statusText, statusError);
        const help = document.createElement("div"); help.className = "no8d-composer-help"; help.textContent = composerText("Ctrl＋Z 撤销，Ctrl＋Shift＋Z / Ctrl＋Y 重做（保留 20 步）；V 显示/隐藏图层；空格＋拖动平移；方向键移动 1 像素，Shift＋方向键移动 10 像素；Ctrl＋L 锁定/解锁，Delete 删除。橡皮擦开启时只能擦除当前图层。"); sidebar.appendChild(help);
    }

    function sliderProperty(labelText, value, min, max, step, update, reset) {
        const row = document.createElement("div"); row.className = "no8d-composer-property-row";
        const label = document.createElement("label"); label.textContent = composerText(labelText);
        const control = document.createElement("div"); control.style.cssText = "display:flex;align-items:center;gap:8px";
        const input = document.createElement("input"); input.type = "range"; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
        const output = document.createElement("input"); output.type = "number"; output.className = "no8d-composer-slider-value";
        output.min = String(min); output.max = String(max); output.step = String(step); output.value = String(value); output.title = activeComposerLocale === "zh" ? `可输入数值，方向键按 ${step} 调节` : `Enter a value; arrow keys adjust by ${step}`;
        let editing = false; let lastValue = Number(value);
        const applyValue = (raw, commit = true) => {
            const number = Number(raw);
            if (!Number.isFinite(number) || raw === "") return;
            const bounded = Math.min(max, Math.max(min, number));
            if (!editing && bounded !== lastValue) { recordHistory(`调整${labelText}`); editing = true; }
            input.value = String(bounded);
            if (commit) output.value = String(bounded);
            lastValue = bounded; update(bounded);
        };
        input.addEventListener("input", () => applyValue(input.value));
        output.addEventListener("input", () => applyValue(output.value, false));
        output.addEventListener("change", () => applyValue(output.value));
        input.addEventListener("change", () => { editing = false; });
        output.addEventListener("blur", () => { editing = false; });
        const resetButton = makeButton("复位", () => {
            recordHistory(`复位${labelText}`);
            const resetValue = reset();
            if (!Number.isFinite(resetValue)) return;
            input.value = String(resetValue);
            output.value = String(resetValue);
            lastValue = resetValue; editing = false;
        });
        control.append(input, output); label.appendChild(control); row.append(label, resetButton); return row;
    }

    function addProperties(layer) {
        const layers = selectedLayers();
        const heading = document.createElement("h3"); heading.textContent = layers.length > 1 ? (activeComposerLocale === "zh" ? `图片属性（已选 ${layers.length} 层）` : `Image properties (${layers.length} layers selected)`) : composerText("图片属性"); heading.style.marginTop = "16px";
        const properties = document.createElement("div"); properties.className = "no8d-composer-properties";
        if (layers.every((item) => item.locked)) {
            const notice = document.createElement("div"); notice.className = "no8d-composer-help"; notice.textContent = composerText("图层已锁定。可在图层列表点击锁图标解锁，或按 Ctrl+L。");
            sidebar.append(heading, notice);
            return;
        }
        const editable = layers.filter((item) => !item.locked);
        let previousScale = layer.scale;
        const scaleInput = sliderProperty("缩放倍数", layer.scale, MIN_SCALE, MAX_SCALE, .01, (value) => {
            const factor = value / Math.max(MIN_SCALE, previousScale);
            for (const selected of editable) selected.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, selected.scale * factor));
            previousScale = value; redraw(false);
        }, () => { for (const selected of editable) selected.scale = 1; previousScale = 1; redraw(false); return 1; });
        let previousRotation = layer.rotation;
        const rotationInput = sliderProperty("旋转角度", layer.rotation, -180, 180, 1, (value) => {
            const delta = value - previousRotation;
            for (const selected of editable) selected.rotation = normalizeAngle(selected.rotation + delta);
            previousRotation = value; redraw(false);
        }, () => { for (const selected of editable) selected.rotation = 0; previousRotation = 0; redraw(false); return 0; });
        properties.append(scaleInput, rotationInput);
        const mirror = document.createElement("div"); mirror.className = "no8d-composer-mirror";
        mirror.append(makeButton("水平镜像", () => { recordHistory("水平镜像"); for (const selected of editable) selected.flip_horizontal = !selected.flip_horizontal; redraw(); }), makeButton("垂直镜像", () => { recordHistory("垂直镜像"); for (const selected of editable) selected.flip_vertical = !selected.flip_vertical; redraw(); }));
        properties.append(mirror);
        if (layers.length > 1) {
            sidebar.append(heading, properties);
            return;
        }
        const cutoutHeading = document.createElement("h3"); cutoutHeading.textContent = composerText("抠像");
        properties.append(cutoutHeading);
        properties.append(makeButton("自动抠像", () => { eraserMode = false; removeBackground(layer); }));
        const strokeToggle = makeSwitch("描边", layer.stroke_enabled, !layer.cutout_source, (checked) => {
            recordHistory("切换描边"); layer.stroke_enabled = checked;
            if (layer.stroke_enabled && !layer.stroke_width) layer.stroke_width = 2;
            redraw();
        });
        properties.append(strokeToggle);
        if (layer.cutout_source && layer.stroke_enabled) {
            const stroke = document.createElement("div"); stroke.className = "no8d-composer-stroke";
            const strokeLabel = document.createElement("label"); strokeLabel.textContent = composerText("描边宽度（像素）");
            const strokeInput = document.createElement("input"); strokeInput.type = "number"; strokeInput.min = "0"; strokeInput.max = "40"; strokeInput.step = "1"; strokeInput.value = String(layer.stroke_width || 0);
            let widthEditing = false;
            strokeInput.addEventListener("input", () => { const value = Number(strokeInput.value); if (Number.isFinite(value)) { const next = Math.min(40, Math.max(0, Math.round(value))); if (!widthEditing && next !== layer.stroke_width) { recordHistory("调整描边宽度"); widthEditing = true; } layer.stroke_width = next; redraw(false); } });
            strokeInput.addEventListener("blur", () => { widthEditing = false; });
            strokeLabel.append(strokeInput); stroke.append(strokeLabel);
            const colorLabel = document.createElement("label"); colorLabel.textContent = composerText("描边颜色");
            const colorInput = document.createElement("input"); colorInput.type = "color"; colorInput.value = layer.stroke_color || "#ffffff";
            let colorEditing = false;
            colorInput.addEventListener("input", () => { if (!colorEditing && colorInput.value !== layer.stroke_color) { recordHistory("调整描边颜色"); colorEditing = true; } layer.stroke_color = colorInput.value; redraw(false); });
            colorInput.addEventListener("change", () => { colorEditing = false; }); colorLabel.append(colorInput);
            stroke.append(colorLabel); properties.append(stroke);
        }
        properties.append(makeSwitch("橡皮擦", eraserMode, !layer.cutout_source, (checked) => { eraserMode = checked; redraw(); }));
        const brush = document.createElement("label"); brush.className = "no8d-composer-brush"; brush.textContent = composerText("笔刷");
        const slider = document.createElement("input"); slider.type = "range"; slider.min = "5"; slider.max = "300"; slider.value = String(brushSize);
        const brushText = document.createElement("span"); brushText.textContent = String(brushSize);
        slider.addEventListener("input", () => { brushSize = Number(slider.value); brushText.textContent = slider.value; }); brush.append(slider, brushText);
        const removeLayer = makeButton("删除当前图层", () => { recordHistory("删除图层"); const index = state.layers.indexOf(layer); state.layers.splice(index, 1); runtime.delete(layer.id); selectedIds.delete(layer.id); selectedId = state.layers[state.layers.length - 1]?.id || null; if (selectedId) selectedIds.add(selectedId); eraserMode = false; redraw(); });
        if (eraserMode) properties.append(brush);
        properties.append(removeLayer); sidebar.append(heading, properties);
    }

    function reorderLayer(sourceId, targetId) {
        if (!sourceId || sourceId === targetId) return;
        const topFirst = [...state.layers].reverse(); const from = topFirst.findIndex((layer) => layer.id === sourceId); const to = topFirst.findIndex((layer) => layer.id === targetId);
        if (from < 0 || to < 0) return;
        recordHistory("调整图层顺序"); const [moved] = topFirst.splice(from, 1); topFirst.splice(to, 0, moved); state.layers = topFirst.reverse(); redraw();
    }

    async function addFiles(files) {
        const images = [...files].filter((file) => file.type.startsWith("image/")); if (!images.length || busy) return;
        busy = true; setButtonsDisabled(true); setStatus(`正在导入 ${images.length} 张图片…`);
        try {
            for (const file of images) {
                const dims = await sourceDimensions(file); const uploaded = await uploadBlob(file, safeName(file.name)); const size = currentSize();
                const scale = Math.min(1, size.width * .72 / dims.width, size.height * .72 / dims.height);
                const layer = { id: `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, name: file.name.replace(/\.[^.]+$/, ""), source: { ...uploaded, ...dims }, cutout_source: null, eraser_mask: null, x: size.width / 2 + state.layers.length * 18, y: size.height / 2 + state.layers.length * 18, scale: Math.max(MIN_SCALE, scale), rotation: 0, opacity: 1, blend_mode: "normal", visible: true, locked: false, flip_horizontal: false, flip_vertical: false, stroke_enabled: false, stroke_width: 0, stroke_color: "#ffffff" };
                recordHistory("添加图片"); state.layers.push(layer); selectedIds.clear(); selectedIds.add(layer.id); selectedId = layer.id; eraserMode = false; await ensureRuntime(layer);
            }
            redraw(); setStatus("");
        } catch (error) { redraw(); setStatus(error.message || "图片导入失败", true); }
        finally { busy = false; setButtonsDisabled(false); fileInput.value = ""; }
    }

    async function removeBackground(layer) {
        if (busy) return;
        busy = true; setButtonsDisabled(true); setStatus("正在抠图，首次使用可能需要加载模型…");
        try {
            const originalResponse = await fetch(refUrl(layer.source)); if (!originalResponse.ok) throw new Error("无法读取原图");
            const original = await originalResponse.blob(); const form = new FormData();
            form.append("image", new File([original], safeName(layer.source.filename), { type: original.type || "image/png" }));
            const response = await api.fetchApi("/no8d/image-composer/remove-background", { method: "POST", body: form });
            if (!response.ok) {
                let message = "抠图失败";
                try { message = (await response.clone().json()).error || message; } catch (_) { message = (await response.text()) || message; }
                throw new Error(message);
            }
            const result = await response.blob(); const uploaded = await uploadBlob(result, `cutout-${Date.now()}.png`);
            recordHistory("抠像"); layer.cutout_source = { ...uploaded, width: layer.source.width, height: layer.source.height };
            const item = runtime.get(layer.id); if (item) { item.imageKey = ""; item.dirty = true; }
            await ensureRuntime(layer); eraserMode = false;
            redraw(); setStatus("抠图完成");
        } catch (error) { setStatus(error.message || "抠图失败", true); }
        finally { busy = false; setButtonsDisabled(false); }
    }

    function setButtonsDisabled(value) {
        addButton.disabled = value; save.disabled = value;
        if (value) sidebar.querySelectorAll("button,input,select").forEach((control) => { control.disabled = true; });
        else redraw();
        updateHistoryButtons();
    }
    function canvasPoint(event) {
        const rect = canvas.getBoundingClientRect(); const size = currentSize();
        const screenX = (event.clientX - rect.left) * stage.clientWidth / rect.width;
        const screenY = (event.clientY - rect.top) * stage.clientHeight / rect.height;
        return { x: (screenX - stage.clientWidth / 2 - panX) / viewScale + size.width / 2, y: (screenY - stage.clientHeight / 2 - panY) / viewScale + size.height / 2 };
    }
    function toLayerLocal(point, layer) {
        const angle = -(Number(layer.rotation) || 0) * Math.PI / 180; const rotated = rotatePoint(point.x - layer.x, point.y - layer.y, angle); const scale = Math.max(MIN_SCALE, Number(layer.scale) || 1);
        return { x: rotated.x / scale, y: rotated.y / scale };
    }
    function pointInLayer(point, layer) {
        const local = toLayerLocal(point, layer); const dims = layerSize(layer, runtime.get(layer.id)); const bounds = contentBounds(layer);
        const sourceX = (layer.flip_horizontal ? -local.x : local.x) + dims.width / 2;
        const sourceY = (layer.flip_vertical ? -local.y : local.y) + dims.height / 2;
        return sourceX >= bounds.left && sourceX <= bounds.right && sourceY >= bounds.top && sourceY <= bounds.bottom;
    }
    function hitLayer(point) {
        for (const layer of [...state.layers].reverse()) {
            if (layer.visible === false || layer.locked) continue;
            if (pointInLayer(point, layer)) return layer;
        }
        return null;
    }
    function selectedHandle(point) {
        const layer = selectedLayer(); if (!layer || layer.locked || selectedIds.size !== 1) return null;
        const local = toLayerLocal(point, layer); const rect = selectionRect(layer); const scale = Math.max(MIN_SCALE, layer.scale); const threshold = HANDLE_SIZE / viewScale / scale * 1.2;
        const left = rect.x / scale; const right = (rect.x + rect.width) / scale; const top = rect.y / scale; const bottom = (rect.y + rect.height) / scale;
        for (const [x, y] of [[left, top], [right, top], [right, bottom], [left, bottom]]) {
            if (Math.hypot(local.x - x, local.y - y) <= threshold) return "scale";
        }
        const rotationX = (left + right) / 2; const rotationY = top - 32 / viewScale / Math.max(MIN_SCALE, layer.scale);
        return Math.hypot(local.x - rotationX, local.y - rotationY) <= threshold * 1.2 ? "rotate" : null;
    }

    function layerWorldBounds(layer) {
        const rect = selectionRect(layer); const angle = (Number(layer.rotation) || 0) * Math.PI / 180;
        const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x + rect.width, rect.y + rect.height], [rect.x, rect.y + rect.height]]
            .map(([x, y]) => rotatePoint(x, y, angle))
            .map((point) => ({ x: point.x + layer.x, y: point.y + layer.y }));
        return { left: Math.min(...corners.map((point) => point.x)), right: Math.max(...corners.map((point) => point.x)), top: Math.min(...corners.map((point) => point.y)), bottom: Math.max(...corners.map((point) => point.y)) };
    }

    function finishMarquee(selection) {
        const left = Math.min(selection.start.x, selection.current.x); const right = Math.max(selection.start.x, selection.current.x);
        const top = Math.min(selection.start.y, selection.current.y); const bottom = Math.max(selection.start.y, selection.current.y);
        selectedIds.clear();
        for (const id of selection.initialIds) selectedIds.add(id);
        for (const layer of state.layers) {
            if (layer.visible === false) continue;
            const bounds = layerWorldBounds(layer);
            if (bounds.right >= left && bounds.left <= right && bounds.bottom >= top && bounds.top <= bottom) selectedIds.add(layer.id);
        }
        selectedId = [...state.layers].reverse().find((layer) => selectedIds.has(layer.id))?.id || null;
    }
    function ensureMask(layer) {
        const item = runtime.get(layer.id); if (!item) return null;
        if (!item.mask) { const dims = layerSize(layer, item); item.mask = document.createElement("canvas"); item.mask.width = dims.width; item.mask.height = dims.height; }
        return item.mask;
    }
    function eraseAt(point, previous = null) {
        const layer = selectedLayer(); const item = selectedRuntime(); if (!layer || !item) return;
        const dims = layerSize(layer, item); const local = toLayerLocal(point, layer);
        const current = { x: (layer.flip_horizontal ? -local.x : local.x) + dims.width / 2, y: (layer.flip_vertical ? -local.y : local.y) + dims.height / 2 }; const mask = ensureMask(layer); if (!mask) return;
        const context = mask.getContext("2d"); context.strokeStyle = "#fff"; context.lineWidth = brushSize; context.lineCap = "round"; context.lineJoin = "round"; context.beginPath();
        if (previous) context.moveTo(previous.x, previous.y); else context.moveTo(current.x, current.y); context.lineTo(current.x, current.y); context.stroke();
        item.maskDirty = true; item.dirty = true; item.outlineKey = ""; interaction.lastMaskPoint = current; redraw(false);
    }

    canvas.addEventListener("pointerdown", (event) => {
        if (busy) return;
        const point = canvasPoint(event);
        pointerPosition = point;
        if (spaceDown) {
            interaction = { mode: "pan", clientX: event.clientX, clientY: event.clientY, startPanX: panX, startPanY: panY };
            canvas.style.cursor = "grabbing"; canvas.setPointerCapture(event.pointerId); return;
        }
        const handle = selectedHandle(point); const active = selectedLayer();
        if (eraserMode) {
            if (active?.cutout_source && active.visible !== false && !active.locked && pointInLayer(point, active)) {
                recordHistory("擦除图层"); interaction = { mode: "erase", layer: active, lastMaskPoint: null }; canvas.setPointerCapture(event.pointerId); eraseAt(point);
            }
            return;
        }
        if (handle && active) {
            const distance = Math.max(1, Math.hypot(point.x - active.x, point.y - active.y));
            interaction = { mode: handle, layer: active, start: point, historyRecorded: false, startScale: active.scale, startDistance: distance, angleOffset: Math.atan2(point.y - active.y, point.x - active.x) - active.rotation * Math.PI / 180 };
            canvas.setPointerCapture(event.pointerId); return;
        }
        const layer = hitLayer(point);
        if (!layer) {
            const initialIds = event.shiftKey ? new Set(selectedIds) : new Set();
            if (!event.shiftKey) { selectedIds.clear(); selectedId = null; }
            eraserMode = false; interaction = { mode: "marquee", start: point, current: point, initialIds }; canvas.setPointerCapture(event.pointerId); redraw(); return;
        }
        if (!selectedIds.has(layer.id)) {
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey) selectedIds.clear();
            selectedIds.add(layer.id);
        }
        selectedId = layer.id; eraserMode = false;
        interaction = { mode: "move", start: point, historyRecorded: false, positions: new Map(selectedLayers().filter((item) => !item.locked).map((item) => [item.id, { x: item.x, y: item.y }])) };
        canvas.setPointerCapture(event.pointerId); redraw();
    });
    canvas.addEventListener("pointermove", (event) => {
        pointerPosition = canvasPoint(event);
        if (!interaction) { if (eraserMode) redraw(false); return; }
        if (interaction.mode === "pan") { panX = interaction.startPanX + event.clientX - interaction.clientX; panY = interaction.startPanY + event.clientY - interaction.clientY; redraw(false); return; }
        const point = canvasPoint(event); const layer = interaction.layer;
        if (["move", "scale", "rotate"].includes(interaction.mode) && !interaction.historyRecorded
            && (point.x !== interaction.start.x || point.y !== interaction.start.y)) {
            recordHistory(interaction.mode === "move" ? "移动图层" : interaction.mode === "scale" ? "缩放图层" : "旋转图层"); interaction.historyRecorded = true;
        }
        if (interaction.mode === "move") {
            const dx = point.x - interaction.start.x; const dy = point.y - interaction.start.y;
            for (const selected of selectedLayers()) { const origin = interaction.positions.get(selected.id); if (origin) { selected.x = origin.x + dx; selected.y = origin.y + dy; } }
        }
        else if (interaction.mode === "scale") { const distance = Math.max(1, Math.hypot(point.x - layer.x, point.y - layer.y)); layer.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, interaction.startScale * distance / interaction.startDistance)); }
        else if (interaction.mode === "rotate") { layer.rotation = normalizeAngle((Math.atan2(point.y - layer.y, point.x - layer.x) - interaction.angleOffset) * 180 / Math.PI); }
        else if (interaction.mode === "erase") { eraseAt(point, interaction.lastMaskPoint); return; }
        else if (interaction.mode === "marquee") { interaction.current = point; }
        redraw(false);
    });
    const finishPointer = (event) => {
        if (!interaction) return;
        const finished = interaction;
        if (finished.mode === "marquee") finishMarquee(finished);
        if (finished.mode === "erase") { const item = runtime.get(finished.layer.id); if (item) item.boundsDirty = true; }
        interaction = null; canvas.style.cursor = spaceDown ? "grab" : "default"; canvas.releasePointerCapture?.(event.pointerId); redraw();
    };
    canvas.addEventListener("pointerup", finishPointer); canvas.addEventListener("pointercancel", finishPointer);
    canvas.addEventListener("pointerleave", () => { pointerPosition = null; if (!interaction) redraw(false); });
    stage.addEventListener("wheel", (event) => {
        event.preventDefault();
        const size = currentSize(); const oldScale = viewScale; const rect = canvas.getBoundingClientRect();
        const screenX = event.clientX - rect.left; const screenY = event.clientY - rect.top;
        const worldX = (screenX - stage.clientWidth / 2 - panX) / oldScale + size.width / 2;
        const worldY = (screenY - stage.clientHeight / 2 - panY) / oldScale + size.height / 2;
        userZoom = Math.min(4, Math.max(.2, userZoom * (event.deltaY < 0 ? 1.12 : .89)));
        const fit = Math.min(1, Math.max(120, stage.clientWidth - 96) / size.width, Math.max(120, stage.clientHeight - 96) / size.height);
        const newScale = fit * userZoom;
        panX = screenX - stage.clientWidth / 2 - (worldX - size.width / 2) * newScale;
        panY = screenY - stage.clientHeight / 2 - (worldY - size.height / 2) * newScale;
        redraw(false);
    }, { passive: false });

    ratioSelect.addEventListener("change", () => resizeCanvas(ratioSelect.value, Number(sideSelect.value)));
    sideSelect.addEventListener("change", () => resizeCanvas(ratioSelect.value, Number(sideSelect.value)));
    function resizeCanvas(ratio, shortSide) {
        if (state.ratio === ratio && Number(state.short_side) === shortSide) return;
        recordHistory("调整画布尺寸"); const old = currentSize(); state.ratio = ratio; state.short_side = shortSide; const next = currentSize();
        for (const layer of state.layers) {
            const oldX = Number(layer.x); const oldY = Number(layer.y);
            layer.x = (Number.isFinite(oldX) ? oldX : old.width / 2) * next.width / old.width;
            layer.y = (Number.isFinite(oldY) ? oldY : old.height / 2) * next.height / old.height;
            layer.scale *= Math.min(next.width / old.width, next.height / old.height);
        }
        userZoom = 1; redraw();
    }
    fileInput.addEventListener("change", () => addFiles(fileInput.files));
    stage.addEventListener("dragover", (event) => { if ([...event.dataTransfer?.types || []].includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } });
    stage.addEventListener("drop", (event) => { if (!event.dataTransfer?.files?.length) return; event.preventDefault(); addFiles(event.dataTransfer.files); });
    const pasteHandler = (event) => {
        const files = [...event.clipboardData?.items || []].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
        if (files.length) { event.preventDefault(); event.stopImmediatePropagation(); addFiles(files); }
    };
    window.addEventListener("paste", pasteHandler, true);

    async function saveDirtyMasks() {
        for (const layer of state.layers) {
            const item = runtime.get(layer.id); if (!item?.maskDirty || !item.mask) continue;
            const blob = await new Promise((resolve) => item.mask.toBlob(resolve, "image/png")); if (!blob) throw new Error("橡皮擦蒙版保存失败");
            const uploaded = await uploadBlob(blob, `eraser-${Date.now()}-${safeName(layer.source.filename)}.png`);
            layer.eraser_mask = { ...uploaded, width: item.mask.width, height: item.mask.height }; item.maskDirty = false; item.maskKey = refKey(layer.eraser_mask);
        }
    }
    async function saveLayout() {
        if (busy) return;
        busy = true; setButtonsDisabled(true); setStatus("正在保存布局…");
        try { await saveDirtyMasks(); writeState(node, state); renderNodePreview(node, state); close(); }
        catch (error) { setStatus(error.message || "布局保存失败", true); busy = false; setButtonsDisabled(false); }
    }
    function close() {
        if (openEditorRefresh === refreshEditorLocale) openEditorRefresh = null;
        observer.disconnect(); window.removeEventListener("keydown", keyHandler, true); window.removeEventListener("keyup", keyUpHandler, true); window.removeEventListener("paste", pasteHandler, true); overlay.remove();
    }
    const keyHandler = (event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopImmediatePropagation(); close(); return; }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && ["z", "y"].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (event.key.toLowerCase() === "y" || event.shiftKey) redo(); else undo();
            return;
        }
        const focused = document.activeElement;
        const editingValue = focused?.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(focused?.tagName);
        if (editingValue || busy) return;
        if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "v" && selectedIds.size) {
            event.preventDefault(); event.stopImmediatePropagation();
            recordHistory();
            const nextVisible = selectedLayers().some((layer) => layer.visible === false);
            for (const layer of selectedLayers()) layer.visible = nextVisible;
            redraw(); return;
        }
        if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "l") {
            if (!selectedIds.size) return;
            event.preventDefault(); event.stopImmediatePropagation();
            recordHistory();
            const nextLocked = selectedLayers().some((layer) => !layer.locked);
            for (const layer of selectedLayers()) layer.locked = nextLocked;
            eraserMode = false; redraw(); return;
        }
        if (event.key === "Delete" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const deletable = selectedLayers().filter((layer) => !layer.locked);
            if (!deletable.length) return;
            event.preventDefault(); event.stopImmediatePropagation();
            recordHistory();
            const ids = new Set(deletable.map((layer) => layer.id));
            state.layers = state.layers.filter((layer) => !ids.has(layer.id));
            for (const id of ids) { runtime.delete(id); selectedIds.delete(id); }
            selectedId = [...state.layers].reverse().find((layer) => selectedIds.has(layer.id))?.id || null;
            eraserMode = false; redraw(); return;
        }
        const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
        if (arrows[event.key] && !event.ctrlKey && !event.metaKey && !event.altKey && !eraserMode) {
            const targets = selectedLayers().filter((layer) => !layer.locked);
            if (!targets.length) return;
            event.preventDefault(); event.stopImmediatePropagation();
            if (!event.repeat) recordHistory();
            const [dx, dy] = arrows[event.key]; const step = event.shiftKey ? 10 : 1;
            for (const layer of targets) { layer.x += dx * step; layer.y += dy * step; }
            redraw(false); return;
        }
        if (event.code !== "Space" || focused?.tagName === "BUTTON") return;
        event.preventDefault(); event.stopImmediatePropagation(); spaceDown = true; if (!interaction) canvas.style.cursor = "grab";
    };
    const keyUpHandler = (event) => {
        if (event.code !== "Space") return;
        event.preventDefault(); event.stopImmediatePropagation(); spaceDown = false; if (interaction?.mode !== "pan") canvas.style.cursor = "default";
    };
    window.addEventListener("keydown", keyHandler, true);
    window.addEventListener("keyup", keyUpHandler, true);
    overlay.addEventListener("mousedown", (event) => { if (event.target === overlay && !busy) close(); });
    const observer = new ResizeObserver(() => redraw(false)); observer.observe(stage);
    Promise.all(state.layers.map(ensureRuntime)).then(() => redraw()); requestAnimationFrame(() => redraw());
}

async function renderNodePreview(node, suppliedState = null) {
    const preview = node?._no8dComposerPreview; if (!preview?.canvas) return;
    const state = suppliedState || readState(node); const size = canvasSize(state); const canvas = preview.canvas; const scale = Math.min(300 / size.width, 210 / size.height);
    canvas.width = Math.max(1, Math.round(size.width * scale)); canvas.height = Math.max(1, Math.round(size.height * scale));
    const context = canvas.getContext("2d"); context.fillStyle = "#000"; context.fillRect(0, 0, canvas.width, canvas.height);
    for (const layer of state.layers) {
        if (layer.visible === false) continue;
        try {
            const source = await loadHtmlImage(refUrl(layer.cutout_source || layer.source)); let drawable = source;
            if (layer.cutout_source && layer.eraser_mask) {
                const mask = await loadHtmlImage(refUrl(layer.eraser_mask)); const processed = document.createElement("canvas"); processed.width = source.naturalWidth; processed.height = source.naturalHeight;
                const processedContext = processed.getContext("2d"); processedContext.drawImage(source, 0, 0); processedContext.globalCompositeOperation = "destination-out"; processedContext.drawImage(mask, 0, 0, processed.width, processed.height); drawable = processed;
            }
            const x = (Number.isFinite(Number(layer.x)) ? Number(layer.x) : size.width / 2) * scale; const y = (Number.isFinite(Number(layer.y)) ? Number(layer.y) : size.height / 2) * scale; const layerScale = Math.max(MIN_SCALE, Number(layer.scale) || 1) * scale;
            context.save(); context.translate(x, y); context.rotate((Number(layer.rotation) || 0) * Math.PI / 180); context.globalAlpha = layer.opacity; context.globalCompositeOperation = layer.blend_mode === "normal" ? "source-over" : (layer.blend_mode || "source-over");
            context.scale(layer.flip_horizontal ? -1 : 1, layer.flip_vertical ? -1 : 1);
            const drawWidth = source.naturalWidth * layerScale; const drawHeight = source.naturalHeight * layerScale;
            const stroke = layer.cutout_source && layer.stroke_enabled ? Math.min(40, Math.max(0, Number(layer.stroke_width) || 0)) : 0;
            if (stroke) {
                const silhouette = document.createElement("canvas"); silhouette.width = source.naturalWidth; silhouette.height = source.naturalHeight;
                const silhouetteContext = silhouette.getContext("2d"); silhouetteContext.drawImage(drawable, 0, 0);
                silhouetteContext.globalCompositeOperation = "source-in"; silhouetteContext.fillStyle = layer.stroke_color || "#ffffff"; silhouetteContext.fillRect(0, 0, silhouette.width, silhouette.height);
                for (let step = 0; step < 24; step++) {
                    const angle = step * Math.PI / 12;
                    context.drawImage(silhouette, -drawWidth / 2 + Math.cos(angle) * stroke * layerScale, -drawHeight / 2 + Math.sin(angle) * stroke * layerScale, drawWidth, drawHeight);
                }
            }
            context.drawImage(drawable, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight); context.restore();
        } catch (error) { console.warn("NO8D Image Composer: node preview failed", error); }
    }
    app.graph?.setDirtyCanvas?.(true, true);
}

function hideLayoutWidget(node) {
    const layout = getWidget(node, "layout_json");
    if (!layout) return;
    layout.options = layout.options || {};
    layout.options.hidden = true;
    layout.options.collapsed = true;
    layout.type = "converted-widget";
    layout.hidden = true;
    layout.serialize = true;
    layout.computeSize = () => [0, -4];
    layout.draw = () => {};
    if (layout.inputEl) layout.inputEl.style.display = "none";
}

function activate(node) {
    if (!isComposer(node) || node._no8dComposerReady) return;
    node._no8dComposerReady = true;
    hideLayoutWidget(node);
    const root = document.createElement("div"); root.className = "no8d-composer-node";
    const preview = document.createElement("div"); preview.className = "no8d-composer-node-preview";
    const canvas = document.createElement("canvas"); preview.appendChild(canvas);
    const button = makeButton("打开图层合成器", () => openEditor(node)); root.append(preview, button);
    node._no8dComposerPreview = { root, canvas, button };
    const domWidget = node.addDOMWidget?.("no8d_composer_editor", "NO8D_IMAGE_COMPOSER", root, { serialize: false, hideOnZoom: false, getValue: () => undefined, setValue: () => {} });
    if (domWidget) domWidget.serialize = false;
    node.setSize?.([Math.max(320, node.size?.[0] || 320), 330]); renderNodePreview(node);
}

app.registerExtension({
    name: "NO8D.Control.ImageComposer",
    setup() {
        refreshComposerLocale(true);
        window.addEventListener("storage", () => refreshComposerLocale(true));
        window.addEventListener("languagechange", () => refreshComposerLocale(true));
        setInterval(() => refreshComposerLocale(), 1000);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () { onCreated?.apply(this, arguments); activate(this); };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () { onConfigure?.apply(this, arguments); setTimeout(() => { hideLayoutWidget(this); activate(this); renderNodePreview(this); }, 0); };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) { onExecuted?.apply(this, arguments); this.imgs = null; this.images = null; renderNodePreview(this); };
    },
    nodeCreated(node) { hideLayoutWidget(node); activate(node); },
});
