/* turn Kayako “post” array ➜ readable chat transcript
    src/modules/kayako/buttons/copy-chat/cleanConversation.ts
   – chronological (oldest → newest)
   – includes Product name extracted from the info‑bar
   – includes Ticket ID extracted from the current URL
   – each line: timestamp, author, role, kind (Reply / Note)
   – posts separated by a clear divider                              */

const SEPARATOR = "\n[——— Post separator ———]\n";

/* ------------------------------------------------------------------ */
/** Map Kayako role.id ➜ label used in the transcript output             */
/**
 * The default role IDs that ship with Kayako are:
 * 1 – Administrator (type ADMIN)
 * 2 – Agent         (type AGENT)
 * 4 – Customer      (type CUSTOMER)
 * 5 – Legacy Agent  (historical data in some instances)
 *
 * Feel free to extend this list or override it in an env‑specific file
 * if your instance defines custom roles.
 */
export const ROLE_MAP: Record<number, string> = {
    1: "Administrator",
    2: "Agent",         // Mike Kebede and other support agents
    4: "Customer",
    5: "Agent",         // legacy fallback
};

interface Role {
    id?: number;
    title?: string;
    /**
     * Kayako REST v1 exposes the role *type* (ADMIN | AGENT | CUSTOMER).
     * We can use this as a secondary signal if the numeric id is unknown.
     */
    type?: "ADMIN" | "AGENT" | "CUSTOMER" | string;
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
    /** Present when the post was created by the ticket requester. */
    is_requester?: boolean;
}

/* ------------------------------------------------------------------ */
function roleLabel(post: Post): string {
    const role = post.creator?.role;

    // 1️⃣  Direct match using the numeric role ID
    if (role?.id && ROLE_MAP[role.id]) {
        return ROLE_MAP[role.id];
    }

    // 2️⃣  Fallback to the role *type* if provided by the API
    switch (role?.type) {
        case "AGENT":
        case "ADMIN":
            return "Agent";
        case "CUSTOMER":
            return "Customer";
    }

    // 3️⃣  Infer from requester flag when everything else fails
    return post.is_requester ? "Requester" : "User";
}

function kindLabel(post: Post): "NOTE" | "REPLY" {
    return post.original?.resource_type === "note" ? "NOTE" : "REPLY";
}

/* ------------------------------------------------------------------ */
/** Attempt to read the “Product” field that lives in the info‑bar */
function detectProduct(): string {
    try {
        // Each trigger container holds the header + placeholder/input
        const triggers = Array.from(
            document.querySelectorAll<HTMLElement>(
                '[class*="ko-info-bar_field_select_trigger__trigger_"]'
            )
        );

        for (const trigger of triggers) {
            // 1) Locate the header span inside this trigger
            const header = trigger.querySelector<HTMLElement>(
                '[class*="ko-info-bar_field_select_trigger__header_"]'
            );
            if (!header) continue;

            if (header.textContent?.trim() !== "Product") {
                continue; // not the Product field
            }

            // 2) Fetch the placeholder span (shows the selected value)
            const placeholder = trigger.querySelector<HTMLElement>(
                '[class*="ko-info-bar_field_select_trigger__placeholder_"]'
            );
            if (!placeholder) return "Unknown product";

            // The visible text may be inside nested spans or only in the title attr
            const textContent = placeholder.textContent?.trim();
            const title = placeholder.getAttribute("title")?.trim();

            const value = (textContent?.length ? textContent : title) ?? "";
            return value || "Unknown product";
        }

        return "Unknown product";
    } catch (err) {
        console.error("[cleanConversation] detectProduct failed", err);
        return "Unknown product";
    }
}

/* ------------------------------------------------------------------ */
/** Extract the ticket ID from the current URL */
function detectTicketId(): string {
    try {
        const match = window.location.pathname.match(/\/conversations\/(\d+)/);
        return match ? match[1] : "Unknown ID";
    } catch (err) {
        console.error("[cleanConversation] detectTicketId failed", err);
        return "Unknown ID";
    }
}

/* ------------------------------------------------------------------ */
export function cleanConversation(posts: Post[]): string {
    const ticketID = `Ticket ID: ${detectTicketId()}`;
    const ticketProduct = `Product: ${detectProduct()}`;

    const ticketInformation = `${ticketID} - ${ticketProduct}`;

    const lines = posts
        .sort(
            (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        )
        .map((p) => {
            const ts = new Date(p.created_at).toLocaleString();
            const who = p.creator?.full_name ?? "Unknown";
            const role = roleLabel(p);
            const kind = kindLabel(p);

            const body = (p.contents ?? "")
                .replace(/\r?\n/g, " ") // single‑line
                .replace(/\s+/g, " ") // collapse whitespace
                .trim();

            return `[${ts}] ${who} (${role}, ${kind}):\n${body}`;
        });

    return [ticketInformation, ...lines].join(SEPARATOR);
}
