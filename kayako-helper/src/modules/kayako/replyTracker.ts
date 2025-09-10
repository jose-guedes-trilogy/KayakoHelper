/* Kayako Helper – modules/kayako/replyTracker.ts
   Robust against Kayako’s SPA navigation. */

import { KAYAKO_SELECTORS } from '@/generated/selectors';
import { currentConvId }    from '@/utils/location';
import type { ToBackground } from '@/utils/messageTypes';
import { sendMessageSafe } from '@/utils/sendMessageSafe';
import { extractProductValueSafe } from '@/modules/kayako/utils/product';

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