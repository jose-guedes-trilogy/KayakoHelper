/* Kayako Helper – ephorSettingsModal.ts (rev-v4.0.1)
   • Integrates logger + auto-save after any network updates.
*/
import { EphorClient }   from "@/background/ephorClient.ts";
import { sendEphorMessage } from "./aiReplyWorkflow.ts";
import { loadEphorStore, saveEphorStore, EphorStore, EphorChannel } from "./ephorStore.ts";

import { createSettingsModal } from "./ephorSettingsUI.ts";
import { makeLogger, LogFn }   from "./ephorSettingsLogger.ts";
import {
    ModalState, refreshProjects, fetchChannels,
    rebuildProjectList, rebuildChannelList, rebuildModelList,
} from "./ephorSettingsNetwork.ts";

export async function openEphorSettingsModal(store: EphorStore, client: EphorClient): Promise<void> {

    if (document.getElementById("kh-ephor-settings-modal")) return;

    /* modal & DOM refs ------------------------------------------------ */
    const { modal, refs } = createSettingsModal();
    document.body.appendChild(modal);

    const state: ModalState = {
        store,
        client,
        channels: [] as EphorChannel[],
        hasProjects: false,
        availableModels: [],
    };

    const log = makeLogger(store, refs.logPre, refs.logContainer);
    EphorClient.setLogger(log);
    refs.verboseCbx.checked = !!store.logFullResponses;
    EphorClient.setVerbose(refs.verboseCbx.checked);

    /* basic UI events ------------------------------------------------- */
    refs.verboseCbx.addEventListener("change", () => {
        store.logFullResponses = refs.verboseCbx.checked;
        EphorClient.setVerbose(refs.verboseCbx.checked);
        void saveEphorStore(store);
        log(`Log verbosity → ${refs.verboseCbx.checked ? "FULL" : "BASIC"}`);
    });
    refs.closeBtn.addEventListener("click", () => { EphorClient.setLogger(null); modal.remove(); });

    modal.querySelector<HTMLButtonElement>("#kh-ephor-copy-log")!
        .addEventListener("click", () =>
            navigator.clipboard.writeText(refs.logPre.textContent || "")
                .then(() => log("Log copied"))
        );
    modal.querySelector<HTMLButtonElement>("#kh-ephor-clear-log")!
        .addEventListener("click", () => { refs.logPre.textContent = ""; log("Log cleared"); });

    /* search boxes */
    refs.projectSearchInp.addEventListener("input", () =>
        rebuildProjectList(state, refs, refs.projectSearchInp.value));
    refs.channelSearchInp.addEventListener("input", () =>
        rebuildChannelList(state, refs, refs.channelSearchInp.value));

    /* toolbar --------------------------------------------------------- */
    refs.refreshBtn.addEventListener("click", () => void refreshProjects(state, refs, log));

    refs.newChatBtn.addEventListener("click", async () => {
        if (!store.selectedProjectId) return alert("Select a project first.");
        const name = prompt("Enter new chat name:"); if (!name) return;

        log("REQUEST", `POST /projects/${store.selectedProjectId}/channels {name:"${name}"}`);
        try {
            const ch = await client.createChannel(store.selectedProjectId, name);
            log("RESPONSE (new channel)", ch.channel_id ?? ch.id);
            await fetchChannels(state, refs, log);
        } catch (err: any) {
            log("ERROR creating chat", err.message);
        }
    });

    refs.sendBtn.addEventListener("click", async () => {
        if (!store.selectedProjectId) return alert("Pick a project.");
        if (!store.selectedChannelId) return alert("Pick a chat.");
        if (!refs.promptInput.value.trim()) return alert("Write a prompt.");
        if (store.selectedModels.length === 0) return alert("Choose at least one model.");

        refs.sendBtn.disabled = true; refs.sendBtn.textContent = "Sending…";
        try {
            await sendEphorMessage({
                client,
                store,
                projectId     : store.selectedProjectId,
                channelId     : store.selectedChannelId,
                prompt        : refs.promptInput.value,
                selectedModels: store.selectedModels,
                onStatus      : log,
            });
        } catch (err) {
            log("FAILED TO SEND", (err as Error).message);
        } finally {
            refs.sendBtn.disabled = false; refs.sendBtn.textContent = "Send Message";
        }
    });

    /* list item clicks ----------------------------------------------- */
    refs.projectListDiv.addEventListener("click", e => {
        const id = (e.target as HTMLElement).dataset.projectId;
        if (!id || id === store.selectedProjectId) return;

        store.selectedProjectId = id;
        store.selectedChannelId = null;
        state.channels = [];
        void saveEphorStore(store);

        rebuildProjectList(state, refs, refs.projectSearchInp.value);
        rebuildChannelList(state, refs);
        void fetchChannels(state, refs, log);
    });
    refs.channelListDiv.addEventListener("click", e => {
        const id = (e.target as HTMLElement).dataset.channelId;
        if (!id) return;
        store.selectedChannelId = id;
        void saveEphorStore(store);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
    });

    /* initial load ---------------------------------------------------- */
    rebuildProjectList(state, refs);
    rebuildChannelList(state, refs);
    void refreshProjects(state, refs, log);

    client.listModels()
        .then(m => { state.availableModels = m.sort(); rebuildModelList(state, refs); })
        .catch(err => log("ERROR fetching models", err.message));

    refs.promptInput.value = store.messagePrompt;
    refs.promptInput.addEventListener("input", () => {
        store.messagePrompt = refs.promptInput.value;
        void saveEphorStore(store);
    });
}
