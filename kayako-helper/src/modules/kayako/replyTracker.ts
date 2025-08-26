/* Kayako Helper – modules/kayako/replyTracker.ts
   Robust against Kayako’s SPA navigation. */

import { KAYAKO_SELECTORS } from '@/generated/selectors';
import { currentConvId }    from '@/utils/location';
import type { ToBackground } from '@/utils/messageTypes';
import { sendMessageSafe } from '@/utils/sendMessageSafe';

// use shared sendMessageSafe

export function bootReplyTracker(): void {
    /* guard for the correct host */
    if (!/\.kayako\.com$/.test(window.location.hostname)) return;
    try { console.debug('[KH] replyTracker active on host', window.location.hostname); } catch {}

    let activeTicketId: string | null = null;
    let metaObserver: MutationObserver | null = null;
    let tickIntervalId: number | null = null;
    let rafId: number | null = null;
    let shuttingDown = false;
    let lastSent: { name: string; email: string; subject: string; product: string } = { name: '', email: '', subject: '', product: '' };

    const teardown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try { console.debug('[KH] replyTracker.teardown start'); } catch {}
        try { metaObserver?.disconnect(); } catch {}
        metaObserver = null;
        if (rafId !== null) {
            try { cancelAnimationFrame(rafId); } catch {}
            rafId = null;
        }
        if (tickIntervalId !== null) {
            try { clearInterval(tickIntervalId); } catch {}
            tickIntervalId = null;
        }
        activeTicketId = null;
        try { console.debug('[KH] replyTracker.teardown done'); } catch {}
    };

    /* single click listener for all tickets */
    document.addEventListener(
        'click',
        e => {
            if (shuttingDown) return;
            const btn = (e.target as Element).closest(KAYAKO_SELECTORS.sendButtonPublicReply) as Element | null;
            if (!btn || !activeTicketId) return;
            try {
                sendMessageSafe<ToBackground>({ action: 'incrementReply', ticketId: activeTicketId });
            } catch (err) {
                try { console.debug('[KH] replyTracker.incrementReply error', err); } catch {}
            }
        },
        true,
    );

    /* initialise capture for whichever ticket is showing */
    const initForTicket = (ticketId: string) => {
        activeTicketId = ticketId;

        /* make sure it’s registered as visited immediately */
        try {
            sendMessageSafe<ToBackground>({ action: 'visitTicket', ticketId });
        } catch (err) {
            try { console.debug('[KH] replyTracker.visitTicket error', err); } catch {}
        }

        /* stop previous observer */
        metaObserver?.disconnect();

        /* fresh metadata grabber with rAF debounce */
        const performSaveIfChanged = () => {
            if (shuttingDown) return;
            try {
                const name    = document.querySelector(KAYAKO_SELECTORS.requesterName )?.textContent?.trim() || '';
                const email   = document.querySelector(KAYAKO_SELECTORS.requesterEmail)?.textContent?.trim() || '';
                const subject = document.querySelector(KAYAKO_SELECTORS.ticketSubject)?.textContent?.trim() || '';

                const product = extractProductValueSafe();

                if (!name && !email && !subject && !product) return;
                if (name === lastSent.name && email === lastSent.email && subject === lastSent.subject && product === lastSent.product) return;

                try { console.debug('[KH] replyTracker.saveMetadata', { ticketId, name, email, subject, product }); } catch {}
                try {
                    sendMessageSafe<ToBackground>({ action: 'saveMetadata', ticketId, name, email, subject, product });
                } catch (err) {
                    try { console.debug('[KH] replyTracker.saveMetadata error', err); } catch {}
                }
                lastSent = { name, email, subject, product };
            } catch (err) {
                try { console.debug('[KH] replyTracker.performSaveIfChanged error', err); } catch {}
            }
        };
        const scheduleSave = () => {
            if (shuttingDown) return;
            if (rafId !== null) {
                try { cancelAnimationFrame(rafId); } catch {}
                rafId = null;
            }
            try {
                rafId = requestAnimationFrame(() => {
                    rafId = null;
                    performSaveIfChanged();
                });
            } catch (err) {
                // As a fallback, run synchronously
                rafId = null;
                performSaveIfChanged();
            }
        };

        scheduleSave();
        metaObserver = new MutationObserver(() => { scheduleSave(); });
        metaObserver.observe(document.body, { childList: true, subtree: true });
    };

    /* watch for SPA url changes (simple polling is enough) */
    const tick = () => {
        const id = currentConvId();
        if (id && id !== activeTicketId) initForTicket(id);
    };
    tick();                            // first run
    tickIntervalId = setInterval(tick, 800) as unknown as number;            // thereafter

    // Ensure we cleanup on unload/navigation
    window.addEventListener('pagehide', teardown, { once: true });
    window.addEventListener('beforeunload', teardown, { once: true });
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
