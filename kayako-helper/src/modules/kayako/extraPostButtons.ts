/* ============================================================================
 * Kayako Helper – “Scroll-to-Top” & “Copy Post” buttons
 * ========================================================================= */

import { KAYAKO_SELECTORS, EXTENSION_SELECTORS } from '@/generated/selectors.ts';
import { addNewlines } from '@/modules/kayako/newlineSpacer.ts';

/* ----------  SELECTORS  -------------------------------------------------- */

const MESSAGE_SEL       = KAYAKO_SELECTORS.messageOrNote;
const MESSAGE_INNER_SEL       = KAYAKO_SELECTORS.timelineItemContent;
const MESSAGE_INNER_CONTENT_SEL       = KAYAKO_SELECTORS.timelineItemContentInner;
const MENU_WRAPPER_SEL  = KAYAKO_SELECTORS.timelineItemActionButtonsWrapper;
const FEED_MENU_SEL     = KAYAKO_SELECTORS.feedItemMenu;

/* ----------  CLASS NAMES  ------------------------------------------------ */

const CL_SCROLL_BTN = EXTENSION_SELECTORS.scrollTopButton.replace(/^\./, '');
const CL_COPY_BTN   = EXTENSION_SELECTORS.copyPostButton.replace(/^\./, '');
const CL_QCER_BTN   = EXTENSION_SELECTORS.qcerButton.replace(/^\./, '');
const CL_QC_TOGGLE_BTN = EXTENSION_SELECTORS.qcToggleButton.replace(/^\./, '');

/* ----------  PERFORMANCE LIMITS ------------------------------------------ */
const COPY_PERF_LIMITS = {
    MAX_HTML_CHARS: 120_000,
    MAX_TEXT_CHARS: 60_000,
};

/* ----------  PUBLIC BOOTSTRAP  ------------------------------------------ */

export function bootExtraPostButtons(): void {
    addButtonsToExistingPosts();
    observeForLazyLoadedPosts();
}

/* ----------  IMPLEMENTATION  ------------------------------------------- */

function addButtonsToExistingPosts(): void {
    document.querySelectorAll<HTMLElement>(MESSAGE_SEL).forEach(addButtons);
}

function observeForLazyLoadedPosts(): void {
    new MutationObserver(mutations => {
        for (const m of mutations) {
            m.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;

                if (node.matches(MESSAGE_SEL)) {
                    addButtons(node);
                } else {
                    node.querySelectorAll?.(MESSAGE_SEL)
                        .forEach(el => addButtons(el as HTMLElement));
                }
            });
        }
    }).observe(document.body, { childList: true, subtree: true });
}

function addButtons(post: HTMLElement): void {
    /* avoid double-insertion */
    if (post.dataset['khButtonsReady']) return;
    post.dataset['khButtonsReady'] = 'yes';

    /* ensure positioning context for the absolute button */
    if (getComputedStyle(post).position === 'static') {
        post.style.position = 'relative';
    }

    // NOTE: Removed standalone kh-scroll-top-btn; bottom toolbar will include scroll-to-top
    const messageInner = post.querySelector<HTMLElement>(MESSAGE_INNER_SEL);

    /* ───── copy-post button (in the timeline menu) ───── */
    const menuWrapper = post.querySelector<HTMLElement>(MENU_WRAPPER_SEL);
    if (!menuWrapper) return; // no menu found – skip copy button

    const feedMenu =
        menuWrapper.querySelector<HTMLElement>(FEED_MENU_SEL) ?? menuWrapper;

    const nativeClass = feedMenu.firstElementChild?.className ?? '';

    const copyBtn = document.createElement('div');
    copyBtn.className = `${nativeClass} ${CL_COPY_BTN}`.trim();
    copyBtn.setAttribute('role', 'button');
    copyBtn.setAttribute('aria-label', 'Copy post');
    copyBtn.setAttribute('draggable', 'false');
    copyBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
    `;
    // Ensure consistent icon color and remove unintended dimming
    try { (copyBtn.style as any).opacity = ''; } catch {}
    try { (copyBtn.querySelector('svg') as SVGElement | null)?.setAttribute('stroke', '#838D94'); } catch {}

    // Prevent upstream listeners from firing; capture-phase guards
    const stopAllEarly = (ev: Event) => { try { console.debug('[KH][CopyPost] Captured', ev.type, '– stopping propagation'); } catch {} ev.preventDefault(); ev.stopImmediatePropagation(); };
    copyBtn.addEventListener('mousedown', stopAllEarly, { capture: true });
    copyBtn.addEventListener('mouseup', stopAllEarly, { capture: true });

    // Handle copy in capture phase to fully isolate from host listeners
    copyBtn.addEventListener('click', e => {
        try { console.debug('[KH][CopyPost] Click captured – starting copy flow'); } catch {}
        try {
            const contentEl = post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);
            if (!contentEl) {
                console.warn('[KH][CopyPost] Post content element not found');
                return;
            }

            // Prepare both HTML and plain text with spacing normalization, then strip color styles
            let cleanedHtml = '';
            let cleanedText = '';
            try {
                const t0 = performance.now?.() ?? 0;
                const container = document.createElement('div');
                container.innerHTML = String((contentEl as HTMLElement).innerHTML || '');
                try {
                    console.debug('[KH][CopyPost] Applying addNewlines on detached container');
                    addNewlines(container);
                } catch (e) {
                    console.warn('[KH][CopyPost] addNewlines failed; proceeding without it', e);
                }
                try {
                    stripColorStyles(container);
                } catch (e) {
                    console.warn('[KH][CopyPost] stripColorStyles failed; continuing', e);
                }
                try {
                    sanitizeLists(container);
                } catch (e) {
                    console.warn('[KH][CopyPost] sanitizeLists failed; continuing', e);
                }
                cleanedHtml = String(container.innerHTML || '');
                cleanedText = sanitiseText(String(container.innerText || ''));
                const t1 = performance.now?.() ?? 0;
                if (t1 && t0) console.debug('[KH][CopyPost] Normalization+sanitize duration (ms):', Math.round(t1 - t0));
            } catch (e) {
                console.warn('[KH][CopyPost] Normalization path failed; falling back to plain text only');
                const innerTextNow = String((contentEl as HTMLElement).innerText || '');
                cleanedText = sanitiseText(innerTextNow);
                cleanedHtml = '';
            }
            try { console.debug('[KH][CopyPost] COPY_HTML mode', { htmlLen: cleanedHtml.length, textLen: cleanedText.length }); } catch {}

            const attemptExecCommandFallback = () => {
                try {
                    const ta = document.createElement('textarea');
                    ta.value = cleanedText;
                    ta.style.position = 'fixed';
                    ta.style.left = '-9999px';
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    const ok = document.execCommand('copy');
                    ta.remove();
                    if (ok) {
                        console.debug('[KH][CopyPost] Copied via execCommand fallback');
                    } else {
                        console.warn('[KH][CopyPost] execCommand copy returned false');
                    }
                } catch (e) {
                    console.error('[KH][CopyPost] execCommand copy failed', e);
                }
            };

            const writePlain = () => {
                if (!navigator.clipboard?.writeText) {
                    attemptExecCommandFallback();
                    return;
                }
                navigator.clipboard.writeText(cleanedText)
                    .then(() => console.debug('[KH][CopyPost] Copied plain text', { textLen: cleanedText.length }))
                    .catch(err => {
                        console.error('[KH][CopyPost] Plain text clipboard write failed; using fallback', err);
                        attemptExecCommandFallback();
                    });
            };

            // Prefer rich clipboard (HTML + plain), fall back to plain text
            if (window.ClipboardItem && navigator.clipboard?.write && cleanedHtml) {
                try {
                    const items: Record<string, Blob> = {
                        'text/html': new Blob([cleanedHtml], { type: 'text/html' }),
                        'text/plain': new Blob([cleanedText], { type: 'text/plain' }),
                    };
                    navigator.clipboard.write([new window.ClipboardItem(items)])
                        .then(() => console.debug('[KH][CopyPost] Copied HTML + plain text', { htmlLen: cleanedHtml.length, textLen: cleanedText.length }))
                        .catch(err => { console.error('[KH][CopyPost] Rich clipboard write failed; falling back to text', err); writePlain(); });
                } catch (e) {
                    console.error('[KH][CopyPost] Rich clipboard path threw; falling back to text', e);
                    writePlain();
                }
            } else {
                writePlain();
            }
        } catch (err) {
            console.error('[KH][CopyPost] Unexpected error preparing copy text', err);
        }
        // Block host handlers
        e.preventDefault();
        e.stopImmediatePropagation();
    });

    // ───── scroll-to-bottom button (next to copy button) ─────
    const scrollDownBtn = document.createElement('div');
    scrollDownBtn.className = `${nativeClass} kh-scroll-bottom-btn`.trim();
    scrollDownBtn.setAttribute('role', 'button');
    scrollDownBtn.setAttribute('aria-label', 'Scroll to bottom of post');
    scrollDownBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 19l-7-7m7 7l7-7m-7 7V5" />
        </svg>
    `;
    try { (scrollDownBtn.style as any).opacity = ''; } catch {}
    try { (scrollDownBtn.querySelector('svg') as SVGElement | null)?.setAttribute('stroke', '#838D94'); } catch {}
    scrollDownBtn.addEventListener('click', e => {
        e.stopPropagation();
        post.scrollIntoView({ behavior: 'smooth', block: 'end' });
    });

    feedMenu.append(copyBtn);
    feedMenu.append(scrollDownBtn);

    // Bottom toolbar duplication (created conditionally for tall posts in updateButtonsVisibility)

    // ───── intelligent visibility based on post height ─────
    const MIN_HEIGHT_FOR_SCROLL_BUTTONS = 350; // px – rule reused for bottom toolbar duplication
    const getContentInner = () => post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);

    const updateButtonsVisibility = () => {
        const inner = getContentInner();
        const isTall = !!inner && inner.getBoundingClientRect().height >= MIN_HEIGHT_FOR_SCROLL_BUTTONS;

        const display = isTall ? '' : 'none';
        scrollDownBtn.style.display = display;
        scrollDownBtn.setAttribute('aria-hidden', String(!isTall));

        // Create/remove bottom toolbar based on isTall
        try {
            const existing = post.querySelector<HTMLElement>('[data-kh-bottom-menu="yes"]');
            if (isTall) {
                if (!existing) buildBottomToolbar(post, feedMenu, nativeClass);
            } else if (existing) {
                existing.remove();
            }
        } catch {}
    };

    // Observe size changes and run an initial check
    const ro = new ResizeObserver(updateButtonsVisibility);
    const innerNow = getContentInner();
    if (innerNow) ro.observe(innerNow);
    window.addEventListener('resize', updateButtonsVisibility, { passive: true });
    updateButtonsVisibility();
}

/* ----------  COPY SANITIZER (similar to QC approach)  -------------------- */
function textNorm(s: string | null | undefined): string {
    return (s ?? '')
        .replace(/\u00A0/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function sanitiseText(s: string): string {
    return s
        .replace(/\r\n?|\u2028|\u2029/g, '\n')
        .replace(/\u00A0/g, ' ')
        // Trim spaces on each line
        .split('\n')
        .map(l => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        // Collapse 3+ blank lines to a single blank line (match QC behavior)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractCleanTextFromHtml(html: string): string {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        // Unwrap Froala spacer wrappers to preserve contents
        Array.from(tmp.querySelectorAll('[class*="br-wrapper"]')).forEach(w => {
            const wrapper = w as HTMLElement;
            while (wrapper.firstChild) {
                wrapper.parentNode?.insertBefore(wrapper.firstChild, wrapper);
            }
            wrapper.remove();
        });

        // Convert <br> to newline so plain text preserves line breaks
        tmp.querySelectorAll('br').forEach(br => br.replaceWith(document.createTextNode('\n')));

        // Remove empty elements
        Array.from(tmp.querySelectorAll('*')).forEach(el => {
            const he = el as HTMLElement;
            if (he.children.length === 0 && textNorm(he.textContent) === '') he.remove();
        });

        const raw = tmp.textContent ?? '';
        return sanitiseText(raw);
    } catch (e) {
        console.debug('[KH][CopyPost] HTML clean failed, using raw text fallback:', e);
        return sanitiseText(html.replace(/<[^>]*>/g, ''));
    }
}

function extractCleanHtmlFromHtml(html: string): string {
    try {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;

        // Unwrap Froala spacer wrappers while preserving child content
        Array.from(tmp.querySelectorAll('[class*="br-wrapper"]')).forEach(w => {
            const wrapper = w as HTMLElement;
            while (wrapper.firstChild) {
                wrapper.parentNode?.insertBefore(wrapper.firstChild, wrapper);
            }
            wrapper.remove();
        });
        // Keep <br> tags in HTML to preserve visible line breaks

        // Remove empty elements
        Array.from(tmp.querySelectorAll('*')).forEach(el => {
            const he = el as HTMLElement;
            if (he.children.length === 0 && textNorm(he.textContent) === '') he.remove();
        });

        // Trim leading/trailing whitespace nodes again
        while (tmp.firstChild && nodeIsWhitespace(tmp.firstChild)) {
            tmp.removeChild(tmp.firstChild);
        }
        while (tmp.lastChild && nodeIsWhitespace(tmp.lastChild)) {
            tmp.removeChild(tmp.lastChild);
        }

        const cleaned = tmp.innerHTML.trim();
        return cleaned.length ? cleaned : '';
    } catch (e) {
        console.debug('[KH][CopyPost] HTML sanitize failed, returning original html:', e);
        return html;
    }
}

function nodeIsWhitespace(n: Node): boolean {
    return n.nodeType === Node.TEXT_NODE && !textNorm(n.textContent || '') || (n instanceof HTMLElement && n.children.length === 0 && textNorm(n.textContent) === '');
}

/* ----------  BOTTOM TOOLBAR (duplication with proxy actions)  ------------ */
/* ----------  COPY PRE/POST PROCESSORS ------------------------------------ */
function stripColorStyles(root: HTMLElement): void {
    try { console.debug('[KH][CopyPost] Stripping color and background-color styles'); } catch {}
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement;
        // Remove color attributes on tags like <font color> and style color/background
        const style = el.getAttribute('style');
        if (style) {
            // Remove color and background-color (any casing, with spaces)
            const cleaned = style
                .replace(/(?:^|;)[\s]*color\s*:[^;]*;?/gi, ';')
                .replace(/(?:^|;)[\s]*background-color\s*:[^;]*;?/gi, ';')
                .replace(/^[\s;]+|[\s;]+$/g, '')
                .replace(/;;+/g, ';');
            if (cleaned) el.setAttribute('style', cleaned); else el.removeAttribute('style');
        }
        // Legacy attributes
        if (el.hasAttribute('color')) el.removeAttribute('color');
        if (el.hasAttribute('bgcolor')) el.removeAttribute('bgcolor');
        if (el.style) {
            try { el.style.removeProperty('color'); } catch {}
            try { el.style.removeProperty('background-color'); } catch {}
        }
    }
}

function sanitizeLists(root: HTMLElement): void {
    try { console.debug('[KH][CopyPost] Sanitizing lists'); } catch {}
    // 1) Remove Froala wrappers inside lists (they cause empty items on paste)
    root.querySelectorAll('ul [class*="br-wrapper"], ol [class*="br-wrapper"]').forEach(n => n.remove());

    // 2) For each UL/OL, remove stray <br> and whitespace-only text nodes,
    //    then ensure all direct children are meaningful <li> elements.
    root.querySelectorAll('ul,ol').forEach(list => {
        // 2a) Remove direct <br> nodes and whitespace-only text nodes under the list
        try {
            Array.from(list.childNodes).forEach(n => {
                if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'BR') {
                    list.removeChild(n);
                    return;
                }
                if (n.nodeType === Node.TEXT_NODE && textNorm(n.textContent || '') === '') {
                    list.removeChild(n);
                }
            });
        } catch {}

        // 2b) Convert non-LI element children to LI only if they contain meaningful content
        const elementChildren = Array.from(list.children);
        elementChildren.forEach(ch => {
            if (ch.tagName === 'LI') return;
            const he = ch as HTMLElement;
            const text = textNorm(he.textContent);
            // If spacer-like (only whitespace/NBSP or only <br>), drop it
            const hasNonBrDescendant = he.querySelector('*:not(br)') !== null;
            if (text === '' || !hasNonBrDescendant) {
                ch.remove();
                return;
            }
            const li = document.createElement('li');
            li.innerHTML = he.innerHTML;
            list.replaceChild(li, ch);
        });
    });

    // 3) Remove empty list items (whitespace/NBSP only), regardless of wrapped spans
    root.querySelectorAll('li').forEach(li => {
        const he = li as HTMLElement;
        const t = textNorm(he.textContent);
        if (t === '') he.remove();
    });
}
function isSpacerDivLocal(el: Element): boolean {
    if (el.tagName !== 'DIV') return false;
    const he = el as HTMLElement;
    const first = he.firstElementChild as HTMLElement | null;
    if (first && first.classList.contains('br-wrapper--multiple')) return true;
    const html = he.innerHTML.trim();
    return html === '<br>' || html === '&nbsp;' || html === '\u00A0';
}

function normalizeNbspInTextNodes(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const toChange: Text[] = [];
    while (walker.nextNode()) {
        const tn = walker.currentNode as Text;
        const parent = tn.parentElement;
        if (!parent) continue;
        if (parent.closest('code,pre')) continue;
        toChange.push(tn);
    }
    toChange.forEach(tn => {
        tn.textContent = (tn.textContent || '')
            .replace(/\u00A0/g, ' ')
            .replace(/ {2,}/g, ' ');
    });
}

function preprocessForNewlineSpacer(root: HTMLElement): void {
    try { console.debug('[KH][CopyPost] Preprocess: start'); } catch {}
    root.querySelectorAll('[data-empty]').forEach(n => n.remove());
    Array.from(root.querySelectorAll('*')).forEach(el => {
        const he = el as HTMLElement;
        if (he.children.length === 0 && textNorm(he.textContent) === '') he.remove();
    });
    normalizeNbspInTextNodes(root);
    try { console.debug('[KH][CopyPost] Preprocess: done'); } catch {}
}

function dedupeSpacerBlocks(root: HTMLElement): void {
    try { console.debug('[KH][CopyPost] Dedupe spacers: start'); } catch {}
    const children = Array.from(root.children);
    for (let i = 0; i < children.length - 1; i++) {
        const a = children[i] as HTMLElement;
        const b = children[i + 1] as HTMLElement;
        if (isSpacerDivLocal(a) && isSpacerDivLocal(b)) {
            b.remove();
            i--;
        }
    }
    try { console.debug('[KH][CopyPost] Dedupe spacers: done'); } catch {}
}

// Lightweight, synchronous formatting tailored for clipboard use
function applyNewlinesLight(root: HTMLElement): void {
    try { console.debug('[KH][CopyPost] Light formatting: start'); } catch {}
    // 1) Normalize NBSPs in text nodes (outside of code/pre)
    normalizeNbspInTextNodes(root);

    // 2) Remove empty/filler nodes
    root.querySelectorAll('[data-empty]').forEach(n => n.remove());
    Array.from(root.querySelectorAll('*')).forEach(el => {
        const he = el as HTMLElement;
        if (he.children.length === 0 && textNorm(he.textContent) === '') he.remove();
    });

    // 3) Inside non-table DIVs, enforce exactly two <br> runs
    Array.from(root.querySelectorAll('div')).forEach(div => {
        const he = div as HTMLElement;
        if (he.closest('table')) return;
        if (isSpacerDivLocal(he)) return;
        let node: ChildNode | null = he.firstChild;
        while (node) {
            if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === 'BR') {
                let runStart = node;
                let count = 0;
                let ptr: ChildNode | null = node;
                while (ptr && ptr.nodeType === Node.ELEMENT_NODE && (ptr as HTMLElement).tagName === 'BR') {
                    count++;
                    ptr = ptr.nextSibling;
                }
                if (count < 2) {
                    const toAdd = 2 - count;
                    for (let i = 0; i < toAdd; i++) he.insertBefore(document.createElement('br'), ptr);
                } else if (count > 2) {
                    let excess = count - 2;
                    let removeTarget = runStart.nextSibling;
                    while (excess-- > 0 && removeTarget) {
                        const next = removeTarget.nextSibling;
                        he.removeChild(removeTarget);
                        removeTarget = next;
                    }
                }
                node = ptr;
            } else {
                node = node.nextSibling;
            }
        }
    });

    // 4) Insert simple spacer DIVs between top-level BLOCKs and before headings
    const BLOCK_SELECTOR = 'DIV,OL,UL';
    const HEADER_SELECTOR = 'H1,H2,H3,H4,H5,H6';
    const topChildren = Array.from(root.children) as HTMLElement[];
    let prevBlock: HTMLElement | null = null;
    for (const child of topChildren) {
        if (isSpacerDivLocal(child)) { prevBlock = null; continue; }
        if (child.matches(HEADER_SELECTOR)) {
            if (!child.previousElementSibling || !isSpacerDivLocal(child.previousElementSibling)) {
                const spacer = document.createElement('div');
                spacer.innerHTML = '<div class="br-wrapper br-wrapper--multiple"><br></div>';
                root.insertBefore(spacer, child);
            }
            prevBlock = null;
            continue;
        }
        if (prevBlock && child.matches(BLOCK_SELECTOR)) {
            const spacer = document.createElement('div');
            spacer.innerHTML = '<div class="br-wrapper br-wrapper--multiple"><br></div>';
            root.insertBefore(spacer, child);
        }
        prevBlock = child.matches(BLOCK_SELECTOR) ? child : null;
    }

    // 5) Dedupe consecutive spacer blocks at the top level
    dedupeSpacerBlocks(root);
    try { console.debug('[KH][CopyPost] Light formatting: done'); } catch {}
}
function buildBottomToolbar(post: HTMLElement, topMenu: HTMLElement, nativeClass: string): void {
    const existing = post.querySelector<HTMLElement>('[data-kh-bottom-menu="yes"]');
    if (existing) existing.remove();

    const messageInner = post.querySelector<HTMLElement>(MESSAGE_INNER_SEL);
    if (!messageInner) return;

    const bottomMenu = document.createElement('div');
    bottomMenu.className = topMenu.className;
    bottomMenu.setAttribute('data-kh-bottom-menu', 'yes');

    const topChildren = Array.from(topMenu.children) as HTMLElement[];

    topChildren.forEach((child, index) => {
        // Skip QCer button: it should only appear inside the PR wrapper, not in mirrored bottom menu
        if (child.classList.contains(CL_QCER_BTN)) {
            try { console.debug('[KH][BottomToolbar] Skipping QCer button in bottom toolbar mirror'); } catch {}
            return;
        }
        // Skip QC toggle (eye) button: should not appear in mirrored bottom menu
        if (child.classList.contains(CL_QC_TOGGLE_BTN)) {
            try { console.debug('[KH][BottomToolbar] Skipping QC toggle button in bottom toolbar mirror'); } catch {}
            return;
        }
        // Replace the scroll-down button with a scroll-up at the bottom
        const isScrollDown = child.classList.contains('kh-scroll-bottom-btn');
        if (isScrollDown) {
            const upBtn = document.createElement('div');
            upBtn.className = `${nativeClass}`.trim();
            upBtn.setAttribute('role', 'button');
            upBtn.setAttribute('aria-label', 'Scroll to top of post');
            upBtn.setAttribute('data-kh-scroll-up', '');
            upBtn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 5l-7 7m7-7l7 7M12 5v14" />
                </svg>
            `;
            upBtn.addEventListener('click', e => {
                e.stopPropagation();
                post.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            bottomMenu.appendChild(upBtn);
            return;
        }

        // Proxy for all other buttons
        const proxy = document.createElement('div');
        proxy.className = child.className;
        // Avoid duplicating element IDs inside inner content
        const tmp = document.createElement('div');
        tmp.innerHTML = child.innerHTML;
        tmp.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
        proxy.innerHTML = tmp.innerHTML;
        proxy.setAttribute('role', child.getAttribute('role') || 'button');
        const aria = child.getAttribute('aria-label');
        if (aria) proxy.setAttribute('aria-label', aria);
        proxy.addEventListener('click', e => {
            e.stopPropagation();
            const freshTopMenu = post.querySelector<HTMLElement>(MENU_WRAPPER_SEL)?.querySelector<HTMLElement>(FEED_MENU_SEL)
                ?? post.querySelector<HTMLElement>(MENU_WRAPPER_SEL);
            const target = freshTopMenu?.children[index] as HTMLElement | undefined;
            if (target) {
                target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } else {
                console.warn('[KH][BottomToolbar] Could not locate original button to proxy click');
            }
        });
        bottomMenu.appendChild(proxy);
    });

    messageInner.appendChild(bottomMenu);

    // Observe top menu for changes and keep mirrored toolbar in sync
    if (!post.dataset['khBottomObserver']) {
        try {
            const mo = new MutationObserver(() => {
                try { buildBottomToolbar(post, topMenu, nativeClass); } catch (e) { console.debug('[KH][BottomToolbar] rebuild failed:', e); }
            });
            mo.observe(topMenu, { childList: true });
            post.dataset['khBottomObserver'] = 'yes';
        } catch (e) {
            console.debug('[KH][BottomToolbar] observer attach failed:', e);
        }
    }
}