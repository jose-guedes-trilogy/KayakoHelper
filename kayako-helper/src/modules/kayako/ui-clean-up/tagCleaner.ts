/* ============================================================================
 * src/modules/ui-clean-up/tagCleaner.ts
 *
 * Kayako Tag-Diff Cleaner – v3.6  (multi-tab aware, **no request caching**)
 * – Watches History-API, popstate and a tiny location-poller to detect
 *   ticket switches reliably even when Kayako patches history after us.
 * – Always waits for a fresh network response (or falls back to bulk fetch);
 *   nothing is cached across tab switches.
 * – Listens for repeated POSTS_JSON messages (first page + limit-100 follow-up).
 * ========================================================================== */

interface Action {
    id: number;
    action: "CREATED" | "UPDATED" | "DELETED";
    field: "tags" | "name";
    old_value: string | null;
    new_value: string | null;
}

/* ---------- per-ticket state ------------------------------------------- */
const actions = new Map<string, Action[]>();
let currentCaseId: string | null = getCaseId();
let ready = false;
const waiters: Array<() => void> = [];
let fallbackId: number | undefined;

/* ---------- helpers ---------------------------------------------------- */
const readyNow = () => {
    ready = true;
    waiters.splice(0).forEach(fn => fn());
};
const waitReady = () =>
    ready ? Promise.resolve() : new Promise<void>(r => waiters.push(r));
const split  = (s: string | null) => [...new Set((s ?? "").split(",").map(t => t.trim()).filter(Boolean))];
const diff   = (o: string | null, n: string | null) => ({
    added  : split(n).filter(t => !split(o).includes(t)),
    removed: split(o).filter(t => !split(n).includes(t)),
});
const COLOR_ADD = "hsl(133 54% 34% / 1)";
const COLOR_REM = "hsl(8 52% 50% / 1)";
const html = (d: { added: string[]; removed: string[] }) =>
    [ d.added.length  ? `added tag${d.added.length  > 1 ? "s" : ""} <b style="color:${COLOR_ADD}">${d.added.join(", ")}</b>` : "",
        d.removed.length? `removed tag${d.removed.length> 1 ? "s" : ""} <b style="color:${COLOR_REM}">${d.removed.join(", ")}</b>` : ""
    ].filter(Boolean).join("&nbsp;");

const meta      = (n: string) => document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content ?? null;
const cookieVal = (k: string) =>
    decodeURIComponent((document.cookie.match(new RegExp(`(?:^|;\\s*)${k.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")}=([^;]+)`)) ?? [])[1] ?? "");
const apiToken  = meta("api-token")  ?? meta("x-api-token");
const csrfToken = meta("csrf-token") ?? meta("x-csrf-token") ?? cookieVal("csrf_token");
const sessionId = meta("session-id") ?? cookieVal("novo_sessionid");

const POST_SEL = '[class*="ko-timeline-2_list_post__post_"]';

function getCaseId(): string | null {
    return location.pathname.match(/\/conversations\/(\d+)\b/)?.[1] ?? null;
}

/* ---------- ingest(): post → activity → action ------------------------ */
function ingest(json: any): void {
    if (!currentCaseId) return;

    const acts: Record<string, Action> = json?.resources?.action  ?? json?.resources?.actions ?? {};
    const avts: Record<string, any>    = json?.resources?.activity ?? {};
    const posts: any[] = Array.isArray(json?.data) ? json.data : [];

    let tagCount = 0;
    for (const post of posts) {
        const postId = String(post.id);
        const actId  = post.original?.id;
        if (!actId) continue;

        const activity = avts[String(actId)];
        if (!activity || !Array.isArray(activity.actions)) continue;

        const tagActs: Action[] = activity.actions
            .map((ref: any) => acts[String(ref.id)])
            .filter((a: Action | undefined): a is Action => !!a && (a.field === "tags" || a.field === "name"));

        if (tagActs.length) {
            actions.set(postId, tagActs);
            tagCount += tagActs.length;
        }
    }
}

/* ---------- fallback bulk fetch (used when injector JSON never arrives) */
async function fetchAllPages(): Promise<void> {
    const caseId = getCaseId();
    if (!caseId) { readyNow(); return; }

    let url: string | null =
        `${location.origin}/api/v1/cases/${caseId}/posts` +
        "?include=attachment,case_message,channel,post,user,identity_phone," +
        "identity_email,identity_twitter,identity_facebook,note,activity," +
        "chat_message,facebook_message,twitter_tweet,twitter_message," +
        "comment,event,action,trigger,monitor,engagement,sla_version," +
        "activity_object,rating,case_status,activity_actor" +
        "&fields=%2Boriginal(%2Bobject(%2Boriginal(%2Bform(-fields))))," +
        "%2Boriginal(%2Bobject(%2Boriginal(-custom_fields)))&filters=all" +
        "&include=*&limit=50";

    const hdrs: RequestInit = {
        credentials: "include",
        headers: {
            Accept: "application/json",
            "X-Options": "flat",
            "X-Requested-With": "XMLHttpRequest",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
            ...(apiToken ? { "X-API-Token": apiToken } : {}),
            ...(sessionId ? { "X-Session-Id": sessionId } : {}),
        },
    };

    let pages = 0;
    while (url) {
        const res = await fetch(url, hdrs);
        if (!res.ok) { break; }
        ingest(await res.json());
        url = res.headers.get("x-next-url") || null;
        if (url && !url.startsWith("http")) url = location.origin + url;
        pages++;
    }
    readyNow();
}

/* ---------- DOM decoration ------------------------------------------- */
function decorate(post: HTMLElement, acts: Action[]): void {
    if (!acts.length) return;

    const box = post.querySelector<HTMLElement>('[class*="ko-timeline-2_list_activity_standard__activity-text_"]');
    if (!box || box.dataset.tagCleaned) return;

    const base  = acts.reduce<Action>((p,c) => ({ ...c, old_value: p.old_value ?? c.old_value }), acts[acts.length - 1]);
    const delta = diff(base.old_value, base.new_value);

    if (!delta.added.length && !delta.removed.length) return;

    /* hide default text and prepend nicer diff-summary */
    box.querySelectorAll<HTMLSpanElement>("span").forEach(
        s => /tags/i.test(s.textContent ?? "") && (s.style.display = "none")
    );

    const span = document.createElement("span");
    span.className = "ktc-diff";
    span.innerHTML = html(delta);
    span.style.whiteSpace = "wrap";
    box.prepend(span);
    box.dataset.tagCleaned = "true";
}

async function handle(post: HTMLElement): Promise<void> {
    const id = post.dataset.id ?? post.getAttribute("data-id");
    if (!id) return;
    await waitReady();
    decorate(post, actions.get(id) ?? []);
}

/* ---------- ticket-switch detection ----------------------------------- */
/* --- replace resetForCase() with the patched version ------------------- */
function resetForCase(newId: string | null): void {
    if (newId === currentCaseId) return;

    currentCaseId = newId;
    ready = false;
    actions.clear();
    clearFallbackTimer();
    startFallbackTimer();

    /* 🆕 re-process posts that are already in the DOM for the (re)opened case */
    document.querySelectorAll<HTMLElement>(POST_SEL).forEach(handle);
}


/* 1️⃣ History-API / popstate hooks */
function installUrlWatcher(): void {
    (["pushState", "replaceState"] as const).forEach(fn => {
        const orig = history[fn];
        history[fn] = function (...a: Parameters<typeof history.pushState>) {
            const rv = orig.apply(this, a);
            window.dispatchEvent(new Event("ktc:url-change"));
            return rv;
        };
    });
    window.addEventListener("popstate", () =>
        window.dispatchEvent(new Event("ktc:url-change"))
    );
    window.addEventListener("ktc:url-change", () =>
        resetForCase(getCaseId())
    );
}

/* 2️⃣ 500 ms location-poll fallback */
function installLocationPoller(): void {
    let lastPath = location.pathname;
    setInterval(() => {
        if (location.pathname !== lastPath) {
            lastPath = location.pathname;
            resetForCase(getCaseId());
        }
    }, 500);
}

/* ---------- fallback timer helpers ------------------------------------ */
function clearFallbackTimer(): void {
    if (fallbackId !== undefined) { clearTimeout(fallbackId); fallbackId = undefined; }
}
function startFallbackTimer(delay = 150 ): void {
    clearFallbackTimer();
    fallbackId = window.setTimeout(() => {
        fetchAllPages().catch(err => console.error("[KTC] bulk fetch failed", err));
    }, delay);
}

/* ---------- BOOTSTRAP -------------------------------------------------- */
export function bootTagCleaner(): void {
    installUrlWatcher();
    installLocationPoller();

    /* 1️⃣ listen for injector messages */
    window.addEventListener("message", ev => {
        if (ev.source !== window || !ev.data || ev.data.source !== "KTC") return;

        switch (ev.data.kind) {
            case "POSTS_FETCH_STARTED":
                clearFallbackTimer();
                break;

            case "POSTS_JSON":
                clearFallbackTimer();
                ingest(ev.data.json);
                if (!ready) readyNow();
                break;
        }
    });

    /* 2️⃣ start fallback timer for the initial ticket */
    startFallbackTimer();

    /* 3️⃣ decorate existing + future timeline posts */
    const POST_SEL = '[class*="ko-timeline-2_list_post__post_"]';
    document.querySelectorAll<HTMLElement>(POST_SEL).forEach(handle);
    new MutationObserver(muts =>
        muts.forEach(r =>
            r.addedNodes.forEach(n => {
                if (!(n instanceof HTMLElement)) return;
                n.matches(POST_SEL)
                    ? handle(n)
                    : n.querySelectorAll?.<HTMLElement>(POST_SEL).forEach(handle);
            })
        )
    ).observe(document.body, { childList: true, subtree: true });

}
