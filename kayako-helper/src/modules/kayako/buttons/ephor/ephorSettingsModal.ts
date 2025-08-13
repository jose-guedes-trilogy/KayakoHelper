// Kayako Helper – ephorSettingsModal.ts (v7.7.0)
// • Accurate cross-workflow progress count (sum of models across stages).
// • Prevents duplicate sends (re-entrancy guard).
// • Outputs tab shows only selected AIs; marks finished models (✓) if saved.
// • Restores persisted outputs (store.lastOutputs) into outputs textareas.
// • Rebuild Outputs on “ephorOutputsUpdated” events.
// • No UI action triggers network calls except explicit buttons.
// • NEW: Cancel button & AbortSignal wiring; autosave all output textareas; progress shows stage name + short status.

/* Full file replaces the existing one */

import { EphorClient } from "@/background/ephorClient.ts";
import { sendEphorMessage, runAiReplyWorkflow } from "./aiReplyWorkflow.ts";
import { loadEphorStore, saveEphorStore, EphorStore, WorkflowStage } from "./ephorStore.ts";

import { createSettingsModal } from "./ephorSettingsUI.ts";
import { makeLogger, LogFn } from "./ephorSettingsLogger.ts";
import {
    ModalState,
    refreshProjects,
    fetchChannels,
    rebuildProjectList,
    rebuildChannelList,
    rebuildModelList,
} from "./ephorSettingsNetwork.ts";
import { fetchTranscript } from "@/utils/api.js";

import { openCannedPromptModal } from "./ephorCannedPromptModal.ts";

import { attachPlaceholderRowHandler, rebuildPlaceholderRow } from "./modal/placeholderRow.ts";

/* ------------------------------------------------------------------ */
/* Entry-point                                                        */
/* ------------------------------------------------------------------ */
export async function openEphorSettingsModal(
    store: EphorStore,
    client: EphorClient,
): Promise<void> {
    /* ---------- avoid duplicates ---------- */
    if (document.getElementById("kh-ephor-settings-modal")) return;

    /* ---------- build modal & refs ---------- */
    const { modal, refs } = createSettingsModal();
    document.body.appendChild(modal);

    attachPlaceholderRowHandler(refs); // mount delegated click handler

    /* ---------- state container ---------- */
    const state: ModalState = {
        store,
        client,
        channels: [],
        hasProjects: false,
        availableModels: [],
    };

    /* ────────────────────────────────────────────────────────────────
     * Keep every open modal in-sync when another tab edits the store
     * ──────────────────────────────────────────────────────────────── */
    chrome.storage.onChanged.addListener(ch => {
        if (!("kh-ephor-store" in ch)) return;
        const newVal = ch["kh-ephor-store"].newValue as EphorStore;

        // update the in-memory copy used by this modal
        store.preferredMode = newVal.preferredMode;

        // reflect in the UI (radio buttons + channel list)
        refs.modeMultiplexer.checked = newVal.preferredMode === "multiplexer";
        refs.modeStream.checked = newVal.preferredMode === "stream";
        rebuildChannelList(state, refs); // greys/ungreys chat list as needed
    });

    /* ---------- logger hookup ---------- */
    const log = makeLogger(store, refs.logPre, refs.logContainer);
    EphorClient.setLogger(log);

    /* ---------- log collapse toggle (starts collapsed via CSS) ---------- */
    let logCollapsed = true;
    refs.logToggle.addEventListener("click", () => {
        logCollapsed = !logCollapsed;
        refs.logContainer.style.display = logCollapsed ? "none" : "";
    });

    /* ------------------------------------------------------------------ *
     * Helpers – current mode / stage / models                            *
     * ------------------------------------------------------------------ */
    let currentStageId = store.workflowStages[0]?.id ?? "";
    let useWorkflow = true; // updated by updateQueryMode()

    const getCurrentModels = (): string[] =>
        useWorkflow
            ? store.workflowStages.find(s => s.id === currentStageId)?.selectedModels ?? []
            : store.selectedModels;

    /* ------------------------------------------------------------------ *
     * OUTPUT-tabs builder                                                *
     * ------------------------------------------------------------------ */
    function rebuildOutputTabs(): void {
        const tabBar = modal.querySelector<HTMLDivElement>("#kh-model-tabs")!;
        const content = modal.querySelector<HTMLDivElement>("#kh-model-content")!;
        tabBar.textContent = "";
        content.textContent = "";

        /* decide where to read saved outputs from */
        const saved = useWorkflow
            ? store.lastOutputs[currentStageId] // current stage
            : store.lastOutputs["__single__"]; // single-stage runs

        /* model list for tabs */
        let models = getCurrentModels();
        if (models.length === 0 && saved?.byModel) {
            models = Object.keys(saved.byModel); // fall back to whatever was saved
        }
        const list = models.length ? models : ["No models selected"];

        const tabs: HTMLButtonElement[] = [];

        list.forEach(label => {
            /* tab button */
            const btn = document.createElement("button");
            btn.textContent = saved?.byModel?.[label] ? `✓ ${label}` : label;
            tabBar.appendChild(btn);
            tabs.push(btn);

            /* textarea */
            const ta = document.createElement("textarea");
            ta.value = saved?.byModel?.[label] ?? "";
            if (!ta.value) {
                ta.placeholder = models.length ? "Awaiting output…" : "Select models in the Settings tab first.";
            }
            content.appendChild(ta);

            /* 🔸 AUTOSAVE this output field (ALL fields autosave) */
            let t: number | null = null;
            const pseudoId = useWorkflow ? currentStageId : "__single__";
            ta.addEventListener("input", () => {
                const bucket =
                    store.lastOutputs[pseudoId] ?? (store.lastOutputs[pseudoId] = { combined: "", byModel: {} });
                bucket.byModel[label] = ta.value;
                bucket.combined = Object.values(bucket.byModel)
                    .filter(Boolean)
                    .join("\n\n");
                if (t) window.clearTimeout(t);
                t = window.setTimeout(() => {
                    void saveEphorStore(store);
                }, 200);
            });

            /* click-to-activate */
            btn.addEventListener("click", () => {
                tabs.forEach(b => b.classList.toggle("active", b === btn));
                Array.from(content.children).forEach(el => ((el as HTMLElement).style.display = el === ta ? "block" : "none"));
            });
        });
        if (tabs.length) tabs[0].click();
    }

    /* Rebuild on persisted-output updates during a run */
    const outputsUpdatedListener = () => {
        // If modal is already gone, ignore
        if (!document.body.contains(modal)) return;
        rebuildOutputTabs();
    };
    document.addEventListener("ephorOutputsUpdated", outputsUpdatedListener);

    /* ------------------------------------------------------------------ *
     * Main-tab helper                                                    *
     * ------------------------------------------------------------------ */
    function setMainTab(t: "settings" | "outputs") {
        const isSettings = t === "settings";
        refs.paneSettings.style.display = isSettings ? "block" : "none";
        refs.paneOutputs.style.display = isSettings ? "none" : "block";
        refs.tabSettingsBtn.classList.toggle("active", isSettings);
        refs.tabOutputsBtn.classList.toggle("active", !isSettings);

        if (!isSettings) rebuildOutputTabs();
    }
    refs.tabSettingsBtn.addEventListener("click", () => setMainTab("settings"));
    refs.tabOutputsBtn.addEventListener("click", () => setMainTab("outputs"));

    /* ------------------------------------------------------------------ *
     * Connection-mode (multiplexer / stream)                             *
     * ------------------------------------------------------------------ */
    refs.modeMultiplexer.checked = store.preferredMode === "multiplexer";
    refs.modeStream.checked = store.preferredMode === "stream";
    const onMode = () => {
        store.preferredMode = refs.modeMultiplexer.checked ? "multiplexer" : "stream";
        void saveEphorStore(store);
        log(`Connection mode → ${store.preferredMode}`);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
    };
    refs.modeMultiplexer.addEventListener("change", onMode);
    refs.modeStream.addEventListener("change", onMode);

    /* ------------------------------------------------------------------ *
     * QUERY-MODE (single vs workflow)                                    *
     * ------------------------------------------------------------------ */
    refs.queryWorkflowRadio.checked = true;

    function updateQueryMode() {
        useWorkflow = refs.queryWorkflowRadio.checked;

        /* stage bar visibility */
        refs.stageBarDiv.style.display = useWorkflow ? "" : "none";

        /* 🔧 Run-mode selector enable/disable */
        const enableRun = useWorkflow;
        refs.runRow.style.opacity = enableRun ? "1" : "0.45";
        refs.runAutoRadio.disabled = refs.runManualRadio.disabled = !enableRun;
        if (!enableRun) {
            refs.runAutoRadio.checked = true;
            store.runMode = "automatic";
            void saveEphorStore(store);
        }

        if (useWorkflow) {
            onStageChange();
        } else {
            refs.promptInput.value = store.messagePrompt;
            rebuildModelList(state, refs, refs.modelSearchInp.value, null);
        }

        rebuildOutputTabs();
        rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCannedButtons);
    }

    refs.querySingleRadio.addEventListener("change", updateQueryMode);
    refs.queryWorkflowRadio.addEventListener("change", updateQueryMode);

    /* ------------------------------------------------------------------ *
     * Run-mode (auto / manual)                                           *
     * ------------------------------------------------------------------ */
    refs.runAutoRadio.checked = store.runMode === "automatic";
    refs.runManualRadio.checked = store.runMode === "manual";
    const updateRunMode = () => {
        store.runMode = refs.runAutoRadio.checked ? "automatic" : "manual";
        void saveEphorStore(store);
    };
    refs.runAutoRadio.addEventListener("change", updateRunMode);
    refs.runManualRadio.addEventListener("change", updateRunMode);

    /* ------------------------------------------------------------------ *
     * Stage bar                                                          *
     * ------------------------------------------------------------------ */
    function rebuildStageBar(): void {
        refs.stageBarDiv.textContent = "";
        for (const s of store.workflowStages) {
            const tab = Object.assign(document.createElement("span"), { textContent: s.name });
            tab.className = "kh-bar-btn" + (s.id === currentStageId ? " active" : "");
            tab.addEventListener("click", () => {
                currentStageId = s.id;
                onStageChange();
            });
            refs.stageBarDiv.appendChild(tab);
        }
        refs.stageBarDiv.appendChild(refs.addStageBtn);
    }

    refs.addStageBtn.addEventListener("click", () => {
        const name = prompt("Stage name:");
        if (!name) return;
        const promptText = prompt("Prompt template (use @#RD_1_COMBINED#@ / @#TRANSCRIPT#@):", "@#TRANSCRIPT#@");
        if (promptText === null) return;

        const stg: WorkflowStage = {
            id: crypto.randomUUID(),
            name: name.trim(),
            prompt: promptText.trim(),
            selectedModels: [state.availableModels[0] ?? "gpt-4o"],
        };
        store.workflowStages.push(stg);
        currentStageId = stg.id;
        void saveEphorStore(store);
        rebuildStageBar();
        onStageChange();
    });

    /* ------------------------------------------------------------------ *
     * Per-stage editing                                                  *
     * ------------------------------------------------------------------ */
    function onStageChange() {
        const stg = store.workflowStages.find(x => x.id === currentStageId);
        if (!stg) return;
        refs.promptInput.value = stg.prompt;
        rebuildModelList(state, refs, refs.modelSearchInp.value, stg);
        rebuildStageBar();
        rebuildOutputTabs();
        rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCannedButtons);
    }

    /* keep prompt text isolated between single-stage and workflow */
    refs.promptInput.addEventListener("input", () => {
        if (useWorkflow) {
            const stg = store.workflowStages.find(x => x.id === currentStageId);
            if (stg) stg.prompt = refs.promptInput.value;
        } else {
            store.messagePrompt = refs.promptInput.value;
        }
        void saveEphorStore(store);
    });

    /* ------------------------------------------------------------------ *
     * Model search                                                       *
     * ------------------------------------------------------------------ */
    refs.modelSearchInp.addEventListener("input", () =>
        rebuildModelList(
            state,
            refs,
            refs.modelSearchInp.value,
            useWorkflow ? store.workflowStages.find(x => x.id === currentStageId)! : null,
        ),
    );

    /* ------------------------------------------------------------------ *
     * Live tab sync on (un)checking model boxes                          *
     * ------------------------------------------------------------------ */
    refs.aiListDiv.addEventListener("change", rebuildOutputTabs);

    /* ------------------------------------------------------------------ *
     * Verbose log toggle                                                 *
     * ------------------------------------------------------------------ */
    refs.verboseCbx.checked = !!store.logFullResponses;
    refs.verboseCbx.addEventListener("change", () => {
        store.logFullResponses = refs.verboseCbx.checked;
        void saveEphorStore(store);
        log(`Log verbosity → ${store.logFullResponses ? "FULL" : "BASIC"}`);
    });

    /* ------------------------------------------------------------------ *
     * Close & log buttons                                                *
     * ------------------------------------------------------------------ */
    refs.closeBtn.addEventListener("click", () => {
        EphorClient.setLogger(null);
        document.removeEventListener("ephorOutputsUpdated", outputsUpdatedListener);
        modal.remove();
    });
    modal
        .querySelector<HTMLButtonElement>("#kh-ephor-copy-log")!
        .addEventListener("click", () =>
            navigator.clipboard
                .writeText(refs.logPre.textContent || "")
                .then(() => log("Log copied")),
        );
    modal
        .querySelector<HTMLButtonElement>("#kh-ephor-clear-log")!
        .addEventListener("click", () => {
            refs.logPre.textContent = "";
            log("Log cleared");
        });

    /* ------------------------------------------------------------------ *
     * Project / chat search                                              *
     * ------------------------------------------------------------------ */
    refs.projectSearchInp.addEventListener("input", () =>
        rebuildProjectList(state, refs, refs.projectSearchInp.value),
    );
    refs.channelSearchInp.addEventListener("input", () =>
        rebuildChannelList(state, refs, refs.channelSearchInp.value),
    );

    /* ------------------------------------------------------------------ *
     * Toolbar buttons                                                    *
     * ------------------------------------------------------------------ */
    refs.refreshBtn.addEventListener("click", () => void refreshProjects(state, refs, log));

    refs.newChatBtn.addEventListener("click", async () => {
        if (!store.selectedProjectId) return alert("Select a project first.");
        const name = prompt("Enter new chat name:");
        if (!name) return;

        log("REQUEST", `POST /projects/${store.selectedProjectId}/channels {name:"${name}"}`);
        try {
            const ch = await client.createChannel(store.selectedProjectId, name);
            log("RESPONSE (new channel)", ch.channel_id ?? ch.id);
            await fetchChannels(state, refs, log);
        } catch (err: any) {
            log("ERROR creating chat", err.message);
        }
    });

    /* ------------------------------------------------------------------ *
     * SEND / CANCEL                                                      *
     * ------------------------------------------------------------------ */
    let isSending = false;
    let abortCtl: AbortController | null = null;

    const setProgress = (stageName: string, curr: number, total: number, status = "") => {
        refs.progressBadge.textContent = `${stageName} · ${curr}/${total}${status ? " — " + status : ""}`;
    };

    refs.cancelBtn.addEventListener("click", () => {
        abortCtl?.abort();
    });

    refs.sendBtn.addEventListener("click", async () => {
        if (isSending) return; // re-entrancy guard
        if (!store.selectedProjectId) return alert("Pick a project.");

        /* prompt + models */
        let promptToSend = "";
        let modelsToUse: string[] = [];
        if (useWorkflow) {
            const stg = store.workflowStages.find(x => x.id === currentStageId)!;
            promptToSend = stg.prompt;
            modelsToUse = [...stg.selectedModels];
        } else {
            promptToSend = refs.promptInput.value.trim();
            modelsToUse = [...store.selectedModels];
        }
        if (!promptToSend) return alert("Write a prompt.");
        if (modelsToUse.length === 0) return alert("Pick at least one model.");

        const channelId = store.preferredMode === "multiplexer" ? "" : store.selectedChannelId ?? "";
        if (store.preferredMode !== "multiplexer" && !channelId) return alert("Pick a chat.");

        // Cross-workflow accurate total (sum of all stages’ selected models)
        const totalForWorkflow =
            useWorkflow && store.runMode === "automatic"
                ? store.workflowStages.reduce((a, s) => a + (s.selectedModels?.length ?? 0), 0)
                : modelsToUse.length;

        const stageName = useWorkflow
            ? store.workflowStages.find(s => s.id === currentStageId)?.name ?? "Stage"
            : "Single Stage";
        setProgress(stageName, 0, totalForWorkflow, "sending");
        refs.sendBtn.disabled = true;
        refs.sendBtn.textContent = "Sending…";
        refs.cancelBtn.style.display = "";
        refs.cancelBtn.disabled = false;
        isSending = true;
        abortCtl = new AbortController();

        try {
            if (useWorkflow && store.runMode === "automatic") {
                /* full chain */
                await runAiReplyWorkflow(
                    client,
                    store,
                    store.selectedProjectId,
                    await fetchTranscript(1000),
                    m => {
                        log("STATUS", m);
                        // short status hints
                        const parts = refs.progressBadge.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
                        const curr = parts ? Number(parts[1]) : 0;
                        if (/Retrying/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "retrying");
                        else if (/failed/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "error");
                        else if (/Query|cost|STATUS/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "sending");
                    },
                    refs.progressBadge,
                    abortCtl.signal,
                );
                setMainTab("outputs"); // show results
            } else {
                /* single stage */
                const result = await sendEphorMessage({
                    client,
                    store,
                    projectId: store.selectedProjectId,
                    channelId,
                    prompt: promptToSend,
                    selectedModels: modelsToUse,
                    progressEl: refs.progressBadge,
                    onStatus: m => {
                        log("STATUS", m);
                        const parts = refs.progressBadge.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
                        const curr = parts ? Number(parts[1]) : 0;
                        if (/Retrying/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "retrying");
                        else if (/failed/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "error");
                        else if (/Query|cost|STATUS/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "sending");
                    },
                    onProgressTick: (_m, phase) => {
                        const parts = refs.progressBadge.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
                        const curr = parts ? Number(parts[1]) : 0;
                        const total = parts ? Number(parts[2]) : totalForWorkflow;
                        const c = Math.min(curr + (phase === "start" ? 0 : 1), total);
                        setProgress(stageName, c, total);
                    },
                    persistStageId: useWorkflow ? currentStageId : "__single__",
                    abortSignal: abortCtl.signal,
                });

                // Persist outputs for "single" run (or current stage) and refresh Outputs tab
                const pseudoId = useWorkflow ? currentStageId : "__single__";
                store.lastOutputs[pseudoId] = { combined: result.combined, byModel: { ...result.byModel } };
                await saveEphorStore(store);
                document.dispatchEvent(new CustomEvent("ephorOutputsUpdated", { detail: { stageId: pseudoId } }));

                if (useWorkflow && store.runMode === "manual") {
                    /* advance to next stage */
                    const stages = store.workflowStages;
                    const idx = stages.findIndex(s => s.id === currentStageId);
                    if (idx >= 0 && idx < stages.length - 1) {
                        currentStageId = stages[idx + 1].id;
                        onStageChange();
                        setMainTab("settings");
                    }
                }
                setMainTab("outputs"); // show results
            }
        } catch (e: any) {
            log("ERROR", String(e));
            if (e?.name === "AbortError" || /cancel/i.test(String(e))) {
                refs.progressBadge.textContent = "Cancelled";
            } else {
                alert(String(e));
                refs.progressBadge.textContent = "Error";
            }
        } finally {
            refs.sendBtn.disabled = false;
            refs.sendBtn.textContent = "Send";
            refs.cancelBtn.disabled = true;
            refs.cancelBtn.style.display = "none";
            isSending = false;
            abortCtl = null;
        }
    });

    /* ------------------------------------------------------------------ *
     * List clicks                                                        *
     * ------------------------------------------------------------------ */
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

        // 👇 NEW: pre-read /messages and cache the latest id for correct parenting
        if (store.selectedProjectId) {
            const pid = store.selectedProjectId;
            log("REQUEST", `GET /projects/${pid}/channels/${id}/messages`);
            state.client.getChannelMessages(pid, id)
                .then((msgs: any[]) => {
                    // pick newest by timestamp (defensive)
                    const newest = (msgs ?? []).reduce((best, m) => {
                        const bt = new Date(best?.timestamp ?? 0).valueOf();
                        const mt = new Date(m?.timestamp ?? 0).valueOf();
                        return mt > bt ? m : best;
                    }, msgs?.[0]);

                    const newestId = newest?.id;
                    if (newestId) {
                        store.lastMsgIdByChannel[id] = newestId;
                        void saveEphorStore(store);
                        log("RESPONSE (latest message id)", newestId);
                    } else {
                        log("RESPONSE (messages)", "none");
                    }
                })
                .catch(err => log("ERROR fetching messages", err?.message ?? String(err)));
        }
    });


    /* ------------------------------------------------------------------ *
     * INITIAL DATA-FETCH                                                 *
     * ------------------------------------------------------------------ */
    rebuildProjectList(state, refs);
    rebuildChannelList(state, refs);
    void refreshProjects(state, refs, log);

    client
        .listModels()
        .then(m => {
            state.availableModels = m.sort();
            // sanitize stored selections against live availability
            const avail = new Set(state.availableModels.map(x => x.toLowerCase()));
            store.selectedModels = store.selectedModels.filter(x => avail.has(x.toLowerCase()));
            store.workflowStages.forEach(s => {
                s.selectedModels = s.selectedModels.filter(x => avail.has(x.toLowerCase()));
            });
            void saveEphorStore(store);
            onStageChange();
        })
        .catch(err => log("ERROR fetching models", err.message));

    /* ------------------------------------------------------------------ *
     * READY                                                               *
     * ------------------------------------------------------------------ */
    onStageChange();
    rebuildOutputTabs();
    updateQueryMode();

    /* ------------------------------------------------------------------ *
     * Placeholder-insert buttons (built-in and canned)                   *
     * ------------------------------------------------------------------ */
    // NOTE: duplicate inline click handler removed; placeholderRow.ts owns it.

    function updatePlaceholderStates() {
        /* kept for compatibility (if needed later) */
    }

    /* Build canned-placeholder buttons inside placeholder row */
    function rebuildCannedButtons(): void {
        /* strip old canned buttons */
        refs.placeholderRow.querySelectorAll<HTMLButtonElement>(".kh-ph-btn[data-canned]").forEach(btn => btn.remove());

        /* add current canned prompts */
        for (const cp of store.cannedPrompts) {
            const btn = document.createElement("button");
            btn.className = "kh-ph-btn";
            btn.dataset.ph = cp.placeholder;
            btn.dataset.canned = "1";
            btn.textContent = cp.placeholder;
            refs.placeholderRow.appendChild(btn);
        }
    }

    rebuildCannedButtons();

    /* Listen for external changes (modal saves) */
    document.addEventListener("cannedPromptsChanged", rebuildCannedButtons);

    /* Open canned-prompt manager */
    refs.cannedBtn.addEventListener("click", () => openCannedPromptModal(store));
}
