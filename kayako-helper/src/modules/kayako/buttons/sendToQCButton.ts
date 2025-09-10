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
const MENU_ID = EXTENSION_SELECTORS.sendToQcButtonRight; // right-half id for split button

const DEFAULT_ACTION = 'Send to customer';
const ACTION_OPTIONS: readonly string[] = [
    'Send to customer',
    'Send to L2',
    'Send to external team',
    'Waiting for vendor',
    'Close ticket',
    'Send to L1',
    'Elevate to BU',
];

/* Settings keys (sync storage) */
const STORAGE_KEYS = {
    enableBtn   : 'qcButtonEnabled',
    templateOnly: 'qcTemplateOnly',
} as const;

/* Live flags (updated from storage) */
let qcBtnEnabled: boolean = true;       // default: show button
let qcTemplateOnly: boolean = false;    // default: include clipboard

// const ICON     = { idle: '📤', work: '⏳', ok: '✅', err: '❌' } as const;
// type UiState   = keyof typeof ICON;
type UiState = 'idle' | 'work' | 'ok' | 'err'; // keep type but without icons
const RESET_MS = 2_000;

/* ------------------------------------------------------------------ */
/* Public bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function bootSendToQcButton(): void {
    try {
        // Load initial settings
        chrome.storage.sync.get({ [STORAGE_KEYS.enableBtn]: true, [STORAGE_KEYS.templateOnly]: false }, res => {
            qcBtnEnabled   = !!res[STORAGE_KEYS.enableBtn];
            qcTemplateOnly = !!res[STORAGE_KEYS.templateOnly];
            console.info('[KH][SendToQC] Settings loaded', { qcBtnEnabled, qcTemplateOnly });
            triggerEnsure();
        });

        // React to changes
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'sync') return;
            let touched = false;
            if (STORAGE_KEYS.enableBtn in changes) {
                qcBtnEnabled = !!changes[STORAGE_KEYS.enableBtn]!.newValue;
                console.info('[KH][SendToQC] qcButtonEnabled →', qcBtnEnabled);
                // If disabling, proactively remove existing controls
                if (!qcBtnEnabled) {
                    document.querySelectorAll<HTMLElement>(`[data-kh-wrap="${BTN_ID}"]`).forEach(el => el.remove());
                }
                touched = true;
            }
            if (STORAGE_KEYS.templateOnly in changes) {
                qcTemplateOnly = !!changes[STORAGE_KEYS.templateOnly]!.newValue;
                console.info('[KH][SendToQC] qcTemplateOnly →', qcTemplateOnly);
                touched = true;
            }
            if (touched) triggerEnsure();
        });
    } catch (err) {
        console.warn('[KH][SendToQC] Storage not available yet:', err);
    }
    let uiState: UiState = 'idle';
    const label = () =>
        // `${ICON[uiState]} ${
        `${
            uiState==='idle' ? 'Send to QC' :
                uiState==='work' ? 'Working…'  :
                    uiState==='ok'   ? 'Done'      : 'Failed' }`;

    registerEditorHeaderButton({
        id   : BTN_ID,
        type : 'split',
        rightId: MENU_ID,
        rightLabel: '▾',
        slot : HeaderSlot.THIRD,
        label,
        headerFilter: (headerEl: HTMLElement) => {
            if (!qcBtnEnabled) return false;
            const inSidePanel = !!headerEl.closest(KAYAKO_SELECTORS.sc_detail_content);
            if (inSidePanel) return false;
            const inReplyArea  = !!headerEl.closest(KAYAKO_SELECTORS.editorChrome);
            const inTextEditor = !!headerEl.closest(KAYAKO_SELECTORS.textEditorContainerRoot);
            return inReplyArea && inTextEditor;
        },
        async onClick(btn) {
            const setState = (s: UiState) => { uiState=s; btn.textContent=label(); };
            console.info('[KH][SendToQC] Default action selected:', DEFAULT_ACTION);
            await handleClick(btn, setState, DEFAULT_ACTION);
            if (uiState !== 'idle') {
                setTimeout(() => { setState('idle'); }, RESET_MS);
            }
        },
        buildMenu(menu: HTMLElement) {
            try {
                const clsItem = EXTENSION_SELECTORS.twoPartBtnDropdownItem.replace(/^\./,'');
                // Idempotent rebuild
                menu.textContent = '';
                for (const action of ACTION_OPTIONS) {
                    const li = document.createElement('div');
                    li.className = clsItem;
                    // Left-click only
                    li.addEventListener('click', (ev) => { if ((ev as MouseEvent).button !== 0) ev.preventDefault(); });
                    li.textContent = action;
                    // Use mousedown to ensure handler fires before any hover-hide timers
                    li.addEventListener('mousedown', async (ev) => {
                        try {
                            ev.preventDefault();
                            ev.stopPropagation();
                            if ((ev as MouseEvent).button !== 0) return;  // left-click only
                            const leftBtn = document.getElementById(BTN_ID.replace(/^#/,'')) as HTMLButtonElement | null;
                            if (!leftBtn) { console.warn('[KH][SendToQC] Left button not found for menu action'); return; }
                            const setState = (s: UiState) => { uiState=s; leftBtn.textContent=label(); };
                            console.info('[KH][SendToQC] Menu action selected (mousedown):', action);
                            await handleClick(leftBtn, setState, action);
                        } catch (e) {
                            console.error('[KH][SendToQC] Menu action failed', e);
                        } finally {
                            // Close the dropdown menu after selection
                            (menu as HTMLElement).style.display = 'none';
                            if (uiState !== 'idle') {
                                setTimeout(() => { const leftBtn = document.getElementById(BTN_ID.replace(/^#/,'')) as HTMLButtonElement | null; if (!leftBtn) return; const setState = (s: UiState) => { uiState=s; leftBtn.textContent=label(); }; setState('idle'); }, RESET_MS);
                            }
                        }
                    });
                    menu.appendChild(li);
                }
            } catch (e) {
                console.warn('[KH][SendToQC] Failed to build menu', e);
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
    action: string = DEFAULT_ACTION,
): Promise<void> {

    setState('work');

    try {
        console.debug('[KH][SendToQC] Clicked. Settings:', { qcTemplateOnly, action });
        const clipHtml = qcTemplateOnly ? null : await readClipboardHtml();
        const html = buildTemplate(clipHtml, action).replace(/(\r\n|\r|\n)/g, ' ');
        const editor = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
        if (!editor) throw new Error('Reply editor not found');
        editor.innerHTML = html;
        console.debug('[KH][SendToQC] Inserted template', { templateOnly: qcTemplateOnly });
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

    tmp.querySelectorAll('*').forEach(el => {
        // Remove data-* attributes
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('data-')) el.removeAttribute(attr.name);
        });
        // Strip color, background-color, and any font-family (including font shorthand)
        const style = (el as HTMLElement).getAttribute('style');
        if (style) {
            const rules = style
                .split(';')
                .map(s => s.trim())
                .filter(Boolean);
            const removed: string[] = [];
            const keptRules = rules.filter(rule => {
                const key = rule.split(':')[0]?.trim().toLowerCase();
                const shouldRemove = key === 'color'
                    || key === 'background-color'
                    || key === 'font-family'
                    || key === 'font';
                if (shouldRemove && key) removed.push(key);
                return !shouldRemove;
            });
            if (removed.some(k => k === 'font-family' || k === 'font')) {
                try {
                    console.debug('[KH][SendToQC] Stripped font-family from inline styles', {
                        tag: (el as HTMLElement).tagName.toLowerCase(),
                        removed,
                    });
                } catch {}
            }
            const cleaned = keptRules.join('; ');
            if (cleaned) (el as HTMLElement).setAttribute('style', cleaned);
            else (el as HTMLElement).removeAttribute('style');
        }
    });

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

function buildTemplate(clip: string | null, action: string = DEFAULT_ACTION): string {
    const body = (clip === null)
        ? ''
        : normalizeParagraphs(clip || '<i>(clipboard empty)</i>');
    return (
        `<strong>What is your proposed action?</strong><br><br>
• ${action}<br><br>
===============================================================<br>
<strong>What is the PR to the customer?</strong><br><br>
${body}<br><br>
===============================================================<br>
<strong>Additional Context?</strong><br><br><br>
===============================================================<br><br>
<strong>GPT</strong><br>
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

/* Internal: nudge ButtonManager's observer to re-run ensures */
function triggerEnsure(): void {
    try {
        document.body.setAttribute('data-kh-qcbtn-ensure', String(Date.now()));
    } catch {}
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
