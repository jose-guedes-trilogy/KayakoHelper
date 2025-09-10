/* =============================================================================
 * Kayako Helper – QCer features
 *  - Adds a per-post "QC" button next to the Copy post button
 *  - On click: extracts the Public Response (PR) from QC macro structure
 *              and inserts it into the main reply editor. Falls back to
 *              copying the whole post when PR section isn't found.
 * ============================================================================= */

import { EXTENSION_SELECTORS, KAYAKO_SELECTORS } from '@/generated/selectors.ts';
import { addNewlines } from '@/modules/kayako/newlineSpacer.ts';
import { applySize } from '@/modules/kayako/reply-box/replyResizer.ts';

/* ----------  SELECTORS  ---------------------------------------------------- */
const MESSAGE_SEL = KAYAKO_SELECTORS.messageOrNote;
const MESSAGE_INNER_CONTENT_SEL = KAYAKO_SELECTORS.timelineItemContentInner;
const MENU_WRAPPER_SEL = KAYAKO_SELECTORS.timelineItemActionButtonsWrapper;
const FEED_MENU_SEL = KAYAKO_SELECTORS.feedItemMenu;

const CL_QC_BTN = EXTENSION_SELECTORS.qcerButton.replace(/^\./, '');

/* ----------  PUBLIC BOOTSTRAP  -------------------------------------------- */
export function bootQcerFeatures(): void {
    try {
        addButtonsToExistingPosts();
        observeForLazyLoadedPosts();
        console.debug('[KH][QCer] Booted QCer features');
    } catch (err) {
        console.error('[KH][QCer] Failed to boot:', err);
    }
}

/* ----------  IMPLEMENTATION  --------------------------------------------- */
function addButtonsToExistingPosts(): void {
    document.querySelectorAll<HTMLElement>(MESSAGE_SEL).forEach(addQcButton);
}

function observeForLazyLoadedPosts(): void {
    new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;

                if (node.matches(MESSAGE_SEL)) {
                    addQcButton(node);
                } else {
                    node.querySelectorAll?.(MESSAGE_SEL)
                        .forEach(el => addQcButton(el as HTMLElement));
                }
            });
        }
    }).observe(document.body, { childList: true, subtree: true });
}

function addQcButton(post: HTMLElement): void {
    try {
        const FLAG = 'khQcerReady';
        if (post.dataset[FLAG]) return; // avoid duplicate insertion

        const menuWrapper = post.querySelector<HTMLElement>(MENU_WRAPPER_SEL);
        if (!menuWrapper) return;

        const feedMenu = menuWrapper.querySelector<HTMLElement>(FEED_MENU_SEL) ?? menuWrapper;
        const nativeClass = feedMenu.firstElementChild?.className ?? '';

        // Build QC button
        const qcBtn = document.createElement('div');
        qcBtn.className = `${nativeClass} ${CL_QC_BTN}`.trim();
        qcBtn.setAttribute('role', 'button');
        qcBtn.setAttribute('aria-label', 'Extract PR to reply');
        qcBtn.setAttribute('title', 'Extract PR to reply');
        qcBtn.innerHTML = '<strong>✔️</strong>';
        qcBtn.style.opacity = '0.65';
        qcBtn.addEventListener('click', async e => {
            e.stopPropagation();
            await onQcClick(post);
        });

        // Place in menu but hide; PR-local toolbar will proxy its click
        feedMenu.insertBefore(qcBtn, feedMenu.firstElementChild);
        qcBtn.style.display = 'none';

        // Mark this post as processed for QC button
        post.dataset[FLAG] = 'yes';
    } catch (err) {
        console.error('[KH][QCer] Failed to add QC button for a post:', err);
    }
}

/* ----------  CLICK HANDLER  ---------------------------------------------- */
async function onQcClick(post: HTMLElement): Promise<void> {
    try {
        const contentEl = post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);
        if (!contentEl) {
            console.warn('[KH][QCer] Post content element not found');
            return;
        }

        // Prefer HTML-based extraction for accurate boundaries and spacing
        const sourceHtml = contentEl.innerHTML;
        const extractedHtml = extractProposedResponseHtml(sourceHtml);

        // Fallback to text-based extraction if HTML approach fails
        const rawText = (contentEl.textContent ?? '').replace(/\u00A0/g, ' ').trim();
        const extractedText = extractedHtml ? null : extractProposedResponse(rawText);
        const toInsertHtml = extractedHtml ?? (extractedText ? textToHtml(sanitiseText(extractedText)) : textToHtml(sanitiseText(rawText)));

        // Switch to Public Reply BEFORE inserting (faster and avoids reflows)
        console.debug('[KH][QCer] Ensuring Public Reply mode before insertion…');
        await ensurePublicReplyMode();

        // Find the reply editor after switching (poll briefly)
        let editor = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
        if (!editor) {
            for (let i = 0; i < 5 && !editor; i++) {
                // eslint-disable-next-line no-await-in-loop
                await new Promise(r => setTimeout(r, 60));
                editor = document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorReplyArea);
            }
        }
        if (!editor) {
            console.error('[KH][QCer] Reply editor not found after switching');
            alert('Reply editor not found after switching to Public Reply');
            return;
        }

        // Insert cleaned HTML so newlineSpacer formats from a minimal baseline
        editor.innerHTML = toInsertHtml;

        // Defense-in-depth cleanup in the live editor before spacing normalization
        try { removeInteractiveArtifacts(editor); } catch (e) { console.debug('[KH][QCer] removeInteractiveArtifacts skipped:', e); }
        try { replaceNbspWithSpaces(editor); } catch (e) { console.debug('[KH][QCer] replaceNbspWithSpaces skipped:', e); }
        // Pre-clean: remove any legacy wrappers/empties so newlineSpacer formats cleanly
        try { preCleanEditorContent(editor); } catch (e) { console.debug('[KH][QCer] preClean skipped:', e); }
        // Remove empty list items that can confuse Froala's list handling on backspace
        try { pruneEmptyListItems(editor); } catch (e) { console.debug('[KH][QCer] pruneEmptyListItems skipped:', e); }
        // Remove whitespace-only text nodes inside UL/OL and trim LI boundaries
        try { sanitizeLists(editor); } catch (e) { console.debug('[KH][QCer] sanitizeLists skipped:', e); }
        try { removeWhitespaceTextNodes(editor); } catch (e) { console.debug('[KH][QCer] removeWhitespaceTextNodes skipped:', e); }
        try { editor.normalize(); } catch {}

        try { addNewlines(editor); } catch (e) { console.debug('[KH][QCer] addNewlines skipped/failed:', e); }

        // Post-clean: collapse consecutive spacer blocks possibly introduced by formatting
        try { collapseDuplicateSpacers(editor); } catch (e) { console.debug('[KH][QCer] postClean skipped:', e); }

        // Already switched before insertion; log current mode for diagnostics
        try {
            const inReply = !!document.querySelector(KAYAKO_SELECTORS.replyModeSelectorOn);
            console.debug('[KH][QCer] Mode after insertion (should be reply):', inReply);
        } catch {}
        try { applySize(500); } catch (e) { /* non-fatal */ }

        // Attach stability guards to mitigate Froala inserting leading NBSP on backspace
        try { attachEditorStabilityGuards(editor); } catch (e) { console.debug('[KH][QCer] attachEditorStabilityGuards failed:', e); }

        const insertedLen = (extractedHtml ?? extractedText ?? rawText).length;
        console.debug('[KH][QCer] Inserted content into reply (chars):', insertedLen, {
            usedHtml: !!extractedHtml,
            hadTextExtraction: !!extractedText,
            editorSample: editor.innerText.slice(0, 120)
        });

        // Add required tags as requested
        try {
            console.debug('[KH][QCer] Adding tags to ticket…');
            await addTag('kyk_send_customer');
            await addTag('soldelproc_start');
            console.debug('[KH][QCer] Tags added successfully.');
        } catch (e) {
            console.warn('[KH][QCer] Failed to add one or more tags:', e);
        }

        // Refocus reply editor and place caret at end
        try {
            editor.focus();
            placeCaretAtEnd(editor);
            console.debug('[KH][QCer] Focus returned to reply editor.');
        } catch (e) {
            console.debug('[KH][QCer] Could not refocus reply editor:', e);
        }
    } catch (err) {
        console.error('[KH][QCer] Failed to process QC extraction:', err);
        alert('QC extraction failed: ' + (err as Error).message);
    }
}

/* ----------  PARSER  ----------------------------------------------------- */
function normaliseWhitespace(input: string): string {
    return input
        .replace(/\r\n?|\u2028|\u2029/g, '\n')
        .split('\n')
        .map(l => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        .trim();
}

function extractProposedResponse(text: string): string | null {
    const norm = normaliseWhitespace(text);
    const lines = norm.split('\n');

    // Locate the PR header line (robust, case-insensitive)
    const isPrHeader = (l: string) => /what\s+is\s+the\s+pr\s+to\s+the\s+customer\s*\??/i.test(l);
    let idx = lines.findIndex(isPrHeader);
    if (idx === -1) {
        // Sometimes the label may be surrounded by separators or extra spaces – try substring
        idx = lines.findIndex(l => /pr\s+to\s+the\s+customer/i.test(l));
    }
    if (idx === -1) return null;

    // Collect lines after the header
    const collected: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line) { collected.push(''); continue; }

        // Stop conditions
        const isSeparator = /^(=\s*){5,}$|^=+\s*$/.test(line);
        const isAdditional = /^additional\s+context\s*[\?:]?/i.test(line);
        const isComposite = /^=+\s*additional\s+context/i.test(line);
        const isGpt = /^gpt\b|^did\s+you\s+use\s+gpt\s*\:?/i.test(line);
        if (isSeparator || isAdditional || isComposite || isGpt) break;

        collected.push(line);
    }

    // Trim leading/trailing empty lines from collected
    while (collected.length > 0 && (collected[0] || '').trim() === '') collected.shift();
    while (collected.length > 0 && (collected[collected.length - 1] || '').trim() === '') collected.pop();

    const result = collected.join('\n').trim();
    return result.length ? result : null;
}

/* ----------  HTML EXTRACTOR  --------------------------------------------- */
function textNorm(s: string | null | undefined): string {
    return (s ?? '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function extractProposedResponseHtml(html: string): string | null {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        // Remove Froala spacer wrappers which pollute text and spacing
        tmp.querySelectorAll('[class*="br-wrapper"]').forEach(n => n.remove());

        const all = Array.from(tmp.querySelectorAll<HTMLElement>('*'));
        const headerEl = all.find(el => /what\s+is\s+the\s+pr\s+to\s+the\s+customer\s*\??/i
            .test(textNorm(el.textContent))
        );
        if (!headerEl || !headerEl.parentElement) return null;

        const parent = headerEl.parentElement;
        const siblings = Array.from(parent.children);
        const startIdx = siblings.indexOf(headerEl);
        if (startIdx === -1) return null;

        const resultRoot = document.createElement('div');
        for (let i = startIdx + 1; i < siblings.length; i++) {
            const el = siblings[i] as HTMLElement;
            const t = textNorm(el.textContent);
            const isSeparator = /^=+\s*$/.test(t);
            const isAdditional = /^additional\s+context\s*[\?:]?$/i.test(t);
            const isComposite = /^=+\s*additional\s+context/i.test(t);
            const isGpt = /^gpt$/i.test(t) || /^did\s+you\s+use\s+gpt\s*[\?:]?/i.test(t);
            if (isSeparator || isAdditional || isComposite || isGpt) break;

            resultRoot.appendChild(el.cloneNode(true));
        }

        if (!resultRoot.childElementCount) return null;

        // Clean spacing: remove Froala wrappers, <br>, and empty blocks
        resultRoot.querySelectorAll('[class*="br-wrapper"]').forEach(n => n.remove());
        resultRoot.querySelectorAll('br').forEach(n => n.remove());

        // Remove empty elements (common offenders: DIV, P, Hx) after <br> removal
        Array.from(resultRoot.querySelectorAll('*')).forEach(el => {
            const he = el as HTMLElement;
            if (he.children.length === 0 && textNorm(he.textContent) === '') {
                he.remove();
            }
        });

        // Trim leading/trailing empties again just in case
        while (resultRoot.firstElementChild && textNorm(resultRoot.firstElementChild.textContent) === '') {
            resultRoot.removeChild(resultRoot.firstElementChild);
        }
        while (resultRoot.lastElementChild && textNorm(resultRoot.lastElementChild.textContent) === '') {
            resultRoot.removeChild(resultRoot.lastElementChild);
        }

        // Replace NBSPs with normal spaces to avoid Froala list quirks on backspace
        try { replaceNbspWithSpaces(resultRoot); } catch (e) { console.debug('[KH][QCer] replaceNbspWithSpaces failed:', e); }

        // Remove interactive artifacts (PR-local toolbars, role buttons, ephor icon, etc.)
        try { removeInteractiveArtifacts(resultRoot); } catch (e) { console.debug('[KH][QCer] removeInteractiveArtifacts failed:', e); }

        // Strip non-text styling (extension classes, inline styles, wrappers)
        try { stripNonTextStyling(resultRoot); } catch (e) { console.debug('[KH][QCer] stripNonTextStyling failed:', e); }

        // Clean whitespace-only text nodes in lists to avoid empty <li> creation on edits
        try { sanitizeLists(resultRoot); } catch (e) { console.debug('[KH][QCer] sanitizeLists(html) failed:', e); }
        try { removeWhitespaceTextNodes(resultRoot); } catch (e) { console.debug('[KH][QCer] removeWhitespaceTextNodes(html) failed:', e); }
        try { resultRoot.normalize(); } catch {}

        const cleaned = resultRoot.innerHTML.trim();
        return cleaned.length ? cleaned : null;
    } catch (e) {
        console.debug('[KH][QCer] HTML extraction failed, will fallback to text:', e);
        return null;
    }
}

/* ----------  UTIL  ------------------------------------------------------- */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function textToHtml(s: string): string {
    return escapeHtml(s).replace(/\n/g, '<br>');
}

function sanitiseText(s: string): string {
    // Collapse 3+ blank lines to a single blank line
    return s
        .replace(/\r\n?|\u2028|\u2029/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/* ----------  SPACING CLEANUP HELPERS  ------------------------------------ */
function preCleanEditorContent(root: HTMLElement): void {
    // Remove Froala wrappers and <br> tags inherited from the source to avoid compounding
    root.querySelectorAll('[class*="br-wrapper"]').forEach(n => n.remove());
    root.querySelectorAll('br').forEach(n => n.remove());
    // Remove whitespace-only divs
    Array.from(root.querySelectorAll('div')).forEach(el => {
        const he = el as HTMLElement;
        if (he.children.length === 0 && textNorm(he.textContent) === '') he.remove();
    });
}

function isSpacerDiv(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.tagName !== 'DIV') return false;
    const first = el.firstElementChild as HTMLElement | null;
    if (first && first.classList.contains('br-wrapper--multiple')) return true;
    const html = el.innerHTML.trim();
    return html === '<br>' || html === '&nbsp;' || html === '\u00A0';
}

function collapseDuplicateSpacers(root: HTMLElement): void {
    // Remove whitespace-only top-level DIVs
    Array.from(root.children).forEach(ch => {
        if (
            ch instanceof HTMLElement &&
            ch.tagName === 'DIV' &&
            ch.children.length === 0 &&
            textNorm(ch.textContent) === ''
        ) ch.remove();
    });

    // Collapse runs of spacer DIVs (possibly separated by empty DIVs) into a single one
    let node = root.firstElementChild as HTMLElement | null;
    let lastWasSpacer = false;
    while (node) {
        const next = node.nextElementSibling as HTMLElement | null;
        if (isSpacerDiv(node)) {
            // Remove any following empty DIVs immediately after spacer
            let ptr = next;
            while (ptr && ptr.tagName === 'DIV' && ptr.children.length === 0 && textNorm(ptr.textContent) === '') {
                const toRemove = ptr; ptr = ptr.nextElementSibling as HTMLElement | null; toRemove.remove();
            }
            // Remove subsequent spacers to keep only one
            while (ptr && isSpacerDiv(ptr)) {
                const toRemove = ptr; ptr = ptr.nextElementSibling as HTMLElement | null; toRemove.remove();
                // Also swallow empties between spacers
                while (ptr && ptr.tagName === 'DIV' && ptr.children.length === 0 && textNorm(ptr.textContent) === '') {
                    const rm = ptr; ptr = ptr.nextElementSibling as HTMLElement | null; rm.remove();
                }
            }
            lastWasSpacer = true;
        } else {
            lastWasSpacer = false;
        }
        node = next;
    }
}

async function ensurePublicReplyMode(contextEl?: HTMLElement): Promise<void> {
    // Strategy:
    // 1) Scope to the header for the editor we just wrote to
    // 2) If Public Reply is already active → return
    // 3) If Notes mode is active → click the official note-mode toggle (root) to exit note mode
    // 4) Fallback: click the reply channel trigger if present
    // 5) Poll and log each attempt

    const editorHeader = contextEl?.closest(KAYAKO_SELECTORS.textEditorHeader)
        ?? document.querySelector<HTMLElement>(KAYAKO_SELECTORS.textEditorHeader)
        ?? undefined;
    console.debug('[KH][QCer] ensurePublicReplyMode: header found?', !!editorHeader);

    const sel = {
        noteActive: KAYAKO_SELECTORS.noteModeSelectorOn,
        noteRoot: KAYAKO_SELECTORS.activateNoteModeButton,
        replyActive: KAYAKO_SELECTORS.replyModeSelectorOn,
        replyTrigger: KAYAKO_SELECTORS.replyModeSelectorOff,
    };

    const isReplyActive = () => !!document.querySelector(sel.replyActive);
    if (isReplyActive()) {
        console.debug('[KH][QCer] Already in Public Reply mode.');
        return;
    }

    const noteActiveInHeader = editorHeader?.querySelector<HTMLElement>(sel.noteActive)
        ?? document.querySelector<HTMLElement>(sel.noteActive)
        ?? null;
    const noteRootBtn = editorHeader?.querySelector<HTMLElement>(sel.noteRoot)
        ?? document.querySelector<HTMLElement>(sel.noteRoot)
        ?? null;
    const replyTrigger = editorHeader?.querySelector<HTMLElement>(sel.replyTrigger)
        ?? document.querySelector<HTMLElement>(sel.replyTrigger)
        ?? null;

    console.debug('[KH][QCer] header-scoped elements:', {
        noteActiveFound: !!noteActiveInHeader,
        noteRootFound: !!noteRootBtn,
        replyTriggerFound: !!replyTrigger,
    });

    if (noteActiveInHeader && noteRootBtn) {
        console.debug('[KH][QCer] Clicking note root to exit Notes…');
        simulateClick(noteRootBtn);
    } else if (noteActiveInHeader) {
        console.debug('[KH][QCer] Note root not found, clicking active note element as fallback…');
        simulateClick(noteActiveInHeader);
    } else if (replyTrigger) {
        console.debug('[KH][QCer] No note active; attempting to click reply trigger…');
        simulateClick(replyTrigger);
    } else {
        console.warn('[KH][QCer] Neither note nor reply controls found; cannot switch.');
        return;
    }

    // Poll up to ~600ms
    let success = false;
    for (let i = 0; i < 10; i++) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 60));
        const nowReply = isReplyActive();
        const stillNote = !!document.querySelector(sel.noteActive);
        console.debug(`[KH][QCer] switch attempt ${i + 1}:`, { nowReply, stillNote });
        if (nowReply && !stillNote) { success = true; break; }

        // One mid-way fallback: try clicking reply trigger if available
        if (i === 3 && replyTrigger) {
            console.debug('[KH][QCer] Fallback: clicking reply trigger…');
            simulateClick(replyTrigger);
        }
    }

    if (!success) {
        console.warn('[KH][QCer] Could not confirm Public Reply mode after attempts.');
    }
}

function simulateClick(el: HTMLElement): void {
    ['mousedown','mouseup','click'].forEach(type =>
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
    );
}



/* ----------  TAG HELPERS (shared pattern with SendToQC)  ------------------ */
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
    const input = document.querySelector<HTMLInputElement>('input[placeholder="Add a tag..."]');
    if (!input) throw new Error('Tag input not found');

    input.focus();
    input.value = tag;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(r));
    simulateEnter(input);
    await new Promise(r => setTimeout(r));
}

/* ----------  EDITOR CARET / SANITIZATION HELPERS  ------------------------- */
function placeCaretAtEnd(el: HTMLElement): void {
    try {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        if (sel) {
            sel.removeAllRanges();
            sel.addRange(range);
        }
    } catch {}
}

function stripNonTextStyling(root: HTMLElement): void {
    // Remove extension wrappers by unwrapping
    Array.from(root.querySelectorAll<HTMLElement>('[data-kh-qc-wrap]')).forEach(w => {
        const parent = w.parentElement; if (!parent) return;
        while (w.firstChild) parent.insertBefore(w.firstChild, w);
        w.remove();
    });

    // Proactively drop interactive artifacts that do not belong in editor content
    removeInteractiveArtifacts(root);

    // Remove inline styles and extension/Kayako classes; drop data-kh* attrs
    const all = Array.from(root.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
        try { el.removeAttribute('style'); } catch {}
        try {
            const keep = Array.from(el.classList).filter(c => !(c.startsWith('kh-') || c.startsWith('ko-')));
            if (keep.length !== el.classList.length) {
                if (keep.length) el.className = keep.join(' '); else el.removeAttribute('class');
            }
        } catch {}
        try {
            Array.from(el.attributes).forEach(attr => {
                const n = attr.name.toLowerCase();
                if (n.startsWith('data-kh')) el.removeAttribute(attr.name);
            });
        } catch {}
    }
}

/* ----------  EXTRA SANITIZERS (defense-in-depth)  ------------------------ */
function removeInteractiveArtifacts(root: HTMLElement): void {
    try {
        let removed = 0;
        // Remove any PR-local toolbars and generic interactive buttons that may have leaked from the timeline
        root.querySelectorAll<HTMLElement>('[data-kh-pr-toolbar], [role="button"], .kh-send-ephor-review-btn').forEach(el => {
            el.remove();
            removed++;
        });
        // Remove bare SVG-only action containers that became empty
        Array.from(root.querySelectorAll<HTMLElement>('div, span'))
            .filter(el => el.children.length > 0 && Array.from(el.children).every(c => c.tagName === 'SVG'))
            .forEach(el => { el.remove(); removed++; });
        // Remove ephor icon images if any remain
        root.querySelectorAll('img[alt="Ephor"]').forEach(n => { (n as HTMLElement).remove(); removed++; });
        if (removed) { try { console.debug('[KH][QCer] Removed interactive artifacts from content:', removed); } catch {} }
    } catch {}
}

function replaceNbspWithSpaces(root: HTMLElement): void {
    try {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const toUpdate: Text[] = [];
        while (walker.nextNode()) {
            const t = walker.currentNode as Text;
            if (t.nodeValue && /\u00A0/.test(t.nodeValue)) toUpdate.push(t);
        }
        toUpdate.forEach(t => { t.nodeValue = (t.nodeValue || '').replace(/\u00A0/g, ' '); });
        if (toUpdate.length) { try { console.debug('[KH][QCer] Replaced NBSPs in text nodes:', toUpdate.length); } catch {} }
    } catch {}
}

function pruneEmptyListItems(root: HTMLElement): void {
    const isEmptyLi = (li: HTMLElement): boolean => {
        const clone = li.cloneNode(true) as HTMLElement;
        // Drop <br> and NBSP-only nodes for the emptiness check
        clone.querySelectorAll('br').forEach(n => n.remove());
        const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
        let text = '';
        while (walker.nextNode()) {
            text += (walker.currentNode as Text).nodeValue || '';
        }
        return text.replace(/\u00A0/g, ' ').trim() === '' && clone.children.length === 0;
    };
    let removed = 0;
    Array.from(root.querySelectorAll<HTMLElement>('li')).forEach(li => {
        try {
            if (isEmptyLi(li)) { li.remove(); removed++; }
        } catch {}
    });
    if (removed) { try { console.debug('[KH][QCer] Removed empty <li> nodes:', removed); } catch {} }
}

function sanitizeLists(root: HTMLElement): void {
    let adjusted = 0;
    const lists = Array.from(root.querySelectorAll<HTMLElement>('ul, ol'));
    for (const list of lists) {
        // Remove whitespace-only text nodes directly under the list
        let n: ChildNode | null = list.firstChild;
        while (n) {
            const next = n.nextSibling;
            if (n.nodeType === Node.TEXT_NODE && !(n.nodeValue || '').replace(/\u00A0/g, ' ').trim()) {
                list.removeChild(n);
                adjusted++;
            }
            n = next;
        }
        // For each LI: trim leading/trailing whitespace-only text nodes
        const items = Array.from(list.children).filter(el => el.tagName === 'LI') as HTMLElement[];
        for (const li of items) {
            // Remove whitespace-only text nodes at boundaries
            while (li.firstChild && li.firstChild.nodeType === Node.TEXT_NODE && !((li.firstChild as Text).nodeValue || '').replace(/\u00A0/g, ' ').trim()) {
                li.removeChild(li.firstChild);
                adjusted++;
            }
            while (li.lastChild && li.lastChild.nodeType === Node.TEXT_NODE && !((li.lastChild as Text).nodeValue || '').replace(/\u00A0/g, ' ').trim()) {
                li.removeChild(li.lastChild);
                adjusted++;
            }
            // Remove <span> or <div> that are purely whitespace
            Array.from(li.querySelectorAll<HTMLElement>('span, div')).forEach(el => {
                if (el.children.length === 0 && ((el.textContent || '').replace(/\u00A0/g, ' ').trim() === '')) {
                    el.remove(); adjusted++;
                }
            });
        }
    }
    if (adjusted) { try { console.debug('[KH][QCer] sanitizeLists adjusted nodes:', adjusted); } catch {} }
}

function removeWhitespaceTextNodes(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const toRemove: Text[] = [];
    while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        const parent = t.parentElement as HTMLElement | null;
        if (!parent) continue;
        const onlyWs = !((t.nodeValue || '').replace(/\u00A0/g, ' ').trim());
        if (!onlyWs) continue;
        // Only remove whitespace-only text that sits in structural blocks or lists
        const tag = parent.tagName;
        if (tag === 'UL' || tag === 'OL' || tag === 'LI' || tag === 'DIV' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'H5' || tag === 'H6') {
            toRemove.push(t);
        }
    }
    toRemove.forEach(t => t.parentNode?.removeChild(t));
    if (toRemove.length) { try { console.debug('[KH][QCer] Removed whitespace-only text nodes:', toRemove.length); } catch {} }
}

/* ----------  LIVE GUARDS FOR FROALA EDGE CASES  -------------------------- */
function attachEditorStabilityGuards(editor: HTMLElement): void {
    const FLAG = 'khBackspaceGuard';
    if ((editor as any).dataset?.[FLAG] === 'yes') return;
    try { (editor as any).dataset[FLAG] = 'yes'; } catch {}

    const scheduleNormalize = (() => {
        let rafId = 0;
        return () => {
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
                rafId = 0;
                try {
                    normalizeEditorWhitespace(editor);
                } catch (e) {
                    console.debug('[KH][QCer] normalizeEditorWhitespace failed:', e);
                }
            });
        };
    })();

    editor.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            scheduleNormalize();
        }
    });
    editor.addEventListener('input', (e: Event) => {
        const ie = e as InputEvent;
        const t = ie.inputType || '';
        if (t.includes('delete')) scheduleNormalize();
    });

    console.debug('[KH][QCer] Backspace guard attached.');
}

function normalizeEditorWhitespace(root: HTMLElement): void {
    // Replace NBSPs first
    replaceNbspWithSpaces(root);
    // Trim block boundaries for common block-level elements
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('div,p,h1,h2,h3,h4,h5,h6,li'));
    let touched = 0;
    for (const blk of blocks) {
        const a = trimLeadingSpacesInBlock(blk);
        const b = trimTrailingSpacesInBlock(blk);
        if (a || b) touched++;
    }
    if (touched) {
        // Clean leftover whitespace-only text nodes and normalize DOM
        removeWhitespaceTextNodes(root);
        try { root.normalize(); } catch {}
        try { console.debug('[KH][QCer] Normalized editor whitespace on delete; blocks touched:', touched); } catch {}
    }
}

function findFirstTextNode(root: Node): Text | null {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const t = walker.currentNode as Text;
        if ((t.nodeValue || '').replace(/\u00A0/g, ' ').length > 0) return t;
    }
    return null;
}

function findLastTextNode(root: Node): Text | null {
    // Walk manually backwards to avoid reverse TreeWalker complexity
    const stack: Node[] = [root];
    let last: Text | null = null;
    while (stack.length) {
        const n = stack.pop()!;
        if (n.nodeType === Node.TEXT_NODE) {
            const t = n as Text;
            if ((t.nodeValue || '').replace(/\u00A0/g, ' ').length > 0) last = t;
            continue;
        }
        const el = n as Element;
        for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i]!);
    }
    return last;
}

function trimLeadingSpacesInBlock(block: HTMLElement): boolean {
    const first = findFirstTextNode(block);
    if (!first) return false;
    const before = first.nodeValue || '';
    const next = before.replace(/^[ \u00A0]+/, '');
    if (next !== before) {
        first.nodeValue = next;
        return true;
    }
    return false;
}

function trimTrailingSpacesInBlock(block: HTMLElement): boolean {
    const last = findLastTextNode(block);
    if (!last) return false;
    const before = last.nodeValue || '';
    const next = before.replace(/[ \u00A0]+$/, '');
    if (next !== before) {
        last.nodeValue = next;
        return true;
    }
    return false;
}

