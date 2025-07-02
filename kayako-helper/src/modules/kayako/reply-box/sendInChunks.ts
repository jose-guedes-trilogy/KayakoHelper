/*  Kayako Helper – sendInChunks.ts
    “Send in chunks” button + paced delivery (default 200 WPM)
    v1.5 – 2025-07-02
---------------------------------------------------------------------------- */

import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import {
    applySize,
    DEFAULT_MAX,
    MIN_HEIGHT,
} from '@/modules/kayako/reply-box/replyResizer.ts';

/* ───────────────── Types & constants ───────────────── */

type ChunkState = {
    chunks:  string[];
    idx:     number;
    timer?:  number;
    tick?:   number;
    nextAt?: number;
};

const INPUT_SEL    = KAYAKO_SELECTORS.textEditorReplyArea;
const FOOTER_SEL   = KAYAKO_SELECTORS.replyBoxFooter;
const SEND_BTN_SEL = KAYAKO_SELECTORS.sendButtonPublicReply;

const BTN_ID = EXTENSION_SELECTORS.sendInChunksButton.replace(/^#/, '');

const CHUNK_RE = /(?:\r?\n|\r)\s*(?:\r?\n|\r)+\s*/g;

let prefs = { wpm: 200 };
chrome.storage.sync.get({ sendChunksWPM: 200 }, r => {
    prefs.wpm = +r.sendChunksWPM || 200;
});

/* ───────────────── Bootstrap ───────────────────────── */

export function bootSendChunks(): void {
    if ((window as any).__khSendChunksBooted) return;
    (window as any).__khSendChunksBooted = true;

    new MutationObserver(tryInject).observe(
        document.body,
        { subtree: true, childList: true, characterData: true },
    );

    tryInject();
}

/* ───────────────── Injection ───────────────────────── */

function tryInject(): void {
    const footer = document.querySelector<HTMLElement>(FOOTER_SEL);
    if (!footer) return;

    const isMessenger = messengerSelected();
    const existingBtn = footer.querySelector<HTMLElement>('#' + BTN_ID);

    if (existingBtn && !isMessenger) {                       // remove when channel switches
        existingBtn.remove();
        return;
    }
    if (!isMessenger || existingBtn) return;                 // nothing to add

    const sendBtn = footer.querySelector<HTMLButtonElement>(SEND_BTN_SEL);
    if (!sendBtn) return;

    const btn  = document.createElement('button');
    btn.id     = BTN_ID;
    btn.className = 'ko-button ko-button--secondary';        // UNIQUE styling!
    btn.addEventListener('click', onClickSendChunks);

    const span = document.createElement('span');
    span.className   = 'ko-button__span_ka3fcv';
    span.textContent = 'Send in chunks';
    btn.appendChild(span);

    footer.insertBefore(btn, sendBtn);
}

function messengerSelected(): boolean {
    const el = document.querySelector<HTMLElement>('[class*=ko-channel-selector_selected-channel__text_]');
    return !!el && /^Messenger\b/i.test(el.textContent?.trim() || '');
}

/* ───────────────── Runtime ─────────────────────────── */

const state: ChunkState = { chunks: [], idx: 0 };

async function onClickSendChunks(ev: MouseEvent): Promise<void> {
    if (state.timer) { abortRun(); return; }

    const editor = getEditorElement();
    if (!editor) return;

    const raw   = htmlToPlain(editor.innerHTML).trim();
    const parts = raw.split(CHUNK_RE).map(t => t.trim()).filter(Boolean);
    if (parts.length <= 1) return;

    Object.assign(state, { chunks: parts, idx: 0 });
    await writeToEditor(parts[0]);
    await new Promise(r => requestAnimationFrame(r));
    triggerSend();
    scheduleNext();
}

/* ───────────────── Scheduler ──────────────────────── */

async function scheduleNext(): Promise<void> {
    state.idx += 1;
    if (state.idx >= state.chunks.length) { abortRun(false); return; }

    await waitForEditorEmpty();

    const chunk = state.chunks[state.idx];
    await writeToEditor(chunk);

    const delay = Math.max(500, words(chunk) * 60_000 / prefs.wpm);
    let secs    = Math.ceil(delay / 1000);
    state.nextAt = Date.now() + delay;

    refreshBtnLabel(secs);
    state.tick = window.setInterval(() => {
        secs = Math.max(0, Math.ceil((state.nextAt! - Date.now()) / 1000));
        refreshBtnLabel(secs);
    }, 1_000);

    state.timer = window.setTimeout(() => {
        clearInterval(state.tick!);
        if (!triggerSend()) { abortRun(); return; }
        scheduleNext();
    }, delay);
}

/* ───────────────── Helpers ────────────────────────── */

function getEditorElement(): HTMLElement | null {
    const wrap = document.querySelector<HTMLElement>(INPUT_SEL);
    return wrap?.matches('.fr-element[contenteditable]')
        ? wrap
        : wrap?.querySelector<HTMLElement>('.fr-element[contenteditable]') ?? null;
}

function waitForEditorEmpty(timeoutMs = 5_000): Promise<void> {
    return new Promise(res => {
        const editor = getEditorElement();
        if (!editor) { res(); return; }

        if (htmlToPlain(editor.innerHTML).trim() === '') { res(); return; }

        const obs = new MutationObserver(() => {
            if (htmlToPlain(editor.innerHTML).trim() === '') {
                obs.disconnect(); clearTimeout(to); res();
            }
        });
        obs.observe(editor, { childList: true, subtree: true, characterData: true });

        const to = setTimeout(() => { obs.disconnect(); res(); }, timeoutMs);
    });
}

function writeToEditor(text: string): Promise<void> {
    const editor = getEditorElement();
    if (!editor) return Promise.resolve();

    editor.innerHTML = text
        .replace(/\n/g, '<br>')
        .replace(/ {2}/g, ' &nbsp;');

    editor.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

    const $ = (window as any).jQuery as JQueryStatic | undefined;
    $?.fn?.froalaEditor && $(editor).closest('.fr-box')
        .data('froala.editor')
        ?.events.trigger('contentChanged')
        ?.undo.saveStep();

    return new Promise(r => requestAnimationFrame(r));
}

function triggerSend(): boolean {
    const sendBtn = document.querySelector<HTMLButtonElement>(SEND_BTN_SEL);
    if (!sendBtn) return false;
    sendBtn.click();
    return true;
}

function abortRun(restore = true): void {
    clearTimeout(state.timer!); clearInterval(state.tick!);

    if (restore && state.chunks.length) {
        const remaining = state.chunks.slice(state.idx);
        if (remaining.length) {
            writeToEditor(remaining.join('\n\n')).then(fitEditorHeight);
        }
    }
    Object.assign(state, { chunks: [], idx: 0, timer: undefined, tick: undefined, nextAt: undefined });
    refreshBtnLabel();
}

function fitEditorHeight(): void {
    const wrap  = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    if (!wrap) return;

    const inner = wrap.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea) || wrap;
    const needed = Math.max(MIN_HEIGHT, inner.scrollHeight + 4);
    applySize(Math.min(DEFAULT_MAX, needed));
}

/* ───────── UI helpers ───────── */

function getBtn(): HTMLButtonElement | null {
    return document.getElementById(BTN_ID) as HTMLButtonElement | null;
}

function refreshBtnLabel(secs?: number): void {
    const span = getBtn()?.querySelector('span');
    if (!span) return;

    if (state.timer) {
        const s = secs ?? Math.max(0, Math.ceil((state.nextAt! - Date.now()) / 1000));
        span.textContent = `Cancel (${s}s)`;
    } else {
        span.textContent = 'Send in chunks';
    }
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const htmlToPlain = (html: string) => html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n');
