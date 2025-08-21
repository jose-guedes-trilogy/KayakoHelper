// Kayako Helper – ephorSettingsModal.ts (v7.8.0 – per-stage custom instructions + ticket watcher)
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
import { currentKayakoTicketId } from "@/utils/kayakoIds.ts";


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

    /* Preselect the mapped channel for the current ticket (Stream mode) so the UI highlights it */
    try {
        if (store.preferredMode === "stream" && store.selectedProjectId) {
            const tid = currentKayakoTicketId();
            if (tid) {
                const key = `${store.selectedProjectId!}::${tid}`;
                const mapped = store.channelIdByContext?.[key];
                if (mapped && store.selectedChannelId !== mapped) {
                    store.selectedChannelId = mapped;
                    await saveEphorStore(store);
                }
            }
        }
    } catch { /* non-fatal */ }

    /* ------------------------------------------------------------------ *
     * Per-ticket Custom Instructions UI (now per-stage)                  *
     * ------------------------------------------------------------------ */
    const stageKeyFor = () => {
        const tid = currentKayakoTicketId();
        const pid = store.selectedProjectId || "";
        const sid = currentStageId || "";
        return tid && sid ? `${pid}::${tid}::${sid}` : "";
    };

    function refreshCustomInstr(): void {
        const tid = currentKayakoTicketId();
        const ta = refs.customInstrTa;
        if (!tid || !currentStageId) {
            ta.disabled = true;
            ta.value = "";
            ta.placeholder = "Open a Kayako ticket to use custom instructions.";
            return;
        }
        ta.disabled = false;
        const skey = stageKeyFor();
        const tkey = (store.selectedProjectId && tid) ? `${store.selectedProjectId}::${tid}` : "";
        const stageVal = skey ? store.customInstructionsByStage?.[skey] : "";
        const ticketVal = tkey ? store.customInstructionsByContext?.[tkey] : "";
        const useTicket = (store.instructionsScopeForWorkflow ?? "ticket") === "ticket";
        refs.instrScopeCbx.checked = useTicket;
        refs.instrScopeLabel.textContent = useTicket
            ? "4. Per-ticket Custom Instructions"
            : "4. Per-stage Custom Instructions";
        ta.value = useTicket ? (ticketVal ?? "") : (stageVal ?? ticketVal ?? "");
        ta.placeholder = useTicket
            ? "Optional: saved for this Kayako ticket. These lines will be prepended to prompts."
            : "Optional: saved for this Kayako ticket & stage. These lines will be prepended to prompts.";
    }

    refs.customInstrTa.addEventListener("input", () => {
        const tid = currentKayakoTicketId();
        const pid = store.selectedProjectId || "";
        const tkey = (pid && tid) ? `${pid}::${tid}` : "";
        const skey = stageKeyFor();
        const useTicket = (store.instructionsScopeForWorkflow ?? "ticket") === "ticket";
        if (useTicket) {
            if (!tkey) return;
            store.customInstructionsByContext = store.customInstructionsByContext || {} as any;
            store.customInstructionsByContext[tkey] = refs.customInstrTa.value;
        } else {
            if (!skey) return;
            store.customInstructionsByStage = store.customInstructionsByStage || {};
            store.customInstructionsByStage[skey] = refs.customInstrTa.value;
        }
    });

    refs.instrScopeCbx.addEventListener("change", async () => {
        store.instructionsScopeForWorkflow = refs.instrScopeCbx.checked ? "ticket" : "stage";
        await saveEphorStore(store);
        refreshCustomInstr();
    });

    /* ────────────────────────────────────────────────────────────────
     * Keep every open modal in-sync when another tab edits the store
     * ──────────────────────────────────────────────────────────────── */
    chrome.storage.onChanged.addListener(ch => {
        if (!("kh-ephor-store" in ch)) return;
        const newVal = ch["kh-ephor-store"].newValue as EphorStore;

        // update the in-memory copy used by this modal
        store.preferredMode = newVal.preferredMode;
        store.customInstructionsByStage = newVal.customInstructionsByStage ?? store.customInstructionsByStage;
        store.customInstructionsByContext = newVal.customInstructionsByContext ?? store.customInstructionsByContext;
        store.instructionsScopeForWorkflow = newVal.instructionsScopeForWorkflow ?? store.instructionsScopeForWorkflow;

        // reflect in the UI (radio buttons + channel list)
        refs.modeMultiplexer.checked = newVal.preferredMode === "multiplexer";
        refs.modeStream.checked = newVal.preferredMode === "stream";
        rebuildChannelList(state, refs); // greys/ungreys chat list as needed
        // and refresh the per-ticket per-stage textarea if it changed externally
        refreshCustomInstr();
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
     * Prompt placeholder highlighting                                    *
     * ------------------------------------------------------------------ */
    const promptTa = refs.promptInput;
    const highlightPre = modal.querySelector<HTMLPreElement>("#kh-ephor-prompt-highlight");
    const renderHighlight = () => {
        if (!highlightPre) return;
        let t = promptTa.value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
        // Bold @#PLACEHOLDER#@ and {{ PLACEHOLDER }} forms
        t = t
            .replace(/@#\s*([A-Z0-9_.-]+(?:\(.*?\))?)\s*#@/g, '<b style="color:#000">@$#$1#$@</b>')
            .replace(/\{\{\s*([A-Z0-9_.-]+)\s*\}\}/g, '<b style="color:#000">{{$1}}</b>')
            .replace(/@\$#\$/g, "@#") // revert temporary
            .replace(/#\$@/g, "#@");
        highlightPre.innerHTML = t;
    };
    if (highlightPre) {
        renderHighlight();
        promptTa.addEventListener("input", renderHighlight);
    }

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
        // The project context for the ticket key may change when switching mode/selection;
        // reflect the current (projectId, ticketId) mapping.
        // (refresh also happens on project selection below)
        refreshCustomInstr();
    };
    refs.modeMultiplexer.addEventListener("change", onMode);
    refs.modeStream.addEventListener("change", onMode);

    /* ------------------------------------------------------------------ *
     * QUERY-MODE (single vs workflow)                                    *
     * ------------------------------------------------------------------ */
    refs.queryWorkflowRadio.checked = (store.preferredQueryMode ?? "workflow") === "workflow";
    refs.querySingleRadio.checked = !refs.queryWorkflowRadio.checked;

    function updateQueryMode() {
        useWorkflow = refs.queryWorkflowRadio.checked;
        store.preferredQueryMode = useWorkflow ? "workflow" : "single";
        void saveEphorStore(store);

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
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
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
        const label = document.createElement("span");
        label.style.fontWeight = "600";
        label.textContent = "Stage:";
        refs.stageBarDiv.appendChild(label);
        for (const s of store.workflowStages) {
            const wrap = document.createElement("span");
            wrap.className = "kh-stage";
            const tab = Object.assign(document.createElement("span"), { textContent: s.name });
            tab.className = "kh-bar-btn" + (s.id === currentStageId ? " active" : "");
            tab.addEventListener("click", () => {
                currentStageId = s.id;
                onStageChange();
            });
            const del = document.createElement("span");
            del.className = "kh-del";
            del.textContent = "×";
            del.title = "Delete stage";
            del.addEventListener("click", (ev) => {
                ev.stopPropagation();
                const ok = confirm(`Delete stage "${s.name}"?`);
                if (!ok) return;
                const idx = store.workflowStages.findIndex(x => x.id === s.id);
                if (idx !== -1) {
                    store.workflowStages.splice(idx, 1);
                    if (currentStageId === s.id) {
                        currentStageId = store.workflowStages[0]?.id ?? "";
                    }
                    void saveEphorStore(store);
                    rebuildStageBar();
                    onStageChange();
                }
            });
            wrap.appendChild(tab);
            wrap.appendChild(del);
            refs.stageBarDiv.appendChild(wrap);
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
        refreshCustomInstr(); // stage changed → swap to stage-specific instructions
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
    refs.chatSortSelect?.addEventListener("change", () => {
        const v = refs.chatSortSelect!.value === "created" ? "created" : "alpha";
        store.channelSortOrder = v;
        void saveEphorStore(store);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
    });

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
            const newId = String((ch as any)?.conversation_id ?? (ch as any)?.id ?? (ch as any)?.channel_id ?? "");
            log("RESPONSE (new channel)", newId || (ch as any)?.id);
            await fetchChannels(state, refs, log);
            if (newId) {
                store.selectedChannelId = newId;
                await saveEphorStore(store);
                rebuildChannelList(state, refs, refs.channelSearchInp.value);
            }
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

    /* Preselect the mapped channel for the current ticket (Stream mode) so the UI highlights it */
    try {
        if (store.preferredMode === "stream" && store.selectedProjectId) {
            const tid = currentKayakoTicketId();
            if (tid) {
                // Narrow `string | null` to `string` for the IDE/type-checker.
                const pid = store.selectedProjectId as string; // guarded above
                const key = `${pid}::${tid}`;
                const mapped = store.channelIdByContext?.[key];
                if (mapped && store.selectedChannelId !== mapped) {
                    store.selectedChannelId = mapped;
                    await saveEphorStore(store);
                }
            }
        }
    } catch { /* non-fatal */ }

    /* ------------------------------------------------------------------ *
     * INITIAL DATA-FETCH                                                 *
     * ------------------------------------------------------------------ */
    rebuildProjectList(state, refs);
    rebuildChannelList(state, refs);
    void refreshProjects(state, refs, log);
    // Initialize custom-instructions textarea for current ticket/project context.
    refreshCustomInstr();

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
    // initialize chat sort select from persisted store
    if (refs.chatSortSelect) {
        refs.chatSortSelect.value = (store.channelSortOrder ?? "alpha") as any;
    }

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
            btn.title = (cp.title ? `${cp.title} — ` : "") + "Right-click to set its value from your clipboard";

            /* NEW: right-click → set this custom placeholder’s body from clipboard, then save */
            btn.addEventListener("contextmenu", async (e) => {
                e.preventDefault();
                try {
                    const text = await navigator.clipboard.readText();
                    const idx = store.cannedPrompts.findIndex(p => p.id === cp.id);
                    if (idx !== -1) {
                        store.cannedPrompts[idx] = { ...store.cannedPrompts[idx], body: text };
                        await saveEphorStore(store);
                        document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
                        btn.animate([{ transform: "scale(1)" }, { transform: "scale(1.06)" }, { transform: "scale(1)" }], { duration: 180 });
                    }
                } catch {
                    alert("Couldn’t read from clipboard. Please allow clipboard permission and try again.");
                }
            });
            refs.placeholderRow.appendChild(btn);
        }
    }

    rebuildCannedButtons();

    /* Listen for external changes (modal saves) */
    document.addEventListener("cannedPromptsChanged", rebuildCannedButtons);

    /* Open canned-prompt manager */
    refs.cannedBtn.addEventListener("click", () => openCannedPromptModal(store));

    /* ------------------------------------------------------------------ *
     * TICKET WATCHER – keep modal in sync when user navigates to
     * another Kayako internal tab while the modal is open.
     * ------------------------------------------------------------------ */
    let lastTicketId = currentKayakoTicketId();
    const ticketWatch = window.setInterval(async () => {
        const now = currentKayakoTicketId();
        if (now === lastTicketId) return;
        lastTicketId = now;
        refreshCustomInstr(); // swap instructions textarea to the new ticket
        // In Stream mode, auto-select mapped chat for the new ticket if available.
        try {
            if (store.preferredMode === "stream" && store.selectedProjectId && now) {
                const key = `${store.selectedProjectId}::${now}`;
                const mapped = store.channelIdByContext?.[key];
                if (mapped && store.selectedChannelId !== mapped) {
                    store.selectedChannelId = mapped;
                    await saveEphorStore(store);
                    rebuildChannelList(state, refs, refs.channelSearchInp.value);
                }
            }
        } catch { /* non-fatal */ }
    }, 800);

    // Cleanup watcher on modal close
    refs.closeBtn.addEventListener("click", () => {
        try { clearInterval(ticketWatch); } catch {}
    });
}
