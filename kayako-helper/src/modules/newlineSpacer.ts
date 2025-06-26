/* src/modules/newlineSpacer.ts */

/**
 * Kayako Extension – Newline Spacer v6
 * ------------------------------------
 *  • Injects an “Add newlines” button (class BTN_CLASS) as the 2nd child of every
 *    editor header given by SEL.textEditorHeader.
 *  • When clicked it now:
 *      1. Inserts a Froala-native spacer block
 *         <div><div class="br-wrapper br-wrapper--multiple"><br></div></div>
 *         ── *between* consecutive top-level DIV/OL/UL siblings **and**
 *            *before* any top-level H1/H2/H3 heading not already preceded by one.
 *      2. Ensures every solitary <br> inside any <div> is doubled to <br><br>,
 *         trimming runs > 2 so the action stays idempotent.
 *      3. Adds exactly two <br> tags to the *last* <li> of every nested list
 *         (a <ul>/<ol> whose parent is an <li>).
 *  • Re-clicking never produces duplicates (fully idempotent).
 */

import {
    KAYAKO_SELECTORS,
    EXTENSION_SELECTORS,
} from '@/generated/selectors';

const BTN_ID             = EXTENSION_SELECTORS.newLinesButton;
const BLOCK_SELECTOR     = 'DIV,OL,UL';
const HEADER_SELECTOR    = 'H1,H2,H3';
const SPACER_INNER_HTML  = '<div class="br-wrapper br-wrapper--multiple"><br></div>';

/* ------------------------------------------------------------------ */
/* Utilities                                                          */
/* ------------------------------------------------------------------ */

/* ── utility ───────────────────────────────────────────────────────── */
const isInsideTable = (el: Element | null): boolean => !!el?.closest('table');

/** Is this element already one of our “blank line” spacer DIVs? */
const isSpacerDiv = (el: Element): boolean => {
    if (el.tagName !== 'DIV') return false;

    const html = el.innerHTML.trim();
    if (html === '<br>' || html === '&nbsp;' || html === '\u00A0') return true;

    const first = el.firstElementChild as HTMLElement | null;
    return !!first && first.classList.contains('br-wrapper--multiple');
};

/** Create a Froala-native spacer block */
const createSpacer = (): HTMLDivElement => {
    const div = document.createElement('div');
    div.innerHTML = SPACER_INNER_HTML;
    return div;
};

/** Ensure the given <li> ends with exactly two <br> elements */
const ensureTrailingBreaks = (li: HTMLElement): void => {
    let trailingBrs = 0;
    for (let n = li.lastChild; n; n = n.previousSibling) {
        if (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) continue;
        if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
            trailingBrs++;
        } else {
            break;
        }
    }

    if (trailingBrs < 2) {
        for (let i = 0; i < 2 - trailingBrs; i++) li.appendChild(document.createElement('br'));
    } else if (trailingBrs > 2) {
        while (trailingBrs-- > 2) li.removeChild(li.lastChild!);
    }
};

/** Inside a normal <div>, guarantee runs of exactly two <br> tags */
/* ── updated ensureDoubleBreaksInDiv ───────────────────────────────── */
const ensureDoubleBreaksInDiv = (div: HTMLElement): void => {
    // Skip anything that lives inside a <table>
    if (isInsideTable(div)) return;

    // 0) Skip spacer blocks entirely
    if (isSpacerDiv(div)) return;

    // 1) Skip signature DIVs whose *any* line ends with the keywords
    //    “regards,”, “support team”, or “support” (case-insensitive)
    const signatureRx = /(regards,|support team|support)\s*$/i;
    const lines = div.innerText.split('\n').map(l => l.trim());
    if (lines.some(line => signatureRx.test(line))) return;

    // 2) Walk through children, forcing each run of <br> to be *exactly* two
    let node: ChildNode | null = div.firstChild;

    while (node) {
        if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).tagName === 'BR'
        ) {
            // count consecutive <br>s
            let runStart = node;
            let count = 0;
            let ptr: ChildNode | null = node;
            while (
                ptr &&
                ptr.nodeType === Node.ELEMENT_NODE &&
                (ptr as HTMLElement).tagName === 'BR'
                ) {
                count++;
                ptr = ptr.nextSibling;
            }

            // extend or trim to exactly 2
            if (count < 2) {
                const toAdd = 2 - count;
                for (let i = 0; i < toAdd; i++) {
                    div.insertBefore(document.createElement('br'), ptr);
                }
            } else if (count > 2) {
                let excess = count - 2;
                let removeTarget = runStart.nextSibling; // second <br>
                while (excess-- > 0 && removeTarget) {
                    const next = removeTarget.nextSibling;
                    div.removeChild(removeTarget);
                    removeTarget = next;
                }
            }

            node = ptr; // continue scanning *after* this run
        } else {
            node = node.nextSibling;
        }
    }
};

/* ------------------------------------------------------------------ */
/* Public bootstrap                                                   */
/* ------------------------------------------------------------------ */

export function bootNewlineSpacer(): void {
    attachAllButtons();

    // Kayako is an SPA—editors appear/destroy dynamically.
    new MutationObserver(attachAllButtons).observe(document.body, {
        childList: true,
        subtree: true,
    });
}

export default bootNewlineSpacer;

/* ------------------------------------------------------------------ */
/* DOM helpers                                                        */
/* ------------------------------------------------------------------ */

function attachAllButtons(): void {
    document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.textEditorHeader).forEach(header => {
        if (header.querySelector(BTN_ID)) return;

        const btnDiv = document.createElement('div');
        const btn = buildButton();

        btnDiv.appendChild(btn);
        btnDiv.style.cssText = 'display:flex;align-items:center;';

        header.children.length
            ? header.insertBefore(btnDiv, header.children[1]) // 2nd child
            : header.appendChild(btnDiv);

    });
}

function buildButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Add newlines';
    btn.id = BTN_ID.replace(/^#/, '');
    btn.className = EXTENSION_SELECTORS.defaultButtonClass.replace(/^./, '');

    btn.addEventListener('click', e => {
        const header = (e.currentTarget as HTMLElement).closest(KAYAKO_SELECTORS.textEditorHeader);
        const editor = header?.parentElement?.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
        if (!editor) {
            console.warn('[newlineSpacer] editor area not found');
            return;
        }
        addNewlines(editor);
    });

    return btn;
}

/* ------------------------------------------------------------------ */
/* Formatting logic                                                   */
/* ------------------------------------------------------------------ */

export function addNewlines(root: HTMLElement): void {
    console.group('[newlineSpacer] formatting', root);

    /* 1.  Top-level block & heading separation -------------------------- */
    const topChildren = Array.from(root.children) as HTMLElement[];
    let prevBlock: HTMLElement | null = null;

    topChildren.forEach(child => {
        if (isSpacerDiv(child)) {
            prevBlock = null;
            return;
        }

        // Ensure spacer immediately *before* H1/H2/H3
        if (child.matches(HEADER_SELECTOR)) {
            if (!child.previousElementSibling || !isSpacerDiv(child.previousElementSibling)) {
                root.insertBefore(createSpacer(), child);
            }
            prevBlock = null;
            return;
        }

        // Original DIV/OL/UL spacing
        if (prevBlock && child.matches(BLOCK_SELECTOR)) {
            root.insertBefore(createSpacer(), child);
            console.log('[newlineSpacer] spacer inserted before', child);
        }
        prevBlock = child.matches(BLOCK_SELECTOR) ? child : null;
    });

    /* 2.  Duplicate single <br> inside every normal <div> --------------- */
    root.querySelectorAll<HTMLElement>('div').forEach(ensureDoubleBreaksInDiv);

    /* 3.  Nested-list final-item breaks --------------------------------- */
    root.querySelectorAll<HTMLElement>('li > ul, li > ol').forEach(list => {
        const lastLi = list.querySelector<HTMLElement>('li:last-child');
        if (lastLi) ensureTrailingBreaks(lastLi);
    });

    console.groupEnd();

    // 🔔 Make Froala treat the change as real user input
    signalFroalaChanged(root);
}


/* --------------------------------------------------------- */
/* Tell Froala that the document really changed              */
/* --------------------------------------------------------- */
function signalFroalaChanged(root: HTMLElement): void {
    /* 1 · Native event ─────────────────────────────────────── */
    root.dispatchEvent(new Event('input', { bubbles: true }));

    /* 2 · Direct Froala API (if jQuery is around) ──────────── */
    // Kayako bundles jQuery + Froala, so this is usually defined.
    // Casts keep TS happy without an extra @types dependency.
    const $ = (window as any).jQuery as JQueryStatic | undefined;
    if ($) {
        const inst = $(root).closest('.fr-box').data('froala.editor');
        if (inst) {
            inst.events.trigger('contentChanged'); // mark dirty
            inst.undo.saveStep();                  // add undo checkpoint
        }
    }
}
