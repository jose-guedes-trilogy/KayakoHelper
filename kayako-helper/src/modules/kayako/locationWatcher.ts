import {ToBackground} from "@/utils/messageTypes.ts";

/** Detects ticket-ID changes no matter how Kayako navigates (SPA or full load). */
export function bootLocationWatcher() {
    let lastTicketId: string | null = null;

    const check = () => {
        const m = location.pathname.match(/\/conversations?\/(\d+)/i);
        const id = m ? m[1] : null;
        if (id && id !== lastTicketId) {
            lastTicketId = id;
            chrome.runtime.sendMessage<ToBackground>({ action: 'visitTicket', ticketId: id });
        }
    };

    // Initial run
    check();

    // History API overrides (SPA navigations)
    ['pushState', 'replaceState'].forEach(fn => {
        const original = (history as any)[fn];
        (history as any)[fn] = function (...args: any[]) {
            original.apply(this, args);
            check();
        };
    });

    // Back/forward buttons
    window.addEventListener('popstate', check);

    // Fallback: observe DOM mutations (layout pushes sometimes change URL late)
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true });
}
