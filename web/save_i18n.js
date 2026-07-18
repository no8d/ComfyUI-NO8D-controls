import { app } from "../../scripts/app.js";
import { no8dLocale, t } from "./no8d_i18n.js";
import { passMouseToComfy, shouldPassMouseToComfy } from "./no8d_comfy_events.js";
import { refreshBypassElements, registerBypassElement, wrapBypassRefresh } from "./no8d_bypass.js";

const NODE_CLASS = "NO8DSaveImageTextDataset";
const VARIABLES = ["none", "original_name", "datetime", "size_class"];
const SAVE_DEFAULT_WIDTH = 520;
const SAVE_BASE_HEIGHT = 240;
const SAVE_ROW_HEIGHT = 34;
let activeLocale = "";

function nodeClass(node) {
    return node?.comfyClass || node?.type || "";
}

function findWidget(node, name) {
    return (node.widgets || []).find((widget) => widget.name === name);
}

function setWidget(widget, value) {
    if (!widget) return;
    widget.value = value;
    try {
        widget.callback?.(value, app.canvas, widget.node || null);
    } catch (_) {}
}

function stopGraphEvents(el) {
    el.addEventListener("pointerdown", (e) => {
        if (shouldPassMouseToComfy(e)) {
            el._no8dSavePassPointerId = e.pointerId;
            passMouseToComfy(e);
            return;
        }
        e.stopPropagation();
    });
    el.addEventListener("pointermove", (e) => {
        if (el._no8dSavePassPointerId === e.pointerId) passMouseToComfy(e);
    });
    el.addEventListener("pointerup", (e) => {
        if (el._no8dSavePassPointerId === e.pointerId) {
            el._no8dSavePassPointerId = null;
            passMouseToComfy(e);
        }
    });
    el.addEventListener("mousedown", (e) => {
        if (!shouldPassMouseToComfy(e)) e.stopPropagation();
    });
    el.addEventListener("wheel", (e) => passMouseToComfy(e), { passive: true });
}

function hideNamePartsWidget(node) {
    const widget = findWidget(node, "name_parts_json");
    if (!widget) return;
    widget.options = widget.options || {};
    widget.options.hidden = true;
    widget.options.collapsed = true;
    widget.type = "converted-widget";
    widget.hidden = true;
    widget.serialize = true;
    widget.computeSize = () => [0, -4];
    widget.draw = () => {};
}

function readParts(node) {
    try {
        const parsed = JSON.parse(findWidget(node, "name_parts_json")?.value || "[]");
        if (!Array.isArray(parsed) || !parsed.length) return [{ variable: "none", text: "" }];
        return parsed.map((part) => ({
            variable: VARIABLES.includes(part?.variable) ? part.variable : "none",
            text: String(part?.text || ""),
        }));
    } catch (_) {
        return [{ variable: "none", text: "" }];
    }
}

function writeParts(node, parts) {
    setWidget(findWidget(node, "name_parts_json"), JSON.stringify(parts));
    node.graph?.change?.();
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function ensureHeightForParts(node, count) {
    if (!node?.size) return;
    const wanted = SAVE_BASE_HEIGHT + Math.max(0, count - 1) * SAVE_ROW_HEIGHT;
    if (node.size[1] < wanted) {
        node.size[1] = wanted;
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
}

function variableLabel(value) {
    return t(`saveVar_${value}`) || value;
}

function makeSelect(value, onChange) {
    const select = document.createElement("select");
    select.style.cssText = "height:26px; min-width:130px; flex:0 0 130px; background:#242424; color:#ddd; border:1px solid #555; border-radius:4px; padding:0 6px;";
    for (const variable of VARIABLES) {
        const option = document.createElement("option");
        option.value = variable;
        option.textContent = variableLabel(variable);
        select.appendChild(option);
    }
    select.value = VARIABLES.includes(value) ? value : "none";
    select.addEventListener("change", () => onChange(select.value));
    stopGraphEvents(select);
    return select;
}

function makeInput(value, onChange, disabled = false) {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    input.placeholder = t("saveFixedText");
    input.disabled = disabled;
    input.style.cssText = [
        "height:26px",
        "min-width:0",
        "flex:1 1 auto",
        `background:${disabled ? "#2f2f2f" : "#1f1f1f"}`,
        `color:${disabled ? "#7f8794" : "#ddd"}`,
        "border:1px solid #555",
        "border-radius:4px",
        "padding:0 8px",
        `cursor:${disabled ? "not-allowed" : "text"}`,
        "box-sizing:border-box",
    ].join(";") + ";";
    input.addEventListener("input", () => onChange(input.value));
    stopGraphEvents(input);
    return input;
}

function makeButton(label, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title || label;
    button.style.cssText = "height:28px; min-width:34px; padding:0 10px; border:1px solid #2563eb; border-radius:5px; background:#24272d; color:#fff; font-weight:700; cursor:pointer;";
    button.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    stopGraphEvents(button);
    return button;
}

function makeDragHandle() {
    const handle = document.createElement("div");
    handle.innerHTML = "&#8942;&#8942;";
    handle.draggable = true;
    handle.title = t("dragReorder");
    handle.style.cssText = "width:22px; flex:0 0 22px; height:26px; display:flex; align-items:center; justify-content:center; color:#9ca3af; cursor:grab; font-size:18px; line-height:1; user-select:none;";
    stopGraphEvents(handle);
    return handle;
}

function reorderParts(parts, fromIndex, toIndex) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return parts;
    const next = parts.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, item);
    return next;
}

function clearDropStyles(list) {
    for (const item of list.children) {
        item.style.background = "";
        item.style.boxShadow = "";
        item.dataset.dropPosition = "";
    }
}

function renderSaveUi(node) {
    const els = node._no8dSaveEls;
    if (!els) return;
    if (els.title) els.title.textContent = t("saveNamingRules");
    if (els.add) {
        els.add.textContent = `+ ${t("saveAddPart")}`;
        els.add.title = t("saveAddPart");
    }
    const parts = readParts(node);
    ensureHeightForParts(node, parts.length);
    els.list.replaceChildren();
    parts.forEach((part, index) => {
        const row = document.createElement("div");
        row.dataset.index = String(index);
        row.style.cssText = "display:flex; align-items:center; gap:6px; width:100%; margin-bottom:6px; border-radius:4px; transition:background 80ms ease, box-shadow 80ms ease;";
        const handle = makeDragHandle();
        handle.addEventListener("dragstart", (e) => {
            e.stopPropagation();
            row.style.opacity = "0.55";
            row.style.outline = "1px solid #2563eb";
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-no8d-save-part-index", String(index));
        });
        handle.addEventListener("dragend", (e) => {
            e.stopPropagation();
            row.style.opacity = "";
            row.style.outline = "";
            clearDropStyles(els.list);
        });
        row.addEventListener("dragover", (e) => {
            if (!e.dataTransfer.types.includes("application/x-no8d-save-part-index")) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            clearDropStyles(els.list);
            const rect = row.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            row.dataset.dropPosition = after ? "after" : "before";
            row.style.background = "rgba(37,99,235,0.18)";
            row.style.boxShadow = after ? "inset 0 -3px 0 #2563eb" : "inset 0 3px 0 #2563eb";
        });
        row.addEventListener("dragleave", () => {
            row.style.background = "";
            row.style.boxShadow = "";
            row.dataset.dropPosition = "";
        });
        row.addEventListener("drop", (e) => {
            if (!e.dataTransfer.types.includes("application/x-no8d-save-part-index")) return;
            e.preventDefault();
            e.stopPropagation();
            const fromIndex = Number(e.dataTransfer.getData("application/x-no8d-save-part-index"));
            const targetIndex = index + (row.dataset.dropPosition === "after" ? 1 : 0);
            const toIndex = fromIndex < targetIndex ? targetIndex - 1 : targetIndex;
            clearDropStyles(els.list);
            const next = reorderParts(parts, fromIndex, toIndex);
            writeParts(node, next);
            renderSaveUi(node);
        });
        const select = makeSelect(part.variable, (value) => {
            parts[index].variable = value;
            if (value !== "none") parts[index].text = "";
            writeParts(node, parts);
            renderSaveUi(node);
        });
        const input = makeInput(part.variable === "none" ? part.text : "", (value) => {
            parts[index].text = value;
            writeParts(node, parts);
        }, part.variable !== "none");
        row.append(handle, select, input);
        if (parts.length > 1) {
            row.appendChild(makeButton("×", t("saveDeletePart"), () => {
                parts.splice(index, 1);
                writeParts(node, parts);
                renderSaveUi(node);
            }));
        }
        els.list.appendChild(row);
    });
    els.add.disabled = false;
}

function makeSaveUi(node) {
    const root = document.createElement("div");
    root.classList.add("no8d-ui");
    root.style.cssText = "display:flex; flex-direction:column; gap:8px; width:100%; height:100%; box-sizing:border-box; padding:0 8px 8px 8px; overflow:hidden;";
    registerBypassElement(node, root);
    const title = document.createElement("div");
    title.textContent = t("saveNamingRules");
    title.style.cssText = "color:#cbd5e1; font-weight:700; font-size:13px;";
    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; width:100%;";
    const add = makeButton(`+ ${t("saveAddPart")}`, t("saveAddPart"), () => {
        const parts = readParts(node);
        parts.push({ variable: "none", text: "" });
        writeParts(node, parts);
        renderSaveUi(node);
    });
    const footer = document.createElement("div");
    footer.style.cssText = "display:flex; width:100%;";
    add.style.width = "100%";
    add.style.height = "32px";
    footer.appendChild(add);
    root.append(title, list, footer);
    node._no8dSaveEls = { root, title, list, add };
    stopGraphEvents(root);
    return root;
}

function installSaveUi(node) {
    if (node._no8dSaveWidget || typeof node.addDOMWidget !== "function") return;
    hideNamePartsWidget(node);
    node.properties = node.properties || {};
    if (!node.properties.no8d_save_size_initialized && node.size?.[0] > SAVE_DEFAULT_WIDTH) {
        node.size[0] = SAVE_DEFAULT_WIDTH;
        node.properties.no8d_save_size_initialized = true;
    }
    const root = makeSaveUi(node);
    const widget = node.addDOMWidget("no8d_save", "save", root, {
        serialize: false,
        hideOnZoom: false,
    });
    widget.serialize = false;
    widget.computeLayoutSize = () => ({ minWidth: 360, minHeight: 120, maxWidth: 1_000_000, maxHeight: 1_000_000 });
    node._no8dSaveWidget = widget;
    renderSaveUi(node);
    refreshBypassElements(node);
}

function applyLabels(node) {
    if (nodeClass(node) !== NODE_CLASS) return;
    node.title = t("saveTitle");
    const labels = {
        folder_path: "saveFolderPath",
        image_format: "saveImageFormat",
        quality: "saveQuality",
        embed_metadata: "saveEmbedMetadata",
    };
    for (const widget of node.widgets || []) {
        const key = labels[widget.name];
        if (!key) continue;
        widget.label = t(key);
        widget.options = widget.options || {};
        widget.options.label = t(key);
    }
    hideNamePartsWidget(node);
    renderSaveUi(node);
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

app.registerExtension({
    name: "NO8D.Control.Save",
    async setup() {
        activeLocale = no8dLocale();
        setTimeout(() => applyAllLabelsIfNeeded(true), 500);
        window.addEventListener("storage", () => applyAllLabelsIfNeeded(true));
        window.addEventListener("languagechange", () => applyAllLabelsIfNeeded(true));
    },
    async nodeCreated(node) {
        if (nodeClass(node) !== NODE_CLASS) return;
        installSaveUi(node);
        applyLabels(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_CLASS) return;
        wrapBypassRefresh(nodeType);
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onCreated?.apply(this, arguments);
            installSaveUi(this);
            applyLabels(this);
            refreshBypassElements(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => {
                installSaveUi(this);
                applyLabels(this);
                refreshBypassElements(this);
            }, 0);
        };
    },
});
