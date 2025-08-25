/* ============================================================================
 * Kayako Helper – “Scroll-to-Top” & “Copy Post” buttons
 * ========================================================================= */

import { KAYAKO_SELECTORS, EXTENSION_SELECTORS } from '@/generated/selectors.ts';

/* ----------  SELECTORS  -------------------------------------------------- */

const MESSAGE_SEL       = KAYAKO_SELECTORS.messageOrNote;
const MESSAGE_INNER_SEL       = KAYAKO_SELECTORS.timelineItemContent;
const MESSAGE_INNER_CONTENT_SEL       = KAYAKO_SELECTORS.timelineItemContentInner;
const MENU_WRAPPER_SEL  = KAYAKO_SELECTORS.timelineItemActionButtonsWrapper;
const FEED_MENU_SEL     = KAYAKO_SELECTORS.feedItemMenu;

/* ----------  CLASS NAMES  ------------------------------------------------ */

const CL_SCROLL_BTN = EXTENSION_SELECTORS.scrollTopButton.replace(/^\./, '');
const CL_COPY_BTN   = EXTENSION_SELECTORS.copyPostButton.replace(/^\./, '');

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
    copyBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" stroke="#838D94" fill="transparent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
        </svg>
    `;
    copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        try {
            const contentEl = post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);
            if (!contentEl) {
                console.warn('[KH][CopyPost] Post content element not found');
                return;
            }

            const sourceHtml = contentEl.innerHTML;
            const cleanedHtml = extractCleanHtmlFromHtml(sourceHtml);
            const cleanedText = extractCleanTextFromHtml(cleanedHtml);

            if (window.ClipboardItem) {
                const data = new Map<string, Blob>();
                data.set('text/html', new Blob([cleanedHtml], { type: 'text/html' }));
                data.set('text/plain', new Blob([cleanedText], { type: 'text/plain' }));
                navigator.clipboard.write([new window.ClipboardItem(data as any)])
                    .then(() => {
                        console.debug('[KH][CopyPost] Copied HTML + plain text', { htmlLen: cleanedHtml.length, textLen: cleanedText.length });
                    })
                    .catch(err => {
                        console.error('[KH][CopyPost] Failed to write rich clipboard, falling back to text', err);
                        navigator.clipboard.writeText(cleanedText).catch(console.error);
                    });
            } else {
                navigator.clipboard.writeText(cleanedText).catch(console.error);
            }
        } catch (err) {
            console.error('[KH][CopyPost] Unexpected error preparing copy text', err);
        }
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

        // Remove Froala spacer wrappers and <br> which often introduce extra blank lines
        tmp.querySelectorAll('[class*="br-wrapper"]').forEach(n => n.remove());
        tmp.querySelectorAll('br').forEach(n => n.remove());

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

        // Remove Froala spacer wrappers and <br> which often introduce extra blank lines
        tmp.querySelectorAll('[class*="br-wrapper"]').forEach(n => n.remove());
        tmp.querySelectorAll('br').forEach(n => n.remove());

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