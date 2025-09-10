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

/* ───────────── Preferences (from chrome.storage) ───────────── */

const STORAGE_KEYS = {
    fixedEnabled: 'replyFixedHeightEnabled',
    fixedPx: 'replyFixedHeightPx',
    rememberLast: 'replyRememberLastHeight',
    lastPx: 'replyLastHeightPx',
} as const;

let prefFixedEnabled = false;
let prefFixedPx = 200;
let prefRememberLast = false;
let lastHeightPx: number | null = null;
let settingsLoaded = false;

/* ───────────── Public bootstrap ─────────────── */

export function bootReplyResizer(): void {
    loadSettings(() => {
        ensureChrome();
        attachStorageListener();
        try {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') {
                    reapplyAllVisibleEditors();
                    try { console.debug('[KH][ReplyResizer] visibilitychange → reapply'); } catch {}
                }
            });
        } catch {}
    });
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
            applyInitialSize(wrap);          // initial size from prefs/last
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

    // Fixed height mode: toggling collapse/expand should apply fixed height and bail
    if (prefFixedEnabled) {
        applySize(prefFixedPx, wrap, inner);
        persistLastIfNeeded(prefFixedPx);
        return;
    }

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

        // In fixed height mode, prevent manual drag resize
        if (prefFixedEnabled) {
            try { console.debug('[KH][ReplyResizer] Drag ignored (fixed height enabled)'); } catch {}
            return;
        }

        const startY = e.clientY;
        const startH = wrap.getBoundingClientRect().height;

        const onMove = (ev: MouseEvent) => {
            const newH = Math.max(MIN_HEIGHT, startH - (ev.clientY - startY));
            applySize(newH, wrap);
        };

        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup',   onUp);
            const h = getCurrentHeight(wrap);
            stored[currentConvId() ?? 'global'] = h;
            persistLastIfNeeded(h);
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
    if (prefFixedEnabled) {                         // no auto-expand in fixed mode
        applySize(prefFixedPx, wrap, inner);
        return;
    }
    if (curH >= DEFAULT_MAX) return;               // already maxed

    const overflow = inner.scrollHeight - inner.clientHeight;
    if (overflow <= 1) return;                     // no scrollbar

    const newHeight = Math.min(DEFAULT_MAX, curH + overflow);

    applySize(newHeight, wrap, inner);
    stored[currentConvId() ?? 'global'] = newHeight;
    persistLastIfNeeded(newHeight);
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
    // Prefer fixed height if enabled; else use remembered last; else collapse
    if (prefFixedEnabled) {
        applySize(prefFixedPx, wrap);
        persistLastIfNeeded(prefFixedPx);
        return;
    }
    const key = currentConvId() ?? 'global';
    const remembered = prefRememberLast ? (lastHeightPx ?? stored[key]) : stored[key];
    const initial = Math.max(MIN_HEIGHT, Math.min(DEFAULT_MAX, remembered || MIN_HEIGHT));
    applySize(initial, wrap);
}

/* ────────── conversation‑change watch (Kayako SPA) ───────── */

function watchConversation(): void {
    const id = currentConvId() ?? 'global';
    if (id !== currentConv) {
        currentConv = id;
        setTimeout(ensureChrome, 100);   // editor mounts a tick later
        // When conversation changes, re-apply fixed/remembered height shortly after mount
        setTimeout(() => {
            reapplyAllVisibleEditors();
        }, 400);
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

        setTimeout(() => {
            // Respect popup settings: do not override fixed or remember-last preferences
            if (prefFixedEnabled) {
                try { console.debug('[KH][ReplyResizer] send → enforcing fixed height', { px: prefFixedPx }); } catch {}
                applySize(prefFixedPx, wrap, inner);
                persistLastIfNeeded(prefFixedPx);
                return;
            }

            if (prefRememberLast) {
                // Keep the last remembered height; fall back to current computed height if unavailable
                const key = currentConvId() ?? 'global';
                const remembered = lastHeightPx ?? stored[key] ?? getCurrentHeight(wrap);
                const px = Math.max(MIN_HEIGHT, Math.min(DEFAULT_MAX, remembered));
                try { console.debug('[KH][ReplyResizer] send → preserving remembered height', { px }); } catch {}
                applySize(px, wrap, inner);
                persistLastIfNeeded(px);
                return;
            }

            // Default behavior (no special preference): collapse after send
            try { console.debug('[KH][ReplyResizer] send → collapsing to min height'); } catch {}
            applySize(MIN_HEIGHT, wrap, inner);
            persistLastIfNeeded(MIN_HEIGHT);
        }, 50);
    }, true);
}

function reapplyAllVisibleEditors(): void {
    try {
        document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.editorWrapper).forEach(wrap => {
            // Only apply to visible editors to avoid affecting hidden tabs
            const rect = wrap.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height >= MIN_HEIGHT && wrap.offsetParent !== null;
            if (isVisible) applyInitialSize(wrap);
        });
    } catch {}
}

/* ───────────── settings load / react helpers ───────────── */

function loadSettings(done?: () => void): void {
    try {
        chrome.storage.sync.get([
            STORAGE_KEYS.fixedEnabled,
            STORAGE_KEYS.fixedPx,
            STORAGE_KEYS.rememberLast,
            STORAGE_KEYS.lastPx,
        ] as const, raw => {
            prefFixedEnabled = !!raw[STORAGE_KEYS.fixedEnabled];
            const px = Number(raw[STORAGE_KEYS.fixedPx] ?? 200);
            prefFixedPx = Math.max(MIN_HEIGHT, Math.min(1000, isFinite(px) ? px : 200));
            prefRememberLast = !!raw[STORAGE_KEYS.rememberLast];
            const last = Number(raw[STORAGE_KEYS.lastPx]);
            lastHeightPx = isFinite(last) && last >= MIN_HEIGHT ? last : null;
            settingsLoaded = true;
            try { console.debug('[KH][ReplyResizer] settings loaded', { prefFixedEnabled, prefFixedPx, prefRememberLast, lastHeightPx }); } catch {}
            if (done) done();
        });
    } catch {
        settingsLoaded = true;
        if (done) done();
    }
}

function attachStorageListener(): void {
    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            let touched = false;
            if (STORAGE_KEYS.fixedEnabled in changes) {
                prefFixedEnabled = !!changes[STORAGE_KEYS.fixedEnabled]?.newValue;
                touched = true;
            }
            if (STORAGE_KEYS.fixedPx in changes) {
                const v = Number(changes[STORAGE_KEYS.fixedPx]?.newValue ?? 200);
                prefFixedPx = Math.max(MIN_HEIGHT, Math.min(1000, isFinite(v) ? v : 200));
                touched = true;
            }
            if (STORAGE_KEYS.rememberLast in changes) {
                prefRememberLast = !!changes[STORAGE_KEYS.rememberLast]?.newValue;
                touched = true;
            }
            if (STORAGE_KEYS.lastPx in changes) {
                const v = Number(changes[STORAGE_KEYS.lastPx]?.newValue);
                lastHeightPx = isFinite(v) && v >= MIN_HEIGHT ? v : lastHeightPx;
            }

            if (touched) {
                // Re-apply to any visible editor(s)
                try {
                    document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.editorWrapper).forEach(wrap => {
                        applyInitialSize(wrap);
                    });
                } catch {}
            }
        });
    } catch {}
}

function persistLastIfNeeded(px: number): void {
    if (!prefRememberLast) return;
    lastHeightPx = px;
    try { chrome.storage.sync.set({ [STORAGE_KEYS.lastPx]: px }); } catch {}
}
