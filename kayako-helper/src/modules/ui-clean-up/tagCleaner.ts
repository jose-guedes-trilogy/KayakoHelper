/**
 * Kayako Tag-Diff Cleaner – v1.1
 * Logs are verbose – filter the console on “KTC:” to follow the flow.
 */

interface Action {
    id: number;
    action: "CREATED" | "UPDATED" | "DELETED";
    field: string;
    old_value: string | null;
    new_value: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const LOG = (...args: any[]) => console.log("KTC:", ...args);

/** Split Kayako’s comma-separated tag string into a unique, trimmed array */
function splitTags(str: string | null): string[] {
    const out = (str ?? "")
        .split(",")
        .map(t => t.trim())
        .filter(Boolean);
    return [...new Set(out)];
}

/** Compute added & removed tags */
function diffTags(oldVal: string | null, newVal: string | null) {
    const oldTags = splitTags(oldVal);
    const newTags = splitTags(newVal);
    return {
        added:   newTags.filter(t => !oldTags.includes(t)),
        removed: oldTags.filter(t => !newTags.includes(t)),
    };
}

/** Build innerHTML snippet */
function renderDiffHtml({ added, removed }: { added: string[]; removed: string[]; }) {
    const parts: string[] = [];
    if (added.length)   parts.push(`added <b>${added.join(", ")}</b>`);
    if (removed.length) parts.push(`removed <b>${removed.join(", ")}</b>`);
    return parts.join(" &nbsp;"); // keep sentence on one line
}

/* ------------------------------------------------------------------ */
/* Network layer (actions are cached)                                 */
/* ------------------------------------------------------------------ */

const ORIGIN = `${location.protocol}//${location.host}`;
const actionCache = new Map<string, Action[]>();          // postId → actions[]
const inFlight     = new Map<string, Promise<Action[]>>(); // dedupe concurrent calls

async function fetchTagActions(postId: string): Promise<Action[]> {
    if (actionCache.has(postId)) return actionCache.get(postId)!;

    if (inFlight.has(postId)) return inFlight.get(postId)!;

    const url =
        `${ORIGIN}/api/v1/cases/posts/${postId}.json` +    // «Retrieve a post» endpoint :contentReference[oaicite:0]{index=0}
        `?include=action` +
        `&fields=+action(field,old_value,new_value,id)`;

    const p = (async () => {
        LOG("fetchTagActions →", postId, url);
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error(`Kayako API ${res.status}`);

        const json = await res.json();
        const actions: Action[] = Object
            .values<Record<string, unknown>>(json.included ?? json.resources ?? {})
            .filter((r: any) => r?.resource_type === "action" && r.field === "tags") as Action[];

        LOG("fetchTagActions ✓", postId, actions);
        actionCache.set(postId, actions);
        inFlight.delete(postId);
        return actions;
    })();

    inFlight.set(postId, p);
    return p;
}

/* ------------------------------------------------------------------ */
/* DOM manipulation                                                   */
/* ------------------------------------------------------------------ */

function applyTagDiff(postEl: HTMLElement, actions: Action[]) {
    if (!actions.length) return;

    const textContainer =
        postEl.querySelector<HTMLElement>(
            '[class^="ko-timeline-2_list_activity_standard__activity-text_"]'
        );
    if (!textContainer) return;

    if (textContainer.dataset.tagCleaned === "true") return; // already done for this node

    // Pick a representative old/new pair
    const base = actions.reduce<Action>((prev, curr) => ({
        ...curr,
        old_value: prev.old_value ?? curr.old_value
    }), actions[actions.length - 1]);

    const diff = diffTags(base.old_value, base.new_value);
    if (!diff.added.length && !diff.removed.length) return;

    // Hide noisy original lines
    Array.from(textContainer.querySelectorAll("span")).forEach(span => {
        if (/tags/i.test(span.textContent ?? "")) (span as HTMLElement).style.display = "none";
    });

    // Inject our diff
    const diffSpan = document.createElement("span");
    diffSpan.className = "ktc-diff";
    diffSpan.innerHTML = renderDiffHtml(diff);
    diffSpan.style.whiteSpace = "nowrap";

    textContainer.prepend(diffSpan);
    textContainer.dataset.tagCleaned = "true";

    LOG("applyTagDiff ✓", { id: postEl.dataset.id, diff });
}

/* ------------------------------------------------------------------ */
/* Post processing pipeline                                           */
/* ------------------------------------------------------------------ */

async function processPostElement(postEl: HTMLElement) {
    const id = postEl.dataset.id ?? postEl.getAttribute("data-id");
    if (!id) return;
    try {
        const actions = await fetchTagActions(id);
        applyTagDiff(postEl, actions);
    } catch (e) {
        console.error("KTC: failed", id, e);
    }
}

/* ------------------------------------------------------------------ */
/* Observer bootstrapping                                             */
/* ------------------------------------------------------------------ */

export function bootTagCleaner(): void {
    LOG("bootTagCleaner");

    const POST_SELECTOR = '[class*="ko-timeline-2_list_post__post_"]';

    // Handle nodes already on screen
    document.querySelectorAll<HTMLElement>(POST_SELECTOR)
        .forEach(processPostElement);

    // Handle future additions / re-renders
    const observer = new MutationObserver(muts => {
        muts.forEach(m => {
            m.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;

                if (node.matches(POST_SELECTOR)) {
                    processPostElement(node).then(r => {});
                } else {
                    node.querySelectorAll?.(POST_SELECTOR).forEach(el => processPostElement(el as HTMLElement));
                }
            });
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
}
