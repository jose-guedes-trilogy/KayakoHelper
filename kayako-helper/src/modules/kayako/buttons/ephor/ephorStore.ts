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

    /* System prompt bodies (editable, non-deletable) */
    systemPromptBodies?: {
        fileAnalysis: string;
        pastTickets : string;
        styleGuide  : string;
    };

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
}

const KEY = "kh-ephor-store";

/* ------------------------------------------------------------------ */
/* Default workflow stages                                            */
/* ------------------------------------------------------------------ */
const defaultStages: WorkflowStage[] = [
    {
        id   : crypto.randomUUID(),
        name : "Write Public Reply",
        prompt:
            `Write a public reply using the following ticket transcript:

{{TRANSCRIPT}}`,
        selectedModels: ["gpt-4o"],
    },
    {
        id   : crypto.randomUUID(),
        name : "Review Public Reply",
        prompt:
            `Review the draft reply below for accuracy, clarity and tone.  
Return ONLY corrections / suggested edits.

{{PRV_RD_OUTPUT}}`,
        selectedModels: ["claude-4-opus-latest-thinking", "gemini-2.5-pro", "gpt-4o"],
    },
    {
        id   : crypto.randomUUID(),
        name : "Adapt Initial Public Reply",
        prompt:
            `Apply the reviewer corrections to produce the final reply.

=== CORRECTIONS ===
{{PRV_RD_OUTPUT}}

=== ORIGINAL TRANSCRIPT ===
{{TRANSCRIPT}}`,
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

        preferredMode     : "multiplexer",
        runMode           : "automatic",

        workflowStages    : defaultStages,
        preferredQueryMode: "workflow",

        /* NEW ▸ canned-prompts default empty list */
        cannedPrompts     : [],

        /* NEW ▸ outputs cache */
        lastOutputs: {},
        lastMsgIdByChannel: {},
        channelIdByContext: {},
        customInstructionsByContext: {},
        customInstructionsByStage: {},
        instructionsScopeForWorkflow: "ticket",
        channelSortOrder: "created",
        showApiLog: false,
        systemPromptBodies: {
            fileAnalysis: "",
            pastTickets : "",
            styleGuide  : "",
        },
        aiSelections: [],
        workflows: [],
    };
    return {
        ...defaults,
        ...saved,
        lastOutputs: saved?.lastOutputs ?? {},
        lastMsgIdByChannel: saved?.lastMsgIdByChannel ?? {},
        channelIdByContext: saved?.channelIdByContext ?? {},
        customInstructionsByContext: saved?.customInstructionsByContext ?? {},
        customInstructionsByStage: saved?.customInstructionsByStage ?? {},
        instructionsScopeForWorkflow: saved?.instructionsScopeForWorkflow ?? "ticket",
        preferredQueryMode: saved?.preferredQueryMode ?? "workflow",
        channelSortOrder: saved?.channelSortOrder ?? "created",
        showApiLog: saved?.showApiLog ?? false,
        systemPromptBodies: {
            fileAnalysis: saved?.systemPromptBodies?.fileAnalysis ?? "",
            pastTickets : saved?.systemPromptBodies?.pastTickets  ?? "",
            styleGuide  : saved?.systemPromptBodies?.styleGuide   ?? "",
        },
        aiSelections: saved?.aiSelections ?? [],
        workflows: saved?.workflows ?? [],
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

