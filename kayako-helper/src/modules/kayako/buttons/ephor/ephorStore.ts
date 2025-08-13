// modules/kayako/buttons/ephor/ephorStore.ts
/* src/utils/ephorStore.ts (v1.4.1)
   • Channel type matches live API (no messages[])
*/
export interface EphorProject {
    project_id : string;
    owner_id   : string;
    name       : string;
    description: string | null;
    is_admin   : boolean;
    access_level: "admin" | "member";
    users      : Record<string, "admin" | "member">;
    model      : string;
    library_id : string;
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
export interface EphorStore {
    projects           : EphorProject[];
    selectedProjectId  : string | null;
    selectedChannelId  : string | null;
    logFullResponses   : boolean;
    messagePrompt      : string;
    selectedModels     : string[];
    draftModels        : string[];
    factModels         : string[];
    refineModels       : string[];
}

const KEY = "kh-ephor-store";

export async function loadEphorStore(): Promise<EphorStore> {
    const raw   = await chrome.storage.local.get(KEY);
    const saved = raw[KEY] as EphorStore | undefined;
    const defaults: EphorStore = {
        projects: [],
        selectedProjectId: null,
        selectedChannelId: null,
        logFullResponses: false,
        messagePrompt   : "Please summarize the following ticket.",
        selectedModels  : ["gpt-4o"],
        draftModels : ["gpt-4o"],
        factModels  : ["claude-3-opus-20240229"],
        refineModels: ["gpt-4o"],
    };
    return { ...defaults, ...saved };
}
export async function saveEphorStore(store: EphorStore) {
    await chrome.storage.local.set({ [KEY]: store });
}
