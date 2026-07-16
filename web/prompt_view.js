import { app } from "../../scripts/app.js";
import { t } from "./no8d_i18n.js";
import { isBypassed, refreshBypassElements, registerWidgetBypassElements, wrapBypassRefresh } from "./no8d_bypass.js";

const NODE_NAME = "NO8DPromptView";
const SEND_BUTTON_HEIGHT = 34;

function findWidget(node, name) {
    return (node.widgets || []).find((w) => w.name === name);
}

function setWidget(widget, value) {
    if (!widget) return;
    widget.value = value;
    if (typeof widget.inputEl?.value === "string" && widget.inputEl.value !== String(value ?? "")) {
        widget.inputEl.value = String(value ?? "");
    }
    try {
        if (typeof widget.callback === "function") {
            widget.callback(value, app.canvas, widget.node || null);
        }
    } catch (_) {}
}

function hideInternalWidgets(node) {
    let changed = false;
    for (const widget of node.widgets || []) {
        if (widget.name !== "send_seq") continue;
        if (widget.value !== "0") {
            widget.value = "0";
            changed = true;
        }
        widget.options = widget.options || {};
        if (!widget.options.hidden) changed = true;
        if (!widget.options.collapsed) changed = true;
        if (widget.type !== "converted-widget") changed = true;
        if (!widget.hidden) changed = true;
        widget.options.hidden = true;
        widget.options.collapsed = true;
        widget.type = "converted-widget";
        widget.hidden = true;
        widget.computeSize = () => [0, -4];
        widget.draw = () => {};
    }
    return changed;
}

function readIncomingFromMessage(message) {
    const candidates = [
        message?.edited_text,
        message?.ui?.edited_text,
        message?.NO8DPromptView_text,
        message?.ui?.NO8DPromptView_text,
        message?.NO8DPromptView_output,
        message?.ui?.NO8DPromptView_output,
    ];
    for (const value of candidates) {
        const text = Array.isArray(value) ? value[0] : value;
        if (typeof text === "string" && text) return text;
    }
    return "";
}

function readEditorText(node) {
    const edited = findWidget(node, "edited_text");
    if (!edited) return "";
    if (typeof edited.inputEl?.value === "string") return edited.inputEl.value;
    return String(edited.value || "");
}

function composeVisibleText(node, text) {
    const rawFixed = String(findWidget(node, "fixed_text")?.value || "").trim();
    const body = String(text || "").trim();
    if (!rawFixed) return body;
    const fixed = /[。！？；：、，,.!?:;…]["'”’）\])}】》]*$/.test(rawFixed) ? rawFixed : `${rawFixed}.`;
    if (!body) return fixed;
    if (body === fixed || body === rawFixed || body.startsWith(`${fixed}\n`) || body.startsWith(`${rawFixed}\n`)) {
        return body;
    }
    return `${fixed}\n${body}`;
}

function captureEditorDraft(node) {
    return readEditorText(node);
}

function hasActiveTextLink(node) {
    const input = (node?.inputs || []).find((item) => item?.name === "text");
    if (input?.link == null) return false;
    const link = node?.graph?.links?.[input.link];
    if (!link || link.origin_id == null) return false;
    const origin = node.graph?.getNodeById?.(link.origin_id);
    return Boolean(origin) && !isBypassed(origin);
}

function serializedEditorText(node) {
    const auto = findWidget(node, "auto_output");
    if (auto?.value && !hasActiveTextLink(node)) return captureEditorDraft(node);
    // In linked auto mode the upstream text is authoritative. In edit mode a
    // normal workflow run emits no text; the Send action injects its draft into
    // the queued prompt explicitly. Keeping inactive drafts out of the API
    // prompt prevents ComfyUI's input-signature cache from invalidating all
    // downstream nodes when only the visible editor state changed.
    return "";
}

function restoreEditorDraft(node, draft) {
    const edited = findWidget(node, "edited_text");
    if (!edited) return;
    const text = String(draft ?? "");
    if (String(edited.value || "") !== text || (typeof edited.inputEl?.value === "string" && edited.inputEl.value !== text)) {
        setWidget(edited, text);
    }
}

function syncNativeLabels(node) {
    let changed = false;
    const title = t("promptViewTitle");
    if (node.title !== title) {
        node.title = title;
        changed = true;
    }
    const edited = findWidget(node, "edited_text");
    if (edited) {
        const label = t("promptEditedText");
        if (edited.label !== label || edited.options?.label !== label) changed = true;
        edited.label = label;
        edited.options = edited.options || {};
        edited.options.label = label;
        edited.serializeValue = function () {
            return serializedEditorText(node);
        };
    }
    const fixed = findWidget(node, "fixed_text");
    if (fixed) {
        const label = t("promptFixedText");
        if (fixed.label !== label || fixed.options?.label !== label) changed = true;
        fixed.label = label;
        fixed.options = fixed.options || {};
        fixed.options.label = label;
        fixed.options.placeholder = label;
        if (fixed.inputEl) fixed.inputEl.placeholder = label;
    }
    const auto = findWidget(node, "auto_output");
    if (auto) {
        const label = t("promptViewAuto");
        if (auto.label !== label || auto.options?.label !== label) changed = true;
        auto.label = label;
        auto.options = auto.options || {};
        auto.options.label = label;
    }
    return changed;
}

function collectDownstreamNodeIds(node) {
    const graph = node?.graph || app?.graph;
    const result = new Set();
    const pending = [];
    const linkParts = [];
    for (const output of node.outputs || []) {
        for (const linkId of output.links || []) {
            const link = graph?.links?.[linkId];
            if (!link || link.target_id == null) continue;
            pending.push(link.target_id);
            linkParts.push(`${link.id}:${link.origin_id}:${link.origin_slot}:${link.target_id}:${link.target_slot}`);
        }
    }
    while (pending.length) {
        const id = pending.shift();
        if (id == null || result.has(String(id))) continue;
        result.add(String(id));
        const next = graph?.getNodeById?.(id);
        for (const output of next?.outputs || []) {
            for (const linkId of output.links || []) {
                const link = graph?.links?.[linkId];
                if (!link || link.target_id == null) continue;
                pending.push(link.target_id);
                linkParts.push(`${link.id}:${link.origin_id}:${link.origin_slot}:${link.target_id}:${link.target_slot}`);
            }
        }
    }
    if (!result.size && node?.id != null) result.add(String(node.id));
    const signature = linkParts.sort().join("|");
    if (node?._promptViewDownstreamCache?.signature === signature) {
        return [...node._promptViewDownstreamCache.ids];
    }
    const ids = [...result];
    if (node) node._promptViewDownstreamCache = { signature, ids };
    return ids;
}

async function runDownstreamQueueHooks(nodeIds, hookName) {
    const graph = app?.graph;
    const targetIds = new Set((nodeIds || []).map(String));
    for (const node of graph?._nodes || []) {
        if (!targetIds.has(String(node?.id))) continue;
        for (const widget of node.widgets || []) {
            const hook = widget?.[hookName];
            if (typeof hook !== "function") continue;
            await hook.call(widget, { isPartialExecution: false });
        }
    }
}

async function queueEditedPrompt(node, editedText, sendSeq) {
    try {
        if (typeof app.graphToPrompt !== "function" || typeof app.api?.queuePrompt !== "function") {
            throw new Error("ComfyUI queue API is unavailable");
        }
        const downstreamNodeIds = collectDownstreamNodeIds(node);
        await runDownstreamQueueHooks(downstreamNodeIds, "beforeQueued");
        const prompt = await app.graphToPrompt();
        const output = prompt?.output || {};
        const viewPromptNode = output[String(node.id)];
        if (!viewPromptNode?.inputs) throw new Error("Prompt view node is not present in the queued prompt");
        viewPromptNode.inputs.text = editedText || "";
        viewPromptNode.inputs.auto_output = false;
        viewPromptNode.inputs.edited_text = editedText || "";
        viewPromptNode.inputs.send_seq = String(sendSeq || "0");
        await app.api.queuePrompt(0, prompt, { partialExecutionTargets: downstreamNodeIds });
        await runDownstreamQueueHooks(downstreamNodeIds, "afterQueued");
    } catch (error) {
        app.extensionManager?.toast?.add?.({
            severity: "warn",
            summary: t("promptViewSend"),
            detail: error?.message || String(error),
            life: 3000,
        });
    }
}

function sendEditedText(node) {
    const edited = findWidget(node, "edited_text");
    if (!edited) return;
    const nextSeq = String(Date.now());
    queueEditedPrompt(node, captureEditorDraft(node), nextSeq);
}

function ensureSendWidget(node) {
    if (node._promptViewSendWidget) {
        node._promptViewSendWidget.computeSize = (width) => [width, SEND_BUTTON_HEIGHT];
        return false;
    }
    const existing = (node.widgets || []).find((widget) => widget._no8dPromptSend);
    if (existing) {
        node._promptViewSendWidget = existing;
        existing.computeSize = (width) => [width, SEND_BUTTON_HEIGHT];
        return false;
    }
    const widget = node.addWidget("button", t("promptViewSend"), null, () => sendEditedText(node));
    widget._no8dPromptSend = true;
    widget.label = t("promptViewSend");
    widget.options = widget.options || {};
    widget.options.label = t("promptViewSend");
    widget.computeSize = (width) => [width, SEND_BUTTON_HEIGHT];
    node._promptViewSendWidget = widget;
    return true;
}

function activate(node) {
    if (node?.type !== NODE_NAME && node?.comfyClass !== NODE_NAME) return;
    let changed = hideInternalWidgets(node);
    changed = ensureSendWidget(node) || changed;
    changed = syncNativeLabels(node) || changed;
    registerWidgetBypassElements(node, ["fixed_text", "edited_text", "auto_output"]);
    refreshBypassElements(node);
    if (changed) {
        node.graph?.setDirtyCanvas?.(true, true);
        app?.canvas?.setDirty?.(true, true);
    }
}

function setIncomingText(node, incoming) {
    const edited = findWidget(node, "edited_text");
    if (!edited) return;
    if (!incoming) return;
    if (incoming === readEditorText(node)) return;
    setWidget(edited, incoming);
    // The visible editor is the canonical value. Once upstream text is shown,
    // that text becomes the editor content instead of living in a hidden state.
}

app.registerExtension({
    name: "NO8D.Control.PromptView",
    async setup() {
        setTimeout(() => {
            for (const node of app?.graph?._nodes || []) activate(node);
        }, 500);
    },
    async nodeCreated(node) {
        activate(node);
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;
        wrapBypassRefresh(nodeType);
        const onCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            if (onCreated) onCreated.apply(this, arguments);
            activate(this);
        };
        const onConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function () {
            if (onConfigure) onConfigure.apply(this, arguments);
            setTimeout(() => activate(this), 0);
        };
        const onExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            // Native execution may rewrite widget values. Capture the live DOM
            // value first so an empty/bypassed upstream cannot erase manual text.
            const draftBeforeExecution = readEditorText(this);
            if (onExecuted) onExecuted.apply(this, arguments);
            activate(this);
            const incoming = readIncomingFromMessage(message);
            const auto = Boolean(findWidget(this, "auto_output")?.value);
            if (!auto && !hasActiveTextLink(this)) {
                restoreEditorDraft(this, composeVisibleText(this, draftBeforeExecution));
            } else if (incoming) setIncomingText(this, incoming);
            else restoreEditorDraft(this, draftBeforeExecution);
        };
    },
});
