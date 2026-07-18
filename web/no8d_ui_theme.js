import { app } from "../../scripts/app.js";

const STYLE_ID = "no8d-ui-theme";
const ACCENT_COLOR = "#2563EB";
const LEGACY_COLOR_DEFAULTS = {
    NO8DImageGrid: ["background_color", "#202020"],
    NO8DImageTitle: ["title_bar_color", "#000000"],
};

if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.no8d-ui {
    --no8d-bg: #1b1e23;
    --no8d-bg-deep: #111318;
    --no8d-bg-soft: #24272d;
    --no8d-bg-hover: #30343c;
    --no8d-border: #41454e;
    --no8d-border-soft: #34373e;
    --no8d-text: #f4f4f5;
    --no8d-text-muted: #a1a1aa;
    --no8d-accent: #2563eb;
    --no8d-accent-hover: #2563eb;
    --no8d-radius: 6px;
    --no8d-shadow: 0 10px 24px rgba(0,0,0,.34);
    color: var(--no8d-text);
    font-family: Arial, "Microsoft YaHei", sans-serif;
}
.no8d-ui, .no8d-ui * { box-sizing: border-box; }
.no8d-ui button:not(.no8d-color-swatch):not(.no8d-krea-style-card),
.no8d-ui input:not([type="range"]):not([type="color"]):not([type="checkbox"]):not([type="radio"]),
.no8d-ui select,
.no8d-ui textarea {
    border: 1px solid var(--no8d-border) !important;
    border-radius: var(--no8d-radius) !important;
    background: var(--no8d-bg-soft) !important;
    color: var(--no8d-text) !important;
    outline: none;
    transition: border-color .14s ease, background .14s ease, box-shadow .14s ease;
}
.no8d-ui button:not(.no8d-color-swatch):not(.no8d-krea-style-card) { cursor: pointer; }
.no8d-ui button:not(.no8d-color-swatch):not(.no8d-krea-style-card):hover:not(:disabled) {
    border-color: #6b7280 !important;
    background: var(--no8d-bg-hover) !important;
}
.no8d-ui button.selected:not(.no8d-krea-style-card),
.no8d-ui button[aria-pressed="true"],
.no8d-ui .selected > button {
    border-color: #2563eb !important;
    background: var(--no8d-accent) !important;
    color: #fff !important;
}
.no8d-ui input:not([type="range"]):focus,
.no8d-ui select:focus,
.no8d-ui textarea:focus {
    border-color: #2563eb !important;
    box-shadow: 0 0 0 2px rgba(37,99,235,.24) !important;
}
.no8d-ui button:disabled,
.no8d-ui [aria-disabled="true"] { opacity: .42; cursor: default; }
.no8d-ui input[type="range"] { accent-color: var(--no8d-accent) !important; }
.no8d-ui ::-webkit-scrollbar { width: 9px; height: 9px; }
.no8d-ui ::-webkit-scrollbar-track { background: var(--no8d-bg-deep); }
.no8d-ui ::-webkit-scrollbar-thumb {
    background: #6b7280;
    border: 2px solid var(--no8d-bg-deep);
    border-radius: 999px;
}
.no8d-ui .no8d-panel {
    border: 1px solid var(--no8d-border-soft) !important;
    border-radius: 7px !important;
    background: var(--no8d-bg) !important;
}
.no8d-ui .no8d-muted { color: var(--no8d-text-muted) !important; }
`;
    document.head.appendChild(style);
}

function migrateLegacyColor(node) {
    const type = node?.comfyClass || node?.type;
    const migration = LEGACY_COLOR_DEFAULTS[type];
    if (!migration) return;
    const [widgetName, legacyColor] = migration;
    const widget = (node.widgets || []).find((item) => item.name === widgetName);
    if (!widget || String(widget.value).toUpperCase() !== legacyColor) return;
    widget.value = ACCENT_COLOR;
    widget.callback?.(ACCENT_COLOR, app.canvas, node, app.canvas?.graph_mouse);
    node.graph?.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "NO8D.Control.UiTheme",
    async nodeCreated(node) {
        setTimeout(() => migrateLegacyColor(node), 0);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!LEGACY_COLOR_DEFAULTS[nodeData.name]) return;
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            onConfigure?.apply(this, arguments);
            setTimeout(() => migrateLegacyColor(this), 0);
        };
    },
});
