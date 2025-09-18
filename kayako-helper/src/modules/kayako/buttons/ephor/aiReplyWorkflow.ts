// modules/kayako/buttons/ephor/aiReplyWorkflow.ts (v4.0.2 – RD_NTH + per-stage status)
// • Change: Multi-stage workflow now auto-creates a new chat per stage named “<Ticket id> - <Stage name>”.
// • Fix: Custom placeholders are expanded alongside built-ins.
// • Keeps: timeout/retry, AbortSignal, quiet-finish, cost tooltips, persisted outputs, placeholders.
// • Stream mode sends ONE request with selected_models (matches web app).
// • NEW: RD_NTH_COMBINED placeholder supported; RD_n also accepts {{ RD_n_COMBINED }} form.
// • NEW: Status pill shows per-stage AI progress (done/total for this stage).

import { EphorClient } from "@/background/ephorClient.ts";
import { EphorStore, saveEphorStore, CannedPrompt } from "./ephorStore.ts";
import { Logger } from "@/background/ephor-client/logger.ts";
import { currentKayakoTicketId } from "@/utils/kayakoIds.ts";
import { fetchTranscript } from "@/utils/api.js";

/* ---------- timing / retry ---------- */
const TIMEOUT_MS = 180_000; // 3 minutes
const MAX_RETRIES = 2; // allow two retries for better resilience
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

function parseStatusFromError(err: unknown): number | null {
    try {
        const j = JSON.parse((err as any)?.message ?? "");
        const st = Number(j?.status ?? 0);
        return Number.isFinite(st) && st > 0 ? st : null;
    } catch {
        const msg = String((err as any)?.message ?? err ?? "");
        const m = msg.match(/HTTP\s+(\d{3})/i);
        return m ? Number(m[1]) : null;
    }
}

function computeBackoffMs(attempt: number, hintMs?: number): number {
    // Exponential with jitter, cap at 6s between tries. Honor server hint when present.
    if (hintMs && Number.isFinite(hintMs)) return Math.max(500, Math.min(6000, hintMs));
    const base = 500 * Math.pow(2, Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.random() * 400);
    return Math.min(6000, base + jitter);
}

/* ---------- helpers ---------- */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("timeout")), ms);
        p.then(
            v => { clearTimeout(t); resolve(v); },
            e => { clearTimeout(t); reject(e); },
        );
    });
}

function isTransient(err: unknown): boolean {
    const s = String(err ?? "");
    try {
        const j = JSON.parse((err as Error)?.message ?? "");
        const st = Number(j?.status ?? 0);
        if ([408, 429, 500, 502, 503, 504].includes(st)) return true;
    } catch { /* not JSON shaped */ }
    return /timeout|network|fetch|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(s);
}

/* ---------- placeholder expansion ---------- */
function escRe(s: string) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function applyPlaceholders(
    tpl: string,
    transcript: string,
    rounds: { combined: string; byModel: Record<string, string> }[],
    canned: CannedPrompt[] = [],
): string {
    const prevCombined = rounds.at(-1)?.combined ?? "";

    let out =
        tpl
            // previous round + transcript
            .replace(/({{\s*PRV_RD_OUTPUT\s*}}|@#\s*PRV_RD_OUTPUT\s*#@)/gi, prevCombined)
            .replace(/({{\s*TRANSCRIPT\s*}}|@#\s*TRANSCRIPT\s*#@)/gi, transcript)

            // RD_NTH_COMBINED (always resolves to the latest completed round)
            .replace(/({{\s*RD_NTH_COMBINED\s*}}|@#\s*RD_NTH_COMBINED\s*#@)/gi, prevCombined)

            // RD_n_COMBINED – @# … #@ form
            .replace(/@#\s*RD_(\d+)_COMBINED\s*#@/gi, (_, d) => rounds[+d - 1]?.combined ?? "")

            // RD_n_COMBINED – {{ … }} form
            .replace(/{{\s*RD_(\d+)_COMBINED\s*}}/gi, (_m, d) => rounds[+d - 1]?.combined ?? "")

            // RD_n_AI_MODEL (marker form)
            .replace(/@#\s*RD_(\d+)_AI_([A-Z0-9._-]+)\s*#@/gi, (_, d, m) => {
                const r = rounds[+d - 1];
                if (!r) return "";
                return r.byModel?.[m] ?? "";
            })

            // legacy: @#OUTPUT_RND_1#@ etc. → map to RD_1_COMBINED
            .replace(
                /@#\s*OUTPUT(?:_RND)?_(\d+)(?:_AI_[A-Z0-9._-]+)?\s*#@/gi,
                (_, d) => rounds[+d - 1]?.combined ?? "",
            );

    // Replace user-defined canned placeholders with their bodies.
    if (Array.isArray(canned) && canned.length) {
        for (const cp of canned) {
            if (!cp?.placeholder) continue;
            try {
                const re = new RegExp(escRe(cp.placeholder), "g");
                out = out.replace(re, cp.body ?? "");
            } catch {
                /* ignore malformed tokens */
            }
        }
    }
    return out;
}

/* ---------- interfaces ---------- */
export interface SendMessageOpts {
    client: EphorClient;
    store: EphorStore;
    projectId: string;
    channelId: string; // "" in multiplexer mode
    prompt: string;
    selectedModels: string[];
    progressEl?: HTMLSpanElement;
    onStatus?: (msg: string) => void;

    /** tick models as they start/finish/fail (for progress bar) */
    onProgressTick?: (model: string, phase: "start" | "done" | "fail") => void;

    /** write results into the Outputs tab under this stage id. "__single__" for single runs. */
    persistStageId?: string;

    /** Abort all network ops. */
    abortSignal?: AbortSignal;
}

export interface StageResult {
    /** concatenated text from every model */
    combined: string;
    /** one entry per model, key = LM id */
    byModel: Record<string, string>;
}

/* ---------- output persistence ---------- */
async function upsertModalOutputs(
    store: EphorStore,
    stageId: string | undefined,
    model: string,
    text: string
): Promise<void> {

    if (!stageId) return;

    const cached =
        store.lastOutputs[stageId] ?? { combined: "", byModel: {} as Record<string, string> };
    cached.byModel[model] = text;

    cached.combined = Object.values(cached.byModel)
        .filter(Boolean)
        .join("\n\n");

    store.lastOutputs[stageId] = cached;
    await saveEphorStore(store);

    document.dispatchEvent(new CustomEvent("ephorOutputsUpdated", { detail: { stageId } }));
}

/* ---------- utilities for messages ---------- */
function isAssistant(m: any): boolean {
    const r = (m?.role ?? m?.sender_role ?? m?.type ?? "").toString().toLowerCase();
    if (r === "assistant") return true;
    const who = (m?.user_name ?? m?.user_id ?? "").toString().toLowerCase();
    if (who.includes("ephor ai")) return true;
    if (Array.isArray(m?.requested_models) && m?.requested_models.length > 0) return true;
    return false;
}
function getTextFromMsg(m: any): string {
    return (m?.content ?? m?.text ?? "").toString().trim();
}

/**
 * Polls the channel for assistant replies to a given **user message id** (anchor).
 * Returns as soon as it has found at least one message per expected model
 * or when the timeout elapses (best-effort).
 */
async function collectAssistantReplies(
    client: EphorClient,
    projectId: string,
    channelId: string,
    anchorUserMsgId: string,
    expectedModels: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    onFound?: (model: string, text: string) => void,
): Promise<{ byModel: Record<string, string>; totalCost: number; newestAssistantId: string | null }> {
    const deadline = Date.now() + Math.max(4000, timeoutMs);
    const want = new Set(expectedModels.map(s => s.toLowerCase()));
    const byModel: Record<string, string> = {};
    let totalCost = 0;
    let newestAssistantId: string | null = null;
    let newestTs = 0;

    const tryParse = (v: any) => {
        if (!v) return null;
        if (typeof v === "string") { try { return JSON.parse(v); } catch { return null; } }
        if (typeof v === "object") return v;
        return null;
    };

    // QUIET-finish controls
    const QUIET_MS = 1400;
    let lastProgressAt = Date.now();
    let lastSeenCount = 0;
    let lastSeenNewestTs = 0;

    // Adaptive polling with backoff and quiet-finish
    let pollAttempt = 0;
    while (Date.now() < deadline) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        try {
            const msgs = (await client.getChannelMessages(projectId, channelId)) as any[];

            // Iterate newest → oldest
            for (let i = 0; i < msgs.length; i++) {
                const m = msgs[i];

                // Only consider assistant messages that reply to our NEW user message
                const parentOk =
                    m.parent_id === anchorUserMsgId ||
                    m.reply_to_id === anchorUserMsgId;

                if (!parentOk || !isAssistant(m)) continue;

                // Track newest assistant id / timestamp
                const ts = new Date(m?.timestamp ?? 0).valueOf();
                if (ts > newestTs) { newestTs = ts; newestAssistantId = m?.id ?? newestAssistantId; }

                // ① leaderboard (multi-model)
                const lb = tryParse(m?.slm_leaderboard);
                if (lb && typeof lb === "object") {
                    for (const [modelLabel, entry] of Object.entries<any>(lb)) {
                        if (modelLabel === "super_response") continue;
                        const text = (entry?.content ?? "").toString().trim();
                        if (!text) continue;
                        const keyLower = modelLabel.toLowerCase();
                        const storedLabel = expectedModels.find(x => x.toLowerCase() === keyLower) || modelLabel;
                        if (!byModel[storedLabel]) {
                            byModel[storedLabel] = text;
                            onFound?.(storedLabel, text);
                            lastProgressAt = Date.now();
                        }
                    }
                }

                // ② single-model fallback
                const oneModel = (m?.lm_type ?? m?.model ?? "").toString();
                const txt = getTextFromMsg(m);
                if (txt && oneModel && !byModel[oneModel]) {
                    byModel[oneModel] = txt;
                    onFound?.(oneModel, txt);
                    lastProgressAt = Date.now();
                }

                // costs (coarse)
                const ca = tryParse(m?.cost_analysis);
                if (ca && typeof ca === "object") {
                    for (const obj of Object.values<any>(ca)) {
                        const n = Number(obj?.total_cost ?? 0);
                        if (Number.isFinite(n)) totalCost += n;
                    }
                } else {
                    const n = Number(m?.cost ?? m?.usage?.usd ?? m?.usage?.total ?? 0);
                    if (Number.isFinite(n)) totalCost += n;
                }
            }

            // Done if we've seen all expected models
            const have = new Set(Object.keys(byModel).map(k => k.toLowerCase()));
            let complete = true;
            for (const w of want) if (!have.has(w)) { complete = false; break; }
            if (complete) break;

            // quiet-finish — if we have something and there's no progress for QUIET_MS, stop.
            const count = Object.keys(byModel).length;
            const newestChanged = newestTs !== lastSeenNewestTs;
            if (count > lastSeenCount || newestChanged) {
                lastSeenCount = count;
                lastSeenNewestTs = newestTs;
                lastProgressAt = Date.now();
            } else if (count > 0 && Date.now() - lastProgressAt >= QUIET_MS) {
                break;
            }
        } catch (err) {
            // transient – slow down a bit on errors, especially 429
            let extraWait = 0;
            try {
                const st = parseStatusFromError(err);
                if (st === 429) extraWait = 800; // add cushion on rate limit
            } catch {}
            const wait = Math.min(1500, 250 + pollAttempt * 75 + extraWait);
            await delay(wait);
            pollAttempt++;
            continue;
        }
        // successful poll → small delay with mild growth to avoid hammering
        const wait = Math.min(1200, 250 + pollAttempt * 50);
        await delay(wait);
        pollAttempt = Math.min(pollAttempt + 1, 10);
    }

    return { byModel, totalCost, newestAssistantId };
}

/* ---------- small helpers for context / parents ---------- */
function sortByTimestampAsc<T extends { timestamp?: string }>(arr: T[]): T[] {
    return [...(arr || [])].sort(
        (a, b) => new Date(a?.timestamp || 0).valueOf() - new Date(b?.timestamp || 0).valueOf(),
    );
}

function mapToPastCtx(history: any[], limit = 20) {
    const sortedAsc = sortByTimestampAsc(history);
    return sortedAsc.slice(-limit)
        .map(m => ({
            role: isAssistant(m) ? "assistant" : "user",
            content: (getTextFromMsg(m) || m?.content || "").toString().trim(),
        }))
        .filter(x => x.content);
}

/* ------------------------------------------------------------------ */
/* sendEphorMessage – stream (one call, many models) | multiplexer     */
/* ------------------------------------------------------------------ */
export async function sendEphorMessage(opts: SendMessageOpts): Promise<StageResult> {
    const { client, store, projectId, channelId, prompt, selectedModels } = opts;
    const tell = (m: string) => opts.onStatus?.(m);
    await client.ready();

    // Expand placeholders for single-shot sends as well (TRANSCRIPT, PRV_RD_OUTPUT, canned, RD_n_*)
    // Use last saved outputs for the current pseudo-stage as "previous round" context.
    try {
        const pseudoStageId = opts.persistStageId || "__single__";
        const prev = store.lastOutputs?.[pseudoStageId];
        const rounds = prev ? [prev] : [];
        const transcript = await fetchTranscript(1000).catch(() => "");
        let expanded = applyPlaceholders(prompt, transcript || "", rounds, store.cannedPrompts ?? []);
        // Auto-fetch recent/past tickets at send time if needed
        try {
            if (/@#\s*PAST_TICKETS\s*#@/i.test(expanded)) {
                const ticketId = currentKayakoTicketId();
                const pid = store.selectedProjectId || "";
                const key = pid && ticketId ? `${pid}::${ticketId}` : "";
                const sysCtx = key ? (store.systemPromptBodiesByContext?.[key] || {}) : {};
                const needsFetch = !sysCtx.pastTickets || sysCtx.pastTickets.trim().length === 0;
                if (needsFetch) {
                    opts.onStatus?.("Fetching recent tickets for Past Tickets placeholder…");
                    try {
                        const { waitForRequesterId, waitForOrganization } = await import("@/modules/kayako/utils/caseContext.ts");
                        const { searchConversationIds, fetchTranscriptByCase, quoteForSearch } = await import("@/modules/kayako/utils/search.ts");
                        const requesterId = await waitForRequesterId(1500).catch(() => "");
                        const org = await waitForOrganization(1500).catch(() => null);
                        const orgName = (org?.name || '').trim();
                        const LIMIT = 10;
                        const POSTS_PER_CASE = 100;
                        const results: string[] = [];
                        // Helper to lightly summarize and deduplicate near-identical tickets
                        const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
                        const fingerprint = (text: string) => {
                            const body = text.slice(0, 8000); // cap for hashing
                            let h = 0;
                            for (let i = 0; i < body.length; i++) {
                                h = (h * 31 + body.charCodeAt(i)) | 0;
                            }
                            return h;
                        };
                        const seen = new Set<number>();
                        const summarize = (t: string) => {
                            // keep header lines and the first ~800 chars of content
                            const lines = t.split(/\r?\n/);
                            const head = lines.slice(0, 12).join("\n");
                            const rest = lines.slice(12).join("\n");
                            const trimmed = rest.length > 800 ? rest.slice(0, 800) + "\n…" : rest;
                            return head + "\n" + trimmed;
                        };
                        // Requester branch
                        try {
                            if (requesterId) {
                                const q = `requester:${quoteForSearch(String(requesterId))}`;
                                const ids = await searchConversationIds(q, LIMIT, 0);
                                const texts = await Promise.all(ids.map(async id => {
                                    const raw = await fetchTranscriptByCase(id, POSTS_PER_CASE);
                                    const t = raw.replace(/^Ticket ID:\s+Unknown ID\b/m, `Ticket ID: ${id}`);
                                    const fp = fingerprint(normalize(t));
                                    if (seen.has(fp)) return ""; // drop near-duplicate
                                    seen.add(fp);
                                    return summarize(t);
                                }));
                                const items = texts.filter(Boolean);
                                if (items.length) {
                                    const section = [
                                        '===== Recent Requester Tickets =====',
                                        ...items.map((t, i) => `--- [Requester ${i+1}] ---\n${t}`),
                                    ].join('\n\n');
                                    results.push(section);
                                }
                            }
                        } catch {}
                        // Organization branch
                        try {
                            if (orgName) {
                                const q = `organization:${quoteForSearch(orgName)}`;
                                const ids = await searchConversationIds(q, LIMIT, 0);
                                const texts = await Promise.all(ids.map(async id => {
                                    const raw = await fetchTranscriptByCase(id, POSTS_PER_CASE);
                                    const t = raw.replace(/^Ticket ID:\s+Unknown ID\b/m, `Ticket ID: ${id}`);
                                    const fp = fingerprint(normalize(t));
                                    if (seen.has(fp)) return "";
                                    seen.add(fp);
                                    return summarize(t);
                                }));
                                const items = texts.filter(Boolean);
                                if (items.length) {
                                    const section = [
                                        '===== Recent Organization Tickets =====',
                                        ...items.map((t, i) => `--- [Org ${i+1}] ---\n${t}`),
                                    ].join('\n\n');
                                    results.push(section);
                                }
                            }
                        } catch {}
                        // Remove empty entries and shrink payload
                        const text = results
                            .map(s => s.trim())
                            .filter(Boolean)
                            .join('\n\n[=========== Next Conversation ===========]\n\n');
                        if (text) {
                            store.systemPromptBodiesByContext = store.systemPromptBodiesByContext || {} as any;
                            (store.systemPromptBodiesByContext as any)[key] = {
                                ...(store.systemPromptBodiesByContext as any)[key],
                                pastTickets: text,
                            };
                            await saveEphorStore(store);
                            opts.onStatus?.("Past tickets cached for this ticket.");
                        } else {
                            // No requester/org tickets found – warn politely in UI next to status
                            try {
                                const span = document.querySelector<HTMLSpanElement>("#kh-ephor-warning");
                                if (span) {
                                    span.textContent = "⚠ No past tickets found for requester or organization";
                                    span.title = "No past tickets found for the current requester and their organization";
                                }
                            } catch {}
                            Logger.log("INFO", "WORKFLOW no past tickets found", { requesterId, orgName });
                            opts.onStatus?.("No past tickets found for requester/org.");
                        }
                    } catch (err: any) {
                        opts.onStatus?.(`Past tickets fetch failed: ${err?.message || 'unknown error'}`);
                    }
                }
            }
        } catch {}
        // Replace system placeholders (prefer per-ticket overrides; include ephemeral)
        try {
            const ticketId = currentKayakoTicketId();
            const projectId = store.selectedProjectId || "" as any;
            const key = projectId && ticketId ? `${projectId}::${ticketId}` : "";
            const sysGlobal = store.systemPromptBodies || { fileAnalysis: "", pastTickets: "", styleGuide: "" };
            const sysCtxPersisted = key ? (store.systemPromptBodiesByContext?.[key] || {}) : {};
            // Ephemeral runtime overrides (not persisted; cleared on reload)
            let sysCtxEphemeral: any = {};
            try { sysCtxEphemeral = key ? (await import('./ephorStore')).ephemeralSystemPromptBodiesByContext?.[key] || {} : {}; } catch {}
            const sysCtx = { ...sysCtxPersisted, ...sysCtxEphemeral } as any;
            const bodyOf = (field: "fileAnalysis"|"pastTickets"|"styleGuide"): string => {
                const v = (sysCtx as any)[field];
                return (typeof v === 'string' && v) ? v : (sysGlobal as any)[field] || "";
            };
            expanded = expanded
                .replace(/@#\s*FILE_ANALYSIS\s*#@/gi, bodyOf("fileAnalysis"))
                .replace(/@#\s*PAST_TICKETS\s*#@/gi, bodyOf("pastTickets"))
                .replace(/@#\s*STYLE_GUIDE\s*#@/gi, bodyOf("styleGuide"));
        } catch {}
        if (expanded !== prompt) tell("Expanded placeholders in prompt");
        (opts as any).prompt = expanded;
    } catch {
        // non-fatal; fall back to original prompt
    }

    /* ── NEW: prepend per-ticket **per-stage** custom instructions.
     * Primary key: `${projectId}::${ticketId}::${stageId}`
     * Fallback (back-compat): `${projectId}::${ticketId}`
     */
    const ticketId = currentKayakoTicketId();
    const ticketKey = ticketId ? `${projectId}::${ticketId}` : "";
    const stageId = opts.persistStageId || "";
    const stageKey = ticketId && stageId ? `${projectId}::${ticketId}::${stageId}` : "";
    const preferTicket = (store.instructionsScopeForWorkflow ?? "ticket") === "ticket";
    const prepend = preferTicket
        ? (store.customInstructionsByContext?.[ticketKey] ?? (stageKey && store.customInstructionsByStage?.[stageKey]) ?? "")
        : ((stageKey && store.customInstructionsByStage?.[stageKey]) ?? (store.customInstructionsByContext?.[ticketKey]) ?? "");
    const trimmed = prepend.trim();
    const finalPrompt = trimmed ? `${trimmed}\n\n${opts.prompt}` : opts.prompt;
    // NOTE: We also pass `custom_instructions` in Stream payload for servers that support it.
    const customInstructions = trimmed;

    const byModel: Record<string, string> = {};
    let combined = "";
    let totalCost = 0;
    const returned: string[] = [];
    const updateBadge = () => {
        if (!opts.progressEl) return;
        opts.progressEl.title = returned.length
            ? `Returned: ${returned.join(", ")} | $${totalCost.toFixed(4)}`
            : "";
    };

    /* ================================================================= */
    /* STREAM mode: one request, many models                              */
    /* ================================================================= */
    if (store.preferredMode === "stream") {
        const stageName = opts.persistStageId ? `stage ${opts.persistStageId}` : "single";
        selectedModels.forEach(m => opts.onProgressTick?.(m, "start"));
        tell(`Query → ${selectedModels.join(", ")}`);

        // 1) Load channel history
        let history: any[] = [];
        try {
            if (channelId) history = (await client.getChannelMessages(projectId, channelId)) as any[];
        } catch {
            history = [];
        }

        // 2) Determine PARENT for the *new user message* we are about to create.
        const newest = (history ?? []).reduce((best, m) => {
            const bt = new Date(best?.timestamp ?? 0).valueOf();
            const mt = new Date(m?.timestamp ?? 0).valueOf();
            return mt > bt ? m : best;
        }, history?.[0]);

        const userMsgParentId =
            newest?.id ||
            crypto.randomUUID(); // fabricate for the first-ever message

        // 3) Fabricate a local user message ID. The streamInteraction endpoint will
        //    implicitly create the user message with this ID as a side-effect,
        //    bypassing the outdated POST /messages endpoint.
        const createdUserMsgId = crypto.randomUUID();

        // 4) Build minimal past context oldest→newest and include the new prompt
        const pastCtx = [
            ...mapToPastCtx(history, 20),
            { role: "user" as const, content: finalPrompt },
        ];

        // 5) Prepare STREAM payload. Parent = **newly created user message id** (never empty).
        const payload = {
            channel_id: channelId, // MUST be a real channel in stream mode
            message_id: crypto.randomUUID(), // unique message id for the assistant stream container
            parent_id : createdUserMsgId,    // IMPORTANT: stream replies to the *new user message* (UUID if first message)
            query     : finalPrompt,
            library_id: store.projects.find(p => p.project_id === projectId)?.library_id ?? "",
            top_k     : 12,
            past_messages: pastCtx,
            attachments    : [],
            past_attachments: [],
            lm_type: selectedModels[0] ?? "gpt-4o",
            metadata: { search_on_web_options: {} },
            project_id: projectId,
            shared_context: true,
            custom_instructions: customInstructions,
            selected_mode: "default",
            selected_sources: ["library"],
            selected_models: selectedModels,
            selected_expert_comments: [],
            debate_mode: false,
            selected_document_info: null,
        } as const;

        // 6) Stream with retry-on-transient
        let attempt = 0;
        let ack: any = null;

        while (true) {
            if (opts.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
            try {
                attempt++;
                const req = client.streamInteraction(payload as any, opts.abortSignal);
                ack = await withTimeout(req, TIMEOUT_MS);
                break; // got ACK; WS/SSE continues in the backend
            } catch (err: any) {
                if (err?.name === "AbortError") {
                    tell(`Models failed — cancelled`);
                    selectedModels.forEach(m => opts.onProgressTick?.(m, "fail"));
                    throw err;
                }
                if (attempt <= MAX_RETRIES && isTransient(err)) {
                    // Respect Retry-After when available (passed via error body if any)
                    let retryAfterMs: number | undefined;
                    try {
                        const j = JSON.parse((err as Error)?.message ?? "");
                        const ra = Number(j?.headers?.["retry-after"] ?? j?.retry_after_ms ?? j?.retry_after);
                        if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra >= 100 ? ra : ra * 1000;
                    } catch {}
                    const st = parseStatusFromError(err);
                    const waitMs = computeBackoffMs(attempt, retryAfterMs);
                    Logger.log("WARN", "STREAM backoff", { attempt, waitMs, status: st ?? undefined, retryAfterMs });
                    tell(`Retrying (${attempt}/${MAX_RETRIES + 1}) after ${waitMs} ms${st ? ` (HTTP ${st})` : ""}…`);
                    await delay(waitMs);
                    continue;
                }
                tell(`Models failed — ${(err as Error).message}`);
                selectedModels.forEach(m => opts.onProgressTick?.(m, "fail"));
                for (const m of selectedModels) {
                    byModel[m] = `(error: ${(err as Error).message})`;
                    await upsertModalOutputs(store, opts.persistStageId, m, byModel[m]);
                }
                break;
            }
        }

        // 7) Poll for assistant replies that parent to **our new user message**
        if (ack && channelId && createdUserMsgId) {
            const { byModel: found, totalCost: costSum, newestAssistantId } =
                await collectAssistantReplies(
                    client,
                    projectId,
                    channelId,
                    createdUserMsgId,
                    selectedModels,
                    120_000, // 2 minutes per-stage timeout
                    opts.abortSignal,
                    async (model, text) => {
                        byModel[model] = text;
                        combined = Object.values(byModel).filter(Boolean).join("\n\n");
                        await upsertModalOutputs(store, opts.persistStageId, model, text);
                        opts.onProgressTick?.(model, "done");
                        returned.push(model);
                        updateBadge();
                    },
                );

            if (channelId && newestAssistantId) {
                store.lastMsgIdByChannel = store.lastMsgIdByChannel || {};
                store.lastMsgIdByChannel[channelId] = newestAssistantId;
                await saveEphorStore(store);
            }

            // Mark missing ones as fail
            for (const m of selectedModels) {
                if (!found[m]) {
                    opts.onProgressTick?.(m, "fail");
                    if (!byModel[m]) {
                        byModel[m] = byModel[m] ?? "(no output received)";
                        await upsertModalOutputs(store, opts.persistStageId, m, byModel[m]);
                    }
                }
            }

            totalCost += costSum;
            if (totalCost) tell(`💰 Total cost this send: $${totalCost.toFixed(4)}`);
        }

        return { combined: combined || Object.values(byModel).filter(Boolean).join("\n\n"), byModel };
    }

    /* ================================================================= */
    /* MULTIPLEXER mode: one request per model (API key path)            */
    /* ================================================================= */
    for (const model of selectedModels) {
        if (opts.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
        opts.onProgressTick?.(model, "start");
        tell(`Query → ${model}`);

        const payload = {
            channel_id: undefined as any, // do not send "", omit the field
            message_id: crypto.randomUUID(),
            parent_id: null,
            project_id: projectId,
            query: finalPrompt,
            model,
        } as any;

        let attempt = 0, text = "", cost = 0;

        while (true) {
            if (opts.abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");
            try {
                attempt++;
                const resp = await withTimeout(client.multiplexerChannelMessage(payload, opts.abortSignal), TIMEOUT_MS);
                text = (resp?.output ?? "").toString().trim();
                cost = Number(resp?.cost ?? resp?.usage?.usd ?? resp?.usage?.total ?? 0) || 0;
                break;
            } catch (err: any) {
                if (err?.name === "AbortError") {
                    tell(`Model failed: ${model} – cancelled`);
                    opts.onProgressTick?.(model, "fail");
                    throw err;
                }
                if (attempt <= MAX_RETRIES && isTransient(err)) {
                    let retryAfterMs: number | undefined;
                    try {
                        const j = JSON.parse((err as Error)?.message ?? "");
                        const ra = Number(j?.headers?.["retry-after"] ?? j?.retry_after_ms ?? j?.retry_after);
                        if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra >= 100 ? ra : ra * 1000;
                    } catch {}
                    const st = parseStatusFromError(err);
                    const waitMs = computeBackoffMs(attempt, retryAfterMs);
                    Logger.log("WARN", "MUX backoff", { model, attempt, waitMs, status: st ?? undefined, retryAfterMs });
                    tell(`Retrying ${model} (${attempt}/${MAX_RETRIES + 1}) after ${waitMs} ms${st ? ` (HTTP ${st})` : ""}…`);
                    await delay(waitMs);
                    continue;
                }
                tell(`Model failed: ${model} – ${(err as Error).message}`);
                opts.onProgressTick?.(model, "fail");
                text = `(error from ${model}: ${(err as Error).message})`;
                break;
            }
        }

        byModel[model] = text;
        combined += (combined ? "\n\n" : "") + text;
        totalCost += cost;

        tell(`${model} cost → $${cost.toFixed(4)}`);
        returned.push(model);
        updateBadge();

        await upsertModalOutputs(store, opts.persistStageId, model, text);
        opts.onProgressTick?.(model, "done");
    }

    if (totalCost) tell(`💰 Total cost this send: $${totalCost.toFixed(4)}`);
    return { combined, byModel };
}

/* ------------------------------------------------------------------ */
/* Automatic multi-stage workflow                                     */
/* ------------------------------------------------------------------ */
export async function runAiReplyWorkflow(
    client: EphorClient,
    store: EphorStore,
    projectId: string,
    transcript: string,
    onStatus?: (m: string) => void,
    progressEl?: HTMLSpanElement,
    abortSignal?: AbortSignal,
): Promise<string> {
    const tell = (m: string) => onStatus?.(m);
    const stages = store.workflowStages;

    const history: StageResult[] = [];
    let channelId = store.preferredMode === "multiplexer" ? "" : (store.selectedChannelId ?? "");

    /* cross-workflow progress (kept for internal counters; UI now shows per-stage) */
    const total = stages.reduce((acc, s) => acc + (s.selectedModels?.length ?? 0), 0);
    let done = 0;
    const label = (name: string) => name || "Stage";

    for (let i = 0; i < stages.length; i++) {
        if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        const stg = stages[i];
        const aiTotalThisStage = Math.max(1, stg.selectedModels?.length ?? 0);
        let aiDoneThisStage = 0;

        tell(`Stage ${i + 1}/${stages.length} – ${stg.name}`);
        if (progressEl)
            progressEl.textContent = `${label(stg.name)} · 0/${aiTotalThisStage} — sending`;

        /* ────────────────────────────────────────────────────────────────
         * Per-stage chat creation (Stream mode)
         * Always create a fresh chat for this stage in the selected project.
         * Name: "<Ticket id> - <Stage name>"
         * Multiplexer mode keeps channelId = "".
         * ──────────────────────────────────────────────────────────────── */
        if (store.preferredMode === "stream") {
            try {
                const tid = currentKayakoTicketId() || "";
                const stageLabel = stg.name || "Stage";
                const chatName = tid ? `${tid} - ${stageLabel}` : stageLabel;
                tell(`Creating chat for stage “${stageLabel}”…`);
                const ch = await client.createChannel(projectId, chatName);
                channelId = String(ch?.id ?? ch?.channel_id ?? "");
                if (!channelId) throw new Error("Channel creation returned no id");

                // reflect in UI for transparency
                store.selectedChannelId = channelId;
                await saveEphorStore(store);

                tell(`Created chat ✓ (${channelId})`);
                Logger.log("INFO", "WORKFLOW/STREAM created per-stage channel", { ticketId: tid, channelId, label: chatName });
            } catch (err: any) {
                Logger.log("ERR", "WORKFLOW/STREAM failed to create per-stage channel", err?.message ?? String(err));
                throw new Error(`Unable to create a chat for stage “${stg.name}” – ${err?.message ?? String(err)}`);
            }
        }

        // Build prompt with built-ins + canned prompt replacements
        const prompt = applyPlaceholders(
            stg.prompt,
            transcript,
            history,
            store.cannedPrompts ?? [],
        );
        Logger.log("INFO", "WORKFLOW stage prompt expanded", { stage: stg.name, length: prompt.length });

        const result = await sendEphorMessage({
            client,
            store,
            projectId,
            channelId,
            prompt,
            selectedModels: stg.selectedModels,
            progressEl,
            onStatus: m => tell(`[${stg.name}] ${m}`),
            onProgressTick: (_model, phase) => {
                if (phase !== "start") {
                    aiDoneThisStage++;
                    done++; // keep overall counter in sync (even if not shown)
                }
                if (progressEl)
                    progressEl.textContent = `${label(stg.name)} · ${Math.min(aiDoneThisStage, aiTotalThisStage)}/${aiTotalThisStage} — ${aiDoneThisStage >= aiTotalThisStage ? "done" : "sending"}`;
            },
            persistStageId: stg.id,
            abortSignal,
        });

        store.lastOutputs[stg.id] = { combined: result.combined, byModel: { ...result.byModel } };
        await saveEphorStore(store);
        document.dispatchEvent(new CustomEvent("ephorOutputsUpdated", { detail: { stageId: stg.id } }));

        history.push(result);
        // Mark stage complete in the progress badge for clarity
        if (progressEl) progressEl.textContent = `${label(stg.name)} · ${aiTotalThisStage}/${aiTotalThisStage} — done`;
    }

    tell("Workflow finished ✅");
    return history.at(-1)?.combined ?? "";
}
