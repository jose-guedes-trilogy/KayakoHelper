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

const BTN_ID = EXTENSION_SELECTORS.sendToQcButton;   // <─ CHANGED

// const ICON     = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
// type UiState   = keyof typeof ICON;
type UiState = 'idle' | 'work' | 'ok' | 'err'; // keep type but without icons
const RESET_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Public bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function bootSendToQcButton(): void {
    let uiState: UiState = 'idle';
    const label = () =>
        // `${ICON[uiState]} ${
        `${
            uiState==='idle' ? 'Send to QC' :
                uiState==='work' ? 'Working…'  :
                    uiState==='ok'   ? 'Done'      : 'Failed' }`;

    registerEditorHeaderButton({
        id   : BTN_ID,
        type : 'simple',
        slot : HeaderSlot.THIRD,
        label,
        async onClick(btn) {
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

async function handleClick(
    self: HTMLButtonElement,
    setState: (s: UiState) => void,
): Promise<void> {

    setState('work');

    try {
        const clipHtml = await readClipboardHtml();
        const html = buildTemplate(clipHtml).replace(/(\r\n|\r|\n)/g, ' ');
        const editor = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
        if (!editor) throw new Error('Reply editor not found');
        editor.innerHTML = html;
        addNewlines(editor);

        const noteBtn = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.activateNoteModeButton);
        if (!noteBtn) throw new Error('Note-mode button not found');
        simulateClick(noteBtn);

        await addTag('qc_pending');

        setState('ok');
        setTimeout(() => setState('idle'), RESET_MS);

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
    try {
        if ('clipboard' in navigator && 'read' in navigator.clipboard) {
            const items = await (navigator.clipboard as any).read();
            for (const it of items) {
                if (it.types.includes('text/html')) {
                    const blob = await it.getType('text/html');
                    return await blob.text();
                }
            }
        }
    } catch {}

    const txt = await navigator.clipboard.readText();
    return txt.replace(/\n/g, '<br>');
}

/* ------------------------------------------------------------------ */
/* Template & normalisation                                           */
/* ------------------------------------------------------------------ */

function normalizeParagraphs(fragment: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = fragment;

    tmp.querySelectorAll('p').forEach(p => {
        if (p.closest('li')) {
            p.replaceWith(...Array.from(p.childNodes));
            return;
        }
        const div = document.createElement('div');
        Array.from(p.attributes).forEach(attr => {
            if (!attr.name.startsWith('data-')) div.setAttribute(attr.name, attr.value);
        });
        div.innerHTML = p.innerHTML;
        p.replaceWith(div);
    });

    tmp.querySelectorAll('h1,h2').forEach(h => {
        const h3 = document.createElement('h3');
        Array.from(h.attributes).forEach(attr => {
            if (!attr.name.startsWith('data-')) h3.setAttribute(attr.name, attr.value);
        });
        h3.innerHTML = h.innerHTML;
        h.replaceWith(h3);
    });

    tmp.querySelectorAll('h3,h4').forEach(h => {
        h.innerHTML = `<strong>${h.innerHTML}</strong>`;
    });

    tmp.querySelectorAll('*').forEach(el =>
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
        }),
    );

    tmp.querySelectorAll('hr').forEach(hr => hr.remove());

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
                keyCode   : 13,
                which     : 13,
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
