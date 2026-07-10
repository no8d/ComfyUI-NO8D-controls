const STYLE_ID = "no8d-bypass-dom-style";

function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .no8d-bypass-aware {
            position: relative;
            isolation: isolate;
        }
        .no8d-bypassed-dom {
            opacity: var(--no8d-node-mode-alpha, 0.2);
            background: var(--no8d-node-mode-bg, #ff00ff) !important;
        }
        .no8d-bypassed-dom input,
        .no8d-bypassed-dom select,
        .no8d-bypassed-dom textarea,
        .no8d-bypassed-dom button {
            opacity: var(--no8d-node-mode-alpha, 0.2) !important;
        }
        .no8d-bypass-overlay {
            position: absolute;
            inset: 0;
            z-index: 2147483647;
            pointer-events: none;
            border-radius: inherit;
            background: var(--no8d-node-mode-bg, #ff00ff);
            opacity: var(--no8d-node-mode-overlay-alpha, 0);
            display: none;
        }
        .no8d-bypassed-dom > .no8d-bypass-overlay {
            display: block !important;
        }
        .no8d-bypassed-filter {
            opacity: var(--no8d-node-mode-alpha, 0.2);
        }
    `;
    document.head.appendChild(style);
}

export function isBypassed(node) {
    const mode = Number(node?.mode);
    const liteGraph = globalThis.LiteGraph;
    return mode === 4
        || mode === Number(liteGraph?.BYPASS)
        || mode === Number(liteGraph?.NEVER);
}

function nodeModeVisual(node) {
    const liteGraph = globalThis.LiteGraph;
    const mode = Number(node?.mode);
    const bypassMode = Number(liteGraph?.BYPASS ?? 4);
    const neverMode = Number(liteGraph?.NEVER ?? 2);
    if (node?.flags?.ghost) {
        return { active: true, alpha: 0.3, color: node.renderingBgColor || liteGraph?.NODE_DEFAULT_BGCOLOR || "#353535" };
    }
    if (mode === bypassMode) {
        return {
            active: true,
            alpha: 0.2,
            color: liteGraph?.NODE_DEFAULT_BYPASS_COLOR || "#ff00ff",
        };
    }
    if (mode === neverMode) {
        return { active: true, alpha: 0.4, color: node.renderingBgColor || liteGraph?.NODE_DEFAULT_BGCOLOR || "#353535" };
    }
    return { active: false, alpha: 1, color: "" };
}

export function registerBypassElement(node, element) {
    if (!node || !element) return;
    ensureStyle();
    node._no8dBypassElements = node._no8dBypassElements || [];
    if (!node._no8dBypassElements.includes(element)) {
        node._no8dBypassElements.push(element);
    }
    element.classList.add("no8d-bypass-aware");
    if (!element.querySelector(":scope > .no8d-bypass-overlay")) {
        const overlay = document.createElement("div");
        overlay.className = "no8d-bypass-overlay";
        element.appendChild(overlay);
    }
    refreshBypassElements(node);
}

export function registerBypassFilterElement(node, element) {
    if (!node || !element) return;
    ensureStyle();
    node._no8dBypassFilterElements = node._no8dBypassFilterElements || [];
    if (!node._no8dBypassFilterElements.includes(element)) {
        node._no8dBypassFilterElements.push(element);
    }
    refreshBypassElements(node);
}

export function registerWidgetBypassElements(node, widgetNames = []) {
    if (!node || !Array.isArray(node.widgets)) return;
    const wanted = new Set(widgetNames);
    for (const widget of node.widgets) {
        if (!wanted.has(widget.name)) continue;
        for (const element of widgetElements(widget)) {
            registerBypassFilterElement(node, element);
        }
    }
}

export function refreshBypassElements(node) {
    if (!node) return;
    const visual = nodeModeVisual(node);
    for (const element of node._no8dBypassElements || []) {
        if (!element?.classList) continue;
        element.classList.toggle("no8d-bypassed-dom", visual.active);
        element.style.setProperty("--no8d-node-mode-alpha", String(visual.alpha));
        element.style.setProperty("--no8d-node-mode-bg", visual.color || "");
        element.style.setProperty("--no8d-node-mode-overlay-alpha", visual.active ? "0" : "0");
    }
    for (const element of node._no8dBypassFilterElements || []) {
        if (!element?.classList) continue;
        element.classList.toggle("no8d-bypassed-filter", visual.active);
        element.style.setProperty("--no8d-node-mode-alpha", String(visual.alpha));
    }
}

export function wrapBypassRefresh(nodeType, refresh = refreshBypassElements) {
    if (!nodeType?.prototype || nodeType.prototype._no8dBypassRefreshWrapped) return;
    const original = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function () {
        const result = original?.apply(this, arguments);
        refresh(this);
        return result;
    };
    nodeType.prototype._no8dBypassRefreshWrapped = true;
}

function widgetElements(widget) {
    const elements = [];
    const candidates = [
        widget?.element,
        widget?.inputEl,
        widget?.textarea,
        widget?.input,
        widget?.domElement,
        widget?.root,
        widget?.el,
    ];
    for (const candidate of candidates) {
        if (candidate instanceof HTMLElement && !elements.includes(candidate)) elements.push(candidate);
    }
    return elements;
}
