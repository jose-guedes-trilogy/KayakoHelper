/*  Kayako Helper – sendInChunks.ts
    “Send in chunks” button + paced delivery (default 200 WPM)
    v1.7 – 2025-07-08   ← bumped
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
    chunks:  string[]; // stores raw **HTML** for each chunk
    idx:     number;
    timer?:  number;
    tick?:   number;
    nextAt?: number;
};

const INPUT_SEL    = KAYAKO_SELECTORS.textEditorReplyArea;
const FOOTER_SEL   = KAYAKO_SELECTORS.replyBoxFooter;
const SEND_BTN_SEL = KAYAKO_SELECTORS.sendButtonPublicReply;

const BTN_ID = EXTENSION_SELECTORS.sendInChunksButton.replace(/^#/, '');

const PUBLIC_ACTIVE_SEL = KAYAKO_SELECTORS.replyModeSelectorOn;

/** ── NEW SPLIT RULES ──────────────────────────────────────────────────
 *  A single *blank* HTML block is now enough to cut a chunk:
 *    • <div><br></div>      (or any <div …>…</div> that’s only a <br>)
 *    • <p><br></p>
 *    • ≥ 2 consecutive <br> tags outside of other blocks
 */
const CHUNK_HTML_RE =
    /(?:<(?:p|div)[^>]*>\s*(?:<br\s*\/?>|\s|&nbsp;)*<\/(?:p|div)>\s*)+|(?:<br\s*\/?>\s*){2,}/gi;

/** Gap inserted when re-stitching remaining chunks after “Cancel”. */
const GAP_HTML = '<div><br></div>';

let prefs = { wpm: 200 };
chrome.storage.sync.get({ sendChunksWPM: 200 }, r => {
    prefs.wpm = +r.sendChunksWPM || 200;
});

/* ───────────────── Bootstrap ───────────────────────── */

export function bootSendChunks(): void {
    if ((window as any).__khSendChunksBooted) return;
    (window as any).__khSendChunksBooted = true;

    /* 🔸  ADD   attributes:true  +   attributeFilter:['class']  */
    new MutationObserver(tryInject).observe(
        document.body,
        {
            subtree: true,
            childList: true,
            characterData: true,
            attributes: true,          // ← watch class changes
            attributeFilter: ['class'] // ← only “class” to stay lightweight
        },
    );

    tryInject();
}

/** True only when the Public Reply tab is active (Internal Notes has a different state). */
function publicReplySelected(): boolean {
    return !!document.querySelector(PUBLIC_ACTIVE_SEL);
}

/* ───────────────── Injection ───────────────────────── */

function tryInject(): void {
    const footer = document.querySelector<HTMLElement>(FOOTER_SEL);
    if (!footer) return;

    const isMessenger = messengerSelected();
    const isPublic    = publicReplySelected();
    const existingBtn = footer.querySelector<HTMLElement>('#' + BTN_ID);

    // Remove if we leave Messenger *or* switch to Internal Notes
    if (existingBtn && (!isMessenger || !isPublic)) {
        existingBtn.remove();
        return;
    }

    // Only add when Messenger **and** Public Reply are both active
    if (!isMessenger || !isPublic || existingBtn) return;

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

    const parts = htmlToChunks(editor.innerHTML);
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

/** Writes **either** plain-text or raw HTML into the editor. */
function writeToEditor(content: string): Promise<void> {
    const editor = getEditorElement();
    if (!editor) return Promise.resolve();

    editor.innerHTML = /[<&>]/.test(content)
        ? content
        : content.replace(/\n/g, '<br>').replace(/ {2}/g, ' &nbsp;');

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
            writeToEditor(remaining.join(GAP_HTML)).then(fitEditorHeight);
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

/* ───────── Text helpers ───────── */

const words = (html: string) => htmlToPlain(html).split(/\s+/).filter(Boolean).length;


/**
 * Split the raw editor HTML into chunks by looking for:
 *   • An empty <div>…</div> or <p>…</p> that contains only <br>, &nbsp; or whitespace
 *   • Two or more consecutive <br> elements **outside** any other block element
 *
 * The browser’s parser handles all oddities (attribute order, comments, entities, etc.)
 * so the rules stay robust if Froala or Kayako tweak their markup in the future.
 */
function htmlToChunks(html: string): string[] {
    const container = document.createElement('div');
    container.innerHTML = html;

    const chunks: string[] = [];
    let currentChunk: string[] = [];
    let consecutiveTopLevelBr = 0;

    const flush = () => {
        if (currentChunk.length) {
            chunks.push(currentChunk.join(''));
            currentChunk = [];
        }
        consecutiveTopLevelBr = 0;
    };

    Array.from(container.childNodes).forEach(node => {
        // Top-level <br>
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
            consecutiveTopLevelBr++;
            if (consecutiveTopLevelBr >= 2) {
                flush();
                return; // don’t include the <br><br> that acted as the separator
            }
        } else {
            consecutiveTopLevelBr = 0;
        }

        // Empty <div> or <p> that should act as a separator
        if (
            node.nodeType === Node.ELEMENT_NODE &&
            /^(DIV|P)$/i.test((node as HTMLElement).tagName)
        ) {
            const el = node as HTMLElement;
            const isBlankBlock = el.textContent?.trim() === '' &&
                // strip the usual suspects and see if there’s anything left
                el.innerHTML.replace(/<br\s*\/?>|&nbsp;|\s+/gi, '') === '';

            if (isBlankBlock) {
                flush();
                return; // separator not part of any chunk
            }
        }

        // Anything else → keep
        currentChunk.push(node.outerHTML ?? node.textContent ?? '');
    });

    flush(); // push the last chunk
    return chunks;
}


/** Existing plain-text converter, unchanged. */
const htmlToPlain = (html: string) => html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n');
