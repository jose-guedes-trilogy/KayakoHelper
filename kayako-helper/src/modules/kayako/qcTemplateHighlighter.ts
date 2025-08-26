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
    action: /what\s+is\s+your\s+proposed\s+action\s*\??/i,
    pr: /what\s+is\s+the\s+pr\s+to\s+the\s+customer\s*\??/i,
    additional: /^additional\s+context\s*\??$/i,
    gpt: /^gpt$/i,
    didUseGpt: /^did\s+you\s+use\s+gpt\s*:?/i,
};

type SectionKind = 'action' | 'pr' | 'additional';

function findHeaderElement(container: HTMLElement, kind: SectionKind): HTMLElement | null {
    const re = HEADER[kind];
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    return (
        all.find(el => re.test(textNorm(el.textContent))) ?? null
    );
}

function findHeaderBlock(el: HTMLElement, root: HTMLElement): HTMLElement {
    // Prefer the closest block-level wrapper (p/div/li) to paint header background
    const block = el.closest('p,div,li,section,header,article');
    if (block && root.contains(block)) return block as HTMLElement;
    return el;
}

function collectSectionSiblings(headerEl: HTMLElement): HTMLElement[] {
    const parent = headerEl.parentElement;
    if (!parent) return [];
    const siblings = Array.from(parent.children) as HTMLElement[];
    const startIdx = siblings.indexOf(headerEl);
    if (startIdx === -1) return [];

    const out: HTMLElement[] = [];
    for (let i = startIdx + 1; i < siblings.length; i++) {
        const el = siblings[i];
        if (!el) continue;
        const t = textNorm(el.textContent);
        // Stop on separators or the start of another section or GPT area
        const isAnotherHeader = HEADER.action.test(t) || HEADER.pr.test(t) || HEADER.additional.test(t) || HEADER.gpt.test(t) || HEADER.didUseGpt.test(t);
        if (isSeparator(t) || isAnotherHeader) break;
        // Skip Froala wrappers that are just spacer shims
        if (el.classList.contains('br-wrapper')) continue;
        out.push(el);
    }
    return out;
}

function applyHighlight(container: HTMLElement, headerBlock: HTMLElement, bodyBlocks: HTMLElement[], kind: SectionKind): void {
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

    // Wrap all body blocks into a single rectangular wrapper if not already wrapped
    if (!bodyBlocks.length) return;

    const first = bodyBlocks[0]!;
    const parent = first.parentElement;
    if (!parent) return;

    // If already wrapped for this section kind, skip
    const existingWrapper = parent.querySelector<HTMLElement>(`div[data-kh-qc-wrap="${kind}"]`);
    if (existingWrapper) {
        try { console.debug('[KH][QC-TPL-HL] Wrapper already exists for', kind); } catch {}
        return;
    }

    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-kh-qc-wrap', kind);
    wrapper.classList.add(cls(bodyClass));

    // Insert wrapper before the first body block and move all collected blocks into it
    parent.insertBefore(wrapper, first);
    for (const el of bodyBlocks) {
        if (!el) continue;
        wrapper.appendChild(el);
    }

    // Post-wrap cleanup: remove consecutive spacer wrappers and stray separators
    try {
        dedupeSpacerWrappers(wrapper);
        removeSeparatorElements(container);
    } catch (e) {
        console.debug('[KH][QC-TPL-HL] cleanup failed:', e);
    }
}

function processContainer(container: HTMLElement): void {
    try {
        if (!highlightEnabled) { return; }
        if (!originalHtmlByContainer.has(container)) {
            try { originalHtmlByContainer.set(container, container.innerHTML); } catch {}
        }
        const targets: SectionKind[] = ['action', 'pr', 'additional'];
        let any = false;
        for (const kind of targets) {
            const headerEl = findHeaderElement(container, kind);
            if (!headerEl) continue;
            const headerBlock = findHeaderBlock(headerEl, container);
            const bodyBlocks = collectSectionSiblings(headerEl);
            // Always add container highlight when a header is present
            applyHighlight(container, headerBlock, bodyBlocks, kind);
            any = true;
        }
        // Try to parse extra ad-hoc sections separated by =====
        try { if (tryProcessGenericSections(container)) any = true; } catch {}

        if (any) {
            container.dataset['khQcTplHasSections'] = 'yes';
            // Inject per-post buttons once
            const postEl = container.closest(KAYAKO_SELECTORS.timelineItem) as HTMLElement | null
                ?? container.closest(KAYAKO_SELECTORS.messageOrNote) as HTMLElement | null;
            if (postEl) ensureButtons(postEl);
        }
        try { console.debug('[KH][QC-TPL-HL] processed container', { any }); } catch {}
    } catch (e) {
        console.error('[KH][QC-TPL-HL] Failed processing a container:', e);
    }
}

/* ----------  CLEANUP HELPERS  --------------------------------------------- */
function dedupeSpacerWrappers(root: HTMLElement): void {
    // Collapse consecutive .br-wrapper--multiple blocks and remove empty wrappers
    let node: ChildNode | null = root.firstChild;
    let lastWasSpacer = false;
    while (node) {
        const next = node.nextSibling;
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const isSpacer = el.classList.contains('br-wrapper') && el.classList.contains('br-wrapper--multiple');
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
        }
        node = next;
    }
}

function removeSeparatorElements(container: HTMLElement): void {
    // Deep-scan: remove any simple block whose text is only separator characters
    const all = Array.from(container.querySelectorAll<HTMLElement>('*'));
    for (const el of all) {
        const t = textNorm(el.textContent);
        if (!t) continue;
        if (isSeparator(t)) {
            el.remove();
        }
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
        const bodyBlocks = collectSectionSiblings(el);
        if (!bodyBlocks.length) continue;
        applyHighlight(container, headerBlock, bodyBlocks, 'additional');
        added = true;
    }
    return added;
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

        const prevBtn = document.createElement('div');
        prevBtn.className = `${nativeClass} ${cls(EXTENSION_SELECTORS.qcPrevButton)}`.trim();
        prevBtn.setAttribute('role', 'button');
        prevBtn.setAttribute('aria-label', 'Previous QC submission');
        prevBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l7-7m-7 7l7 7M5 12h14"/></svg>`;
        prevBtn.addEventListener('click', e => { e.stopPropagation(); goToPrev(post); });

        const toggleBtn = document.createElement('div');
        toggleBtn.className = `${nativeClass} ${cls(EXTENSION_SELECTORS.qcToggleButton)}`.trim();
        toggleBtn.setAttribute('role', 'button');
        toggleBtn.setAttribute('aria-pressed', String(highlightEnabled));
        toggleBtn.setAttribute('aria-label', 'Toggle QC highlighting');
        // Eye icon for visibility toggle
        toggleBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
        toggleBtn.addEventListener('click', e => { e.stopPropagation(); toggleHighlighting(); updateToggleVisuals(); });

        const nextBtn = document.createElement('div');
        nextBtn.className = `${nativeClass} ${cls(EXTENSION_SELECTORS.qcNextButton)}`.trim();
        nextBtn.setAttribute('role', 'button');
        nextBtn.setAttribute('aria-label', 'Next QC submission');
        nextBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12l-7 7m7-7l-7-7M19 12H5"/></svg>`;
        nextBtn.addEventListener('click', e => { e.stopPropagation(); goToNext(post); });

        // Place QC group at the far left
        const firstChild = feedMenu.firstElementChild;
        feedMenu.insertBefore(prevBtn, firstChild);
        feedMenu.insertBefore(toggleBtn, prevBtn.nextSibling);
        feedMenu.insertBefore(nextBtn, toggleBtn.nextSibling);

        // Move existing QC button (if present) to follow our group
        try {
            const existingQc = feedMenu.querySelector<HTMLElement>(EXTENSION_SELECTORS.qcerButton);
            if (existingQc) {
                feedMenu.insertBefore(existingQc, nextBtn.nextSibling);
            }
        } catch {}

        // Add visible separation by margin on the first original button after our group.
        try {
            const firstOriginal = (feedMenu.querySelector<HTMLElement>(EXTENSION_SELECTORS.qcerButton)?.nextElementSibling as HTMLElement | null)
                ?? (nextBtn.nextElementSibling as HTMLElement | null);
            if (firstOriginal) {
                firstOriginal.style.marginLeft = '40px';
                // Restore any lost left border on the first original button
                const style = getComputedStyle(firstOriginal);
                if (!style.borderLeftWidth || style.borderLeftWidth === '0px') {
                    firstOriginal.style.borderLeft = '1px solid #D1D5D7';
                }
            }
        } catch {}

        post.dataset[FLAG] = 'yes';
        updateToggleVisuals();
        try { console.debug('[KH][QC-TPL-HL] Inserted prev/toggle/next buttons'); } catch {}
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
        post.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
}

function updateToggleVisuals(): void {
    const pressed = String(highlightEnabled);
    document.querySelectorAll<HTMLElement>(EXTENSION_SELECTORS.qcToggleButton).forEach(btn => {
        btn.setAttribute('aria-pressed', pressed);
        btn.style.opacity = highlightEnabled ? '' : '0.5';
    });
}

function processExisting(): void {
    document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.timelineItemContentInner)
        .forEach(processContainer);
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


