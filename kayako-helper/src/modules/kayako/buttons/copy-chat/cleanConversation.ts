// modules/cleanConversation.ts

/* turn Kayako “post” array ➜ readable chat transcript
   – chronological (oldest → newest)
   – includes Product name extracted from the info-bar
   – includes Ticket ID extracted from the current URL
   – each line: timestamp, author, role, kind (Reply / Note)
   – posts separated by a clear divider                               */

import {KAYAKO_SELECTORS} from "@/generated/selectors.ts";

const SEPARATOR = '\n[——— Post separator ———]\n';

/* optional helper: map role.id → label you prefer */
const ROLE_MAP: Record<number, string> = {
    5: 'Agent',
    4: 'Customer',
};

interface Role {
    id?: number;
}

interface Creator {
    full_name?: string;
    role?: Role;
}

interface Original {
    resource_type?: string;
}

export interface Post {
    created_at: string;
    creator?: Creator;
    original?: Original;
    contents?: string;
    is_requester?: boolean;
}

function roleLabel(post: Post): string {
    const id = post.creator?.role?.id;
    if (id && ROLE_MAP[id]) {
        return ROLE_MAP[id];
    }
    return post.is_requester ? 'Requester' : 'User';
}

function kindLabel(post: Post): 'NOTE' | 'REPLY' {
    return post.original?.resource_type === 'note' ? 'NOTE' : 'REPLY';
}

/* ------------------------------------------------------------------ */
/** Attempt to read the “Product” field that lives in the info-bar */
function detectProduct(): string {
    try {
        // Each trigger container holds the header + placeholder/input
        const triggers = Array.from(
            document.querySelectorAll<HTMLElement>('[class*="ko-info-bar_field_select_trigger__trigger_"]')
        );

        for (const trigger of triggers) {
            // 1) Locate the header span inside this trigger
            const header = trigger.querySelector<HTMLElement>(
                '[class*="ko-info-bar_field_select_trigger__header_"]'
            );
            if (!header) continue;

            if (header.textContent?.trim() !== 'Product') {
                continue; // not the Product field
            }

            // 2) Fetch the placeholder span (shows the selected value)
            const placeholder = trigger.querySelector<HTMLElement>(
                '[class*="ko-info-bar_field_select_trigger__placeholder_"]'
            );
            if (!placeholder) return 'Unknown product';

            // The visible text may be inside nested spans or only in the title attr
            const textContent = placeholder.textContent?.trim();
            const title = placeholder.getAttribute('title')?.trim();

            const value = (textContent?.length ? textContent : title) ?? '';
            return value || 'Unknown product';
        }

        return 'Unknown product';
    } catch (err) {
        console.error('[cleanConversation] detectProduct failed', err);
        return 'Unknown product';
    }
}

/* ------------------------------------------------------------------ */
/** Extract the ticket ID from the current URL */
function detectTicketId(): string {
    try {
        const match = window.location.pathname.match(/\/conversations\/(\d+)/);
        return match ? match[1] : 'Unknown ID';
    } catch (err) {
        console.error('[cleanConversation] detectTicketId failed', err);
        return 'Unknown ID';
    }
}

/* ------------------------------------------------------------------ */
export function cleanConversation(posts: Post[]): string {
    const ticketID  = `Ticket ID: ${detectTicketId()}`;
    const ticketProduct = `Product: ${detectProduct()}`;

    const ticketInformation = `${ticketID} - ${ticketProduct}`;

    const lines = posts
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((p) => {
            const ts = new Date(p.created_at).toLocaleString();
            const who = p.creator?.full_name ?? 'Unknown';
            const role = roleLabel(p);
            const kind = kindLabel(p);

            const body = (p.contents ?? '')
                .replace(/\r?\n/g, ' ')   // single-line
                .replace(/\s+/g, ' ')     // collapse whitespace
                .trim();

            return `[${ts}] ${who} (${role}, ${kind}):\n${body}`;
        });

    return [ticketInformation,  ...lines].join(SEPARATOR);
}
