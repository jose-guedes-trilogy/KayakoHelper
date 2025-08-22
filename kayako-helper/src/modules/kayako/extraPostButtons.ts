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

    /* ───── scroll-to-top button ───── */
    const scrollBtn = document.createElement('button');
    scrollBtn.className   = CL_SCROLL_BTN;
    scrollBtn.title       = 'Scroll to top of post';
    scrollBtn.innerHTML = '<span>↑</span>';
    scrollBtn.addEventListener('click', e => {
        e.stopPropagation();
        post.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const messageInner = post.querySelector<HTMLElement>(MESSAGE_INNER_SEL);
    messageInner?.append(scrollBtn);

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
        const contentEl = post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);
        const text = (contentEl?.textContent ?? '').trim();
        navigator.clipboard.writeText(text).catch(console.error);
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

    // ───── intelligent visibility based on post height ─────
    const MIN_HEIGHT_FOR_SCROLL_BUTTONS = 350; // px – hide when not tall enough
    const getContentInner = () => post.querySelector<HTMLElement>(MESSAGE_INNER_CONTENT_SEL);

    const updateButtonsVisibility = () => {
        const inner = getContentInner();
        const isTall = !!inner && inner.getBoundingClientRect().height >= MIN_HEIGHT_FOR_SCROLL_BUTTONS;

        const display = isTall ? '' : 'none';
        scrollBtn.style.display = display;
        scrollDownBtn.style.display = display;
        scrollBtn.setAttribute('aria-hidden', String(!isTall));
        scrollDownBtn.setAttribute('aria-hidden', String(!isTall));
    };

    // Observe size changes and run an initial check
    const ro = new ResizeObserver(updateButtonsVisibility);
    const innerNow = getContentInner();
    if (innerNow) ro.observe(innerNow);
    window.addEventListener('resize', updateButtonsVisibility, { passive: true });
    updateButtonsVisibility();
}