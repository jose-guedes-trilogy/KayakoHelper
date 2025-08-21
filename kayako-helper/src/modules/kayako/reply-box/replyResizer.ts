/*  Kayako Helper – replyResizer.ts  (rev-v3.1)
    ──────────────────────────────────────────────────────────────────
    • Drag‑to‑resize bar (+ stored height per conversation)
    • Auto‑expand to hide the scrollbar when typing/pasting
    • Double‑click bar → collapse/expand
    • Supports *multiple* simultaneous editors (main reply + side‑conversation)
    • NEW (v3.1): "hot‑reload" safe – if a bar already exists but has
      no listeners (e.g. extension reloaded), listeners are (re)attached
      instead of injecting a duplicate bar.                                             */

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
const LISTENER_KEY   = 'resizeListeners';      // on the <div> bar itself

let stored: Record<string, number> = {};
let currentConv: string | null = null;

/* ───────────── Public bootstrap ─────────────── */

export function bootReplyResizer(): void {
    ensureChrome();
    watchConversation();
    attachCollapseOnSend();
}

/* ───────────────  Core orchestration  ──────────────── */

function ensureChrome(): void {
    const chromeEls = Array.from(
        document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.textEditorContainerRoot)
    );

    for (const chromeEl of chromeEls) {
        const wrap = chromeEl.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
        if (!wrap) continue;                                 // editor not yet mounted

        /* ───────── existing bar? just (re)attach listeners ───────── */
        const existingBar = chromeEl.querySelector<HTMLElement>(`.${BAR_CLASS}`);
        if (existingBar) {
            if (existingBar.dataset[LISTENER_KEY] !== 'true') {
                attachDrag(existingBar);
                attachDoubleClick(existingBar);
                existingBar.dataset[LISTENER_KEY] = 'true';
            }
        }
        /* ───────── inject if missing ───────── */
        else {
            chromeEl.style.position = 'relative';
            injectBar(chromeEl);
            applyInitialSize(wrap);          // collapse by default
        }

        /* ───────── auto-expand handlers (idempotent) ───────── */
        maybeAttachAutoExpand(chromeEl);
    }

    /* Continuous guard: re-run next frame so we reinject if the DOM re-renders
       and removes our bar (common with Ember view swaps). Lightweight because
       we bail early once bars exist. */
    requestAnimationFrame(ensureChrome);
}

/* ───────────────────────── drag bar ───────────────────────── */

function injectBar(chromeEl: HTMLElement): void {
    const bar = document.createElement('div');
    bar.className = BAR_CLASS;
    bar.style.cssText =
        `position:absolute;left:0;top:-${BAR_H}px;width:100%;height:${BAR_H}px;` +
        'cursor:ns-resize;z-index:10;';

    chromeEl.prepend(bar);
    attachDrag(bar);
    attachDoubleClick(bar);
    bar.dataset[LISTENER_KEY] = 'true';
}

function toggleCollapseExpand(bar: HTMLElement): void {
    const chromeRoot = bar.parentElement as HTMLElement;
    const wrap  = chromeRoot.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!wrap || !inner) return;

    const curH = getCurrentHeight(wrap);
    const key  = currentConvId() ?? 'global';

    if (curH > MIN_HEIGHT + 1) {                     // collapse
        applySize(MIN_HEIGHT, wrap, inner);
        stored[key] = MIN_HEIGHT;
        return;
    }

    // expand → best‑fit capped at DEFAULT_MAX
    const fit     = inner.scrollHeight;
    const desired = fit > MIN_HEIGHT + 1 ? fit : DEFAULT_MAX;
    const newH    = Math.min(desired, DEFAULT_MAX);

    applySize(newH, wrap, inner);
    stored[key] = newH;
}

function attachDrag(bar: HTMLElement): void {
    bar.addEventListener('mousedown', e => {
        /* Fast double‑click? */
        if (e.detail === 2) {
            e.preventDefault();
            toggleCollapseExpand(bar);
            return;
        }

        e.preventDefault();

        const chromeRoot = bar.parentElement as HTMLElement;
        const wrap = chromeRoot.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
        if (!wrap) return;

        const startY = e.clientY;
        const startH = wrap.getBoundingClientRect().height;

        const onMove = (ev: MouseEvent) => {
            const newH = Math.max(MIN_HEIGHT, startH - (ev.clientY - startY));
            applySize(newH, wrap);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            stored[currentConvId() ?? 'global'] = getCurrentHeight(wrap);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
    });
}

function attachDoubleClick(bar: HTMLElement): void {
    bar.addEventListener('dblclick', () => toggleCollapseExpand(bar));
}

/* ────────────────────── auto‑expand ─────────────────────── */

function maybeAttachAutoExpand(chromeRoot: HTMLElement): void {
    const wrap  = chromeRoot.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea);
    if (!wrap || !inner || inner.dataset[AUTO_SETUP_KEY] === 'true') return;

    inner.dataset[AUTO_SETUP_KEY] = 'true';

    const scheduleCheck = () => requestAnimationFrame(() => checkOverflowAndExpand(wrap, inner));

    inner.addEventListener('input', scheduleCheck);
    inner.addEventListener('paste', scheduleCheck);
    inner.addEventListener('keyup', (ev: KeyboardEvent) => {
        if (ev.key === 'Enter') scheduleCheck();
    });

    scheduleCheck();
}

function checkOverflowAndExpand(wrap: HTMLElement, inner: HTMLElement): void {
    const curH = getCurrentHeight(wrap);
    if (curH >= DEFAULT_MAX) return;               // already maxed

    const overflow = inner.scrollHeight - inner.clientHeight;
    if (overflow <= 1) return;                     // no scrollbar

    const newHeight = Math.min(DEFAULT_MAX, curH + overflow);

    applySize(newHeight, wrap, inner);
    stored[currentConvId() ?? 'global'] = newHeight;
}

/* ───────────────────── height helpers ───────────────────── */

export function applySize(px: number, wrap?: HTMLElement | null, inner?: HTMLElement | null): void {
    wrap  = wrap  ?? document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    inner = inner ?? wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea) ?? null;
    if (!wrap) return;

    wrap.style.maxHeight = `${px}px`;
    wrap.style.minHeight = `${px}px`;
    if (inner) {
        inner.style.maxHeight = `${px}px`;
        inner.style.minHeight = `${px}px`;
    }
}

function getCurrentHeight(wrap?: HTMLElement | null): number {
    wrap = wrap ?? document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    return wrap ? (parseInt(getComputedStyle(wrap).maxHeight, 10) || MIN_HEIGHT) : DEFAULT_MAX;
}

function applyInitialSize(wrap: HTMLElement): void {
    applySize(MIN_HEIGHT, wrap);
}

/* ────────── conversation‑change watch (Kayako SPA) ───────── */

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

        const chromeRoot = btn.closest(KAYAKO_SELECTORS.textEditorContainerRoot) as HTMLElement | null;
        const wrap  = chromeRoot?.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper) || null;
        const inner = wrap?.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea) || null;

        setTimeout(() => applySize(MIN_HEIGHT, wrap, inner), 50);
    }, true);
}
