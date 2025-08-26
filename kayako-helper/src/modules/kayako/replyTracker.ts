/* Kayako Helper – modules/kayako/replyTracker.ts
   Robust against Kayako’s SPA navigation. */

import { KAYAKO_SELECTORS } from '@/generated/selectors';
import { currentConvId }    from '@/utils/location';
import type { ToBackground } from '@/utils/messageTypes';

export function bootReplyTracker(): void {
    /* guard for the correct host */
    if (!/central-supportdesk\.kayako\.com$/.test(window.location.hostname)) return;

    let activeTicketId: string | null = null;
    let metaObserver: MutationObserver | null = null;
    let lastSent: { name: string; email: string; subject: string; product: string } = { name: '', email: '', subject: '', product: '' };

    /* single click listener for all tickets */
    document.addEventListener(
        'click',
        e => {
            const btn = (e.target as Element).closest(KAYAKO_SELECTORS.sendButtonPublicReply) as Element | null;
            if (!btn || !activeTicketId) return;
            chrome.runtime.sendMessage<ToBackground>({ action: 'incrementReply', ticketId: activeTicketId });
        },
        true,
    );

    /* initialise capture for whichever ticket is showing */
    const initForTicket = (ticketId: string) => {
        activeTicketId = ticketId;

        /* make sure it’s registered as visited immediately */
        chrome.runtime.sendMessage<ToBackground>({ action: 'visitTicket', ticketId });

        /* stop previous observer */
        metaObserver?.disconnect();

        /* fresh metadata grabber */
        const trySave = () => {
            const name    = document.querySelector(KAYAKO_SELECTORS.requesterName )?.textContent?.trim() || '';
            const email   = document.querySelector(KAYAKO_SELECTORS.requesterEmail)?.textContent?.trim() || '';
            const subject = document.querySelector(KAYAKO_SELECTORS.ticketSubject)?.textContent?.trim() || '';

            // Attempt to extract Product from side info bar (resilient selectors + text sniffing)
            const product = extractProductValueSafe();

            if (!name && !email && !subject && !product) return;

            // Only send if changed since last dispatch
            if (name === lastSent.name && email === lastSent.email && subject === lastSent.subject && product === lastSent.product) return;

            try { console.debug('[KH] replyTracker.saveMetadata', { ticketId, name, email, subject, product }); } catch {}
            chrome.runtime.sendMessage<ToBackground>({ action: 'saveMetadata', ticketId, name, email, subject, product });
            lastSent = { name, email, subject, product };
        };
        trySave();
        metaObserver = new MutationObserver(() => { trySave(); });
        metaObserver.observe(document.body, { childList: true, subtree: true });
    };

    /* watch for SPA url changes (simple polling is enough) */
    const tick = () => {
        const id = currentConvId();
        if (id && id !== activeTicketId) initForTicket(id);
    };
    tick();                            // first run
    setInterval(tick, 800);            // thereafter
}

/**
 * Extracts the Product field value from the ticket side panel using resilient selectors.
 * This avoids brittle text-based selectors by anchoring to the generic custom-field container
 * and then identifying the specific field by its visible header text ("Product").
 */
function extractProductValueSafe(): string {
    try {
        // Locate the header labeled "Product"
        const headers = Array.from(document.querySelectorAll<HTMLElement>(KAYAKO_SELECTORS.customFieldContainer));
        const productHeader = headers.find(h => /\bproduct\b/i.test(h.textContent || ''));
        if (!productHeader) return '';

        // Prefer the power-select field root if present; fallback to generic field container
        const fieldRoot = (productHeader.closest('[class*="ko-info-bar_field_select__power-select_"]') as HTMLElement | null)
            || (productHeader.closest(KAYAKO_SELECTORS.fieldContainer as string) as HTMLElement | null)
            || productHeader.parentElement;
        if (!fieldRoot) return '';

        // Common value renderers
        const pillVals = Array.from(fieldRoot.querySelectorAll<HTMLElement>('[class*="ko-select_multiple_pill__pill_"]'))
            .map(el => (el.textContent || '').trim()).filter(Boolean);
        if (pillVals.length) return pillVals.join(', ');

        const selectedItem = fieldRoot.querySelector<HTMLElement>('[class*="ember-power-select-selected-item"], [class*="selected-item"]');
        if (selectedItem) {
            const txt = (selectedItem.textContent || '').replace(/\bProduct\b/i, '').trim();
            if (txt) return txt;
        }

        const trigger = fieldRoot.querySelector<HTMLElement>(KAYAKO_SELECTORS.fieldSelectTrigger || '[class*="ko-info-bar_field_select_trigger__trigger_"]');
        if (trigger) {
            // Preferred: dedicated placeholder span shows the current value; title attr often mirrors it
            const placeholder = trigger.querySelector<HTMLElement>('[class*="ko-info-bar_field_select_trigger__placeholder_"]');
            if (placeholder) {
                const placeholderText = (placeholder.textContent || '').trim();
                const placeholderTitle = (placeholder.getAttribute('title') || '').trim();
                const best = placeholderText || placeholderTitle;
                if (best) return best;
            }

            // Fallback: extract text from trigger, minus header label and common UI words
            const raw = (trigger.textContent || '')
                .replace(/\bProduct\b/i, '')
                .replace(/Search|Type to search|Clear/gi, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (raw) return raw;
        }

        // Heuristic fallback: take non-empty longest token from root text minus header
        const combined = (fieldRoot.textContent || '').replace(/\bProduct\b/i, '').trim();
        const parts = combined.split(/\s{2,}|\n+/).map(s => s.trim()).filter(Boolean);
        const best = parts.sort((a, b) => b.length - a.length)[0];
        return best || '';
    } catch (_e) {
        try { console.debug('[KH] replyTracker.extractProductValueSafe error', _e); } catch {}
        return '';
    }
}
