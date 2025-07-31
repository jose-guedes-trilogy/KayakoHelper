/* ===========================================================================
 * src/modules/buttons/sendToQCButton.ts  (v1.4.1)
 *
 *  Kayako Helper – “Send to QC” Button
 *  – v1.4.1  • 🛠 FIX: duplicate-button bug + TS type mismatch
 * ---------------------------------------------------------------------------
 *  • Adds a button that automates the full “QC pending” workflow:
 *      1. Reads the clipboard (preferring rich HTML).
 *      2. Normalises <p>→<div>, removes <hr>, converts h1/h2→h3, bolds h3.
 *      3. Wraps it in the required template (preserving formatting).
 *      4. Injects the result into the current reply editor.
 *      5. Runs the “Add newlines” helper.
 *      6. Switches the composer to Internal-Note mode (robust click).
 *      7. Adds the ‘qc_pending’ tag to the ticket.
 * ---------------------------------------------------------------------------
 */

import {
    EXTENSION_SELECTORS,
    KAYAKO_SELECTORS,
} from '@/generated/selectors.ts';

import { isConvPage }        from '@/utils/location.js';
import { addNewlines }       from '@/modules/kayako/newlineSpacer.ts';
import { applySize }         from '@/modules/kayako/reply-box/replyResizer.ts';
import {HeaderSlot, registerEditorHeaderButton} from "@/modules/kayako/buttons/buttonManager.ts";

/* ------------------------------------------------------------------ */
/* Constants & UI state                                               */
/* ------------------------------------------------------------------ */

/* 🛠 FIX 1 – keep the leading “#” so the querySelector in
   tabButtonManager can find the element and avoid duplicates. */
const BTN_ID = EXTENSION_SELECTORS.sendToQcButton;   // <─ CHANGED

const ICON     = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
type UiState   = keyof typeof ICON;
const RESET_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Public bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function bootSendToQcButton(): void {
    /* central UI-state tracker */
    let uiState: UiState = 'idle';
    const label = () =>
        `${ICON[uiState]} ${
            uiState==='idle' ? 'Send to QC' :
                uiState==='work' ? 'Working…'  :
                    uiState==='ok'   ? 'Done'      : 'Failed' }`;

    /* create + register the editor-header button */
    registerEditorHeaderButton({
        id   : BTN_ID,
        type : 'simple',
        slot : HeaderSlot.THIRD,
        label,
        async onClick(btn) {
            /* 🛠 FIX 2 – the helper now only needs the new state */
            const setState = (s: UiState) => { uiState=s; btn.textContent=label(); };
            await handleClick(btn, setState);
            if (uiState !== 'idle') {
                setTimeout(() => { setState('idle'); }, RESET_MS);
            }
        },
    });
}

/* ------------------------------------------------------------------ */
/* Click handler                                                      */
/* ------------------------------------------------------------------ */

/* 🛠 FIX 3 – simplify the callback signature so it matches the
   setState we pass in (and remove the unused second argument). */
async function handleClick(
    self: HTMLButtonElement,
    setState: (s: UiState) => void,
): Promise<void> {

    setState('work');

    try {
        /* 1 · Grab the clipboard (prefer rich HTML) */
        const clipHtml = await readClipboardHtml();

        /* 2 · Build the template (normalise & clean) */
        const html = buildTemplate(clipHtml).replace(/(\r\n|\r|\n)/g, ' ');

        /* 3 · Inject into the active Froala editor */
        const editor = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
        if (!editor) throw new Error('Reply editor not found');
        editor.innerHTML = html;

        /* 4 · Tidy spacing */
        addNewlines(editor);

        /* 5 · Switch to Internal-Note mode (robust click) */
        const noteBtn = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.activateNoteModeButton);
        if (!noteBtn) throw new Error('Note-mode button not found');
        simulateClick(noteBtn);

        /* 6 · Add the qc_pending tag */
        await addTag('qc_pending');

        /* ✅ All good */
        setState('ok');
        setTimeout(() => setState('idle'), RESET_MS);

        /* Enlarge reply box */
        applySize(500);

    } catch (err) {
        console.error('[SendToQC] failed:', err);
        alert(`Send to QC failed: ${(err as Error).message}`);
        setState('err');
        setTimeout(() => setState('idle'), RESET_MS);
    }
}

/* ------------------------------------------------------------------ */
/* Clipboard helpers                                                  */
/* ------------------------------------------------------------------ */

async function readClipboardHtml(): Promise<string> {
    /* Try → navigator.clipboard.read(…) for rich HTML */
    try {
        if ('clipboard' in navigator && 'read' in navigator.clipboard) {
            const items = await (navigator.clipboard as any).read();
            for (const it of items) {
                if (it.types.includes('text/html')) {
                    const blob = await it.getType('text/html');
                    return await blob.text();             // ⬅ rich fragment
                }
            }
        }
    } catch {
        /* Ignore → fall back to plain text */
    }

    /* Fallback → plain text, convert linebreaks to <br> */
    const txt = await navigator.clipboard.readText();
    return txt.replace(/\n/g, '<br>');
}


/* ------------------------------------------------------------------ */
/* Template & normalisation                                           */
/* ------------------------------------------------------------------ */

/** Normalises p→div, strips data-* & <hr>, converts h1/h2→h3 and bolds h3. */
function normalizeParagraphs(fragment: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = fragment;

    /* 1 ─ Replace <p> with <div>, but **only if the <p> is not inside an <li>** */
    tmp.querySelectorAll('p').forEach(p => {
        if (p.closest('li')) {
            p.replaceWith(...Array.from(p.childNodes));   // unwrap for inline flow
            return;
        }
        const div = document.createElement('div');
        Array.from(p.attributes).forEach(attr => {
            if (!attr.name.startsWith('data-')) div.setAttribute(attr.name, attr.value);
        });
        div.innerHTML = p.innerHTML;
        p.replaceWith(div);
    });

    /* 1b ─ Convert <h1> & <h2> → <h3> (attrs kept, data-* stripped later) */
    tmp.querySelectorAll('h1,h2').forEach(h => {
        const h3 = document.createElement('h3');
        Array.from(h.attributes).forEach(attr => {
            if (!attr.name.startsWith('data-')) h3.setAttribute(attr.name, attr.value);
        });
        h3.innerHTML = h.innerHTML;
        h.replaceWith(h3);
    });

    /* 1c ─ Wrap every <h3> & <h4> content in <strong> to force bold */
    tmp.querySelectorAll('h3,h4').forEach(h => {
        h.innerHTML = `<strong>${h.innerHTML}</strong>`;
    });

    /* 2 ─ Strip data-* attributes everywhere */
    tmp.querySelectorAll('*').forEach(el =>
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
        }),
    );

    /* 2b ─ Remove all <hr> elements */
    tmp.querySelectorAll('hr').forEach(hr => hr.remove());

    /* 3 ─ Remove whitespace-only text nodes sitting between elements */
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    const toRemove: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (!node.data.trim()) {
            const parentName = node.parentElement?.tagName.toLowerCase();
            if (parentName && /^(pre|code|textarea)$/.test(parentName)) continue;
            toRemove.push(node);
        }
    }
    toRemove.forEach(n => n.remove());

    return tmp.innerHTML;
}

function buildTemplate(clip: string): string {
    const body = normalizeParagraphs(clip || '<i>(clipboard empty)</i>');
    return (
        `What is your proposed action?<br><br>
• Send to customer<br><br>
===============================================================<br>
What is the PR to the customer?<br><br>
${body}<br><br>
===============================================================<br>
Additional Context?<br><br><br>
===============================================================<br><br>
GPT<br>
Did you use GPT: Yes`
    );
}

/* ------------------------------------------------------------------ */
/* Mouse-event helper                                                 */
/* ------------------------------------------------------------------ */

function simulateClick(el: HTMLElement): void {
    ['mousedown', 'mouseup', 'click'].forEach(type =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
}

/* ------------------------------------------------------------------ */
/* Tag helper (Ember power-select)                                    */
/* ------------------------------------------------------------------ */

function simulateEnter(el: HTMLElement): void {
    ['keydown', 'keypress', 'keyup'].forEach(type =>
        el.dispatchEvent(
            new KeyboardEvent(type, {
                bubbles   : true,
                cancelable: true,
                key       : 'Enter',
                code      : 'Enter',
                keyCode   : 13,   // legacy
                which     : 13,   // legacy
                charCode  : type === 'keypress' ? 13 : 0,
            }),
        )
    );
}

async function addTag(tag: string): Promise<void> {
    const input = document.querySelector<HTMLInputElement>(
        'input[placeholder="Add a tag..."]',
    );
    if (!input) throw new Error('Tag input not found');

    input.focus();
    input.value = tag;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    simulateEnter(input);
    await new Promise(r => setTimeout(r));
}
