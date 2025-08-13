// modules/kayako/buttons/ephor/aiReplyWorkflow.ts
/* v1.3.0 – switched to /interact/stream payload */
import { EphorClient } from "@/background/ephorClient.ts";
import { EphorStore  } from "@/modules/kayako/buttons/ephor/ephorStore.ts";

/* ── types ── */
export interface WorkflowOpts {
    client    : EphorClient;
    store     : EphorStore;
    projectId : string;
    transcript: string;
    onStatus? : (msg: string) => void;
}
export interface SendMessageOpts {
    client        : EphorClient;
    store         : EphorStore;
    projectId     : string;
    channelId     : string;
    prompt        : string;
    selectedModels: string[];
    onStatus?     : (msg: string) => void;
}

/* manual send helper ------------------------------------------------- */

export async function sendEphorMessage(opts: SendMessageOpts): Promise<void> {
    const tell = (m: string) => opts.onStatus?.(m);

    tell("Fetching conversation history…");
    const msgs = await opts.client.getChannelMessages(opts.projectId, opts.channelId) as { id: string }[];
    const parentId = msgs.length ? msgs[msgs.length - 1].id : null;
    tell(`Found ${msgs.length} messages. Parent = ${parentId ?? "none"}`);

    /* Build payload EXACTLY as the web-app expects */
    const payload = {
        channel_id   : opts.channelId,
        message_id   : crypto.randomUUID(),
        parent_id    : parentId,
        project_id   : opts.projectId,
        query        : opts.prompt,
        lm_type      : opts.selectedModels[0] ?? "gpt-4o",
        selected_mode: "ask",
    };

    tell(`Sending with model ${payload.lm_type}…`);
    await opts.client.streamInteraction(payload);
    tell("✅ Message sent!");
}

/* 3-phase “draft → fact-check → refine” workflow --------------------- */
export async function runAiReplyWorkflow(opts: WorkflowOpts): Promise<string> {
    const tell = (m: string) => opts.onStatus?.(m);

    /* 1. Draft */
    tell("Phase 1 / 3 – drafting…");
    const draftModel = opts.store.draftModels[0];
    if (!draftModel) throw new Error("No draft model configured.");
    const draftRes = await opts.client.queryProject({ projectId: opts.projectId, query: opts.transcript, model: draftModel });
    let reply = (draftRes as unknown as string).trim();

    /* 2. Fact-check */
    tell("Phase 2 / 3 – fact-checking…");
    const factModel = opts.store.factModels[0];
    if (!factModel) throw new Error("No fact-check model configured.");
    const critiquePrompt = `Please fact-check the following reply. Output ONLY corrections.\n\n${reply}`;
    const factRes  = await opts.client.queryProject({ projectId: opts.projectId, query: critiquePrompt, model: factModel });
    const feedback = (factRes as unknown as string).trim();

    /* 3. Refine */
    tell("Phase 3 / 3 – refining…");
    const refineModel = opts.store.refineModels[0];
    if (!refineModel) throw new Error("No refinement model configured.");
    const refinePrompt = `You are the original answering AI. Incorporate the corrections below and output an updated reply only.

=== CORRECTIONS ===
${feedback}

=== ORIGINAL TICKET ===
${opts.transcript}`;
    const refineRes = await opts.client.queryProject({ projectId: opts.projectId, query: refinePrompt, model: refineModel });
    reply = (refineRes as unknown as string).trim();

    tell("Done!");
    return reply;
}
