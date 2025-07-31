/*  Kayako Helper – replyResizer.ts  (rev-v2)
    ──────────────────────────────────────────────────────────────────
    • Drag-to-resize bar (+ stored height per conversation)
    • Auto-expand to hide the scrollbar when typing/pasting
    • NEW: double-click the bar to collapse → MIN, or restore to a
      “best fit” height (≤ DEFAULT_MAX) if already collapsed.          */

import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import { currentConvId } from '@/utils/location.ts';

/* ─────────────── Config / State ─────────────── */

const BAR_H            = 14;
export const DEFAULT_MAX = 350;
export const MIN_HEIGHT  = 44;

const BAR_CLASS      = 'ktx-resize-bar';
const AUTO_SETUP_KEY = 'autoExpandSetup';

let stored: Record<string, number> = {};
let currentConv: string | null = null;

/* ───────────── Public bootstrap ─────────────── */

export function bootReplyResizer(): void {
    ensureChrome();
    watchConversation();
    attachCollapseOnSend();
}

/* ───────────────  Main patch  ──────────────── */

function ensureChrome(): void {
    const chromeEl = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorContainerRoot);
    const wrap     = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);

    if (!chromeEl || !wrap) {
        requestAnimationFrame(ensureChrome);
        return;
    }

    /* ----- one-time bar injection per editor ----- */
    if (chromeEl.dataset.resizerSetup !== 'true' &&
        !chromeEl.querySelector(`.${BAR_CLASS}`)) {

        chromeEl.dataset.resizerSetup = 'true';
        injectBar(chromeEl);
        applyInitialSize();
    }

    /* ----- auto-expand listeners (idempotent) ----- */
    maybeAttachAutoExpand(wrap);
}

/* ───────────────────────── drag bar ───────────────────────── */

function injectBar(chromeEl: HTMLElement): void {
    chromeEl.style.position = 'relative';

    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.style.cssText =
        `position:absolute;left:0;top:-${BAR_H}px;width:100%;height:${BAR_H}px;` +
        'cursor:ns-resize;z-index:10;';

    chromeEl.prepend(bar);
    attachDrag(bar);
    attachDoubleClick(bar);   // ← NEW
}
function toggleCollapseExpand(): void {
    const wrap  = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!wrap || !inner) return;

    const curH = getCurrentHeight();
    const key  = currentConvId() ?? 'global';

    if (curH > MIN_HEIGHT + 1) {                     // ① collapse
        applySize(MIN_HEIGHT);
        stored[key] = MIN_HEIGHT;
        return;
    }

    /* ② expand – use scrollHeight *unless* it’s too small,
          then default to DEFAULT_MAX                         */
    const fit     = inner.scrollHeight;
    const desired = fit > MIN_HEIGHT + 1 ? fit : DEFAULT_MAX;
    const newH    = Math.min(desired, DEFAULT_MAX);

    applySize(newH);
    stored[key] = newH;
}

function attachDrag(bar: HTMLElement): void {
    bar.addEventListener('mousedown', e => {
        /* Fast double-click? handle & bail */
        if (e.detail === 2) {
            e.preventDefault();
            toggleCollapseExpand();
            return;
        }

        /* Normal drag-to-resize below (unchanged) */
        e.preventDefault();

        const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
        if (!wrap) return;

        const startY = e.clientY;
        const startH = wrap.getBoundingClientRect().height;

        const onMove = (ev: MouseEvent) => {
            const newH = Math.max(MIN_HEIGHT, startH - (ev.clientY - startY));
            applySize(newH);
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

/* ───────────────────── NEW: dbl-click toggle ───────────────────── */

function attachDoubleClick(bar: HTMLElement): void {
    bar.addEventListener('dblclick', () => {
        const wrap  = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
        const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
        if (!wrap || !inner) return;

        const curH = getCurrentHeight();
        const key  = currentConvId() ?? 'global';

        /* Collapse if taller than MIN; tolerate ±1 px rounding */
        if (curH > MIN_HEIGHT + 1) {
            applySize(MIN_HEIGHT);
            stored[key] = MIN_HEIGHT;
            return;
        }

        /* Already at MIN → expand:
           – “Best fit” to content if ≤ DEFAULT_MAX
           – Otherwise hard-cap at DEFAULT_MAX                        */
        const desired  = Math.max(inner.scrollHeight, MIN_HEIGHT);
        const newH     = desired <= DEFAULT_MAX ? desired : DEFAULT_MAX;

        applySize(newH);
        stored[key] = newH;
    });
}

/* ────────────────────── auto-expand (unchanged) ─────────────────────── */

function maybeAttachAutoExpand(wrap: HTMLElement): void {
    const inner = wrap.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!inner || inner.dataset[AUTO_SETUP_KEY] === 'true') return;

    inner.dataset[AUTO_SETUP_KEY] = 'true';

    const scheduleCheck = () => requestAnimationFrame(checkOverflowAndExpand);

    inner.addEventListener('input', scheduleCheck);
    inner.addEventListener('paste', scheduleCheck);
    inner.addEventListener('keyup', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter') scheduleCheck();
    });

    scheduleCheck();
}

function checkOverflowAndExpand(): void {
    const wrap  = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!wrap || !inner) return;

    const curH       = getCurrentHeight();
    if (curH >= DEFAULT_MAX) return;                           // already maxed

    const overflow   = inner.scrollHeight - inner.clientHeight;
    if (overflow <= 1) return;                                 // no scrollbar

    const needed     = overflow;
    const newHeight  = Math.min(DEFAULT_MAX, curH + needed);

    applySize(newHeight);
    stored[currentConvId() ?? 'global'] = newHeight;
}

/* ───────────────────── height helpers ───────────────────── */

export function applySize(px: number): void {
    const wrap  = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!wrap) return;

    wrap .style.maxHeight = `${px}px`;
    wrap .style.minHeight = `${px}px`;
    if (inner) {
        inner.style.maxHeight = `${px}px`;
        inner.style.minHeight = `${px}px`;
    }
}

function getCurrentHeight(): number {
    const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    return wrap
        ? parseInt(getComputedStyle(wrap).maxHeight, 10)
        : DEFAULT_MAX;
}

function applyInitialSize(): void {
    const key = currentConvId() ?? 'global';
    applySize(MIN_HEIGHT);
}

/* ────────── conversation change watch (Kayako SPA) ───────── */

function watchConversation(): void {
    const id = currentConvId() ?? 'global';
    if (id !== currentConv) {
        currentConv = id;
        setTimeout(ensureChrome, 100);   // editor mounts a tick later
    }
    requestAnimationFrame(watchConversation);
}

/* ───────────── collapse after send (optional) ───────────── */

function attachCollapseOnSend(): void {
    document.addEventListener('click', e => {
        const btn = (e.target as Element)
            .closest(KAYAKO_SELECTORS.sendButtonPublicReply) as Element | null;
        if (!btn) return;

        setTimeout(() => applySize(MIN_HEIGHT), 50);
    }, true);
}
