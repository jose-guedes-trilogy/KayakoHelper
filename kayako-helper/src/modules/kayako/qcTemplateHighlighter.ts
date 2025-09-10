/* =============================================================================
 * Kayako Helper – QC Template Highlighter
 * - Highlights sections within Send to QC template inside timeline items
 * - Sections: Proposed Action, PR to the customer, Additional Context
 * - Resilient to spacing, NBSP, case, optional punctuation, and separator length
 * ============================================================================= */

import { KAYAKO_SELECTORS, EXTENSION_SELECTORS } from '@/generated/selectors.ts';

/* ----------  STATE  -------------------------------------------------------- */
let observer: MutationObserver | null = null;
let highlightEnabled = true;
const TOGGLE_STORAGE_KEY = 'khQcTplEnabled';
const originalHtmlByContainer = new WeakMap<HTMLElement, string>();

/* ----------  HELPERS  ------------------------------------------------------ */
const cls = (sel: string) => sel.replace(/^\./, '');

function textNorm(s: string | null | undefined): string {
    return (s ?? '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isSeparator(t: string): boolean {
    // Any line that is made primarily of '=' with optional spaces
    return /^(=\s*){5,}$|^=+\s*$/.test(t);
}

const HEADER = {
    action: /^what\s+is\s+your\s+proposed\s+action\s*\??$/i,
    pr: /^what\s+is\s+the\s+pr\s+to\s+the\s+customer\s*\??$/i,
    additional: /^additional\s+context\s*\??$/i,
    gpt: /^gpt$/i,
    didUseGpt: /^did\s+you\s+use\s+gpt\s*:?/i,
};

type SectionKind = 'action' | 'pr' | 'additional';

function findHeaderElement(container: HTMLElement, kind: SectionKind): HTMLElement | null {
    const re = HEADER[kind];
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    // Prefer strong/headers that exactly match the header regex to avoid partial matches inside body
    const prioritized = all.filter(el => /^(STRONG|H1|H2|H3|H4|H5|H6)$/i.test(el.tagName));
    const candidates = prioritized.length ? prioritized : all;
    return (
        candidates.find(el => re.test(textNorm(el.textContent))) ?? null
    );
}

function findHeaderBlock(el: HTMLElement, root: HTMLElement): HTMLElement {
    // Prefer the closest block-level wrapper (p/div/li) to paint header background
    const block = el.closest('h1,h2,h3,h4,h5,h6,p,div,li,section,header,article');
    if (block && root.contains(block) && block !== root) return block as HTMLElement;
    // Avoid applying header styles to the root container; fallback to the title element
    return el;
}

function collectSectionNodes(headerEl: HTMLElement, headerBlock: HTMLElement): ChildNode[] {
    // Collect nodes that belong to the section body:
    // 1) Nodes within the header's block AFTER the header element
    // 2) Then nodes in subsequent sibling blocks, up to (but not including) a separator or the next header

    const out: ChildNode[] = [];

    const pushIfContent = (node: ChildNode): boolean => {
        // returns true if we should continue, false if we hit a stop condition
        const t = textNorm((node as HTMLElement | Text).textContent || '');
        const isAnotherHeader = HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || HEADER.gpt.test(t) || HEADER.didUseGpt.test(t);
        if (t && (isSeparator(t) || isAnotherHeader)) return false;
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            // Skip content already inside any wrapper to avoid double-wrapping
            if (el.closest('div[data-kh-qc-wrap]')) return true;
        }
        out.push(node);
        return true;
    };

    // 1) Within the header block, collect child nodes after the header element
    try {
        const children = Array.from(headerBlock.childNodes);
        const startIdx = children.indexOf(headerEl);
        if (startIdx !== -1) {
            for (let i = startIdx + 1; i < children.length; i++) {
                const child = children[i]!;
                const t = textNorm((child as HTMLElement | Text).textContent || '');
                const isAnotherHeader = HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || HEADER.gpt.test(t) || HEADER.didUseGpt.test(t);
                if (t && (isSeparator(t) || isAnotherHeader)) break;
                if (child.nodeType === Node.ELEMENT_NODE) {
                    const el = child as HTMLElement;
                    if (el.closest('div[data-kh-qc-wrap]')) continue;
                }
                out.push(child);
            }
        }
    } catch {}

    // 2) Walk subsequent sibling blocks and include their children until stop
    const parent = headerBlock.parentElement;
    if (!parent) return out;
    const siblings = Array.from(parent.childNodes);
    const startIdx = siblings.indexOf(headerBlock);
    if (startIdx === -1) return out;

    let stop = false;
    for (let i = startIdx + 1; i < siblings.length && !stop; i++) {
        const sib = siblings[i]!;
        if (sib.nodeType === Node.TEXT_NODE) {
            // Plain text between blocks
            const shouldContinue = pushIfContent(sib);
            if (!shouldContinue) break;
            continue;
        }
        if (sib.nodeType === Node.ELEMENT_NODE) {
            const el = sib as HTMLElement;
            if (el.closest('div[data-kh-qc-wrap]')) continue;
            // If we hit a table or table-related element, stop collecting PR content
            const tag = el.tagName.toUpperCase();
            if (tag === 'TABLE' || tag === 'TBODY' || tag === 'THEAD' || tag === 'TFOOT' || tag === 'TR' || tag === 'TD' || tag === 'TH') {
                stop = true; break;
            }
            // Iterate children to preserve internal structure but stop before the next header/separator
            const kids = Array.from(el.childNodes);
            for (const k of kids) {
                const t = textNorm((k as HTMLElement | Text).textContent || '');
                const isAnotherHeader = HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || HEADER.gpt.test(t) || HEADER.didUseGpt.test(t);
                if (t && (isSeparator(t) || isAnotherHeader)) { stop = true; break; }
                if (k.nodeType === Node.ELEMENT_NODE) {
                    const kel = k as HTMLElement;
                    const kt = kel.tagName.toUpperCase();
                    if (kt === 'TABLE' || kt === 'TBODY' || kt === 'THEAD' || kt === 'TFOOT' || kt === 'TR' || kt === 'TD' || kt === 'TH') { stop = true; break; }
                    if (kel.closest('div[data-kh-qc-wrap]')) continue;
                }
                out.push(k);
            }
        }
    }

    return out;
}

function applyHighlight(container: HTMLElement, headerBlock: HTMLElement, bodyNodes: ChildNode[], kind: SectionKind): void {
    const headerClass =
        kind === 'action' ? EXTENSION_SELECTORS.qcHighlightHeaderAction
        : kind === 'pr' ? EXTENSION_SELECTORS.qcHighlightHeaderPR
        : EXTENSION_SELECTORS.qcHighlightHeaderAdditional;

    const bodyClass =
        kind === 'action' ? EXTENSION_SELECTORS.qcHighlightBodyAction
        : kind === 'pr' ? EXTENSION_SELECTORS.qcHighlightBodyPR
        : EXTENSION_SELECTORS.qcHighlightBodyAdditional;

    // Mark only the header block (keep container clean to avoid inherited styles)
    try { headerBlock.classList.add(cls(headerClass)); } catch {}

    // Wrap all body nodes into a single rectangular wrapper if not already wrapped
    if (!bodyNodes.length) return;

    const first = bodyNodes[0]!;
    // Determine the correct parent for insertion. If the first node is an element,
    // we must use its parentElement (not the element itself) to avoid DOMException
    // when calling insertBefore.
    const parent = (first.nodeType === Node.ELEMENT_NODE)
        ? ((first as HTMLElement).parentElement as HTMLElement | null)
        : (first.parentNode as HTMLElement | null);
    if (!parent) return;

    // If nodes are already inside an existing wrapper for this kind, do nothing
    try {
        const closestBase = (first.nodeType === Node.ELEMENT_NODE)
            ? (first as HTMLElement)
            : ((first.parentElement as HTMLElement | null));
        const nearestWrapper = closestBase?.closest?.(`div[data-kh-qc-wrap="${kind}"]`) as HTMLElement | null;
        if (nearestWrapper) {
            try { console.debug('[KH][QC-TPL-HL] First node already inside wrapper for', kind); } catch {}
            return;
        }
    } catch {}

    // If a wrapper for this kind already exists anywhere in the container, merge nodes into it
    const containerExisting = container.querySelector<HTMLElement>(`div[data-kh-qc-wrap="${kind}"]`);
    if (containerExisting) {
        try {
            for (const node of bodyNodes) {
                if (!node) continue;
                const alreadyInside = (node.parentElement?.closest?.(`div[data-kh-qc-wrap="${kind}"]`) ?? null) === containerExisting;
                if (!alreadyInside) containerExisting.appendChild(node);
            }
            dedupeSpacerWrappers(containerExisting);
            removeSeparatorElements(container);
            console.debug('[KH][QC-TPL-HL] Merged nodes into existing wrapper for', kind);
        } catch (e) {
            console.debug('[KH][QC-TPL-HL] merge into existing wrapper failed:', e);
        }
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-kh-qc-wrap', kind);
    wrapper.classList.add(cls(bodyClass));

    // Insert wrapper before the first body node and move all collected nodes into it
    try {
        parent.insertBefore(wrapper, first);
        for (const node of bodyNodes) {
            if (!node) continue;
            // Avoid hierarchy errors by ensuring we never try to append an ancestor of the wrapper
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.contains(wrapper)) continue;
            }
            wrapper.appendChild(node);
        }
    } catch (err) {
        try { console.debug('[KH][QC-TPL-HL] Failed wrapping body nodes:', err); } catch {}
        return;
    }

    // Post-wrap cleanup: remove consecutive spacer wrappers and stray separators
    try {
        dedupeSpacerWrappers(wrapper);
        removeSeparatorElements(container);
        // Within this wrapper, ensure there is at most one multi spacer in a row
        dedupeSpacerWrappers(wrapper);
    } catch (e) {
        console.debug('[KH][QC-TPL-HL] cleanup failed:', e);
    }

    // If this is the PR body, ensure PR-local controls are present
    if (kind === 'pr') {
        try {
            const postEl = container.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null
                ?? container.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null;
            if (postEl) ensurePrControls(wrapper, postEl);
        } catch (e) {
            console.debug('[KH][QC-TPL-HL] ensurePrControls failed:', e);
        }
    }
}

function processContainer(container: HTMLElement): void {
    try {
        if (!highlightEnabled) { return; }
        if (!originalHtmlByContainer.has(container)) {
            try { originalHtmlByContainer.set(container, container.innerHTML); } catch {}
        }
        let any = false;
        // Only wrap when at least one divider is present (segments detected)
        try { if (processByDividers(container)) any = true; } catch {}

        if (any) {
            container.dataset['khQcTplHasSections'] = 'yes';
            // Inject per-post buttons once
            const postEl = container.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null
                ?? container.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null;
            if (postEl) ensureButtons(postEl);
            // Remove divider lines now that sections are wrapped; snapshot ensures they can be restored on toggle off
            try { removeSeparatorElements(container); } catch {}
        }
        try { console.debug('[KH][QC-TPL-HL] processed container', { any }); } catch {}
    } catch (e) {
        console.error('[KH][QC-TPL-HL] Failed processing a container:', e);
    }
}

/* ----------  CLEANUP HELPERS  --------------------------------------------- */
function isSpacerBlock(el: HTMLElement): boolean {
    // Treat as spacer if the element itself is a Froala spacer wrapper
    // or if it is a simple container whose only child is a spacer wrapper.
    const isDirectSpacer = el.classList.contains('br-wrapper') && el.classList.contains('br-wrapper--multiple');
    if (isDirectSpacer) return true;
    const onlyChild = el.children.length === 1 ? (el.firstElementChild as HTMLElement | null) : null;
    if (!onlyChild) return false;
    const onlyChildIsSpacer = onlyChild.classList.contains('br-wrapper') && onlyChild.classList.contains('br-wrapper--multiple');
    // Ensure there is no extra text content around the spacer
    const hasNoText = textNorm(el.textContent) === '';
    return onlyChildIsSpacer && hasNoText;
}

function dedupeSpacerWrappers(root: HTMLElement): void {
    // Collapse consecutive .br-wrapper--multiple blocks and remove empty wrappers
    let node: ChildNode | null = root.firstChild;
    let lastWasSpacer = false;
    while (node) {
        const next = node.nextSibling;
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const isSpacer = isSpacerBlock(el);
            if (isSpacer) {
                if (lastWasSpacer) {
                    root.removeChild(el);
                    node = next; continue;
                }
                lastWasSpacer = true;
            } else {
                lastWasSpacer = false;
            }
            // remove empty blocks
            if (el.children.length === 0 && textNorm(el.textContent) === '') {
                root.removeChild(el);
            }
        } else if (node.nodeType === Node.TEXT_NODE) {
            // Remove pure whitespace text nodes between spacers to prevent visual gaps
            if (!textNorm((node as Text).nodeValue || '')) {
                root.removeChild(node);
                node = next; continue;
            }
        }
        node = next;
    }
}

function removeSeparatorElements(container: HTMLElement): void {
    // Deep-scan: remove any simple block whose text is only separator characters
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    let removedElements = 0;
    for (const el of all) {
        const t = textNorm(el.textContent);
        if (!t) continue;
        if (isSeparator(t)) {
            el.remove();
            removedElements++;
        }
    }
    // Also remove standalone text nodes that are only separators
    try {
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
        const toRemove: Text[] = [];
        // Collect first to avoid invalidating walker during iteration
        while (walker.nextNode()) {
            const n = walker.currentNode as Text;
            const t = textNorm(n.nodeValue || '');
            if (t && isSeparator(t)) {
                toRemove.push(n);
            }
        }
        for (const n of toRemove) {
            n.parentNode?.removeChild(n);
        }
        if (toRemove.length || removedElements) {
            try { console.debug('[KH][QC-TPL-HL] Removed separator nodes', { removedElements, removedTextNodes: toRemove.length }); } catch {}
        }
    } catch (e) {
        console.debug('[KH][QC-TPL-HL] Failed removing separator text nodes:', e);
    }
}

/* ----------  GENERIC SECTIONS  ------------------------------------------- */
function tryProcessGenericSections(container: HTMLElement): boolean {
    let added = false;
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
        const t = textNorm(el.textContent);
        if (!t) continue;
        // Skip known headers
        if (HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || HEADER.gpt.test(t) || HEADER.didUseGpt.test(t)) continue;
        // Treat as a generic header if next or prev sibling is a separator and it has following content
        const parent = el.parentElement; if (!parent) continue;
        const siblings = Array.from(parent.children) as HTMLElement[];
        const idx = siblings.indexOf(el);
        if (idx === -1) continue;
        const prevEl = siblings[idx - 1];
        const nextEl = siblings[idx + 1];
        const prevT = textNorm(prevEl ? prevEl.textContent : '');
        const nextT = textNorm(nextEl ? nextEl.textContent : '');
        const isGenericHeader = isSeparator(prevT) || isSeparator(nextT);
        if (!isGenericHeader) continue;
        // Skip if already wrapped/processed
        if (el.closest('div[data-kh-qc-wrap]')) continue;
        const headerBlock = findHeaderBlock(el, container);
        const bodyBlocks = collectSectionNodes(el, headerBlock);
        if (!bodyBlocks.length) continue;
        applyHighlight(container, headerBlock, bodyBlocks, 'additional');
        added = true;
    }
    return added;
}

/* ----------  DIVIDER-BASED GENERAL PARSER  ------------------------------- */
function isDividerNode(node: ChildNode): boolean {
    try {
        if (node.nodeType === Node.TEXT_NODE) {
            const t = textNorm((node as Text).nodeValue || '');
            return !!t && isSeparator(t);
        }
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            // Consider only simple leaf elements as potential dividers
            if (el.children.length === 0) {
                const t = textNorm(el.textContent || '');
                return !!t && isSeparator(t);
            }
        }
    } catch {}
    return false;
}

function determineSectionKindFromTitle(titleText: string): SectionKind {
    const t = textNorm(titleText);
    // Relaxed matching: detect keywords anywhere in the title text
    const ACTION_ANY = /what\s+is\s+your\s+proposed\s+action/i;
    const PR_ANY = /what\s+is\s+the\s+pr\s+to\s+the\s+customer/i;
    const ADDITIONAL_ANY = /additional\s+context/i;
    if (ACTION_ANY.test(t) || HEADER.action.test(t)) return 'action';
    if (PR_ANY.test(t) || HEADER.pr.test(t)) return 'pr';
    if (ADDITIONAL_ANY.test(t) || HEADER.additional.test(t)) return 'additional';
    // Treat other/generic as 'additional'
    return 'additional';
}

function wrapBodyWithoutCleanup(container: HTMLElement, headerBlock: HTMLElement, bodyNodes: ChildNode[], kind: SectionKind): void {
    const headerClass =
        kind === 'action' ? EXTENSION_SELECTORS.qcHighlightHeaderAction
        : kind === 'pr' ? EXTENSION_SELECTORS.qcHighlightHeaderPR
        : EXTENSION_SELECTORS.qcHighlightHeaderAdditional;

    const bodyClass =
        kind === 'action' ? EXTENSION_SELECTORS.qcHighlightBodyAction
        : kind === 'pr' ? EXTENSION_SELECTORS.qcHighlightBodyPR
        : EXTENSION_SELECTORS.qcHighlightBodyAdditional;

    try { headerBlock.classList.add(cls(headerClass)); } catch {}
    if (!bodyNodes.length) return;

    const first = bodyNodes[0]!;
    const parent = (first.nodeType === Node.ELEMENT_NODE)
        ? ((first as HTMLElement).parentElement as HTMLElement | null)
        : (first.parentNode as HTMLElement | null);
    if (!parent) return;

    // Skip if already wrapped for this kind
    try {
        const closestBase = (first.nodeType === Node.ELEMENT_NODE)
            ? (first as HTMLElement)
            : ((first.parentElement as HTMLElement | null));
        const nearestWrapper = closestBase?.closest?.(`div[data-kh-qc-wrap="${kind}"]`) as HTMLElement | null;
        if (nearestWrapper) return;
    } catch {}

    // Do not merge segments of the same kind across the container; keep each segment separate

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-kh-qc-wrap', kind);
    wrapper.classList.add(cls(bodyClass));
    try {
        parent.insertBefore(wrapper, first);
        for (const node of bodyNodes) {
            if (!node) continue;
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.contains(wrapper)) continue;
            }
            wrapper.appendChild(node);
        }
    } catch (err) {
        try { console.debug('[KH][QC-TPL-HL][DIV] Failed wrapping body nodes:', err); } catch {}
        return;
    }

    if (kind === 'pr') {
        try {
            const postEl = container.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null
                ?? container.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null;
            if (postEl) ensurePrControls(wrapper, postEl);
        } catch (e) {
            console.debug('[KH][QC-TPL-HL][DIV] ensurePrControls failed:', e);
        }
    }
}

function processBlockByDividers(block: HTMLElement, rootContainer: HTMLElement): boolean {
    try {
        const nodes = Array.from(block.childNodes);
        if (!nodes.length) return false;

        // Build segments split by divider nodes
        const dividerIdxs: number[] = [];
        nodes.forEach((n, idx) => { if (isDividerNode(n)) dividerIdxs.push(idx); });
        if (!dividerIdxs.length) return false;

        const segments: ChildNode[][] = [];
        let start = 0;
        for (const d of dividerIdxs) {
            if (d > start) segments.push(nodes.slice(start, d));
            start = d + 1;
        }
        if (start < nodes.length) segments.push(nodes.slice(start));

        let anyLocal = false;
        for (const seg of segments) {
            if (!seg.length) continue;
            // Determine title boundary
            let titleEnd = 0;
            let foundQ = false;
            let titleTextAcc = '';
            for (let i = 0; i < seg.length; i++) {
                const n = seg[i]!;
                const t = textNorm((n as HTMLElement | Text).textContent || '');
                if (t) titleTextAcc += (titleTextAcc ? ' ' : '') + t;
                if (HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || /\?/.test(t)) {
                    titleEnd = i; foundQ = true; break;
                }
            }
            if (!foundQ) {
                // Default: first node is the title
                titleEnd = 0;
                titleTextAcc = textNorm((seg[0] as HTMLElement | Text).textContent || '');
            }

            const body = seg.slice(titleEnd + 1);
            if (!body.length) continue;

            const titleNode = seg[titleEnd] as HTMLElement | Text;
            const titleEl = (titleNode.nodeType === Node.ELEMENT_NODE)
                ? (titleNode as HTMLElement)
                : ((titleNode.parentElement as HTMLElement | null) ?? block);
            const headerBlock = findHeaderBlock(titleEl, block);
            const kind = determineSectionKindFromTitle(titleTextAcc);

            wrapBodyWithoutCleanup(rootContainer, headerBlock, body, kind);
            anyLocal = true;
            try { console.debug('[KH][QC-TPL-HL][DIV] Processed segment with kind', kind); } catch {}
        }
        return anyLocal;
    } catch (e) {
        console.error('[KH][QC-TPL-HL][DIV] Failed processing block by dividers:', e);
        return false;
    }
}

function processByDividers(container: HTMLElement): boolean {
    let any = false;
    try {
        const nodes = Array.from(container.childNodes);
        if (!nodes.length) return false;

        const dividerIdxs: number[] = [];
        nodes.forEach((n, idx) => { if (isDividerNode(n)) dividerIdxs.push(idx); });
        if (!dividerIdxs.length) return false;

        // Build segments between divider indices (dividers themselves excluded)
        const segments: ChildNode[][] = [];
        let start = 0;
        for (const d of dividerIdxs) {
            if (d > start) segments.push(nodes.slice(start, d));
            start = d + 1;
        }
        if (start < nodes.length) segments.push(nodes.slice(start));

        for (const seg of segments) {
            if (!seg.length) continue;

            // Determine title node and kind
            let titleIndex = 0;
            let titleTextAcc = '';
            let foundTitle = false;
            for (let i = 0; i < seg.length; i++) {
                const n = seg[i]!;
                const t = textNorm((n as HTMLElement | Text).textContent || '');
                if (t) titleTextAcc += (titleTextAcc ? ' ' : '') + t;
                if (HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || /\?/.test(t)) {
                    titleIndex = i; foundTitle = true; break;
                }
            }
            if (!foundTitle) {
                titleIndex = 0;
                titleTextAcc = textNorm((seg[0] as HTMLElement | Text).textContent || '');
            }

            const bodyNodes = seg.slice(titleIndex + 1);
            if (!bodyNodes.length) continue;

            const titleNode = seg[titleIndex] as ChildNode | undefined;
            if (!titleNode) continue;
            const titleEl = (titleNode.nodeType === Node.ELEMENT_NODE)
                ? (titleNode as HTMLElement)
                : ((titleNode.parentElement as HTMLElement | null) ?? container);
            const headerBlock = findHeaderBlock(titleEl, container);
            const kind = determineSectionKindFromTitle(titleTextAcc);

            wrapBodyWithoutCleanup(container, headerBlock, bodyNodes, kind);
            any = true;
            try { console.debug('[KH][QC-TPL-HL][DIV] Processed container-level segment with kind', kind); } catch {}
        }
    } catch (e) {
        console.error('[KH][QC-TPL-HL][DIV] processByDividers failed:', e);
    }
    return any;
}

/* ----------  BUTTONS: PREV/NEXT/TOGGLE  ---------------------------------- */
const MENU_WRAPPER_SEL = KAYAKO_SELECTORS.timelineItemActionButtonsWrapper;
const FEED_MENU_SEL = KAYAKO_SELECTORS.feedItemMenu;

function ensureButtons(post: HTMLElement): void {
    try {
        const FLAG = 'khQcTplButtons';
        if (post.dataset[FLAG]) return;
        const menuWrapper = post.querySelector<HTMLElement>(MENU_WRAPPER_SEL);
        if (!menuWrapper) return;
        const feedMenu = menuWrapper.querySelector<HTMLElement>(FEED_MENU_SEL) ?? menuWrapper;
        const nativeClass = feedMenu.firstElementChild?.className ?? '';
        // Only keep the toggle button in the feed menu
        const toggleBtn = document.createElement('div');
        toggleBtn.className = `${nativeClass} ${cls(EXTENSION_SELECTORS.qcToggleButton)}`.trim();
        toggleBtn.setAttribute('role', 'button');
        toggleBtn.setAttribute('aria-pressed', String(highlightEnabled));
        toggleBtn.setAttribute('aria-label', 'Toggle QC highlighting');
        toggleBtn.setAttribute('title', highlightEnabled ? 'Disable QC highlighting' : 'Enable QC highlighting');
        // Eye icon for visibility toggle
        toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
        toggleBtn.addEventListener('click', e => { e.stopPropagation(); toggleHighlighting(); updateToggleVisuals(); });

        // Place QC group at the far left
        const firstChild = feedMenu.firstElementChild;
        feedMenu.insertBefore(toggleBtn, firstChild);

        // Move existing QC button (if present) to follow our group
        try {
            const existingQc = feedMenu.querySelector<HTMLElement>(EXTENSION_SELECTORS.qcerButton);
            if (existingQc) {
                feedMenu.insertBefore(existingQc, toggleBtn.nextSibling);
                // Ensure the feed-menu QC button remains hidden; PR-local toolbars will proxy its action
                try { (existingQc as HTMLElement).style.display = 'none'; } catch {}
            }
        } catch {}

        // Ensure no artificial spacing is added after our group.
        try {
            const firstOriginal = (feedMenu.querySelector<HTMLElement>(EXTENSION_SELECTORS.qcerButton)?.nextElementSibling as HTMLElement | null)
                ?? (toggleBtn.nextElementSibling as HTMLElement | null);
            if (firstOriginal) {
                if (firstOriginal.style.marginLeft === '40px') firstOriginal.style.marginLeft = '';
            }
        } catch {}

        post.dataset[FLAG] = 'yes';
        updateToggleVisuals();
        try { console.debug('[KH][QC-TPL-HL] Inserted toggle button in feed menu'); } catch {}
    } catch (e) {
        console.error('[KH][QC-TPL-HL] Failed to insert QC buttons:', e);
    }
}

function eligibleContainers(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.timelineItemContentInner))
        .filter(el => el.dataset['khQcTplHasSections'] === 'yes');
}

function goToNext(fromPost: HTMLElement): void {
    const containers = eligibleContainers();
    if (!containers.length) return;
    const allPosts = containers
        .map(c => (c.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null) || (c.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null))
        .filter((p): p is HTMLElement => !!p);
    if (!allPosts.length) return;
    const idx = Math.max(0, allPosts.indexOf(fromPost));
    const nextIndex = (idx + 1) % allPosts.length;
    const target = allPosts[nextIndex];
    if (target) focusPost(target);
}

function goToPrev(fromPost: HTMLElement): void {
    const containers = eligibleContainers();
    if (!containers.length) return;
    const allPosts = containers
        .map(c => (c.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null) || (c.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null))
        .filter((p): p is HTMLElement => !!p);
    if (!allPosts.length) return;
    const idx = Math.max(0, allPosts.indexOf(fromPost));
    const prevIndex = (idx - 1 + allPosts.length) % allPosts.length;
    const target = allPosts[prevIndex];
    if (target) focusPost(target);
}

function focusPost(post: HTMLElement): void {
    try {
        post.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
        post.animate?.([{ outline: '2px solid #4EAFCB' }, { outline: 'none' }], { duration: 800 });
    } catch {}
}

function toggleHighlighting(): void {
    highlightEnabled = !highlightEnabled;
    try { localStorage.setItem(TOGGLE_STORAGE_KEY, highlightEnabled ? '1' : '0'); } catch {}
    if (!highlightEnabled) {
        // Remove all wrappers and classes
        document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.timelineItemContentInner).forEach(resetContainer);
    } else {
        // Reprocess all containers
        processExisting();
    }
}

function resetContainer(container: HTMLElement): void {
    const snap = originalHtmlByContainer.get(container);
    if (typeof snap === 'string') {
        container.innerHTML = snap;
        delete container.dataset['khQcTplHasSections'];
        return;
    }
    // Fallback path: unwrap and remove extension classes
    Array.from(container.querySelectorAll('div[data-kh-qc-wrap]')).forEach(w => {
        const parent = w.parentElement; if (!parent) return;
        while (w.firstChild) parent.insertBefore(w.firstChild, w);
        w.remove();
    });
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    const classesToRemove = [
        EXTENSION_SELECTORS.qcHighlightHeaderAction,
        EXTENSION_SELECTORS.qcHighlightHeaderPR,
        EXTENSION_SELECTORS.qcHighlightHeaderAdditional,
        EXTENSION_SELECTORS.qcHighlightBodyAction,
        EXTENSION_SELECTORS.qcHighlightBodyPR,
        EXTENSION_SELECTORS.qcHighlightBodyAdditional,
    ].map(cls);
    [container, ...all].forEach(el => classesToRemove.forEach(c => el.classList.remove(c)));
    // Also clear any inline text centering introduced by highlighting styles
    try {
        [container, ...all].forEach(el => { if ((el.style?.textAlign || '') === 'center') el.style.textAlign = ''; });
    } catch {}
}

function updateToggleVisuals(): void {
    const pressed = String(highlightEnabled);
    document.querySelectorAll<HTMLElement>(EXTENSION_SELECTORS.qcToggleButton).forEach(btn => {
        btn.setAttribute('aria-pressed', pressed);
        btn.style.opacity = highlightEnabled ? '' : '0.5';
        btn.setAttribute('title', highlightEnabled ? 'Disable QC highlighting' : 'Enable QC highlighting');
    });
    // Remove visual header styles when disabled so text is not centered
    if (!highlightEnabled) {
        const classesToRemove = [
            EXTENSION_SELECTORS.qcHighlightHeaderAction,
            EXTENSION_SELECTORS.qcHighlightHeaderPR,
            EXTENSION_SELECTORS.qcHighlightHeaderAdditional,
            EXTENSION_SELECTORS.qcHighlightBodyAction,
            EXTENSION_SELECTORS.qcHighlightBodyPR,
            EXTENSION_SELECTORS.qcHighlightBodyAdditional,
        ].map(cls);
        try {
            const els = Array.from(document.querySelectorAll<HTMLElement>(
                [
                    EXTENSION_SELECTORS.qcHighlightHeaderAction,
                    EXTENSION_SELECTORS.qcHighlightHeaderPR,
                    EXTENSION_SELECTORS.qcHighlightHeaderAdditional,
                    EXTENSION_SELECTORS.qcHighlightBodyAction,
                    EXTENSION_SELECTORS.qcHighlightBodyPR,
                    EXTENSION_SELECTORS.qcHighlightBodyAdditional,
                ].join(',')));
            els.forEach(el => {
                classesToRemove.forEach(c => el.classList.remove(c));
                // Clear any inline centering that might have been applied
                if ((el.style?.textAlign || '') === 'center') el.style.textAlign = '';
            });
        } catch {}
    }
}

function processExisting(): void {
    document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.timelineItemContentInner)
        .forEach(processContainer);
}

/* ----------  PR-LOCAL CONTROLS INSIDE WRAPPER ---------------------------- */
function ensurePrControls(prWrapper: HTMLElement, post: HTMLElement): void {
    try {
        if (prWrapper.dataset['khPrCtrls'] === 'yes') return;

        // Ensure positioning context
        const style = prWrapper.style;
        if (getComputedStyle(prWrapper).position === 'static') {
            style.position = 'relative';
        }

        const buildQcCheckmarkBtn = (): HTMLElement => {
            const btn = document.createElement('div');
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Extract PR to reply');
            btn.setAttribute('title', 'Extract PR to reply');
            btn.style.cursor = 'pointer';
            btn.style.padding = '2px';
            btn.style.opacity = '0.65';
            // Keep extension class for styling consistency
            try { btn.classList.add(cls(EXTENSION_SELECTORS.qcerButton)); } catch {}
            // Use SVG icon only (no text) to avoid polluting text extraction
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" stroke="#2ca24f" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
            btn.addEventListener('click', e => {
                e.stopPropagation();
                try {
                    const feedMenu = post.querySelector<HTMLElement>(MENU_WRAPPER_SEL)?.querySelector<HTMLElement>(FEED_MENU_SEL)
                        ?? post.querySelector<HTMLElement>(MENU_WRAPPER_SEL);
                    const existingQc = feedMenu?.querySelector<HTMLElement>(EXTENSION_SELECTORS.qcerButton) ?? null;
                    if (existingQc) {
                        existingQc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                        existingQc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                        existingQc.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    } else {
                        console.warn('[KH][QC-TPL-HL] Feed QC button not found for proxy click');
                    }
                } catch (err) {
                    console.error('[KH][QC-TPL-HL] Failed to proxy QC click:', err);
                }
            });
            return btn;
        };

        const buildCopyBtn = (): HTMLElement => {
            const btn = document.createElement('div');
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Copy proposed reply');
            btn.setAttribute('title', 'Copy proposed reply');
            btn.style.cursor = 'pointer';
            btn.style.padding = '2px';
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                </svg>`;
            btn.addEventListener('click', e => {
                e.stopPropagation();
                try { console.debug('[KH][QC-TPL-HL] Copy proposed reply (dummy)'); } catch {}
            });
            return btn;
        };

        const buildEphorBtn = (): HTMLElement => {
            const btn = document.createElement('div');
            btn.classList.add('kh-send-ephor-review-btn');
            btn.setAttribute('role', 'button');
            btn.setAttribute('aria-label', 'Send to Ephor for review');
            btn.setAttribute('title', 'Send to Ephor for review');
            btn.style.cursor = 'pointer';
            btn.style.padding = '2px';
            const img = document.createElement('img');
            try {
                const url = (globalThis as any).chrome?.runtime?.getURL?.('images/ephor-icon.png') || 'images/ephor-icon.png';
                img.src = url;
            } catch {
                img.src = 'images/ephor-icon.png';
            }
            img.width = 12; img.height = 12;
            img.alt = 'Ephor';
            btn.appendChild(img);
            btn.addEventListener('click', e => {
                e.stopPropagation();
                try { console.debug('[KH][QC-TPL-HL] Send to Ephor (dummy)'); } catch {}
            });
            return btn;
        };

        const buildToolbar = (pos: 'top' | 'bottom'): HTMLElement => {
            const wrap = document.createElement('div');
            wrap.setAttribute('data-kh-pr-toolbar', pos);
            wrap.style.position = 'absolute';
            wrap.style.right = '12px';
            wrap.style.display = 'flex';
            wrap.style.gap = '6px';
            wrap.style.alignItems = 'center';
            wrap.style.zIndex = '1';
            if (pos === 'top') wrap.style.top = '4px'; else wrap.style.bottom = '4px';
            return wrap;
        };

        const topBar = buildToolbar('top');
        // Order (left to right): QC checkmark, Copy, Ephor (Ephor rightmost visually)
        topBar.appendChild(buildQcCheckmarkBtn());
        topBar.appendChild(buildCopyBtn());
        topBar.appendChild(buildEphorBtn());
        prWrapper.appendChild(topBar);

        // Conditionally add bottom bar if tall enough
        const BOTTOM_BAR_MIN_HEIGHT = 350; // px
        const ensureBottomBar = () => {
            try {
                const h = prWrapper.getBoundingClientRect().height;
                const existing = prWrapper.querySelector<HTMLElement>('div[data-kh-pr-toolbar="bottom"]');
                if (h >= BOTTOM_BAR_MIN_HEIGHT) {
                    if (!existing) {
                        const bottomBar = buildToolbar('bottom');
                        bottomBar.appendChild(buildQcCheckmarkBtn());
                        bottomBar.appendChild(buildCopyBtn());
                        bottomBar.appendChild(buildEphorBtn());
                        prWrapper.appendChild(bottomBar);
                        try { console.debug('[KH][QC-TPL-HL] Added bottom PR toolbar (with QC checkmark)'); } catch {}
                    }
                } else if (existing) {
                    existing.remove();
                }
            } catch (e) {
                console.debug('[KH][QC-TPL-HL] ensureBottomBar failed:', e);
            }
        };
        ensureBottomBar();
        try {
            const ro = new ResizeObserver(() => ensureBottomBar());
            ro.observe(prWrapper);
        } catch {}

        prWrapper.dataset['khPrCtrls'] = 'yes';
        try { console.debug('[KH][QC-TPL-HL] Inserted PR-local controls'); } catch {}
    } catch (e) {
        console.error('[KH][QC-TPL-HL] Failed to insert PR-local controls:', e);
    }
}

function observe(): void {
    observer = new MutationObserver(muts => {
        for (const m of muts) {
            m.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                if (node.matches?.(KAYAKO_SELECTORS.timelineItemContentInner)) {
                    processContainer(node);
                    return;
                }
                const inner = node.querySelector?.(KAYAKO_SELECTORS.timelineItemContentInner);
                if (inner instanceof HTMLElement) processContainer(inner);
            });
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

/* ----------  PUBLIC  ------------------------------------------------------- */
export function bootQcTemplateHighlighter(): void {
    try {
        try { highlightEnabled = localStorage.getItem(TOGGLE_STORAGE_KEY) !== '0'; } catch {}
        processExisting();
        observe();
        console.debug('[KH][QC-TPL-HL] Booted');
    } catch (e) {
        console.error('[KH][QC-TPL-HL] Boot failed:', e);
    }
}


