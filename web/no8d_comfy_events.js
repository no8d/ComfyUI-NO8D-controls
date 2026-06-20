import { app } from "../../scripts/app.js";

let spaceDown = false;

function isTextInput(target) {
    return /input|textarea|select/i.test(target?.tagName || "");
}

document.addEventListener("keydown", (event) => {
    if (event.code === "Space" && !isTextInput(event.target)) {
        spaceDown = true;
    }
}, true);

document.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceDown = false;
}, true);

export function isComfySpaceDown() {
    return spaceDown;
}

export function passMouseToComfy(event) {
    const canvas = app?.canvas?.canvas;
    if (!canvas) return;
    const mouseType = {
        pointerdown: "mousedown",
        pointermove: "mousemove",
        pointerup: "mouseup",
        pointercancel: "mouseup",
    }[event.type];
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
    };
    if (event instanceof WheelEvent) {
        canvas.dispatchEvent(new WheelEvent(event.type, {
            ...init,
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
        }));
    } else if (window.PointerEvent && event instanceof PointerEvent) {
        canvas.dispatchEvent(new PointerEvent(event.type, {
            ...init,
            pointerId: event.pointerId,
            pointerType: event.pointerType,
            isPrimary: event.isPrimary,
            pressure: event.pressure,
        }));
        if (mouseType) canvas.dispatchEvent(new MouseEvent(mouseType, init));
    } else {
        canvas.dispatchEvent(new MouseEvent(event.type, init));
    }
}

export function shouldPassMouseToComfy(event) {
    return isComfySpaceDown()
        || event.button > 0
        || event.type === "wheel"
        || event.type === "contextmenu";
}

export function shouldPassKeyToComfy(event) {
    return (event.ctrlKey || event.metaKey) && event.key === "Enter";
}
