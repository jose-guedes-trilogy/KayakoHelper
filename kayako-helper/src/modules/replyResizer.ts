// modules/replyResizer.ts

import { SEL }           from '@/selectors';
import { currentConvId } from '@/utils/location';

/* ------------------------------------------------------------------ */
/*  Config / State                                                    */
/* ------------------------------------------------------------------ */
const BAR_H       = 6;        // bar thickness
const DEFAULT_MAX = 350;      // px if nothing stored yet
const MIN_HEIGHT  = 44;       // don’t collapse completely
const BAR_CLASS   = 'ktx-resize-bar';

let stored: Record<string, number> = {};  // { convId | "global" : px }
let currentConv: string | null     = null;

/* ------------------------------------------------------------------ */
/*  Public bootstrap                                                  */
/* ------------------------------------------------------------------ */
export function bootReplyResizer(): void {
    ensureChrome();      // patch current tab
    watchConversation(); // keep watching SPA navigation
}

/* ------------------------------------------------------------------ */
/*  Main patch routine                                                */
/* ------------------------------------------------------------------ */
function ensureChrome(): void {
    const chrome = document.querySelector<HTMLElement>(SEL.editorChrome);
    const wrap   = document.querySelector<HTMLElement>(SEL.editorWrapper);

    // Wait until the reply area exists
    if (!chrome || !wrap) {
        requestAnimationFrame(ensureChrome);
        return;
    }

    // Already patched?
    if (
        chrome.dataset.resizerSetup === 'true' ||
        chrome.querySelector(`.${BAR_CLASS}`)
    ) {
        return;
    }

    chrome.dataset.resizerSetup = 'true';
    injectBar(chrome);
    applyInitialSize();
}

/* ------------------------------------------------------------------ */
/*  Inject a slim overlay bar                                         */
/* ------------------------------------------------------------------ */
function injectBar(chrome: HTMLElement): void {
    chrome.style.position = 'relative';

    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.style.cssText =
        `position:absolute;left:0;top:0;width:100%;height:${BAR_H}px;` +
        'cursor:ns-resize;z-index:10;';
    chrome.prepend(bar);

    attachDrag(bar);
}

/* ------------------------------------------------------------------ */
/*  Drag behaviour                                                    */
/* ------------------------------------------------------------------ */
function attachDrag(bar: HTMLElement): void {
    bar.addEventListener('mousedown', (e: MouseEvent) => {
        e.preventDefault();

        // Re-query live elements so we never hold a stale reference
        const wrap = document.querySelector<HTMLElement>(SEL.editorWrapper);
        if (!wrap) return;

        const startY: number = e.clientY;
        const startH: number = wrap.getBoundingClientRect().height;

        const onMove = (ev: MouseEvent): void => {
            const dy = ev.clientY - startY;
            const newH = Math.max(MIN_HEIGHT, startH - dy);
            applySize(newH);
        };

        const onUp = (): void => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            stored[currentConvId() ?? 'global'] = getCurrentHeight();
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}

/* ------------------------------------------------------------------ */
/*  Height helpers                                                    */
/* ------------------------------------------------------------------ */
function applySize(px: number): void {
    const wrap  = document.querySelector<HTMLElement>(SEL.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(SEL.replyInner);
    if (!wrap) return;

    wrap.style.maxHeight = `${px}px`;
    wrap.style.minHeight = `${px}px`;
    if (inner) {
        inner.style.minHeight = `${px}px`;
        inner.style.maxHeight = `${px}px`;
    }
}

function getCurrentHeight(): number {
    const wrap = document.querySelector<HTMLElement>(SEL.editorWrapper);
    return wrap
        ? parseInt(getComputedStyle(wrap).maxHeight, 10)
        : DEFAULT_MAX;
}

function applyInitialSize(): void {
    const key = currentConvId() ?? 'global';
    const h   = stored[key] ?? DEFAULT_MAX;
    applySize(h);
}

/* ------------------------------------------------------------------ */
/*  Watch SPA route changes                                           */
/* ------------------------------------------------------------------ */
function watchConversation(): void {
    const id = currentConvId() ?? 'global';
    if (id !== currentConv) {
        currentConv = id;
        setTimeout(ensureChrome, 100); // DOM settles, then patch
    }
    requestAnimationFrame(watchConversation);
}
