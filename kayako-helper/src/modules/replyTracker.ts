import {
    KAYAKO_SELECTORS,
} from '@/generated/selectors';
import { currentConvId } from '@/utils/location';
import type { ToBackground } from '@/messageTypes';

export function bootReplyTracker() {
    const ALLOWED_HOSTNAME = 'central-supportdesk.kayako.com';

    if (window.location.hostname !== ALLOWED_HOSTNAME) {
        return;
    }

    const ticketId = currentConvId();
    if (!ticketId) {
        return;
    }

    // Save metadata once
    const name = document.querySelector(KAYAKO_SELECTORS.requesterName)?.textContent?.trim() || '';
    const email = document.querySelector(KAYAKO_SELECTORS.requesterEmail)?.textContent?.trim() || '';
    const subject = document.querySelector(KAYAKO_SELECTORS.ticketSubject)?.textContent?.trim() || '';

    chrome.runtime.sendMessage(<ToBackground>{
        action: 'saveMetadata',
        ticketId,
        name,
        email,
        subject
    });

    document.addEventListener('click', e => {
        const btn = (e.target as Element)
            .closest(KAYAKO_SELECTORS.sendButtonReply) as Element | null;
        if (!btn) return;
        chrome.runtime.sendMessage(<ToBackground>{
            action: 'incrementReply',
            ticketId
        });
    }, true);
}