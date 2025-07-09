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
        let sentOnce = false;
        const trySave = () => {
            const name    = document.querySelector(KAYAKO_SELECTORS.requesterName )?.textContent?.trim() || '';
            const email   = document.querySelector(KAYAKO_SELECTORS.requesterEmail)?.textContent?.trim() || '';
            const subject = document.querySelector(KAYAKO_SELECTORS.ticketSubject)?.textContent?.trim() || '';
            if (!name && !email && !subject) return;

            chrome.runtime.sendMessage<ToBackground>({
                action  : 'saveMetadata',
                ticketId,
                name,
                email,
                subject,
            });
            sentOnce = true;
        };
        trySave();
        metaObserver = new MutationObserver(() => { if (!sentOnce) trySave(); });
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
