/* Kayako Helper – src/background/replyDataBg.ts */

import type { ToBackground, FromBackground } from '@/utils/messageTypes';

export interface TicketData {
    count  : number;
    name   : string;
    email  : string;
    subject: string;
    notes ?: string;
    product?: string;
    lastAccess: number;
    bookmarked?: boolean;
}

const STORAGE_KEY = 'ticketData';

/* ─ persistence ─ */
async function load(): Promise<Record<string, TicketData>> {
    return new Promise(res =>
        chrome.storage.local.get(STORAGE_KEY, r =>
            res((r[STORAGE_KEY] as Record<string, TicketData>) ?? {}),
        ),
    );
}
function save(tickets: Record<string, TicketData>): void {
    chrome.storage.local.set({ [STORAGE_KEY]: tickets });
}

/* ─ in-memory cache ─ */
let tickets: Record<string, TicketData> = {};
load().then(t => (tickets = t));

/* ─ message hub ─ */
chrome.runtime.onMessage.addListener((msg: ToBackground) => {
    switch (msg.action) {
        /* visited stub (always runs first) */
        case 'visitTicket': {
            const now  = Date.now();
            const base = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '' , lastAccess: now, bookmarked: false };
            tickets[msg.ticketId] = { ...base, lastAccess: now };
            save(tickets);
            break;
        }

        /* metadata */
        case 'saveMetadata': {
            const t = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '', product: '', lastAccess: Date.now(), bookmarked: false };
            tickets[msg.ticketId] = {
                ...t,
                name:    msg.name    || t.name,
                email:   msg.email   || t.email,
                subject: msg.subject || t.subject,
                product: msg.product ?? t.product,
            };
            save(tickets);
            break;
        }

        /* notes */
        case 'saveNotes': {
            const t = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '', lastAccess: Date.now(), bookmarked: false };
            tickets[msg.ticketId] = { ...t, notes: msg.notes };
            save(tickets);
            break;
        }

        /* reply counter */
        case 'incrementReply': {
            const t = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '', lastAccess: Date.now(), bookmarked: false };
            tickets[msg.ticketId] = { ...t, count: t.count + 1 };
            save(tickets);
            break;
        }

        /* bookmark toggle */
        case 'setBookmark': {
            const t = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '', lastAccess: Date.now(), bookmarked: false };
            tickets[msg.ticketId] = { ...t, bookmarked: !!msg.bookmarked };
            save(tickets);
            // Broadcast updated list so popup can refresh
            chrome.runtime.sendMessage<FromBackground>({ action: 'allTickets', tickets });
            break;
        }

        /* stats for one */
        case 'getStats': {
            const t = tickets[msg.ticketId] ?? { count: 0, name: '', email: '', subject: '', notes: '', product: '', lastAccess: 0, bookmarked: false };
            chrome.runtime.sendMessage<FromBackground>({
                action : 'stats',
                ticketId: msg.ticketId,
                count : t.count,
                name  : t.name,
                email : t.email,
                subject: t.subject,
                notes : t.notes ?? '',
                product: t.product,
                lastAccess: t.lastAccess,
                bookmarked: !!t.bookmarked,
            });
            break;
        }

        /* full list */
        case 'getAllTickets': {
            chrome.runtime.sendMessage<FromBackground>({ action: 'allTickets', tickets });
            break;
        }

        /* delete */
        case 'deleteTicket': {
            delete tickets[msg.ticketId];
            save(tickets);
            chrome.runtime.sendMessage<FromBackground>({ action: 'allTickets', tickets });
            break;
        }
    }
});
