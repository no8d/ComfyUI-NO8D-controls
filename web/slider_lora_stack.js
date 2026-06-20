import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { passMouseToComfy, shouldPassKeyToComfy, shouldPassMouseToComfy } from "./no8d_comfy_events.js";
import { t } from "./no8d_i18n.js";

const NODE_NAME = "NO8DLoraStack";
const STACK_MIN_WIDTH = 620;
const STACK_BOTTOM_GAP = 16;

const stackPassThroughStyle = document.createElement("style");
stackPassThroughStyle.textContent = `
    .dom-widget.no8d-stack-widget { pointer-events: none !important; }
    .no8d-stack-control { pointer-events: auto; }
    .no8d-stack-reordering .no8d-stack-row { pointer-events: auto; }
`;
document.head.appendChild(stackPassThroughStyle);

function findWidget(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function setWidget(widget, value) {
    if (!widget) return;
    widget.value = value;
    try {
        if (typeof widget.callback === "function") {
            widget.callback(value, app.canvas, widget.node || null);
        }
    } catch (_) {}
}

function hideNativeWidgets(node) {
    for (const w of node.widgets || []) {
        if (!["lora_picker", "stack_json"].includes(w.name)) continue;
        w.options = w.options || {};
        w.options.hidden = true;
        w.options.collapsed = true;
        w.type = "converted-widget";
        w.hidden = true;
        w.computeSize = () => [0, -4];
        w.draw = () => {};
    }
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function defaultEntry(options) {
    return {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        name: options.includes("None") ? "None" : (options[0] || "None"),
        weight: 0,
        min: -6,
        max: 6,
        enabled: true,
    };
}

function getOptions(node) {
    return findWidget(node, "lora_picker")?.options?.values || ["None"];
}

function sameOptions(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
}

async function refreshLoraOptions(node) {
    try {
        const response = await api.fetchApi(`/object_info/${NODE_NAME}`);
        if (!response.ok) return false;
        const info = await response.json();
        const options = info?.[NODE_NAME]?.input?.required?.lora_picker?.[0];
        if (!Array.isArray(options) || !options.length) return false;
        const widget = findWidget(node, "lora_picker");
        if (!widget) return false;
        widget.options = widget.options || {};
        const current = widget.options.values || [];
        if (sameOptions(current, options)) return false;
        widget.options.values = options;
        return true;
    } catch (_) {
        return false;
    }
}

function readStack(node) {
    try {
        const raw = findWidget(node, "stack_json")?.value || "[]";
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function writeStack(node) {
    const serializable = (node._stackEntries || []).map((entry) => {
        const { _editingRange, ...rest } = entry;
        return rest;
    });
    setWidget(findWidget(node, "stack_json"), JSON.stringify(serializable));
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

function roundedWeight(value) {
    return Math.round(Number(value || 0) * 10) / 10;
}

function shortLoraName(name) {
    if (!name || name === "None") return name || "None";
    const file = String(name).split(/[\\/]/).pop() || String(name);
    return file.replace(/\.(safetensors|ckpt|pt|pth)$/i, "");
}

function makeButton(label, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.title = title;
    b.style.cssText = "cursor:pointer; min-width:26px; height:26px; border:1px solid #555; border-radius:4px; background:#242424; color:#ddd; font-weight:700;";
    stopGraphEvents(b);
    b.addEventListener("click", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    });
    return b;
}

function stopGraphEvents(el) {
    el.classList.add("no8d-stack-control");
    el.addEventListener("pointerdown", (e) => {
        if (shouldPassMouseToComfy(e)) {
            el._stackPassPointerId = e.pointerId;
            passMouseToComfy(e);
            return;
        }
        e.stopPropagation();
    });
    el.addEventListener("pointermove", (e) => {
        if (el._stackPassPointerId === e.pointerId) passMouseToComfy(e);
    });
    el.addEventListener("pointerup", (e) => {
        if (el._stackPassPointerId === e.pointerId) {
            el._stackPassPointerId = null;
            passMouseToComfy(e);
        }
    });
    el.addEventListener("pointercancel", (e) => {
        if (el._stackPassPointerId === e.pointerId) {
            el._stackPassPointerId = null;
            passMouseToComfy(e);
        }
    });
    el.addEventListener("mousedown", (e) => {
        if (shouldPassMouseToComfy(e)) return;
        e.stopPropagation();
    });
    el.addEventListener("touchstart", (e) => e.stopPropagation());
    el.addEventListener("wheel", (e) => passMouseToComfy(e), { passive: true });
    el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        passMouseToComfy(e);
    });
}

function showLoraMenu(input, menu, options, entry, node) {
    const query = input.value.toLowerCase();
    const filtered = (!query || query === "none")
        ? options.slice(0, 160)
        : options.filter((opt) => opt.toLowerCase().includes(query)).slice(0, 160);
    input._filteredOptions = filtered;
    input._activeIndex = Math.max(0, filtered.findIndex((opt) => opt === entry.name));
    menu.innerHTML = "";
    for (let idx = 0; idx < filtered.length; idx++) {
        const opt = filtered[idx];
        const item = document.createElement("div");
        item.textContent = opt;
        const selected = opt === entry.name;
        const active = idx === input._activeIndex;
        item.style.cssText = `padding:6px 10px; cursor:pointer; color:#dbeafe; background:${active || selected ? "rgba(59,130,246,0.28)" : "#151b24"}; border-bottom:1px solid #263244; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px;`;
        item.dataset.index = String(idx);
        item.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();
            entry.name = opt;
            input.value = shortLoraName(opt);
            writeStack(node);
            menu.style.display = "none";
        });
        menu.appendChild(item);
    }
    if (filtered.length) {
        const r = input.getBoundingClientRect();
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 4}px`;
        menu.style.width = `${Math.max(460, r.width)}px`;
        menu.style.display = "block";
    } else {
        menu.style.display = "none";
    }
}

function refreshMenuActive(input, menu) {
    const children = Array.from(menu.children);
    children.forEach((child, idx) => {
        child.style.background = idx === input._activeIndex ? "rgba(59,130,246,0.32)" : "#151b24";
    });
    const active = children[input._activeIndex];
    if (active) active.scrollIntoView({ block: "nearest" });
}

function stackPanelHeight(node) {
    const panel = node?._stackContainer;
    const measured = Math.ceil(panel?.scrollHeight || panel?.offsetHeight || 0);
    return measured || 120;
}

function stackWidgetHeight(node) {
    return stackPanelHeight(node) + STACK_BOTTOM_GAP;
}

function ensureStackNodeFitsContent(node) {
    if (!node || typeof node.setSize !== "function") return;
    const computed = node.computeSize?.();
    if (!Array.isArray(computed)) return;
    const width = Math.max(node.size?.[0] || computed[0], STACK_MIN_WIDTH);
    const height = Math.max(node.size?.[1] || computed[1], computed[1]);
    if (width === node.size?.[0] && height === node.size?.[1]) return;
    node.setSize([width, height]);
    node.graph?.setDirtyCanvas?.(true, true);
    app?.canvas?.setDirty?.(true, true);
}

function render(node) {
    hideNativeWidgets(node);
    const list = node._stackList;
    if (!list) return;
    for (const menu of node._stackMenus || []) menu.remove();
    node._stackMenus = [];
    list.innerHTML = "";
    let options = getOptions(node);
    const entries = node._stackEntries || [];
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry.id) entry.id = `${Date.now()}_${i}_${Math.random().toString(16).slice(2)}`;
        if (entry.min == null) entry.min = -6;
        if (entry.max == null) entry.max = 6;
        if (entry.weight == null) entry.weight = 0;
        if (entry.enabled == null) entry.enabled = true;

        const row = document.createElement("div");
        row.classList.add("no8d-stack-row");
        row.draggable = false;
        row.dataset.id = entry.id;
        row.style.cssText = "display:grid; grid-template-columns:24px 26px minmax(130px,1fr) minmax(120px,1.4fr) 72px 34px; gap:8px; align-items:center; padding:6px 8px; border-bottom:1px solid #333; transition:background 0.12s ease, outline 0.12s ease, transform 0.12s ease; min-width:0;";
        row.addEventListener("dragover", (e) => {
            if (!node._stackContainer?.classList.contains("no8d-stack-reordering")) return;
            e.preventDefault();
            row.style.background = "#102b4f";
            row.style.outline = "2px solid #3b82f6";
            row.style.transform = "translateY(-1px)";
        });
        row.addEventListener("dragleave", () => {
            row.style.background = "";
            row.style.outline = "";
            row.style.transform = "";
        });
        row.addEventListener("drop", (e) => {
            if (!node._stackContainer?.classList.contains("no8d-stack-reordering")) return;
            e.preventDefault();
            row.style.background = "";
            row.style.outline = "";
            row.style.transform = "";
            node._stackContainer?.classList.remove("no8d-stack-reordering");
            const fromId = e.dataTransfer.getData("text/plain");
            const from = entries.findIndex((x) => x.id === fromId);
            const to = entries.findIndex((x) => x.id === entry.id);
            if (from < 0 || to < 0 || from === to) return;
            const [moved] = entries.splice(from, 1);
            entries.splice(to, 0, moved);
            writeStack(node);
            render(node);
        });

        const handle = document.createElement("div");
        handle.innerHTML = "<span>••</span><span>••</span>";
        handle.title = t("dragReorder");
        handle.style.cssText = "cursor:grab; color:#9aa; font-size:12px; line-height:8px; display:flex; flex-direction:column; align-items:center; justify-content:center; user-select:none;";
        handle.draggable = true;
        stopGraphEvents(handle);
        handle.addEventListener("dragstart", (e) => {
            node._stackContainer?.classList.add("no8d-stack-reordering");
            e.dataTransfer.setData("text/plain", entry.id);
            e.dataTransfer.effectAllowed = "move";
            row.style.opacity = "0.45";
            row.style.outline = "2px solid #60a5fa";
            row.style.background = "#102b4f";
        });
        handle.addEventListener("dragend", () => {
            node._stackContainer?.classList.remove("no8d-stack-reordering");
            row.style.opacity = "1";
            row.style.outline = "";
            row.style.background = "";
            row.style.transform = "";
        });
        row.appendChild(handle);

        const toggle = makeButton(entry.enabled ? "ON" : "OFF", "临时启用/关闭此 LoRA", () => {
            entry.enabled = !entry.enabled;
            writeStack(node);
            render(node);
        });
        toggle.style.borderColor = entry.enabled ? "#3b82f6" : "#4b5563";
        toggle.style.color = entry.enabled ? "#bfdbfe" : "#8aa0bd";
        toggle.textContent = entry.enabled ? "👁" : "—";
        toggle.style.fontSize = "15px";
        row.appendChild(toggle);

        const nameWrap = document.createElement("div");
        nameWrap.style.cssText = "position:relative; min-width:0;";
        const sel = document.createElement("input");
        stopGraphEvents(sel);
        sel.value = shortLoraName(entry.name || "None");
        sel.style.cssText = "height:28px; box-sizing:border-box; width:100%; min-width:0; background:#111827; color:#dbeafe; border:1px solid #2563eb; border-radius:4px; padding:3px 8px;";
        const menu = document.createElement("div");
        menu.style.cssText = "display:none; position:fixed; z-index:100000; max-height:260px; overflow:auto; border:1px solid #2563eb; border-radius:4px; background:#151b24; box-shadow:0 10px 24px rgba(0,0,0,0.45);";
        menu.className = "no8d-stack-menu";
        document.body.appendChild(menu);
        node._stackMenus = node._stackMenus || [];
        node._stackMenus.push(menu);
        sel.addEventListener("click", (e) => e.stopPropagation());
        sel.addEventListener("focus", () => {
            sel.select();
            showLoraMenu(sel, menu, options, entry, node);
            refreshLoraOptions(node).then((changed) => {
                if (!changed || document.activeElement !== sel) return;
                options = getOptions(node);
                showLoraMenu(sel, menu, options, entry, node);
            });
        });
        sel.addEventListener("keydown", (e) => {
            if (shouldPassKeyToComfy(e)) return;
            if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const filtered = sel._filteredOptions || [];
            if (!filtered.length) return;
            if (e.key === "ArrowDown") {
                sel._activeIndex = Math.min(filtered.length - 1, (sel._activeIndex ?? 0) + 1);
                refreshMenuActive(sel, menu);
            } else if (e.key === "ArrowUp") {
                sel._activeIndex = Math.max(0, (sel._activeIndex ?? 0) - 1);
                refreshMenuActive(sel, menu);
            } else if (e.key === "Enter") {
                entry.name = filtered[sel._activeIndex ?? 0];
                sel.value = shortLoraName(entry.name);
                writeStack(node);
                menu.style.display = "none";
            } else if (e.key === "Escape") {
                menu.style.display = "none";
            }
        });
        sel.addEventListener("change", () => {
            options = getOptions(node);
            const typed = sel.value;
            const exact = options.find((opt) => opt === typed || shortLoraName(opt) === typed);
            entry.name = exact || typed;
            sel.value = shortLoraName(entry.name);
            writeStack(node);
        });
        sel.addEventListener("input", () => {
            options = getOptions(node);
            const typed = sel.value;
            const exact = options.find((opt) => opt === typed || shortLoraName(opt) === typed);
            entry.name = exact || typed;
            writeStack(node);
            showLoraMenu(sel, menu, options, entry, node);
        });
        sel.addEventListener("blur", () => {
            sel.value = shortLoraName(entry.name || "None");
            setTimeout(() => { menu.style.display = "none"; }, 150);
        });
        nameWrap.append(sel);
        row.appendChild(nameWrap);

        const slider = document.createElement("input");
        slider.type = "range";
        slider.min = String(entry.min);
        slider.max = String(entry.max);
        slider.step = "0.1";
        slider.value = String(clamp(Number(entry.weight || 0), Number(entry.min), Number(entry.max)));
        slider.disabled = !entry.enabled;
        slider.style.cssText = "width:100%; accent-color:#5aa7ff;";
        stopGraphEvents(slider);
        slider.addEventListener("click", (e) => e.stopPropagation());
        slider.addEventListener("pointerdown", () => num.blur());
        slider.addEventListener("input", () => {
            entry.weight = roundedWeight(slider.value);
            num.value = Number(entry.weight).toFixed(1);
            writeStack(node);
        });
        row.appendChild(slider);

        const num = document.createElement("input");
        num.type = "number";
        num.step = "0.1";
        num.min = String(entry.min);
        num.max = String(entry.max);
        num.value = Number(entry.weight || 0).toFixed(1);
        num.disabled = !entry.enabled;
        num.style.cssText = "height:28px; width:76px; background:#111827; color:#dbeafe; border:1px solid #2563eb; border-radius:4px; padding:3px 6px;";
        stopGraphEvents(num);
        num.addEventListener("click", (e) => e.stopPropagation());
        num.addEventListener("focus", () => num.select());
        num.addEventListener("keydown", (e) => {
            if (shouldPassKeyToComfy(e)) return;
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                e.stopPropagation();
                const direction = e.key === "ArrowUp" ? 1 : -1;
                const step = e.shiftKey ? 0.5 : 0.1;
                const next = clamp(
                    roundedWeight(Number(num.value || 0) + direction * step),
                    Number(entry.min),
                    Number(entry.max),
                );
                entry.weight = next;
                num.value = next.toFixed(1);
                slider.value = String(next);
                writeStack(node);
                return;
            }
        });
        num.addEventListener("change", () => {
            const next = clamp(Number(num.value || 0), Number(entry.min), Number(entry.max));
            entry.weight = next;
            num.value = next.toFixed(1);
            slider.value = String(next);
            writeStack(node);
        });
        row.appendChild(num);

        row.appendChild(makeButton(entry._editingRange ? "⌄" : "⚙", t("editRange"), () => {
            const open = !entry._editingRange;
            for (const item of entries) item._editingRange = false;
            entry._editingRange = open;
            writeStack(node);
            render(node);
        }));

        if (!entry.enabled) row.style.opacity = "0.5";
        list.appendChild(row);

        if (entry._editingRange) {
            const rangeRow = document.createElement("div");
            rangeRow.style.cssText = "display:flex; align-items:center; gap:20px; padding:6px 8px 8px 68px; border-bottom:1px solid #1e3a8a; background:#111d32; min-width:740px;";
            const minGroup = document.createElement("span");
            minGroup.style.cssText = "display:inline-flex; align-items:center; gap:10px;";
            const maxGroup = document.createElement("span");
            maxGroup.style.cssText = "display:inline-flex; align-items:center; gap:10px;";
            const minLabel = document.createElement("span");
            minLabel.textContent = t("minValue");
            minLabel.style.cssText = "color:#bbb; font-size:12px; text-align:left;";
            const minInput = document.createElement("input");
            minInput.type = "number";
            minInput.step = "0.1";
            minInput.value = String(entry.min);
            minInput.style.cssText = "height:26px; background:#111827; color:#dbeafe; border:1px solid #2563eb; border-radius:4px; padding:3px 6px;";
            stopGraphEvents(minInput);
            minInput.addEventListener("focus", () => minInput.select());
            const maxLabel = document.createElement("span");
            maxLabel.textContent = t("maxValue");
            maxLabel.style.cssText = "color:#bbb; font-size:12px; text-align:left;";
            const maxInput = document.createElement("input");
            maxInput.type = "number";
            maxInput.step = "0.1";
            maxInput.value = String(entry.max);
            maxInput.style.cssText = "height:26px; background:#111827; color:#dbeafe; border:1px solid #2563eb; border-radius:4px; padding:3px 6px;";
            stopGraphEvents(maxInput);
            maxInput.addEventListener("focus", () => maxInput.select());
            minGroup.append(minLabel, minInput);
            maxGroup.append(maxLabel, maxInput);
            const apply = makeButton(t("apply"), t("applyRange"), () => {
                const nextMin = Number(minInput.value);
                const nextMax = Number(maxInput.value);
                if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax) || nextMax <= nextMin) return;
                entry.min = nextMin;
                entry.max = nextMax;
                entry.weight = clamp(Number(entry.weight || 0), entry.min, entry.max);
                entry._editingRange = false;
                writeStack(node);
                render(node);
            });
            const spacer = document.createElement("span");
            spacer.style.cssText = "flex:1 1 auto;";
            apply.style.width = "56px";
            const del = makeButton("🗑", t("deleteLora"), () => {
                const idx = entries.findIndex((x) => x.id === entry.id);
                if (idx >= 0) entries.splice(idx, 1);
                writeStack(node);
                render(node);
            });
            del.style.width = "34px";
            rangeRow.append(minGroup, maxGroup, spacer, apply, del);
            list.appendChild(rangeRow);
        }
    }
    ensureStackNodeFitsContent(node);
}

function attach(node) {
    if (node._stackWidget) return;
    hideNativeWidgets(node);
    node.title = t("sliderStackTitle");
    node._stackEntries = readStack(node);

    const container = document.createElement("div");
    container.style.cssText = "width:100%; box-sizing:border-box; overflow:visible; pointer-events:none;";

    const panel = document.createElement("div");
    panel.style.cssText = "width:100%; box-sizing:border-box; background:#1f1f1f; border:1px solid #333; border-radius:6px; overflow:hidden; overscroll-behavior:contain; pointer-events:none;";
    node._stackContainer = panel;

    const header = document.createElement("div");
    header.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 10px; background:#171717; border-bottom:1px solid #333;";
    const add = makeButton("+", t("addLora"), () => {
        node._stackEntries.push(defaultEntry(getOptions(node)));
        writeStack(node);
        render(node);
    });
    add.style.width = "72px";
    add.style.borderColor = "#3b82f6";
    add.style.color = "#bfdbfe";
    const invert = makeButton(t("invertEnabled"), t("invertEnabledTitle"), () => {
        for (const entry of node._stackEntries || []) {
            entry.enabled = !entry.enabled;
        }
        writeStack(node);
        render(node);
    });
    invert.style.width = "72px";
    invert.style.borderColor = "#3b82f6";
    invert.style.color = "#bfdbfe";
    header.append(add, invert);
    panel.appendChild(header);

    const list = document.createElement("div");
    list.style.cssText = "display:flex; flex-direction:column; min-height:72px; overflow:visible;";
    panel.appendChild(list);
    node._stackList = list;
    container.appendChild(panel);

    const widget = node.addDOMWidget("slider_lora_stack", "stack", container, {
        serialize: false,
        hideOnZoom: false,
        getMinWidth: () => STACK_MIN_WIDTH,
        getMinHeight: () => stackWidgetHeight(node),
    });
    node._stackWidget = widget;
    widget.minWidth = STACK_MIN_WIDTH;
    widget.computeSize = (width) => [
        Math.max(width || 0, STACK_MIN_WIDTH),
        stackWidgetHeight(node),
    ];
    const markWrapper = () => container.closest(".dom-widget")?.classList.add("no8d-stack-widget");
    markWrapper();
    requestAnimationFrame(markWrapper);
    render(node);
    refreshLoraOptions(node).then((changed) => {
        if (changed) render(node);
    });
}

app.registerExtension({
    name: "NO8D.Control.LoraStack",
    async setup() {
        setTimeout(() => {
            for (const node of app?.graph?._nodes || []) {
                if (node?.type === NODE_NAME || node?.comfyClass === NODE_NAME) {
                    hideNativeWidgets(node);
                    attach(node);
                }
            }
        }, 500);
    },
    async nodeCreated(node) {
        if (node?.type !== NODE_NAME && node?.comfyClass !== NODE_NAME) return;
        hideNativeWidgets(node);
        attach(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onCreated) onCreated.apply(this, arguments);
            hideNativeWidgets(this);
            attach(this);
            setTimeout(() => hideNativeWidgets(this), 0);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => {
                hideNativeWidgets(this);
                this.title = t("sliderStackTitle");
                this._stackEntries = readStack(this);
                refreshLoraOptions(this).then((changed) => {
                    if (changed) render(this);
                });
                render(this);
                hideNativeWidgets(this);
            }, 0);
        };
        const onRemoved = nodeType.prototype.onRemoved;
        nodeType.prototype.onRemoved = function () {
            for (const menu of this._stackMenus || []) {
                try { menu.remove(); } catch (_) {}
            }
            this._stackMenus = [];
            if (onRemoved) onRemoved.apply(this, arguments);
        };
    },
});
