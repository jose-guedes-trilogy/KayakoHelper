/* ===========================================================================
 * src/modules/buttons/sendToQC.ts
 *
 *  Kayako Helper – “Send to QC” Button (v1.1)
 * ---------------------------------------------------------------------------
 *  • Adds a tab-strip button that automates the full “QC pending” workflow:
 *      1. Reads the clipboard (preferring rich HTML).
 *      2. Normalises <p>→<div> so newline-spacer recognises them.
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
} from '@/generated/selectors';

import { registerTabButton } from '@/utils/tabButtonManager';
import { isConvPage }        from '@/utils/location.js';
import { addNewlines }       from '@/modules/newlineSpacer';
import {applySize} from "@/modules/replyResizer";

/* ------------------------------------------------------------------ */
/* Constants & UI state                                               */
/* ------------------------------------------------------------------ */

const BTN_ID = EXTENSION_SELECTORS.sendToQcButton.replace(/^#/, '');

const ICON     = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
type UiState   = keyof typeof ICON;
const RESET_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Public bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function bootSendToQcButton(): void {
    let uiState: UiState = 'idle';

    const label = (): string => {
        switch (uiState) {
            case 'idle': return `${ICON.idle} Send to QC`;
            case 'work': return `${ICON.work} Working…`;
            case 'ok'  : return `${ICON.ok} Done`;
            case 'err' : return `${ICON.err} Failed`;
        }
    };

    const setState = (state: UiState, btn?: HTMLButtonElement): void => {
        uiState = state;
        (btn ?? document.getElementById(BTN_ID) as HTMLButtonElement | null)!.textContent = label();
    };

    registerTabButton({
        id: BTN_ID,
        label,
        routeTest : isConvPage,
        onClick   : handleClick,
    });

    /* --------------------------------------------------------- */
    /* Click handler                                             */
    /* --------------------------------------------------------- */

    async function handleClick(btn?: HTMLButtonElement): Promise<void> {
        const self = btn ?? document.getElementById(BTN_ID) as HTMLButtonElement;
        if (!self) return;

        setState('work', self);

        try {
            /* 1 · Grab the clipboard (prefer rich HTML) */
            const clipHtml = await readClipboardHtml();

            /* 2 · Build the template (incl. <p>→<div> normalisation) */
            const html = buildTemplate(clipHtml).replace(/(\r\n|\r|\n)/g, " ");

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
            setState('ok', self);
            setTimeout(() => setState('idle'), RESET_MS);

            /* Enlarge reply box */
            applySize(500);

        } catch (err) {
            console.error('[SendToQC] failed:', err);
            alert(`Send to QC failed: ${(err as Error).message}`);
            setState('err', self);
            setTimeout(() => setState('idle'), RESET_MS);
        }
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

/** Converts every <p>→<div> inside the fragment (attributes kept). */
function normalizeParagraphs(fragment: string): string {
    const tmp = document.createElement('div');
    tmp.innerHTML = fragment;

    /* 1 ─ Replace <p> with <div>, but **only if the <p> is not inside an <li>** */
    tmp.querySelectorAll('p').forEach(p => {
        if (p.closest('li')) {
            /* unwrap so the <li> contains inline flow, not a block */
            p.replaceWith(...Array.from(p.childNodes));
            return;
        }

        const div = document.createElement('div');
        /* copy all attrs except data-* */
        Array.from(p.attributes).forEach(attr => {
            if (!attr.name.startsWith('data-')) div.setAttribute(attr.name, attr.value);
        });
        div.innerHTML = p.innerHTML;
        p.replaceWith(div);
    });

    /* 2 ─ Strip data-* attributes everywhere (unchanged) */
    tmp.querySelectorAll('*').forEach(el =>
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
        }),
    );

    /* 3 ─ Remove whitespace-only text nodes sitting between elements        */
    const walker = document.createTreeWalker(tmp, NodeFilter.SHOW_TEXT);
    const toRemove: Text[] = [];

    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
        if (!node.data.trim()) {
            /* keep meaningful whitespace inside pre|code|textarea */
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

    /* 1 • Type the tag text */
    input.focus();
    input.value = tag;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    /* 2 • Wait one frame so Ember sees the value */
    await new Promise(r => requestAnimationFrame(r));

    /* 3 • Simulate a genuine <Enter> key press */
    simulateEnter(input);

    /* 4 • Give Ember a micro-tick to create the pill */
    await new Promise(r => setTimeout(r));
}

export default bootSendToQcButton;
