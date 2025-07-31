/*  Kayako Helper – sendInChunks.ts
    “Send in chunks” button + paced delivery  (default 200 WPM)
    v1.9.1 – 2025-07-16  ← fix <br …> detection
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

/* ───────────────── Types, constants & utils ───────────────── */

const DBG = true;
const log = (...a: any[]) => DBG && console.log('[KH-SendChunks]', ...a);

type ChunkState = { chunks: string[]; idx: number; timer?: number; tick?: number; nextAt?: number };

const INPUT_SEL    = KAYAKO_SELECTORS.textEditorReplyArea;
const FOOTER_SEL   = KAYAKO_SELECTORS.replyBoxFooter;
const SEND_BTN_SEL = KAYAKO_SELECTORS.sendButtonPublicReply;
const BTN_ID       = EXTENSION_SELECTORS.sendInChunksButton.replace(/^#/, '');
const PUBLIC_ACTIVE_SEL = KAYAKO_SELECTORS.replyModeSelectorOn;

/* UI text */
const GAP_HTML = '<div><br></div>';

/* NEW: matches <br>, <br />, <br data-foo="…">, etc. */
const BR_TAG_RE = /<br\b[^>]*>/gi;

let prefs = { wpm: 200 };
chrome.storage.sync.get({ sendChunksWPM: 200 }, r => prefs.wpm = +r.sendChunksWPM || 200);

/* ───────────────── Bootstrapping ─────────────────────────── */

export function bootSendChunks(): void {
    if ((window as any).__khSendChunksBooted) return;
    (window as any).__khSendChunksBooted = true;
    log('bootSendChunks');

    new MutationObserver(tryInject).observe(document.body, {
        subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ['class'],
    });

    tryInject();
}

/* ───────────────── Button injection / removal ───────────── */

function publicReply(): boolean     { return !!document.querySelector(PUBLIC_ACTIVE_SEL); }
function messengerSelected(): boolean {
    const el = document.querySelector<HTMLElement>('[class*=ko-channel-selector_selected-channel__text_]');
    return !!el && /^Messenger\b/i.test(el.textContent?.trim() || '');
}

function tryInject(): void {
    const footer = document.querySelector<HTMLElement>(FOOTER_SEL);
    if (!footer) return;

    const inMessenger = messengerSelected(), inPublic = publicReply();
    const btn = footer.querySelector<HTMLElement>(`#${BTN_ID}`);

    if (btn && (!inMessenger || !inPublic)) { btn.remove(); return; }
    if (!inMessenger || !inPublic || btn)   return;

    const sendBtn = footer.querySelector<HTMLButtonElement>(SEND_BTN_SEL);
    if (!sendBtn) return;

    const newBtn = document.createElement('button');
    newBtn.id        = BTN_ID;
    newBtn.className = 'ko-button ko-button--secondary';
    newBtn.addEventListener('click', onClickSendChunks);

    const span = document.createElement('span');
    span.className = 'ko-button__span_ka3fcv';
    span.textContent = 'Send in chunks';
    newBtn.appendChild(span);

    footer.insertBefore(newBtn, sendBtn);
}

/* ───────────────── Runtime ──────────────────────────────── */

const state: ChunkState = { chunks: [], idx: 0 };

async function onClickSendChunks(): Promise<void> {
    log('button', state.timer ? '→ cancel' : 'clicked');

    if (state.timer) { abortRun(); return; }

    const editor = getEditor();
    if (!editor) { log('⚠️ editor not found'); return; }

    const parts = htmlToChunks(editor.innerHTML);
    log('chunk count =', parts.length);
    if (parts.length <= 1) { log('nothing to chunk'); return; }

    Object.assign(state, { chunks: parts, idx: 0 });
    await writeToEditor(parts[0]);
    await new Promise(r => requestAnimationFrame(r));
    if (!triggerSend()) { abortRun(); return; }
    scheduleNext();
}

/* ───────────────── Scheduler ────────────────────────────── */

async function scheduleNext(): Promise<void> {
    state.idx += 1;
    if (state.idx >= state.chunks.length) { abortRun(false); return; }

    await waitUntilEmpty();

    const next = state.chunks[state.idx];
    await writeToEditor(next);

    const delay = Math.max(500, words(next) * 60_000 / prefs.wpm);
    let secs    = Math.ceil(delay / 1000);
    state.nextAt = Date.now() + delay;

    refreshBtn(secs);
    state.tick = window.setInterval(() => {
        secs = Math.max(0, Math.ceil((state.nextAt! - Date.now()) / 1000));
        refreshBtn(secs);
    }, 1000);

    state.timer = window.setTimeout(() => {
        clearInterval(state.tick!);
        if (!triggerSend()) { abortRun(); return; }
        scheduleNext();
    }, delay);
}

/* ───────────────── DOM helpers ─────────────────────────── */

function getEditor(): HTMLElement | null {
    const wrap  = document.querySelector<HTMLElement>(INPUT_SEL);
    const inner = wrap?.matches('.fr-element[contenteditable]')
        ? wrap
        : wrap?.querySelector<HTMLElement>('.fr-element[contenteditable]');
    return inner ?? null;
}

function waitUntilEmpty(max = 5000): Promise<void> {
    return new Promise(res => {
        const ed = getEditor();
        if (!ed) { res(); return; }
        if (htmlToPlain(ed.innerHTML).trim() === '') { res(); return; }

        const mo = new MutationObserver(() => {
            if (htmlToPlain(ed.innerHTML).trim() === '') { mo.disconnect(); clearTimeout(to); res(); }
        });
        mo.observe(ed, { childList: true, subtree: true, characterData: true });

        const to = setTimeout(() => { mo.disconnect(); res(); }, max);
    });
}

function writeToEditor(content: string): Promise<void> {
    const ed = getEditor();
    if (!ed) return Promise.resolve();

    ed.innerHTML = /[<&>]/.test(content)
        ? content
        : content.replace(/\n/g, '<br>').replace(/ {2}/g, ' &nbsp;');

    ed.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));

    /* notify Froala if available */
    try {
        const $ = (window as any).jQuery as JQueryStatic | undefined;
        $?.fn?.froalaEditor &&
        $(ed).closest('.fr-box').data('froala.editor')?.events.trigger('contentChanged')?.undo.saveStep();
    } catch { /* noop */ }

    return new Promise(r => requestAnimationFrame(r));
}

function triggerSend(): boolean {
    const btn = document.querySelector<HTMLButtonElement>(SEND_BTN_SEL);
    if (!btn) { log('⚠️ send button not found'); return false; }
    btn.click(); return true;
}

function abortRun(restore = true): void {
    clearTimeout(state.timer!); clearInterval(state.tick!);

    if (restore && state.chunks.length) {
        const rest = state.chunks.slice(state.idx);
        rest.length && writeToEditor(rest.join(GAP_HTML)).then(adjustHeight);
    }
    Object.assign(state, { chunks: [], idx: 0, timer: undefined, tick: undefined, nextAt: undefined });
    refreshBtn();
}

function adjustHeight(): void {
    const wrap = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.editorWrapper);
    if (!wrap) return;
    const inner = wrap.querySelector<HTMLElement>(KAYAKO_SELECTORS.replyBoxInputArea) || wrap;
    applySize(Math.min(DEFAULT_MAX, Math.max(MIN_HEIGHT, inner.scrollHeight + 4)));
}

/* ───────── UI helpers ───────── */

function refreshBtn(secs?: number): void {
    const span = document.getElementById(BTN_ID)?.querySelector('span');
    if (!span) return;
    span.textContent = state.timer
        ? `Cancel (${secs ?? Math.max(0, Math.ceil((state.nextAt! - Date.now()) / 1000))}s)`
        : 'Send in chunks';
}

/* ───────── Chunk splitter  – NEW! ───────── */

/**
 * DOM-based splitter:
 *   • tags any pair `<br><br>` *anywhere* in the tree
 *   • tags an empty `<div>` / `<p>` (only whitespace, &nbsp; or a single `<br>`)
 *   • adds a harmless comment node `<!-- KH-SEP -->`
 *   • serialises outerHTML once and splits on that comment
 *
 * Unlike the old version, it doesn’t care about nesting — so a blank line
 * inside `<li>` finally counts.  No giant regexes, no fragile “top-level only”.
 */
function htmlToChunks(html: string): string[] {
    const SEP  = 'KH-SEP';
    const root = document.createElement('div');
    root.innerHTML = html;

    const after = (ref: Node) =>
        ref.parentNode!.insertBefore(document.createComment(SEP), ref.nextSibling);

    /* 1️⃣  Split EMPTY <div>/<p> blocks */
    [...root.querySelectorAll('div, p')].forEach(el => {
        const blank = el.textContent?.trim() === '' &&
            el.innerHTML.replace(BR_TAG_RE, '').replace(/&nbsp;|\s+/gi, '') === '';
        if (blank) { after(el); el.remove(); }
    });

    /* 2️⃣  Split on <br><br>  (same logic as v1.12) */
    [...root.querySelectorAll('br')].forEach(br1 => {
        let nxt = br1.nextSibling;
        while (nxt && nxt.nodeType === 3 && !nxt.textContent!.trim())
            nxt = nxt.nextSibling;
        if (!(nxt && nxt.nodeType === 1 && (nxt as HTMLElement).tagName === 'BR')) return;

        const li = br1.closest('li');
        if (li) {
            let tailStart = nxt.nextSibling;
            while (tailStart && tailStart.nodeType === 3 && !tailStart.textContent!.trim())
                tailStart = tailStart.nextSibling;

            if (!tailStart) {            /* just mark boundary */
                after(li);
                removeBetween(br1, nxt);
                return;
            }

            const liTail = li.cloneNode(false) as HTMLElement;
            while (tailStart) {
                const next = tailStart.nextSibling;
                liTail.appendChild(tailStart);
                tailStart = next;
            }
            after(li);
            li.parentNode!.insertBefore(liTail, li.nextSibling!.nextSibling);
            removeBetween(br1, nxt);
            return;
        }

        after(nxt);
        removeBetween(br1, nxt);
    });

    /* 3️⃣  Serialise → raw chunks */
    const raw = root.innerHTML
        .split(`<!--${SEP}-->`)
        .map(s => s.trim())
        .filter(Boolean);

    /* 4️⃣  Fix ordered-list numbering */
    const fixed: string[] = [];
    let inOl = false;
    let counter = 0;

    raw.forEach(chunk => {
        let s = chunk.trim();

        /* chunk with its own <ol …> */
        if (/^<ol\b/i.test(s)) {
            /* ensure it closes */
            if (!/<\/ol>/i.test(s)) s += '</ol>';

            /* figure out current number */
            const m = s.match(/<ol[^>]*start\s*=\s*["']?(\d+)/i);
            counter = m ? parseInt(m[1], 10) : 1;
            inOl = true;

            fixed.push(s);
            return;
        }

        /* orphan <li> that belongs to the running list */
        if (/^<li\b/i.test(s) && inOl) {
            counter += 1;
            s = s.replace(/\s*<\/ol>\s*$/i, '');               // strip stray </ol> if any
            s = `<ol start="${counter}">\n${s}\n</ol>`;
            fixed.push(s);
            return;
        }

        /* any other content closes the list context */
        inOl = false;
        counter = 0;
        fixed.push(s);
    });

    return fixed;

    /* helper – remove nodeA, nodeB and everything between */
    function removeBetween(a: Node, b: Node) {
        let n: Node | null = a;
        while (n) {
            const next = n.nextSibling;
            n.remove();
            if (n === b) break;
            n = next;
        }
    }
}

/* ───────── Misc. helpers ───────── */

const words = (h: string) => htmlToPlain(h).split(/\s+/).filter(Boolean).length;

const htmlToPlain = (h: string) => h
    .replace(BR_TAG_RE, '\n')
    .replace(/<\/(p|div|blockquote|li)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n');
