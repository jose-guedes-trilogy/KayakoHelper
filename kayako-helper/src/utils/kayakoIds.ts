/* Kayako Helper – kayakoIds.ts
   Utility to derive a stable ticket/conversation id for per-ticket channel mapping. */

export function currentKayakoTicketId(): string {
  try {
    // /agent/conversations/12345 (common Kayako pattern)
    const p = location.pathname.match(/\/conversations\/(\d+)/i);
    if (p?.[1]) return p[1];
  } catch {}

  try {
    // ?conversation_id=12345 or ?ticket_id=12345
    const q = location.search.match(/[?&](?:conversation|ticket)_id=(\d+)/i);
    if (q?.[1]) return q[1];
  } catch {}

  try {
    // DOM hint (if your content script injects one)
    const el = document.querySelector("[data-conversation-id]");
    const v = el ? (el as HTMLElement).getAttribute("data-conversation-id") : null;
    if (v) return v;
  } catch {}

  return "";
}
