// Kayako Helper – ephorStore.ts (v2.5.0 – adds per-stage custom instructions)

/* Full file replaces the existing one */

export type ConnectionMode = "multiplexer" | "stream";
export type RunMode        = "automatic"   | "manual";

/* ------------------------------------------------------------------ */
/* NEW ▸ canned-prompt type                                            */
/* ------------------------------------------------------------------ */
export interface CannedPrompt {
    /** Stable UUID */
    id         : string;
    /** Human-readable title shown in the manager list */
    title      : string;
    /** Placeholder token, e.g. @#GREETING#@ (used in Prompt editor) */
    placeholder: string;
    /** Prompt body text */
    body       : string;
}

/* ------------------------------------------------------------------ */
/* NEW ▸ AI model selection presets                                    */
/* ------------------------------------------------------------------ */
export interface AISelection {
    /** Stable UUID */
    id    : string;
    /** Human-readable name */
    name  : string;
    /** List of model ids in this preset */
    models: string[];
}

/* ------------------------------------------------------------------ */
/* NEW ▸ Saved instructions                                           */
/* ------------------------------------------------------------------ */
export interface SavedInstruction {
    /** Stable UUID */
    id   : string;
    /** Human-readable name */
    name : string;
    /** Instruction body text */
    body : string;
}

/* ------------------------------------------------------------------ */
/* Workflow types                                                     */
/* ------------------------------------------------------------------ */
export interface WorkflowStage {
    /** Stable UUID so list ops don’t depend on array index */
    id           : string;
    /** Human label shown in the UI */
    name         : string;
    /** Prompt template – use {{TRANSCRIPT}} / {{PRV_RD_OUTPUT}} or @#RD_n_*#@ tokens */
    prompt       : string;
    /** One-or-many model IDs – first is used for cost display, all are run */
    selectedModels: string[];
}

/* ------------------------------------------------------------------ */
/* Server-side objects                                                */
/* ------------------------------------------------------------------ */
export interface EphorProject {
    project_id  : string;
    owner_id    : string;
    name        : string;
    description : string | null;
    is_admin    : boolean;
    access_level: "admin" | "member";
    users       : Record<string, "admin" | "member">;
    model       : string;
    library_id  : string;
}

export interface EphorChannel {
    id        : string;
    name      : string | null;
    project_id: string | null;
    creator_id: string;
    state     : "private" | "public";
    created_at: string;
    updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Persisted UI store                                                 */
/* ------------------------------------------------------------------ */
export interface EphorStore {
    /* selections */
    projects          : EphorProject[];
    selectedProjectId : string | null;
    selectedChannelId : string | null;

    /* misc prefs */
    logFullResponses  : boolean;
    messagePrompt     : string;

    /* manual-send model pick list */
    selectedModels    : string[];

    /* connection & run modes */
    preferredMode     : ConnectionMode;
    runMode           : RunMode;

    /* multi-stage workflow */
    workflowStages    : WorkflowStage[];

    /* query mode preference */
    preferredQueryMode?: "single" | "workflow";

    /* NEW ▸ user-defined canned prompts */
    cannedPrompts     : CannedPrompt[];

    /* NEW ▸ persisted outputs by stage */
    lastOutputs       : Record<string, { combined: string; byModel: Record<string,string> }>;

    /* 👇 NEW: caches the latest message id per channel (for correct parent_id) */
    lastMsgIdByChannel: Record<string, string>;

    /* 👇 NEW: per-ticket channel mapping (key = `${projectId}::${ticketId}`) */
    channelIdByContext: Record<string, string>;

    /* 👇 NEW: per-ticket project mapping (key = `${ticketId}`) */
    projectIdByContext?: Record<string, string>;

    /* 👇 NEW (legacy): per-ticket custom instructions (key = `${projectId}::${ticketId}`) */
    customInstructionsByContext: Record<string, string>;

    /* 👇 NEW: per-ticket **per-stage** custom instructions
       key = `${projectId}::${ticketId}::${stageId}` */
    customInstructionsByStage: Record<string, string>;

    /* 👇 NEW: governs which scope to use for workflow custom instructions
       "ticket" → one set per ticket across all stages
       "stage"  → distinct set per ticket per stage */
    instructionsScopeForWorkflow?: "ticket" | "stage";

    /* chat list sort order */
    channelSortOrder?: "alpha" | "created";

    /* UI preferences */
    showApiLog?: boolean;
    /** When false (default), API mode is hidden and unavailable */
    enableApiMode?: boolean;

    /* System prompt bodies (editable, non-deletable) */
    systemPromptBodies?: {
        fileAnalysis: string;
        pastTickets : string;
        styleGuide  : string;
    };

    /* Per-ticket system prompt bodies (key: `${projectId}::${ticketId}`) */
    systemPromptBodiesByContext?: Record<string, {
        fileAnalysis?: string;
        pastTickets?: string;
        styleGuide?: string;
    }>;

    /* 👇 NEW: saved AI model selection presets */
    aiSelections?: AISelection[];

    /* 👇 NEW: saved multi-stage workflow presets */
    workflows?: Array<{
        id: string;
        name: string;
        data: {
            workflowStages: WorkflowStage[];
            preferredMode: ConnectionMode;
            preferredQueryMode?: "single" | "workflow";
            runMode: RunMode;
            selectedModels: string[];
            systemPromptBodies?: EphorStore["systemPromptBodies"];
        };
    }>;

    /* 👇 NEW: saved instruction snippets */
    savedInstructions?: SavedInstruction[];

    /* 👇 NEW: persist last selected workflow id for UX continuity */
    lastSelectedWorkflowId?: string;

    /* 👇 NEW: per-ticket preference overrides for Mode/Workflow/Run */
    ticketPrefsByContext?: Record<string, {
        preferredMode?: ConnectionMode;
        preferredQueryMode?: "single" | "workflow";
        runMode?: RunMode;
    }>;
}

const KEY = "kh-ephor-store";

/* ------------------------------------------------------------------ */
/* Default workflow stages                                            */
/* ------------------------------------------------------------------ */
const defaultStages: WorkflowStage[] = [
    {
        id   : crypto.randomUUID(),
        name : "Check Past Tickets",
        prompt:
            `Please check these past tickets from the same requester and other members of their organization and make a highly detailed and informative summary of all important information that is relevant to the current ticket.

Make sure to ONLY include relevant information. If none of the information in the past tickets is relevant to the current ticket, reply with nothing except "No relevant information found in past tickets."

CURRENT TICKET
@#TRANSCRIPT#@


PAST TICKETS
@#PAST_TICKETS#@`,
        selectedModels: ["gpt-4o"],
    },
    {
        id   : crypto.randomUUID(),
        name : "Write Public Reply",
        prompt:
            `Please write a reply to this user

CURRENT TICKET
@#TRANSCRIPT#@

RELEVANT INFORMATION FROM PAST TICKETS
@#RD_1_COMBINED#@`,
        selectedModels: ["gpt-4o"],
    },
    {
        id   : crypto.randomUUID(),
        name : "Review Public Reply",
        prompt:
            `Please review and fact-check this reply. Please ensure: 

1) all possible troubleshooting steps have been provided
2) the client's concerns have been fully addressed 
3) the reply contains no incorrect information
4) CRUCIAL: confirm all UI paths look correct in case any paths are mentioned in the reply

CURRENT TICKET
@#TRANSCRIPT#@

RELEVANT INFORMATION FROM PAST TICKETS
@#RD_1_COMBINED#@

REPLY
@#RD_2_COMBINED#@`,
        selectedModels: ["claude-4-opus-latest-thinking", "gemini-2.5-pro", "gpt-4o"],
    },
    {
        id   : crypto.randomUUID(),
        name : "Adapt Initial Public Reply",
        prompt:
            `Here's what our RAG fact-checking AI ensemble output when asked to review the reply below. Please confirm their feedback does not include any mistakes and adapt the reply if necessary. Keep in mind that not all feedback may be relevant or accurate.

CURRENT TICKET
@#TRANSCRIPT#@

RELEVANT INFORMATION FROM PAST TICKETS
@#RD_1_COMBINED#@

REPLY
@#RD_2_COMBINED#@

FEEDBACK
@#RD_3_COMBINED#@`,
        selectedModels: ["gpt-4o"],
    },
];

/* ------------------------------------------------------------------ */
/* Load / save helpers                                                */
/* ------------------------------------------------------------------ */
export async function loadEphorStore(): Promise<EphorStore> {
    const raw   = await chrome.storage.local.get(KEY);
    const saved = raw[KEY] as EphorStore | undefined;

    const defaults: EphorStore = {
        projects          : [],
        selectedProjectId : null,
        selectedChannelId : null,

        logFullResponses  : false,
        messagePrompt     : "Please summarize the following ticket.",
        selectedModels    : ["gpt-4o"],

        preferredMode     : "stream",
        runMode           : "automatic",

        workflowStages    : defaultStages,
        preferredQueryMode: "workflow",

        /* NEW ▸ canned-prompts default empty list */
        cannedPrompts     : [],

        /* NEW ▸ outputs cache */
        lastOutputs: {},
        lastMsgIdByChannel: {},
        channelIdByContext: {},
        projectIdByContext: {},
        customInstructionsByContext: {},
        customInstructionsByStage: {},
        instructionsScopeForWorkflow: "ticket",
        channelSortOrder: "created",
        showApiLog: false,
        enableApiMode: false,
        systemPromptBodies: {
            fileAnalysis: "",
            pastTickets : "",
            styleGuide  : "",
        },
        systemPromptBodiesByContext: {},
        aiSelections: [],
        workflows: [],
        savedInstructions: [],
        lastSelectedWorkflowId: "",
        ticketPrefsByContext: {},
    };
    return {
        ...defaults,
        ...saved,
        lastOutputs: saved?.lastOutputs ?? {},
        lastMsgIdByChannel: saved?.lastMsgIdByChannel ?? {},
        channelIdByContext: saved?.channelIdByContext ?? {},
        projectIdByContext: saved?.projectIdByContext ?? {},
        customInstructionsByContext: saved?.customInstructionsByContext ?? {},
        customInstructionsByStage: saved?.customInstructionsByStage ?? {},
        instructionsScopeForWorkflow: saved?.instructionsScopeForWorkflow ?? "ticket",
        preferredQueryMode: saved?.preferredQueryMode ?? "workflow",
        channelSortOrder: saved?.channelSortOrder ?? "created",
        showApiLog: saved?.showApiLog ?? false,
        enableApiMode: saved?.enableApiMode ?? false,
        systemPromptBodies: {
            fileAnalysis: saved?.systemPromptBodies?.fileAnalysis ?? "",
            pastTickets : saved?.systemPromptBodies?.pastTickets  ?? "",
            styleGuide  : saved?.systemPromptBodies?.styleGuide   ?? "",
        },
        systemPromptBodiesByContext: saved?.systemPromptBodiesByContext ?? {},
        aiSelections: saved?.aiSelections ?? [],
        workflows: saved?.workflows ?? [],
        savedInstructions: saved?.savedInstructions ?? [],
        lastSelectedWorkflowId: saved?.lastSelectedWorkflowId ?? "",
        ticketPrefsByContext: saved?.ticketPrefsByContext ?? {},
    };
}

export async function saveEphorStore(store: EphorStore): Promise<void> {
    /* ------------------------------------------------------------------
     * Merge-save instead of clobbering the existing record. This prevents
     * older tabs (with stale copies) from overwriting newer changes such
     * as `preferredMode`.
     * ------------------------------------------------------------------ */
    const existingRaw = (await chrome.storage.local.get(KEY))[KEY] as
        Partial<EphorStore> | undefined;

    const merged: EphorStore = { ...(existingRaw ?? {}), ...store };

    /* Optional debug trace – handy for reproducing mode flips. */
    if (existingRaw?.preferredMode !== merged.preferredMode) {
        console.debug(
            `[Ephor] preferredMode changed → ${merged.preferredMode} (was ${existingRaw?.preferredMode ?? "undefined"})`,
        );
    }

    await chrome.storage.local.set({ [KEY]: merged });
}

/**
 * Runtime-only, per-ticket overrides for system placeholders.
 * Keyed by `${projectId}::${ticketId}`. Not persisted; cleared on reload.
 */
export const ephemeralSystemPromptBodiesByContext: Record<string, {
    fileAnalysis?: string;
    pastTickets?: string;
    styleGuide?: string;
}> = {};

/** Set or clear an ephemeral system body. Pass empty string to clear field. */
export function setEphemeralSystemBody(
    projectId: string | null | undefined,
    ticketId : string | null | undefined,
    field    : 'fileAnalysis' | 'pastTickets' | 'styleGuide',
    body     : string,
): void {
    try {
        const pid = String(projectId || '');
        const tid = String(ticketId || '');
        if (!(pid && tid)) return;
        const key = `${pid}::${tid}`;
        const rec = ephemeralSystemPromptBodiesByContext[key] || {};
        if (body) {
            (rec as any)[field] = body;
        } else {
            delete (rec as any)[field];
        }
        ephemeralSystemPromptBodiesByContext[key] = rec;
        try { console.debug('[Ephor][Ephemeral] set', { key, field, length: body?.length || 0 }); } catch {}
    } catch {}
}

/** Optional helper: clear all ephemeral entries for a context key. */
export function clearEphemeralForContext(projectId: string | null | undefined, ticketId: string | null | undefined): void {
    try {
        const pid = String(projectId || '');
        const tid = String(ticketId || '');
        if (!(pid && tid)) return;
        const key = `${pid}::${tid}`;
        if (ephemeralSystemPromptBodiesByContext[key]) {
            delete ephemeralSystemPromptBodiesByContext[key];
            try { console.debug('[Ephor][Ephemeral] cleared', { key }); } catch {}
        }
    } catch {}
}

