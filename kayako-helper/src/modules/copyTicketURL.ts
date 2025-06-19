/* src/modules/copyTicketURL.ts */

/**
 * caseIdCopy.ts
 *
 * Turns the “ticket ID” element into a smart button:
 *  – Left-click  ⇒ copies full ticket URL
 *  – Right-click ⇒ copies just the numeric ID
 *
 * Works across ticket navigations by observing the DOM for changes.
 */

const CASE_ID_SELECTOR = 'div.ko-case-content__id_11x6m5';

function attachCopyHandlers(el: HTMLElement): void {
    // Don’t double-attach if we’ve already handled this element
    if (el.dataset.copyHandlersAttached) return;
    el.dataset.copyHandlersAttached = 'true';

    // Make it feel clickable
    el.style.cursor = 'pointer';
    el.title = 'Left-click: copy URL • Right-click: copy ID';

    // Left-click → copy full URL
    el.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.href)
            .catch(err => console.error('Copy URL failed:', err));
    });

    // Right-click → copy only the numeric ID
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();                                 // stop default context menu
        const id = (el.textContent || '').replace(/[^\d]/g, '').trim();
        if (id) {
            navigator.clipboard.writeText(id)
                .catch(err => console.error('Copy ID failed:', err));
        }
    });
}

function findAndAttach(): void {
    const el = document.querySelector<HTMLElement>(CASE_ID_SELECTOR);
    if (el) attachCopyHandlers(el);
}

/**
 * Call this once from your content script.
 * It will keep working when switching between tickets.
 */
export default function bootCopyTicketURL(): void {
    // Attach immediately if the element is already present
    findAndAttach();

    // Observe future DOM mutations so we re-attach after ticket changes
    const observer = new MutationObserver(findAndAttach);
    observer.observe(document.body, { childList: true, subtree: true });
}
