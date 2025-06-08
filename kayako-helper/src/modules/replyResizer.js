/* Reply-box resizer v3.1
   – Adds a 6 px “grab bar” at the top of the editor chrome
   – Drag ↑ increases height, drag ↓ decreases (floor 44 px)
   – Persists height per conversation tab until page reload            */

import { SEL }           from '../selectors.js';
import { currentConvId } from '../utils/location.js';

/* ------------------------------------------------------------------ */
/*  Config / State                                                    */
/* ------------------------------------------------------------------ */
const BAR_H       = 6;        // bar thickness
const DEFAULT_MAX = 350;      // px if nothing stored yet
const MIN_HEIGHT  = 44;       // don’t collapse completely
const BAR_CLASS   = 'ktx-resize-bar';

let stored      = {};         // { convId | "global" : px }
let currentConv = null;

/* ------------------------------------------------------------------ */
/*  Public bootstrap                                                  */
/* ------------------------------------------------------------------ */
export function bootReplyResizer() {
    ensureChrome();           // patch current tab
    watchConversation();      // keep watching SPA navigation
}

/* ------------------------------------------------------------------ */
/*  Main patch routine                                                */
/* ------------------------------------------------------------------ */
function ensureChrome() {
    const chrome = document.querySelector(SEL.editorChrome);
    const wrap   = document.querySelector(SEL.editorWrapper); // same element

    /* Wait until the reply area exists */
    if (!chrome || !wrap) { requestAnimationFrame(ensureChrome); return; }

    /* Already patched? */
    if (chrome.dataset.resizerSetup === 'true' ||
        chrome.querySelector(`.${BAR_CLASS}`)) return;

    chrome.dataset.resizerSetup = 'true';
    injectBar(chrome);
    applyInitialSize();
}

/* ------------------------------------------------------------------ */
/*  Inject a slim overlay bar                                         */
/* ------------------------------------------------------------------ */
function injectBar(chrome) {
    chrome.style.position = 'relative';

    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.style.cssText =
        `position:absolute;left:0;top:0;width:100%;height:${BAR_H}px;` +
        'cursor:ns-resize;z-index:10;';
    chrome.prepend(bar);

    attachDrag(bar);          // wire up drag behaviour
}

/* ------------------------------------------------------------------ */
/*  Drag behaviour                                                    */
/* ------------------------------------------------------------------ */
function attachDrag(bar) {
    bar.addEventListener('mousedown', e => {
        e.preventDefault();

        /* Re-query live elements **right now**, so we never hold a stale
           `.fr-element` reference that Froala may swap out later.      */
        const wrap   = document.querySelector(SEL.editorWrapper);
        if (!wrap) return;                       // safety guard

        const startY = e.clientY;
        const startH = wrap.getBoundingClientRect().height;

        const onMove = ev => {
            const dy   = ev.clientY - startY;
            const newH = Math.max(MIN_HEIGHT, startH - dy);
            applySize(newH);                     // uses live query inside
        };

        const onUp = () => {
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
function applySize(px) {
    /* Always hit the current nodes to avoid “ghost” elements */
    const wrap  = document.querySelector(SEL.editorWrapper);
    const inner = wrap?.querySelector(SEL.replyInner);
    if (!wrap) return;

    wrap .style.maxHeight = `${px}px`;
    wrap .style.minHeight = `${px}px`;
    if (inner) {
        inner.style.minHeight = `${px}px`;
        inner.style.maxHeight = `${px}px`;
    }
}

function getCurrentHeight() {
    const wrap = document.querySelector(SEL.editorWrapper);
    return wrap ? parseInt(getComputedStyle(wrap).maxHeight, 10) : DEFAULT_MAX;
}

function applyInitialSize() {
    const h = stored[currentConvId() ?? 'global'] ?? DEFAULT_MAX;
    applySize(h);
}

/* ------------------------------------------------------------------ */
/*  Watch SPA route changes                                           */
/* ------------------------------------------------------------------ */
function watchConversation() {
    const id = currentConvId() ?? 'global';
    if (id !== currentConv) {
        currentConv = id;
        setTimeout(ensureChrome, 100);          // DOM settles, then patch
    }
    requestAnimationFrame(watchConversation);
}
