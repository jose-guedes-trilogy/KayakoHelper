/* Network helpers – v3.3.2
   • Saves EphorStore back to storage whenever projects refresh.
   • Propagates save after model checkbox changes.
*/
import type {EphorProject, EphorChannel, EphorStore, WorkflowStage} from "./ephorStore.ts";
import type { LogFn }   from "./ephorSettingsLogger.ts";
import type { ModalRefs } from "./ephorSettingsUI.ts";
import { EphorClient }  from "@/background/ephorClient.ts";
import { saveEphorStore } from "./ephorStore.ts";

export interface ModalState {
    store          : EphorStore;
    client         : EphorClient;
    channels       : EphorChannel[];
    hasProjects    : boolean;
    availableModels: string[];
}

/* ---------- list builders ---------- */
export function rebuildProjectList(state: ModalState, refs: ModalRefs, filter = "") {
    const { store } = state;
    refs.projectListDiv.textContent = "";

    const filtered = store.projects.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()));

    if (filtered.length === 0) {
        refs.projectListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">${
            state.hasProjects ? "No projects found." : "Click Refresh to load."
        }</em>`;
        return;
    }

    for (const p of filtered) {
        const el = document.createElement("div");
        el.textContent = p.name;
        el.dataset.projectId = p.project_id;
        el.style.cssText = "padding:6px 8px;cursor:pointer;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        if (p.project_id === store.selectedProjectId) {
            el.style.position = "relative";
            el.style.border = "1px solid #a7bee7";
            el.style.background = "white";
            el.style.boxShadow = "0 1px 3px 0 #00000017";
            el.style.color = "hsl(0 0% 26% / 1)";
            el.style.fontWeight = "600";
        }
        refs.projectListDiv.appendChild(el);
    }
}

export function rebuildChannelList(state: ModalState, refs: ModalRefs, filter = "") {
    const { store, channels } = state;

    /* API mode ignores channel_id – grey-out UI */
    const inApi = store.preferredMode === "multiplexer";
    const usingWorkflow = refs.queryWorkflowRadio?.checked;
    if (inApi || usingWorkflow) {
        refs.channelSearchInp.disabled = true;
        const msg = inApi
            ? "Connection Mode set to API"
            : (usingWorkflow ? "Multi-stage mode autocreates chats." : "");
        refs.channelListDiv.innerHTML =
            `<em style="color:#666;padding:8px;display:block;font-style:italic;">${msg}</em>`;
        refs.channelListDiv.style.filter = "grayscale(1)";
        refs.channelListDiv.style.opacity = "0.6";
        refs.channelListDiv.style.background = "#f5f5f5";
        return;
    }
    refs.channelSearchInp.disabled = false;
    refs.channelListDiv.style.filter = "";
    refs.channelListDiv.style.opacity = "";
    refs.channelListDiv.style.background = "";

    refs.channelListDiv.textContent = "";
    if (!store.selectedProjectId) {
        refs.channelListDiv.innerHTML =
            `<em style="color:#666;padding:8px;display:block;">Select a project first.</em>`;
        return;
    }
    let visible = channels.filter(c => (c.name ?? "").toLowerCase().includes(filter.toLowerCase()));
    const order = store.channelSortOrder ?? "alpha";
    if (order === "alpha") {
        visible.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
        // newest first by created_at
        visible.sort((a, b) => new Date(b.created_at || 0).valueOf() - new Date(a.created_at || 0).valueOf());
    }
    if (visible.length === 0) {
        refs.channelListDiv.innerHTML =
            `<em style="color:#666;padding:8px;display:block;">No chats found.</em>`;
        return;
    }
    for (const c of visible) {
        const el = document.createElement("div");
        el.textContent = c.name || `(created ${new Date(c.created_at).toLocaleDateString()})`;
        el.dataset.channelId = c.id;
        el.style.cssText = "padding:6px 8px;cursor:pointer;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        if (c.id === store.selectedChannelId) {
            el.style.position = "relative";
            el.style.border = "1px solid #a7bee7";
            el.style.background = "white";
            el.style.boxShadow = "0 1px 3px 0 #00000017";
            el.style.color = "hsl(0 0% 26% / 1)";
            el.style.fontWeight = "600";
        }
        refs.channelListDiv.appendChild(el);
    }
}


export function rebuildModelList(
    state : ModalState,
    refs  : ModalRefs,
    filter= "",
    stage : WorkflowStage | null = null,
) {
    const { store, availableModels } = state;
    refs.aiListDiv.textContent = "";

    const visible = availableModels.filter(m => m.toLowerCase().includes(filter.toLowerCase()));
    if (visible.length === 0) {
        refs.aiListDiv.innerHTML =
            `<em style="color:#666;padding:8px;display:block;">No models found.</em>`;
        return;
    }

    const isStage = !!stage;
    const sel = isStage ? stage!.selectedModels : store.selectedModels;

    for (const m of visible) {
        const label = document.createElement("label");
        const cb    = document.createElement("input");
        cb.type    = "checkbox";
        cb.value   = m;
        cb.checked = sel.includes(m);

        cb.addEventListener("change", () => {
            if (cb.checked) sel.push(m);
            else {
                const idx = sel.indexOf(m);
                if (idx !== -1) sel.splice(idx, 1);
            }
            /* persist */
            void saveEphorStore(store);
        });

        label.appendChild(cb);
        label.appendChild(document.createTextNode(m));
        refs.aiListDiv.appendChild(label);
    }
}

/* ---------- network ---------- */
export async function refreshProjects(state: ModalState, refs: ModalRefs, log: LogFn) {
    refs.projectListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">Loading…</em>`;
    log("REQUEST", "GET /projects");

    try {
        const remote = await state.client.listProjects() as EphorProject[];
        state.hasProjects = true;
        remote.sort((a, b) => a.name.localeCompare(b.name));
        state.store.projects = remote;
        await saveEphorStore(state.store);

        log("RESPONSE (projects)", remote.map(p => p.name));
        refs.projectSearchInp.placeholder = `Search ${remote.length} projects…`;
        rebuildProjectList(state, refs, refs.projectSearchInp.value);

        /* NEW ➜ auto-fetch channels if a project is already selected */
        if (state.store.selectedProjectId) {
            // ensure selected ID still exists
            const exists = remote.some(p => p.project_id === state.store.selectedProjectId);
            if (exists) await fetchChannels(state, refs, log);
            else {
                state.store.selectedProjectId = null;
                await saveEphorStore(state.store);
                rebuildChannelList(state, refs);
            }
        }
    } catch (err: any) {
        log("ERROR fetching projects", err.message);
        refs.projectListDiv.innerHTML =
            `<span style="color:#c33;padding:8px;display:block;">Fetch failed.</span>`;
    }
}


export async function fetchChannels(state: ModalState, refs: ModalRefs, log: LogFn) {
    const pid = state.store.selectedProjectId;
    if (!pid) { rebuildChannelList(state, refs); return; }

    refs.channelListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">Loading chats…</em>`;
    log("REQUEST", `GET /projects/${pid}/channels`);

    try {
        state.channels = await state.client.listChannels(pid);
        log("RESPONSE (channels)", state.channels.length);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
    } catch (err: any) {
        log("ERROR fetching channels", err.message);
        refs.channelListDiv.innerHTML =
            `<em style="color:#c33;padding:8px;display:block;">Failed to load chats.</em>`;
    }
}
