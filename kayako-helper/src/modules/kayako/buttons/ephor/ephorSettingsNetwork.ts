/* Network helpers – v3.3.2
   • Saves EphorStore back to storage whenever projects refresh.
   • Propagates save after model checkbox changes.
*/
import type { EphorProject, EphorChannel, EphorStore } from "./ephorStore.ts";
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
            el.style.background = "hsl(203 100% 95%)";
            el.style.fontWeight = "600";
        }
        refs.projectListDiv.appendChild(el);
    }
}

export function rebuildChannelList(state: ModalState, refs: ModalRefs, filter = "") {
    const { store, channels } = state;
    refs.channelListDiv.textContent = "";
    if (!store.selectedProjectId) {
        refs.channelListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">Select a project first.</em>`;
        return;
    }
    const filtered = channels.filter(c => (c.name ?? "").toLowerCase().includes(filter.toLowerCase()));
    if (filtered.length === 0) {
        refs.channelListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">No chats found.</em>`;
        return;
    }
    for (const c of filtered) {
        const el = document.createElement("div");
        el.textContent = c.name || `(created ${new Date(c.created_at).toLocaleDateString()})`;
        el.dataset.channelId = c.id;
        el.style.cssText = "padding:6px 8px;cursor:pointer;border-radius:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
        if (c.id === store.selectedChannelId) {
            el.style.background = "hsl(203 100% 95%)";
            el.style.fontWeight = "600";
        }
        refs.channelListDiv.appendChild(el);
    }
}

export function rebuildModelList(state: ModalState, refs: ModalRefs) {
    const { store, availableModels } = state;
    refs.aiListDiv.textContent = "";

    if (availableModels.length === 0) {
        refs.aiListDiv.innerHTML = `<em style="color:#666;padding:8px;display:block;">Loading models…</em>`;
        return;
    }

    store.selectedModels = store.selectedModels.filter(m => availableModels.includes(m));
    if (store.selectedModels.length === 0) store.selectedModels = [availableModels[0]];
    saveEphorStore(store).then(r => {});

    for (const m of availableModels) {
        const label = document.createElement("label");
        const cb    = document.createElement("input");
        cb.type   = "checkbox";
        cb.value  = m;
        cb.checked= store.selectedModels.includes(m);
        cb.addEventListener("change", () => {
            if (cb.checked) store.selectedModels.push(m);
            else store.selectedModels = store.selectedModels.filter(x => x !== m);
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
