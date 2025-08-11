// modules/kayako/buttons/ephor/aiReplyWorkflow.ts (v3.8.0)
// • Fix: Always POST a fresh *user* message, then stream the assistant reply to that user message.
// • Fix: Strictly anchor polling to the NEW user message id (not to an assistant id).
// • Parent rules:
//    - user message parent = newest existing message id (assistant or user)
//    - if channel empty → FABRICATE parent_id (UUID) for the first user message (per your requirement)
//    - stream parent = the id of the *newly created user message*
// • Keeps: timeout/retry, AbortSignal, quiet-finish, cost tooltips, persisted outputs, placeholders.
// • Stream mode sends ONE request with selected_models (matches web app).

import { EphorClient } from "@/background/ephorClient.ts";
import { EphorStore, saveEphorStore } from "./ephorStore.ts";

/* ---------- timing / retry ---------- */
const TIMEOUT_MS = 180_000; // 3 minutes
const MAX_RETRIES = 1; // retry once
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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
function applyPlaceholders(
    tpl: string,
    transcript: string,
    rounds: { combined: string; byModel: Record<string, string> }[],
): string {
    const prevCombined = rounds.at(-1)?.combined ?? "";

    return (
        tpl
            // previous round + transcript
            .replace(/({{\s*PRV_RD_OUTPUT\s*}}|@#\s*PRV_RD_OUTPUT\s*#@)/gi, prevCombined)
            .replace(/({{\s*TRANSCRIPT\s*}}|@#\s*TRANSCRIPT\s*#@)/gi, transcript)

            // RD_n_COMBINED
            .replace(/@#\s*RD_(\d+)_COMBINED\s*#@/gi, (_, d) => rounds[+d - 1]?.combined ?? "")

            // RD_n_AI_MODEL
            .replace(/@#\s*RD_(\d+)_AI_([A-Z0-9._-]+)\s*#@/gi, (_, d, m) => {
                const r = rounds[+d - 1];
                if (!r) return "";
                return r.byModel?.[m] ?? "";
            })

            // legacy: @#OUTPUT_RND_1#@ etc. → map to RD_1_COMBINED
            .replace(
                /@#\s*OUTPUT(?:_RND)?_(\d+)(?:_AI_[A-Z0-9._-]+)?\s*#@/gi,
                (_, d) => rounds[+d - 1]?.combined ?? "",
            )
    );
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
    text: string,
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
        } catch {
            /* transient – keep polling */
        }
        await delay(350);
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
        //    - If channel has any messages: parent = newest message id (assistant or user)
        //    - If empty: FABRICATE a UUID parent (your requirement)
        const newest = (history ?? []).reduce((best, m) => {
            const bt = new Date(best?.timestamp ?? 0).valueOf();
            const mt = new Date(m?.timestamp ?? 0).valueOf();
            return mt > bt ? m : best;
        }, history?.[0]);

        const userMsgParentId =
            newest?.id ||
            crypto.randomUUID(); // fabricate for the first-ever message

        // 3) CREATE the new *user* message that contains the current prompt.
        //    This guarantees the assistant reply will parent to a *user* id,
        //    never to an assistant id.
        let createdUserMsgId: string | null = null;
        if (channelId) {
            try {
                tell("Creating user message…");
                const created = await client.createMessage(projectId, channelId, {
                    content: prompt,
                    parent_id: userMsgParentId,
                    role: "user",
                    artifacts: [],
                });
                createdUserMsgId = String(created?.id || created?.message_id || "");
                if (!createdUserMsgId) {
                    // defensively fall back (should not happen, but remain resilient)
                    createdUserMsgId = crypto.randomUUID();
                }
            } catch (err: any) {
                // If POST fails, still attempt to stream (anchor to best-effort last *user* or newest)
                tell(`User message create failed – proceeding to stream: ${err?.message || err}`);
                createdUserMsgId = crypto.randomUUID(); // local anchor so polling has a key
            }
        } else {
            // multiplexer path uses "", but we’re in stream mode; still guard
            createdUserMsgId = crypto.randomUUID();
        }

        // 4) Build minimal past context oldest→newest and include the new prompt
        const pastCtx = [
            ...mapToPastCtx(history, 20),
            { role: "user" as const, content: prompt },
        ];

        // 5) Prepare STREAM payload. Parent = **new user message id**.
        const payload = {
            channel_id: channelId, // MUST be a real channel in stream mode
            message_id: crypto.randomUUID(), // unique message id for the assistant stream container
            parent_id : createdUserMsgId,    // IMPORTANT: stream replies to the *new user message*
            query     : prompt,
            library_id: store.projects.find(p => p.project_id === projectId)?.library_id ?? "",
            top_k     : 12,
            past_messages: pastCtx,
            attachments    : [],
            past_attachments: [],
            lm_type: selectedModels[0] ?? "gpt-4o",
            metadata: { search_on_web_options: {} },
            project_id: projectId,
            shared_context: true,
            custom_instructions: "",
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
                    tell(`Retrying (${attempt}/${MAX_RETRIES + 1})…`);
                    await delay(400 + Math.random() * 600);
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
                    10_000,
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
            query: prompt,
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
                    tell(`Retrying ${model} (${attempt}/${MAX_RETRIES + 1})…`);
                    await delay(400 + Math.random() * 600);
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
    const channelId = store.preferredMode === "multiplexer" ? "" : store.selectedChannelId ?? "";

    /* cross-workflow progress */
    const total = stages.reduce((acc, s) => acc + (s.selectedModels?.length ?? 0), 0);
    let done = 0;
    const label = (name: string) => name || "Stage";
    let currentStageName = "";

    const tick = (model: string, phase: "start" | "done" | "fail") => {
        if (phase !== "start") done++;
        if (progressEl)
            progressEl.textContent = `${label(currentStageName)} · ${Math.min(done, total)}/${total}`;
    };
    if (progressEl) progressEl.textContent = `0/${total}`;

    for (let i = 0; i < stages.length; i++) {
        if (abortSignal?.aborted) throw new DOMException("Aborted", "AbortError");

        const stg = stages[i];
        currentStageName = stg.name;
        tell(`Stage ${i + 1}/${stages.length} – ${stg.name}`);
        if (progressEl)
            progressEl.textContent = `${label(stg.name)} · ${done}/${total} — sending`;

        const prompt = applyPlaceholders(stg.prompt, transcript, history);

        const result = await sendEphorMessage({
            client,
            store,
            projectId,
            channelId,
            prompt,
            selectedModels: stg.selectedModels,
            progressEl,
            onStatus: m => tell(`[${stg.name}] ${m}`),
            onProgressTick: tick,
            persistStageId: stg.id,
            abortSignal,
        });

        store.lastOutputs[stg.id] = { combined: result.combined, byModel: { ...result.byModel } };
        await saveEphorStore(store);
        document.dispatchEvent(new CustomEvent("ephorOutputsUpdated", { detail: { stageId: stg.id } }));

        history.push(result);
    }

    tell("Workflow finished ✅");
    return history.at(-1)?.combined ?? "";
}
