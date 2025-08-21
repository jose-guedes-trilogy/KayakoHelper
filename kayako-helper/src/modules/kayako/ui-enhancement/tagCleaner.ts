/* ============================================================================
 * src/modules/ui-enhancement/tagCleaner.ts
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
    field: "tags" | "case_tags" | "name";
    old_value: string | null;
    new_value: string | null;
}

/* ---------- per-ticket state ------------------------------------------- */
const actions = new Map<string, Action[]>();
let currentCaseId: string | null = getCaseId();
let ready = false;
const waiters: Array<() => void> = [];
let fallbackId: number | undefined;

/* backfill control: run one full-history fetch if we encounter posts with
   no actions after we're 'ready' (injector only sent first page). */
let bulkFetched = false;
let backfillPromise: Promise<void> | null = null;

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

/* activity-text finder: Kayako uses several variants; try them in order */
const ACTIVITY_TEXT_SELS = [
    '[class*="ko-timeline-2_list_activity_standard__activity-text_"]',
    '[class*="ko-timeline-2_list_activity_system__activity-text_"]',
    '[class*="ko-timeline-2_list_activity__activity-text_"]',
    /* very last resort: any class containing 'activity-text_' */
    '[class*="activity-text_"]',
] as const;

function findActivityBox(root: ParentNode): HTMLElement | null {
    for (const sel of ACTIVITY_TEXT_SELS) {
        const el = root.querySelector<HTMLElement>(sel);
        if (el) return el;
    }
    return null;
}

/* quick heuristic to avoid retrying non-tag updates like On Hold timestamps */
function looksLikeTagChange(post: HTMLElement): boolean {
    const box = findActivityBox(post);
    const txt = (box?.textContent || "").toLowerCase();
    return /\btag\b|\btags\b/.test(txt) || /conversation tags/.test(txt);
}

function getCaseId(): string | null {
    return location.pathname.match(/\/conversations\/(\d+)\b/)?.[1] ?? null;
}

/* ---------- ingest(): post → activity → action ------------------------ */
function ingest(json: any): void {
    if (!currentCaseId) return;

    const acts: Record<string, Action> = json?.resources?.actions ?? json?.resources?.action ?? {};
    const avts: Record<string, any>    = json?.resources?.activity ?? {};
    const posts: any[] = Array.isArray(json?.data) ? json.data : [];

    for (const post of posts) {
        const postId = String(post.id);
        const actId  = post.original?.id;
        if (!actId) continue;

        const activity = avts[String(actId)];
        if (!activity || !Array.isArray(activity.actions)) continue;

        const tagActs: Action[] = activity.actions
            .map((ref: any) => acts[String(ref.id)])
            .filter((a: any): a is Action => !!a && (a.field === "tags" || a.field === "case_tags" || a.field === "name"));

        if (tagActs.length) {
            const existingActs = actions.get(postId) ?? [];
            const mergedActs = [...existingActs];
            for (const newAct of tagActs) {
                if (!mergedActs.some(ea => ea.id === newAct.id)) mergedActs.push(newAct);
            }
            actions.set(postId, mergedActs);
            pokePending(postId);
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
        "&include=*&limit=1000";

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
        if (!res.ok) break;
        ingest(await res.json());
        url = res.headers.get("x-next-url") || null;
        if (url && !url.startsWith("http")) url = location.origin + url;
        pages++;
        if (pages > 20) break;
    }
    bulkFetched = true;
    readyNow();
}

/* ---------- DOM decoration ------------------------------------------- */
function decorate(post: HTMLElement, acts: Action[]): void {
    if (!acts.length) return;

    const box = findActivityBox(post);
    if (!box || box.dataset.tagCleaned) return;

    const base  = acts.reduce<Action>((p,c) => ({ ...c, old_value: p.old_value ?? c.old_value }), acts[acts.length - 1]);
    const delta = diff(base.old_value, base.new_value);

    if (!delta.added.length && !delta.removed.length) return;

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

/* ---------- retry / verification helpers ------------------------------ */
const MAX_DECORATE_RETRIES = 5;
const RETRY_BASE_DELAY_MS  = 200;

/* track per-post retries so one failure never blocks others */
type PendingInfo = { attempt: number; post: HTMLElement; timer?: number; lastReason?: string };
const pendings = new Map<string, PendingInfo>();

function isTagCleaned(post: HTMLElement): boolean {
    const box = findActivityBox(post);
    if (!box) return false;
    if (box.dataset.tagCleaned === "true") return true;
    if (box.querySelector(".ktc-diff")) return true;
    const tagsHidden = Array.from(box.querySelectorAll<HTMLSpanElement>("span"))
        .some(s => /tags/i.test(s.textContent ?? "") && s.style.display === "none");
    return tagsHidden;
}

function markIrrelevant(post: HTMLElement): void {
    const box = findActivityBox(post);
    if (box && !box.dataset.tagCleaned) box.dataset.tagCleaned = "n/a";
}

function scheduleRetry(id: string, post: HTMLElement, reason: string, attempt: number): void {
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
    const prev = pendings.get(id);
    if (prev?.timer) window.clearTimeout(prev.timer);
    const timer = window.setTimeout(() => decorateWithRetry(post, id, attempt + 1), delay);
    pendings.set(id, { attempt, post, timer, lastReason: reason });
}

function pokePending(id: string): void {
    const p = pendings.get(id);
    if (!p) return;
    if (p.timer) { window.clearTimeout(p.timer); p.timer = undefined; }
    decorateWithRetry(p.post, id, p.attempt);
}

function clearPendings(): void {
    pendings.forEach(p => p.timer && window.clearTimeout(p.timer));
    pendings.clear();
}

/* fire one backfill if we hit posts with no actions after we're 'ready' */
function ensureBackfill(): void {
    if (bulkFetched || backfillPromise) return;
    backfillPromise = fetchAllPages()
        .catch(() => {})
        .finally(() => { backfillPromise = null; });
}

function decorateWithRetry(post: HTMLElement, id: string, attempt = 0): void {
    if (!post.isConnected) { pendings.delete(id); return; }

    const acts = actions.get(id) ?? [];
    const hasBox = !!findActivityBox(post);

    try {
        if (!hasBox) {
            if (attempt >= MAX_DECORATE_RETRIES) {
                markIrrelevant(post);
                pendings.delete(id);
                return;
            }
            scheduleRetry(id, post, "no-box-yet", attempt);
            return;
        }
        if (!acts.length) {
            if (looksLikeTagChange(post) === false) {
                markIrrelevant(post);
                pendings.delete(id);
                return;
            }
            if (!ready && attempt < MAX_DECORATE_RETRIES) {
                scheduleRetry(id, post, "no-actions-for-post", attempt);
                return;
            }
            ensureBackfill();
            if (attempt < MAX_DECORATE_RETRIES) {
                scheduleRetry(id, post, "no-actions-for-post", attempt);
                return;
            }
            markIrrelevant(post);
            pendings.delete(id);
            return;
        }

        decorate(post, acts);
    } catch {
        /* swallow */
    }

    if (isTagCleaned(post)) {
        pendings.delete(id);
        return;
    }

    if (attempt >= MAX_DECORATE_RETRIES) {
        pendings.delete(id);
        return;
    }
    scheduleRetry(id, post, "not-cleaned-yet", attempt);
}

async function handle(post: HTMLElement): Promise<void> {
    const id = post.dataset.id ?? post.getAttribute("data-id");
    if (!id) return;
    await waitReady();
    decorateWithRetry(post, id);
}

/* ---------- ticket-switch detection ----------------------------------- */
/* --- replace resetForCase() with the patched version ------------------- */
function resetForCase(newId: string | null): void {
    if (newId === currentCaseId) return;

    currentCaseId = newId;
    ready = false;
    actions.clear();
    clearPendings();
    clearFallbackTimer();
    bulkFetched = false;
    backfillPromise = null;
    startFallbackTimer();

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
    if (bulkFetched) return;
    fallbackId = window.setTimeout(() => {
        fetchAllPages().catch(() => {});
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
