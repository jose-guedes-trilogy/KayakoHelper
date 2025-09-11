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
import { loadEphorStore, saveEphorStore, EphorStore, WorkflowStage, SavedInstruction } from "./ephorStore.ts";

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
import { openAiSelectionsModal } from "./ephorAiSelectionsModal.ts";

import { attachPlaceholderRowHandler, rebuildPlaceholderRow } from "./modal/placeholderRow.ts";
import { currentKayakoTicketId } from "@/utils/kayakoIds.ts";
import { extractProductValueSafe } from "@/modules/kayako/utils/product.ts";
import { loadStore, findProvider } from "@/utils/providerStore.ts";


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

    /* ------------------------------------------------------------------ *
     * Per-ticket defaults and preferences (Mode/Workflow/Run)
     * - Defaults: Mode: Normal (multiplexer), Workflow: Multi-stage, Run: Auto
     * - Persist any changes per ticket so they survive refreshes
     * ------------------------------------------------------------------ */
    const applyTicketPrefsForCurrentTicket = async () => {
        try {
            const tid = currentKayakoTicketId() || "";
            const prefs = tid ? (store.ticketPrefsByContext?.[tid] ?? null) : null;

            // Desired defaults when none exist yet for this ticket
            const desiredMode: typeof store.preferredMode = "stream";
            const desiredQuery: typeof store.preferredQueryMode = "workflow";
            const desiredRun: typeof store.runMode = "automatic";

            let changed = false;
            if (prefs) {
                if (prefs.preferredMode && prefs.preferredMode !== store.preferredMode) {
                    store.preferredMode = prefs.preferredMode;
                    changed = true;
                }
                if (prefs.preferredQueryMode && prefs.preferredQueryMode !== store.preferredQueryMode) {
                    store.preferredQueryMode = prefs.preferredQueryMode;
                    changed = true;
                }
                if (prefs.runMode && prefs.runMode !== store.runMode) {
                    store.runMode = prefs.runMode;
                    changed = true;
                }
            } else if (tid) {
                // Initialize defaults for this ticket
                store.ticketPrefsByContext = store.ticketPrefsByContext || {} as any;
                store.ticketPrefsByContext[tid] = {
                    preferredMode: desiredMode,
                    preferredQueryMode: desiredQuery,
                    runMode: desiredRun,
                };
                if (store.preferredMode !== desiredMode) { store.preferredMode = desiredMode; changed = true; }
                if (store.preferredQueryMode !== desiredQuery) { store.preferredQueryMode = desiredQuery; changed = true; }
                if (store.runMode !== desiredRun) { store.runMode = desiredRun; changed = true; }
            }

            if (changed) await saveEphorStore(store);

            // Reflect in UI immediately
            try {
                refs.modeMultiplexer.checked = store.preferredMode === "multiplexer";
                refs.modeStream.checked = store.preferredMode === "stream";
                refs.queryWorkflowRadio.checked = (store.preferredQueryMode ?? "workflow") === "workflow";
                refs.querySingleRadio.checked = !refs.queryWorkflowRadio.checked;
                refs.runAutoRadio.checked = store.runMode === "automatic";
                refs.runManualRadio.checked = store.runMode === "manual";
            } catch {}
        } catch {}
    };

    const saveTicketPrefsPartial = async (partial: Partial<{
        preferredMode: typeof store.preferredMode;
        preferredQueryMode: typeof store.preferredQueryMode;
        runMode: typeof store.runMode;
    }>) => {
        try {
            const tid = currentKayakoTicketId() || "";
            if (!tid) return;
            store.ticketPrefsByContext = store.ticketPrefsByContext || {} as any;
            store.ticketPrefsByContext[tid] = { ...(store.ticketPrefsByContext[tid] || {}), ...partial } as any;
            await saveEphorStore(store);
            try { log("UI", `Saved per-ticket prefs for ${tid}`); } catch {}
        } catch {}
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
        // Checkbox now means: when CHECKED → use per-stage instead
        refs.instrScopeCbx.checked = !useTicket;
        refs.instrScopeLabel.textContent = useTicket
            ? "4. Per-ticket Instructions"
            : "4. Per-stage Instructions";
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
        // Checkbox checked → per-stage; unchecked → per-ticket
        store.instructionsScopeForWorkflow = refs.instrScopeCbx.checked ? "stage" : "ticket";
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
        store.instructionsScopeForWorkflow = newVal.instructionsScopeForWorkflow ?? store.instructionsScopeForWorkflow ?? "ticket";

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
        refs.logContainer.style.display = logCollapsed ? "none" : "block";
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
    // Prevent huge pasted content from expanding layout; keep scroll within textarea
    try {
        promptTa.style.overflow = "auto";
        // Respect reduced motion layout but cap height to viewport
        if (!promptTa.style.maxHeight) promptTa.style.maxHeight = "60vh";
    } catch {}
    const highlightPre = modal.querySelector<HTMLPreElement>("#kh-ephor-prompt-highlight");
    const PLACEHOLDER_PILLS_ENABLED = false; // Temporarily disabled per request
    if (highlightPre) {
        if (!PLACEHOLDER_PILLS_ENABLED) {
            // Hide preview to avoid layout expansion and turn feature off without removing code
            try { highlightPre.style.display = "none"; } catch {}
        } else {
            const renderHighlight = () => {
                if (!highlightPre) return;

                const cannedMap = new Map<string, string>();
                try {
                    for (const cp of store.cannedPrompts ?? []) {
                        const core = String(cp.placeholder || "").replace(/^@#\s*|\s*#@$/g, "");
                        if (core) cannedMap.set(core, cp.title || core);
                    }
                } catch {}

                const toLabel = (name: string): string => {
                    const canned = cannedMap.get(name);
                    if (canned) return canned;
                    if (/^TRANSCRIPT$/i.test(name)) return "Transcript";
                    if (/^PRV_RD_OUTPUT$/i.test(name)) return "Previous Round";
                    const m1 = name.match(/^RD_(\d+)_COMBINED$/i);
                    if (m1) return `Round ${m1[1]} Combined`;
                    const m2 = name.match(/^RD_(\d+)_AI_(.+)$/i);
                    if (m2) return `Round ${m2[1]} ${m2[2]}`;
                    return name;
                };

                const esc = (s: string) => s
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");

                const pill = (name: string, fullToken: string) => {
                    const label = esc(toLabel(name));
                    const tokenEsc = esc(fullToken);
                    return `<span class=\"kh-pill\" title=\"${tokenEsc}\">${label}</span>`;
                };

                const raw = promptTa.value;
                const tokens1 = raw.match(/@#\s*([A-Z0-9_.-]+(?:\(.*?\))?)\s*#@/g) ?? [];
                try { console.debug("[Ephor] Placeholder highlight", { count: tokens1.length }); } catch {}

                let t = esc(raw);
                // Replace @#PLACEHOLDER#@
                t = t.replace(/@#\s*([A-Z0-9_.-]+(?:\(.*?\))?)\s*#@/g, (_m, name) => pill(String(name), `@#${String(name)}#@`));

                highlightPre.innerHTML = t;
            };
            renderHighlight();
            promptTa.addEventListener("input", () => {
                renderHighlight();
                // live validation for placeholder syntax in Default Instructions
                const hasCurly = /\{\{[^}]+\}\}/.test(promptTa.value);
                promptTa.style.borderColor = hasCurly ? "#c33" : "";
                promptTa.style.boxShadow = hasCurly ? "0 0 0 2px rgba(195,51,51,.15)" : "";
            });
            promptTa.addEventListener("blur", () => {
                // normalize any {{NAME}} → @#NAME#@
                const before = promptTa.value;
                const after = before.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_m, name) => `@#${String(name).toUpperCase()}#@`);
                if (after !== before) {
                    promptTa.value = after;
                    promptTa.dispatchEvent(new Event("input", { bubbles: true }));
                }
                promptTa.style.borderColor = "";
                promptTa.style.boxShadow = "";
            });
        }
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

        // Clear ephemeral models note in Outputs build
        try {
            const note = (document.getElementById("kh-model-saved-note") as HTMLSpanElement | null);
            if (note) { note.style.display = "none"; note.textContent = ""; note.style.opacity = "1"; }
        } catch {}

        const tabs: HTMLButtonElement[] = [];

        list.forEach(label => {
            /* tab button */
            const btn = document.createElement("button");
            btn.textContent = saved?.byModel?.[label] ? `✓ ${label}` : label;
            btn.className = "kh-bar-btn";
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
    // Listen for per-ticket system body updates (e.g., Recent Tickets placeholder)
    const onSetPerTicketSystemBody = (ev: Event) => {
        try {
            const d = (ev as CustomEvent).detail || {};
            const field = String(d.field || '');
            const body  = String(d.body ?? '');
            if (!field) return;
            const ticketId = currentKayakoTicketId();
            const projectId = store.selectedProjectId || '';
            if (!(ticketId && projectId)) return;
            store.systemPromptBodiesByContext = store.systemPromptBodiesByContext || {};
            const key = `${projectId}::${ticketId}`;
            const rec = store.systemPromptBodiesByContext[key] || {};
            (rec as any)[field] = body;
            store.systemPromptBodiesByContext[key] = rec;
            void saveEphorStore(store);
            // Update highlight preview immediately
            try { (modal.querySelector('#kh-ephor-prompt-highlight') as HTMLElement | null)?.dispatchEvent(new Event('input')); } catch {}
        } catch {}
    };
    document.addEventListener('ephorSetPerTicketSystemBody', onSetPerTicketSystemBody as EventListener);

    // Allow external actions (like placeholder flows) to skip current stage
    const skipStageListener = () => {
        if (!useWorkflow) return;
        const stages = store.workflowStages;
        const idx = stages.findIndex(s => s.id === currentStageId);
        if (idx >= 0 && idx < stages.length - 1) {
            currentStageId = stages[idx + 1].id;
            onStageChange();
            setMainTab("settings");
            try { log("UI", "Stage skipped by external action"); } catch {}
        }
    };
    document.addEventListener("ephorSkipCurrentStage", skipStageListener as EventListener);

    /* ------------------------------------------------------------------ *
     * Main-tab helper                                                    *
     * ------------------------------------------------------------------ */
    function openInlineDialog(title: string, fields: Array<{ id: string; label: string; value?: string; placeholder?: string }>, onSubmit: (values: Record<string,string>) => void) {
        const overlay = document.createElement("div");
        overlay.className = "kh-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "kh-dialog";
        dlg.innerHTML = `
          <header>${title}</header>
          <main></main>
          <footer>
            <button class="kh-btn" data-act="cancel">Cancel</button>
            <button class="kh-btn kh-btn-primary" data-act="ok">OK</button>
          </footer>`;
        const main = dlg.querySelector("main")!;
        fields.forEach(f => {
            const wrap = document.createElement("div");
            wrap.style.margin = "6px 0";
            const lbl = document.createElement("label");
            lbl.textContent = f.label;
            lbl.style.display = "block";
            const input = document.createElement("input");
            input.type = "text";
            input.value = f.value ?? "";
            input.placeholder = f.placeholder ?? "";
            input.id = f.id;
            input.style.width = "100%";
            input.style.padding = "6px";
            wrap.appendChild(lbl);
            wrap.appendChild(input);
            main.appendChild(wrap);
        });
        const close = () => overlay.remove();
        dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", close);
        dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => {
            const vals: Record<string,string> = {};
            fields.forEach(f => {
                vals[f.id] = (dlg.querySelector<HTMLInputElement>(`#${CSS.escape(f.id)}`)?.value ?? "").trim();
            });
            onSubmit(vals);
            close();
        });
        overlay.appendChild(dlg);
        modal.appendChild(overlay);
        (dlg.querySelector<HTMLInputElement>(`#${CSS.escape(fields[0].id)}`) as HTMLInputElement | null)?.focus();
    }

    function openMessageDialog(title: string, message: string): void {
        const overlay = document.createElement("div");
        overlay.className = "kh-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "kh-dialog";
        dlg.innerHTML = `
          <header>${title}</header>
          <main><p style="margin:0;line-height:1.4">${message}</p></main>
          <footer>
            <button class="kh-btn kh-btn-primary" data-act="ok">OK</button>
          </footer>`;
        dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => overlay.remove());
        overlay.appendChild(dlg);
        modal.appendChild(overlay);
    }

    function openConfirmDialog(message: string): Promise<boolean> {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "kh-dialog-overlay";
            const dlg = document.createElement("div");
            dlg.className = "kh-dialog";
            dlg.innerHTML = `
              <header>Confirm</header>
              <main><p style="margin:0;line-height:1.4">${message}</p></main>
              <footer>
                <button class="kh-btn" data-act="cancel">Cancel</button>
                <button class="kh-btn kh-btn-primary" data-act="ok">OK</button>
              </footer>`;
            const close = (v: boolean) => { overlay.remove(); resolve(v); };
            dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", () => close(false));
            dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => close(true));
            overlay.appendChild(dlg);
            modal.appendChild(overlay);
        });
    }

    function openPromptDialog(title: string, label: string, defaultValue = ""): Promise<string | null> {
        return new Promise(resolve => {
            const overlay = document.createElement("div");
            overlay.className = "kh-dialog-overlay";
            const dlg = document.createElement("div");
            dlg.className = "kh-dialog";
            dlg.innerHTML = `
              <header>${title}</header>
              <main>
                <label style="display:block;margin-bottom:4px">${label}</label>
                <input id="kh-prompt-input" type="text" style="width:100%;padding:6px">
              </main>
              <footer>
                <button class="kh-btn" data-act="cancel">Cancel</button>
                <button class="kh-btn kh-btn-primary" data-act="ok">OK</button>
              </footer>`;
            const input = dlg.querySelector<HTMLInputElement>("#kh-prompt-input")!;
            input.value = defaultValue;
            const close = (v: string | null) => { overlay.remove(); resolve(v); };
            dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", () => close(null));
            dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => close((input.value || "").trim()));
            overlay.appendChild(dlg);
            modal.appendChild(overlay);
            input.focus();
        });
    }

    function setMainTab(t: "settings" | "outputs") {
        const targetIsSettings = t === "settings";
        const fromEl = targetIsSettings ? refs.paneOutputs : refs.paneSettings;
        const toEl = targetIsSettings ? refs.paneSettings : refs.paneOutputs;

        // Update active state on tab buttons immediately
        refs.tabSettingsBtn.classList.toggle("active", targetIsSettings);
        refs.tabOutputsBtn.classList.toggle("active", !targetIsSettings);

        // If already in desired state, nothing to do
        const toHidden = toEl.classList.contains("kh-hidden");
        const fromHidden = fromEl.classList.contains("kh-hidden");
        if (!toHidden && fromHidden) return;

        // Prepare target pane
        toEl.classList.remove("kh-hidden");
        // Immediately hide previous pane to prevent double-scrollbars/layout jump
        fromEl.classList.add("kh-hidden");

        // Respect reduced motion
        const prefersNoMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const duration = prefersNoMotion ? 0 : 220;

        try { log("UI", `Tab switch → ${targetIsSettings ? "Prompt Setup" : "AI Outputs"}`); } catch {}

        if (duration === 0) {
            fromEl.classList.add("kh-hidden");
            if (!targetIsSettings) rebuildOutputTabs();
            return;
        }

        // Animate: slide/fade in next (outgoing is already hidden to avoid layout shift)
        const easing = "cubic-bezier(.2,.7,.2,1)";
        const toOriginalTransition = toEl.style.transition;

        // Establish initial states
        toEl.style.opacity = "0";
        toEl.style.transform = "translateY(6px)";
        toEl.style.transition = `opacity ${duration}ms ${easing}, transform ${duration}ms ${easing}`;

        // next frame to ensure styles apply
        requestAnimationFrame(() => {
            // Trigger animations
            toEl.style.opacity = "1";
            toEl.style.transform = "translateY(0)";

            // Cleanup after animation
            window.setTimeout(() => {
                // Reset inline styles
                toEl.style.opacity = "";
                toEl.style.transform = "";
                toEl.style.transition = toOriginalTransition;

                if (!targetIsSettings) rebuildOutputTabs();
            }, duration);
        });
    }
    refs.tabSettingsBtn.addEventListener("click", () => setMainTab("settings"));
    refs.tabOutputsBtn.addEventListener("click", () => setMainTab("outputs"));

    await applyTicketPrefsForCurrentTicket();
    refs.modeMultiplexer.checked = store.preferredMode === "multiplexer";
    refs.modeStream.checked = store.preferredMode === "stream";
    const onMode = () => {
        store.preferredMode = refs.modeMultiplexer.checked ? "multiplexer" : "stream";
        void saveEphorStore(store);
        log(`Connection mode → ${store.preferredMode}`);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
        refreshCustomInstr();
        void saveTicketPrefsPartial({ preferredMode: store.preferredMode });
    };
    refs.modeMultiplexer.addEventListener("change", onMode);
    refs.modeStream.addEventListener("change", onMode);

    refs.queryWorkflowRadio.checked = (store.preferredQueryMode ?? "workflow") === "workflow";
    refs.querySingleRadio.checked = !refs.queryWorkflowRadio.checked;

    function updateQueryMode() {
        useWorkflow = refs.queryWorkflowRadio.checked;
        store.preferredQueryMode = useWorkflow ? "workflow" : "single";
        void saveEphorStore(store);

        refs.stageBarDiv.style.display = "";
        refs.stageBarDiv.classList.toggle("kh-stagebar-disabled", !useWorkflow);

        const enableRun = useWorkflow;
        // Hide Run label + controls entirely in single-stage mode
        const runLabel = (refs.runRow.previousElementSibling as HTMLElement | null);
        refs.runRow.style.display = enableRun ? "" : "none";
        if (runLabel) runLabel.style.display = enableRun ? "" : "none";
        refs.runRow.style.opacity = enableRun ? "1" : "";
        refs.runAutoRadio.disabled = refs.runManualRadio.disabled = !enableRun;
        if (!enableRun) {
            refs.runAutoRadio.checked = true;
            store.runMode = "automatic";
            void saveEphorStore(store);
        }

        // Hide the per-stage scope checkbox in single-stage mode
        try {
            const scopeCbx = modal.querySelector<HTMLInputElement>("#kh-ephor-instr-scope");
            const scopeCbxWrap = scopeCbx?.closest("label") as HTMLElement | null;
            if (scopeCbxWrap) scopeCbxWrap.style.display = useWorkflow ? "" : "none";
        } catch {}

        // Grey out and disable New Chat button when multi-stage is selected
        try {
            if (refs.newChatBtn) {
                refs.newChatBtn.disabled = useWorkflow;
                refs.newChatBtn.style.opacity = useWorkflow ? ".45" : "";
                refs.newChatBtn.style.pointerEvents = useWorkflow ? "none" : "";
                try { log("UI", useWorkflow ? "New Chat disabled in multi-stage" : "New Chat enabled in single-stage"); } catch {}
            }
        } catch {}

        if (useWorkflow) {
            onStageChange();
        } else {
            // Always reflect global default instructions in the prompt input
            refs.promptInput.value = store.messagePrompt;
            rebuildModelList(state, refs, refs.modelSearchInp.value, null);
        }

        rebuildOutputTabs();
        rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCannedButtons);
        rebuildAiSelectionButtons();
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
        updateWorkflowDirtyIndicator();
        void saveTicketPrefsPartial({ preferredQueryMode: store.preferredQueryMode });
    }

    refs.querySingleRadio.addEventListener("change", updateQueryMode);
    refs.queryWorkflowRadio.addEventListener("change", updateQueryMode);

    refs.runAutoRadio.checked = store.runMode === "automatic";
    refs.runManualRadio.checked = store.runMode === "manual";
    const updateRunMode = () => {
        store.runMode = refs.runAutoRadio.checked ? "automatic" : "manual";
        void saveEphorStore(store);
        updateWorkflowDirtyIndicator();
        void saveTicketPrefsPartial({ runMode: store.runMode });
    };
    refs.runAutoRadio.addEventListener("change", updateRunMode);
    refs.runManualRadio.addEventListener("change", updateRunMode);

    /* ------------------------------------------------------------------ *
     * Stage bar                                                          *
     * ------------------------------------------------------------------ */
    function rebuildStageBar(): void {
        refs.stageBarDiv.textContent = "";
        let dragIndex = -1;
        const onDragOver = (e: DragEvent, overIndex: number) => {
            e.preventDefault();
            const after = (e.offsetX / (e.currentTarget as HTMLElement).clientWidth) > 0.5;
            (e.currentTarget as HTMLElement).style.borderLeft = after ? "" : "2px solid #88a5da";
            (e.currentTarget as HTMLElement).style.borderRight = after ? "2px solid #88a5da" : "";
        };
        const clearBorders = (el: HTMLElement) => { el.style.borderLeft = el.style.borderRight = ""; };
        store.workflowStages.forEach((s, index) => {
            const wrap = document.createElement("span");
            wrap.className = "kh-stage";
            wrap.draggable = true;
            const tab = Object.assign(document.createElement("span"), { textContent: s.name });
            tab.className = "kh-bar-btn" + (s.id === currentStageId ? " active" : "");
            tab.addEventListener("click", () => { currentStageId = s.id; onStageChange(); });
            const del = document.createElement("span");
            del.className = "kh-del"; del.textContent = "×"; del.title = "Delete stage"; del.tabIndex = 0;
            del.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); del.click(); } });
            del.addEventListener("click", async (ev) => {
                ev.stopPropagation();
                const ok = await openConfirmDialog(`Delete stage "${s.name}"?`);
                if (!ok) return;
                const idx = store.workflowStages.findIndex(x => x.id === s.id);
                if (idx !== -1) {
                    store.workflowStages.splice(idx, 1);
                    if (currentStageId === s.id) currentStageId = store.workflowStages[0]?.id ?? "";
                    void saveEphorStore(store);
                    rebuildStageBar(); onStageChange();
                }
            });
            wrap.appendChild(tab); wrap.appendChild(del);
            wrap.addEventListener("dragstart", () => { dragIndex = index; });
            wrap.addEventListener("dragover", (e) => onDragOver(e as DragEvent, index));
            wrap.addEventListener("dragleave", () => clearBorders(wrap));
            wrap.addEventListener("drop", (e) => {
                e.preventDefault(); clearBorders(wrap);
                if (dragIndex === -1 || dragIndex === index) return;

                const isAfter = (e as DragEvent).offsetX / (wrap.clientWidth) > 0.5;

                // Remove dragged first
                const dragged = store.workflowStages.splice(dragIndex, 1)[0];

                // Adjust hovered index if needed after removal
                let baseIndex = index;
                if (dragIndex < index) baseIndex -= 1;

                // Compute insertion index
                let insertIndex = isAfter ? baseIndex + 1 : baseIndex;
                if (insertIndex < 0) insertIndex = 0;
                if (insertIndex > store.workflowStages.length) insertIndex = store.workflowStages.length;

                store.workflowStages.splice(insertIndex, 0, dragged);
                dragIndex = -1;
                try { log("UI", `Stage reordered: '${dragged.name}' → position ${insertIndex + 1}`); } catch {}
                void saveEphorStore(store);
                rebuildStageBar(); onStageChange(); updateWorkflowDirtyIndicator();
                void saveEphorStore(store);
                rebuildStageBar(); onStageChange(); updateWorkflowDirtyIndicator();
            });
            refs.stageBarDiv.appendChild(wrap);
        });
        refs.stageBarDiv.appendChild(refs.addStageBtn);
    }

    // Custom Sort dropdown wiring
    (function initSortDropdown(){
        const sortDd = modal.querySelector<HTMLDivElement>("#kh-sort-dd");
        const sortDdBtn = sortDd?.querySelector<HTMLButtonElement>(".kh-dd-btn");
        const sortDdMenu = sortDd?.querySelector<HTMLDivElement>(".kh-dd-menu");
        const sortDdLabel = sortDd?.querySelector<HTMLSpanElement>("#kh-sort-dd-label");
        if (!(sortDd && sortDdBtn && sortDdMenu && sortDdLabel && refs.chatSortSelect)) return;
        const updateFromSelect = () => {
            const v = refs.chatSortSelect!.value === "created" ? "created" : "alpha";
            sortDdLabel.textContent = v === "created" ? "Newest" : "A–Z";
        };
        updateFromSelect();
        sortDdBtn.addEventListener("click", () => {
            const open = sortDdBtn.getAttribute("aria-expanded") === "true";
            sortDdBtn.setAttribute("aria-expanded", open ? "false" : "true");
            sortDdMenu.style.display = open ? "none" : "block";
        });
        sortDdMenu.addEventListener("click", (ev) => {
            const item = (ev.target as HTMLElement).closest<HTMLElement>("[data-value]");
            if (!item) return;
            const v = item.getAttribute("data-value") === "created" ? "created" : "alpha";
            refs.chatSortSelect!.value = v;
            refs.chatSortSelect!.dispatchEvent(new Event("change", { bubbles: true }));
            sortDdMenu.style.display = "none";
            sortDdBtn.setAttribute("aria-expanded", "false");
            updateFromSelect();
        });
        document.addEventListener("click", (e) => {
            if (!sortDd.contains(e.target as Node)) {
                sortDdMenu.style.display = "none";
                sortDdBtn.setAttribute("aria-expanded", "false");
            }
        });
    })();

    /* Ensure model list matches Projects/Chats visual height */
    function syncModelListHeight(): void {
        try {
            const projH = refs.projectListDiv.clientHeight || 0;
            const chanH = refs.channelListDiv.clientHeight || 0;
            const target = Math.max(projH, chanH);
            if (target > 0) {
                refs.aiListDiv.style.height = `${target}px`;
                refs.aiListDiv.style.minHeight = `${target}px`;
            }
        } catch {}
    }
    window.addEventListener("resize", () => syncModelListHeight());

    refs.addStageBtn.addEventListener("click", () => {
        const overlay = document.createElement("div");
        overlay.className = "kh-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "kh-dialog";
        dlg.innerHTML = `
          <header>Add Stage</header>
          <main>
            <div style=\"margin:6px 0\">
              <label style=\"display:block\">Stage name</label>
              <input id=\"dlg-stage-name\" type=\"text\" style=\"width:100%;padding:6px\" placeholder=\"e.g. Review\">
            </div>
          </main>
          <footer>
            <button class=\"kh-btn\" data-act=\"cancel\">Cancel</button>
            <button class=\"kh-btn kh-btn-primary\" data-act=\"ok\">OK</button>
          </footer>`;
        const close = () => overlay.remove();
        dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", close);
        dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => {
            const name = (dlg.querySelector<HTMLInputElement>("#dlg-stage-name")!.value || "").trim();
            if (!name) return;
            const stg: WorkflowStage = {
                id: crypto.randomUUID(),
                name,
                // Per-stage prompt removed; keep empty for compatibility
                prompt: "",
                selectedModels: [state.availableModels[0] ?? "gpt-4o"],
            };
            store.workflowStages.push(stg);
            currentStageId = stg.id;
            void saveEphorStore(store);
            rebuildStageBar();
            onStageChange();
            updateWorkflowDirtyIndicator();
            close();
        });
        overlay.appendChild(dlg);
        modal.appendChild(overlay);
        (dlg.querySelector("#dlg-stage-name") as HTMLInputElement).focus();
    });

    /* ------------------------------------------------------------------ *
     * Per-stage editing                                                  *
     * ------------------------------------------------------------------ */
    function onStageChange() {
        const stg = store.workflowStages.find(x => x.id === currentStageId);
        if (!stg) return;
        refs.promptInput.value = stg.prompt;
        rebuildModelList(state, refs, refs.modelSearchInp.value, stg);
        syncModelListHeight();
        rebuildStageBar();
        rebuildOutputTabs();
        rebuildAiSelectionButtons();
        rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCannedButtons);
        refreshCustomInstr(); // stage changed → swap to stage-specific instructions

        // Reflect current selection in the Models title note (workflow) – brief, fades away
        try {
            const note = (document.getElementById("kh-model-saved-note") as HTMLSpanElement | null);
            if (note) {
                const current = stg.selectedModels ?? [];
                if (current.length) {
                    note.textContent = current.join(", ");
                    note.style.color = "hsl(217.86deg 45% 56%)";
                    note.style.display = "inline";
                    note.style.transition = "opacity .4s ease";
                    note.style.opacity = "1";
                    window.setTimeout(() => { note.style.opacity = "0"; }, 1800);
                    window.setTimeout(() => { note.style.display = "none"; note.textContent = ""; note.style.opacity = "1"; }, 2400);
                } else {
                    note.style.display = "none";
                    note.textContent = "";
                    note.style.opacity = "1";
                }
            }
        } catch {}
    }

    /* keep prompt text isolated between single-stage and workflow */
    refs.promptInput.addEventListener("input", () => {
        // Per-stage prompt removed; always persist to global default instructions
        store.messagePrompt = refs.promptInput.value;
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
    refs.modelSearchInp.addEventListener("input", () => syncModelListHeight());

    /* ------------------------------------------------------------------ *
     * Live tab sync on (un)checking model boxes                          *
     * ------------------------------------------------------------------ */
    refs.aiListDiv.addEventListener("change", () => {
        rebuildOutputTabs();
        updateWorkflowDirtyIndicator();
        // Keep Insert row split-button menus in sync with selected AIs
        try { 
            rebuildPlaceholderRow(store, refs, useWorkflow, currentStageId, rebuildCannedButtons);
            log("UI", "Rebuilt placeholder row after AI selection change");
        } catch {}
    });

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
    // Allow closing via ESC (handle both 'Escape' and legacy 'Esc', on document and window)
    const onKeydownEsc = (ev: KeyboardEvent) => {
        const k = String(ev.key || "");
        if (k === "Escape" || k === "Esc") {
            try { log("UI", "Closed via Escape"); } catch {}
            ev.preventDefault();
            refs.closeBtn.click();
        }
    };
    document.addEventListener("keydown", onKeydownEsc, { capture: true });
    window.addEventListener("keydown", onKeydownEsc, { capture: true });

    refs.closeBtn.addEventListener("click", () => {
        EphorClient.setLogger(null);
        document.removeEventListener("ephorOutputsUpdated", outputsUpdatedListener);
        document.removeEventListener('ephorSetPerTicketSystemBody', onSetPerTicketSystemBody as EventListener);
        document.removeEventListener("ephorSkipCurrentStage", skipStageListener as EventListener);
        document.removeEventListener("keydown", onKeydownEsc, { capture: true } as any);
        window.removeEventListener("keydown", onKeydownEsc, { capture: true } as any);
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

    // Settings gear → open preferences (toggle API Log visibility)
    const gearBtn = modal.querySelector<HTMLButtonElement>("#kh-ephor-gear");
    gearBtn?.addEventListener("click", () => {
        const overlay = document.createElement("div");
        overlay.className = "kh-dialog-overlay";
        const dlg = document.createElement("div");
        dlg.className = "kh-dialog";
        dlg.innerHTML = `
          <header>Preferences</header>
          <main>
            <label style="display:flex;align-items:center;gap:8px">
              <input id="kh-pref-show-log" type="checkbox"> Show API Log section
            </label>
          </main>
          <footer>
            <button class="kh-btn" data-act="cancel">Close</button>
          </footer>`;
        const cbx = dlg.querySelector<HTMLInputElement>("#kh-pref-show-log")!;
        cbx.checked = store.showApiLog ?? true;
        cbx.addEventListener("change", async () => {
            store.showApiLog = cbx.checked;
            await saveEphorStore(store);
            const sec = modal.querySelector<HTMLDivElement>("#kh-ephor-log-section");
            if (sec) sec.style.display = store.showApiLog ? "" : "none";
        });
        dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", () => overlay.remove());
        overlay.appendChild(dlg);
        modal.appendChild(overlay);
    });

    /* ------------------------------------------------------------------ *
     * Project / chat search                                              *
     * ------------------------------------------------------------------ */
    refs.projectSearchInp.addEventListener("input", () =>
        rebuildProjectList(state, refs, refs.projectSearchInp.value),
    );
    refs.projectSearchInp.addEventListener("input", () => syncModelListHeight());
    refs.channelSearchInp.addEventListener("input", () =>
        rebuildChannelList(state, refs, refs.channelSearchInp.value),
    );
    refs.channelSearchInp.addEventListener("input", () => syncModelListHeight());
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

    // Browse projects modal – lists defaults from JSON and allows joining
    (modal.querySelector<HTMLButtonElement>("#kh-ephor-browse-projects") as HTMLButtonElement | null)?.addEventListener("click", async () => {
        try { log("UI", "Open Browse Projects"); } catch {}
        if (document.getElementById("kh-browse-projects-modal")) return;
        const overlay = document.createElement("div"); overlay.className = "kh-dialog-overlay";
        const dlg = document.createElement("div"); dlg.className = "kh-dialog"; dlg.id = "kh-browse-projects-modal";
        dlg.style.minWidth = "720px";
        dlg.innerHTML = `
          <header>Browse Projects</header>
          <main style="display:grid;grid-template-columns:260px 1fr;gap:12px;min-height:340px;height:60vh;overflow:hidden;">
            <div style="border:1px solid #adc1e3;border-radius:6px;padding:6px;min-height:240px;display:flex;flex-direction:column;gap:6px;">
              <input id="kh-browse-proj-search" type="search" placeholder="Search projects…" style="padding:4px 6px;border:1px solid #cfd3d9;border-radius:4px;">
              <div id="kh-browse-proj-list" style="flex:1 1 auto;overflow:auto;display:flex;flex-direction:column;gap:6px;"></div>
            </div>
            <div style="border:1px solid #adc1e3;border-radius:6px;padding:8px;">
              <p style="margin:0 0 6px;color:#445">Select a project on the left to see details.</p>
              <div id="kh-browse-proj-details" style="font-family:monospace;color:#334"></div>
            </div>
          </main>
          <footer>
            <button class="kh-btn" data-act="close">Close</button>
          </footer>`;

        const close = () => overlay.remove();
        dlg.querySelector<HTMLButtonElement>("[data-act=close]")!.addEventListener("click", close);
        overlay.appendChild(dlg);
        modal.appendChild(overlay);

        // Constrain dialog height and keep search visible at top; only inner panes scroll
        try {
            dlg.style.maxHeight = "80vh";
            (dlg as any).style.display = "flex";
            (dlg as any).style.flexDirection = "column";
            const mainEl = dlg.querySelector<HTMLDivElement>("main");
            if (mainEl) {
                mainEl.style.overflow = "hidden";
                mainEl.style.height = "60vh";
            }
        } catch {}

        type DefaultProj = { project_id: string; invite_link_id: string };
        const defaults = await import("../export-chat/defaultEphorProjects.json");
        const entries: Array<[string, DefaultProj]> = Object.entries(defaults.default || defaults as any);

        // fetch joined projects via cookie
        let joinedIds = new Set<string>();
        try {
            const remote = await state.client.listProjects();
            const items: any[] = Array.isArray(remote) ? remote : (remote?.items ?? remote?.data ?? []);
            joinedIds = new Set(items.map((p: any) => String(p.project_id ?? p.id ?? p.uuid)));
            try { log("RESPONSE (projects cookie)", `${items.length} items`); } catch {}
        } catch {}

        const listDiv = dlg.querySelector<HTMLDivElement>("#kh-browse-proj-list")!;
        const details = dlg.querySelector<HTMLDivElement>("#kh-browse-proj-details")!;
        try { details.style.overflow = "auto"; } catch {}

        const searchInp = dlg.querySelector<HTMLInputElement>("#kh-browse-proj-search");
        let filter = "";
        searchInp?.addEventListener("input", () => {
            filter = (searchInp.value || "").toLowerCase();
            try { log("UI", `Browse Projects: filter='${filter}'`); } catch {}
            render();
        });

        const render = () => {
            listDiv.textContent = "";
            const filtered = !filter
                ? entries
                : entries.filter(([n]) => n.toLowerCase().includes(filter));
            for (const [name, rec] of filtered.sort((a,b)=>a[0].localeCompare(b[0]))) {
                const has = joinedIds.has(rec.project_id);
                const row = document.createElement("div");
                row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px;border:1px solid #ddd;border-radius:6px";
                if (!has) row.style.opacity = ".5";
                const lab = document.createElement("span"); lab.textContent = name; lab.style.flex = "1";
                const btn = document.createElement("button"); btn.className = "kh-btn";
                btn.textContent = has ? "Joined" : "Join";
                btn.disabled = has;
                if (!has) btn.classList.add("kh-btn-primary");
                btn.addEventListener("click", async (ev) => {
                    ev.stopPropagation();
                    btn.disabled = true; btn.textContent = "Joining…";
                    try { log("REQUEST", `Join by invite ${rec.invite_link_id} → ${rec.project_id}`); } catch {}
                    const resp = await new Promise<{ ok: boolean; joined?: boolean; error?: any }>(r =>
                        chrome.runtime.sendMessage({ action: 'ephor.joinByInvite', inviteId: rec.invite_link_id, projectId: rec.project_id }, r));
                    if (resp?.ok && resp.joined) {
                        joinedIds.add(rec.project_id);
                        btn.textContent = "Joined"; btn.classList.remove("kh-btn-primary"); btn.disabled = false;
                        // refresh projects list in main modal so Project list updates
                        void refreshProjects(state, refs, log);
                        try { log("RESPONSE (join)", `Joined ${rec.project_id}`); } catch {}
                    } else {
                        btn.textContent = "Join"; btn.disabled = false;
                        alert("Could not join project – sign in to ephor.ai and try again.");
                        try { log("ERROR join", String(resp?.error || "unknown")); } catch {}
                    }
                });
                row.appendChild(lab);
                row.appendChild(btn);
                row.addEventListener("click", () => {
                    details.innerHTML = `<div>Name: ${name}</div><div>Project: ${rec.project_id}</div><div>Invite: ${rec.invite_link_id}</div>`;
                });
                listDiv.appendChild(row);
            }
        };
        render();
    });

    refs.newChatBtn.addEventListener("click", async () => {
        if (!store.selectedProjectId) { openMessageDialog("New Chat", "Select a project first."); return; }
        const name = await openPromptDialog("New Chat", "Enter new chat name:", "");
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

    // Ensure Cancel is hidden initially
    try { refs.cancelBtn.style.display = "none"; } catch {}

    refs.sendBtn.addEventListener("click", async () => {
        if (isSending) return;
        if (!store.selectedProjectId) { openMessageDialog("Send", "Pick a project."); return; }

        let promptToSend = "";
        let modelsToUse: string[] = [];
        if (useWorkflow) {
            // Use global default instructions for all stages
            promptToSend = refs.promptInput.value.trim();
            const stg = store.workflowStages.find(x => x.id === currentStageId)!;
            modelsToUse = [...stg.selectedModels];
        } else {
            promptToSend = refs.promptInput.value.trim();
            modelsToUse = [...store.selectedModels];
        }
        if (!promptToSend) { openMessageDialog("Send", "Write a prompt."); return; }
        if (modelsToUse.length === 0) { openMessageDialog("Send", "Pick at least one model."); return; }

        const channelId = store.preferredMode === "multiplexer" ? "" : store.selectedChannelId ?? "";
        if (store.preferredMode !== "multiplexer" && !channelId) { openMessageDialog("Send", "Pick a chat."); return; }

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
                await runAiReplyWorkflow(
                    client,
                    store,
                    store.selectedProjectId,
                    await fetchTranscript(1000),
                    m => {
                        log("STATUS", m);
                        const parts = refs.progressBadge.textContent?.match(/(\d+)\s*\/\s*(\d+)/);
                        const curr = parts ? Number(parts[1]) : 0;
                        if (/Retrying/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "retrying");
                        else if (/failed/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "error");
                        else if (/Query|cost|STATUS/i.test(m)) setProgress(stageName, curr, totalForWorkflow, "sending");
                    },
                    refs.progressBadge,
                    abortCtl.signal,
                );
                setMainTab("outputs");
            } else {
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

                const pseudoId = useWorkflow ? currentStageId : "__single__";
                store.lastOutputs[pseudoId] = { combined: result.combined, byModel: { ...result.byModel } };
                await saveEphorStore(store);
                document.dispatchEvent(new CustomEvent("ephorOutputsUpdated", { detail: { stageId: pseudoId } }));

                if (useWorkflow && store.runMode === "manual") {
                    const stages = store.workflowStages;
                    const idx = stages.findIndex(s => s.id === currentStageId);
                    if (idx >= 0 && idx < stages.length - 1) {
                        currentStageId = stages[idx + 1].id;
                        onStageChange();
                        setMainTab("settings");
                    }
                }
                setMainTab("outputs");
            }
        } catch (e: any) {
            log("ERROR", String(e));
            if (e?.name === "AbortError" || /cancel/i.test(String(e))) {
                refs.progressBadge.textContent = "Cancelled";
            } else {
                openMessageDialog("Error", String(e));
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
        // Remember user's explicit choice for this ticket from now on
        try {
            const tid = currentKayakoTicketId();
            if (tid) {
                store.projectIdByContext = store.projectIdByContext || {};
                store.projectIdByContext[tid] = id;
            }
        } catch {}
        store.selectedChannelId = null;
        state.channels = [];
        void saveEphorStore(store);
        rebuildProjectList(state, refs, refs.projectSearchInp.value);
        rebuildChannelList(state, refs);
        syncModelListHeight();
        void fetchChannels(state, refs, log);
    });
    refs.channelListDiv.addEventListener("click", e => {
        const id = (e.target as HTMLElement).dataset.channelId;
        if (!id) return;

        store.selectedChannelId = id;
        void saveEphorStore(store);
        rebuildChannelList(state, refs, refs.channelSearchInp.value);
        syncModelListHeight();

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
    syncModelListHeight();
    // Fetch projects first, then apply per-ticket auto-selection if no prior choice
    await refreshProjects(state, refs, log);
    try {
        const tid0 = currentKayakoTicketId();
        const mappedPid = tid0 ? (store.projectIdByContext?.[tid0] || "") : "";
        if (!mappedPid && !store.selectedProjectId) {
            const detected = (extractProductValueSafe() || "").trim().toLowerCase();
            if (detected) {
                const expStore = await loadStore();
                const ephorProv = findProvider(expStore, "ephor");
                let projFromUrl = "";
                if (ephorProv) {
                    const byProd = (ephorProv as any).defaultUrlIdByProduct || {};
                    const urlId = byProd[detected] || null;
                    const urlEntry = urlId
                        ? ephorProv.urls.find(u => u.id === urlId)
                        : ephorProv.urls.find(u => (u.product || "").trim().toLowerCase() === detected);
                    if (urlEntry) {
                        try { projFromUrl = new URL(urlEntry.url).pathname.split("/").pop() || ""; } catch {}
                    }
                }
                if (projFromUrl) {
                    const exists = state.store.projects.some(p => String(p.project_id) === projFromUrl);
                    if (exists) {
                        state.store.selectedProjectId = projFromUrl;
                        await saveEphorStore(state.store);
                        rebuildProjectList(state, refs, refs.projectSearchInp.value);
                        await fetchChannels(state, refs, log);
                        try { log("UI", `Auto-selected project for Product='${detected}' → ${projFromUrl}`); } catch {}
                    }
                }
            }
        }
    } catch (e) {
        try { log("ERROR auto-select", String(e)); } catch {}
    }
    setTimeout(() => syncModelListHeight(), 0);
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
        const lbl = modal.querySelector<HTMLSpanElement>("#kh-sort-dd-label");
        if (lbl) lbl.textContent = refs.chatSortSelect.value === "created" ? "Newest" : "A–Z";
        // keep channel list reflecting the chosen order
        refs.chatSortSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Apply initial log visibility
    const logSection = modal.querySelector<HTMLDivElement>("#kh-ephor-log-section");
    if (logSection) logSection.style.display = (store.showApiLog ?? true) ? "" : "none";

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
            btn.textContent = cp.title || cp.placeholder;
            btn.title = `${cp.title || "Custom placeholder"} (${cp.placeholder}) — Right-click to set its value from your clipboard`;

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
    refs.cannedBtn?.addEventListener("click", () => openCannedPromptModal(store));

    /* ------------------------------------------------------------------ *
     * Workflows manager (save/load/delete/switch)                        *
     * ------------------------------------------------------------------ */
    function rebuildWorkflowSelect(): void {
        const sel = refs.wfSelect;
        if (!sel) return;
        sel.textContent = "";
        const none = document.createElement("option"); none.value = ""; none.textContent = "(Unsaved)";
        sel.appendChild(none);
        for (const wf of (store.workflows ?? [])) {
            const opt = document.createElement("option");
            opt.value = wf.id; opt.textContent = wf.name || "Workflow";
            sel.appendChild(opt);
        }
        // use last selected workflow if available
        const lastId = store.lastSelectedWorkflowId || "";
        sel.value = (lastId && (store.workflows ?? []).some(w => w.id === lastId)) ? lastId : "";
        if (refs.wfNameInp) refs.wfNameInp.value = sel.value ? (store.workflows?.find(w=>w.id===sel.value)?.name ?? "") : "";
        updateWorkflowDirtyIndicator();
    }

    function snapshotCurrentWorkflow(): EphorStore["workflows"][number]["data"] {
        return {
            workflowStages: JSON.parse(JSON.stringify(store.workflowStages)),
            preferredMode: store.preferredMode,
            preferredQueryMode: store.preferredQueryMode,
            runMode: store.runMode,
            selectedModels: [...(store.selectedModels ?? [])],
            systemPromptBodies: store.systemPromptBodies ? { ...store.systemPromptBodies } : undefined,
        };
    }

    async function restoreWorkflow(data: EphorStore["workflows"][number]["data"]): Promise<void> {
        store.workflowStages = JSON.parse(JSON.stringify(data.workflowStages || []));
        store.preferredMode = data.preferredMode ?? store.preferredMode;
        store.preferredQueryMode = data.preferredQueryMode ?? store.preferredQueryMode;
        store.runMode = data.runMode ?? store.runMode;
        store.selectedModels = [...(data.selectedModels ?? [])];
        if (data.systemPromptBodies) store.systemPromptBodies = { ...data.systemPromptBodies };
        await saveEphorStore(store);
        updateQueryMode();
        rebuildStageBar();
        onStageChange();
        rebuildOutputTabs();
        rebuildAiSelectionButtons();
        updateWorkflowDirtyIndicator();
    }

    rebuildWorkflowSelect();

    refs.wfSaveBtn?.addEventListener("click", async () => {
        const id = refs.wfSelect?.value || "";
        let name = (refs.wfNameInp?.value || "").trim();
        if (!id) {
            if (!name) name = "New Workflow";
            const wf = { id: crypto.randomUUID(), name, data: snapshotCurrentWorkflow() } as EphorStore["workflows"][number];
            store.workflows = store.workflows ?? [];
            store.workflows.push(wf);
            await saveEphorStore(store);
            rebuildWorkflowSelect();
            if (refs.wfSelect) refs.wfSelect.value = wf.id;
            store.lastSelectedWorkflowId = wf.id;
            await saveEphorStore(store);
            if (refs.wfNameInp) refs.wfNameInp.value = name;
            try { log("UI", `Workflow created: ${name}`); } catch {}
            return;
        }
        const idx = (store.workflows ?? []).findIndex(w => w.id === id);
        if (idx === -1) return;
        if (name) store.workflows![idx].name = name;
        store.workflows![idx].data = snapshotCurrentWorkflow();
        store.lastSelectedWorkflowId = id;
        await saveEphorStore(store);
        rebuildWorkflowSelect();
        if (refs.wfSelect) refs.wfSelect.value = id;
        if (refs.wfNameInp) refs.wfNameInp.value = store.workflows![idx].name;
        try { log("UI", `Workflow saved: ${store.workflows![idx].name}`); } catch {}
        updateWorkflowDirtyIndicator();
    });

    refs.wfLoadBtn?.addEventListener("click", async () => {
        const id = refs.wfSelect?.value || "";
        const wf = (store.workflows ?? []).find(w => w.id === id);
        if (!wf) return;
        await restoreWorkflow(wf.data);
        store.lastSelectedWorkflowId = id;
        await saveEphorStore(store);
        try { log("UI", `Workflow loaded: ${wf.name}`); } catch {}
        if (refs.wfNameInp) refs.wfNameInp.value = wf.name;
    });

    refs.wfDeleteBtn?.addEventListener("click", async () => {
        const id = refs.wfSelect?.value || "";
        const wf = (store.workflows ?? []).find(w => w.id === id);
        if (!wf) return;
        const ok = await openConfirmDialog(`Delete workflow "${wf.name}"?`);
        if (!ok) return;
        store.workflows = (store.workflows ?? []).filter(w => w.id !== id);
        if (store.lastSelectedWorkflowId === id) store.lastSelectedWorkflowId = "";
        await saveEphorStore(store);
        rebuildWorkflowSelect();
        try { log("UI", `Workflow deleted: ${wf.name}`); } catch {}
    });

    refs.wfSelect?.addEventListener("change", () => {
        const id = refs.wfSelect.value;
        const wf = (store.workflows ?? []).find(w => w.id === id);
        if (refs.wfNameInp) refs.wfNameInp.value = wf?.name ?? "";
        store.lastSelectedWorkflowId = id;
        void saveEphorStore(store);
        updateWorkflowDirtyIndicator();
    });

    refs.wfNameInp?.addEventListener("input", () => {
        const id = refs.wfSelect?.value || "";
        if (!id) return; // only edit name of existing
        const wf = (store.workflows ?? []).find(w => w.id === id);
        if (!wf) return;
        wf.name = refs.wfNameInp!.value.trim();
        void saveEphorStore(store).then(() => rebuildWorkflowSelect());
    });

    // Clear workflow name input (small × button)
    try {
        refs.wfNameClearBtn?.addEventListener("click", () => {
            if (!refs.wfNameInp) return;
            refs.wfNameInp.value = "";
            refs.wfNameInp.focus();
            refs.wfNameInp.dispatchEvent(new Event("input", { bubbles: true }));
            try { log("UI", "Cleared workflow name input"); } catch {}
        });
    } catch {}

    function updateWorkflowDirtyIndicator(): void {
        try {
            const sel = refs.wfSelect;
            if (!sel) return;
            const id = sel.value;
            if (!id) return; // empty selection shows (Unsaved)
            const wf = (store.workflows ?? []).find(w => w.id === id);
            if (!wf) return;
            const current = snapshotCurrentWorkflow();
            const isDirty = JSON.stringify(current) !== JSON.stringify(wf.data);
            const opt = Array.from(sel.options).find(o => o.value === id);
            if (opt) {
                const base = wf.name || "Workflow";
                const label = isDirty ? `${base} (unsaved)` : base;
                if (opt.textContent !== label) opt.textContent = label;
            }
        } catch {}
    }

    /* ------------------------------------------------------------------ *
     * Saved Instructions toolbar                                        *
     * ------------------------------------------------------------------ */
    function rebuildSavedInstructionButtons(): void {
        try { if (!refs.instrRow) return; } catch { return; }
        refs.instrRow.textContent = "";
        const list = store.savedInstructions ?? [];
        for (const si of list) {
            const btn = document.createElement("button");
            btn.className = "kh-ph-btn";
            btn.textContent = si.name || "Instruction";
            btn.title = `${si.name || "Instruction"}`;
            btn.addEventListener("click", () => {
                const ta = refs.promptInput;
                ta.focus();
                // Prefer modern API that participates in the undo stack
                try {
                    ta.setSelectionRange(0, ta.value.length);
                    // setRangeText is widely supported and integrates with undo
                    // Replace entire content and move caret to end
                    (ta as any).setRangeText ? ta.setRangeText(si.body, 0, ta.value.length, "end") : (ta.value = si.body);
                } catch {
                    // Fallback to deprecated execCommand; still improves undoability in some browsers
                    try {
                        ta.setSelectionRange(0, ta.value.length);
                        // eslint-disable-next-line deprecation/deprecation
                        document.execCommand("insertText", false, si.body);
                    } catch {
                        ta.value = si.body;
                    }
                }
                const pos = (si.body || "").length;
                try { ta.setSelectionRange(pos, pos); } catch {}
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                try { log("UI", `Applied saved instruction: ${si.name || "Instruction"}`); } catch {}
            });
            refs.instrRow.appendChild(btn);
        }
    }

    function openSavedInstructionsModal(): void {
        if (document.getElementById("kh-instr-modal")) return;
        const modal2 = document.createElement("div");
        modal2.id = "kh-instr-modal";
        Object.assign(modal2.style, {
            position:"fixed", top:"120px", left:"50%", transform:"translateX(-50%)",
            minWidth:"720px", background:"#fff", border:"1px solid #ccc", borderRadius:"6px",
            padding:"12px", zIndex:"10001", boxShadow:"0 4px 16px rgba(0,0,0,.2)",
            fontFamily:"system-ui", fontSize:"13px", display:"flex", flexDirection:"column", gap:"10px",
        } as CSSStyleDeclaration);
        modal2.innerHTML = `
          <style>
            /* Match main modal focus styles for inputs in this window */
            #kh-instr-name:focus,
            #kh-instr-body:focus {
              outline: none;
              border-color: #89b5ff !important;
              box-shadow: 0 0 0 2px rgba(46,115,233,.15) !important;
            }
          </style>
          <div style="display:flex;align-items:center;gap:8px;">
            <h3 style="margin:0;font-size:15px;">Saved Instructions</h3>
            <button id="kh-instr-close" class="kh-btn kh-close-button" style="margin-left:auto;">✕</button>
          </div>
          <div style="display:grid;grid-template-columns:200px 1fr;gap:14px;min-height:280px;">
            <div style="border:1px solid #ddd;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:6px;">
              <div id="kh-instr-list" style="flex:1 1 auto;overflow-y:auto;"></div>
              <button id="kh-instr-new" class="kh-btn">➕ New instruction</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px;min-height:0;">
              <input id="kh-instr-name" type="text" placeholder="Name" style="padding:4px 6px;border:1px solid hsl(213deg 15% 84%);border-radius:4px;background:#fff;box-shadow: inset 0 0 4px 0 hsla(0,0%,0%,0.0325), inset 0 0 2px 0 hsla(0,0%,0%,0.0805), inset 0 0 1px 0 hsla(0,0%,0%,0.089);">
              <textarea id="kh-instr-body" style="flex:1 1 auto;resize:vertical;padding:6px;border:1px solid hsl(213deg 15% 84%);border-radius:4px;background:#fff;box-shadow: inset 0 0 4px 0 hsla(0,0%,0%,0.0325), inset 0 0 2px 0 hsla(0,0%,0%,0.0805), inset 0 0 1px 0 hsla(0,0%,0%,0.089);"></textarea>
            </div>
          </div>`;
        document.body.appendChild(modal2);

        const $ = <T extends HTMLElement>(q: string) => modal2.querySelector<T>(q)!;
        const listDiv = $("#kh-instr-list");
        const newBtn = $("#kh-instr-new") as HTMLButtonElement;
        const closeBtn = $("#kh-instr-close") as HTMLButtonElement;
        const nameInp = $("#kh-instr-name") as HTMLInputElement;
        const bodyTa = $("#kh-instr-body") as HTMLTextAreaElement;

        let currentId: string | null = null;

        const rebuildList = () => {
            listDiv.textContent = "";
            for (const s of (store.savedInstructions ?? [])) {
                const row = document.createElement("div");
                row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:pointer;border-radius:3px;";
                if (s.id === currentId) row.style.background = "hsl(203 100% 95%)";
                const lab = document.createElement("span"); lab.textContent = s.name || "Instruction"; lab.style.flex = "1";
                row.appendChild(lab);
                const del = document.createElement("button"); del.textContent = "✕";
                Object.assign(del.style, { border:"none", background:"none", cursor:"pointer", padding:"0 4px" });
                del.addEventListener("click", ev => {
                    ev.stopPropagation();
                    const overlay = document.createElement("div"); overlay.className = "kh-dialog-overlay";
                    const dlg = document.createElement("div"); dlg.className = "kh-dialog";
                    dlg.innerHTML = `
                      <header>Delete Instruction</header>
                      <main><p style="margin:0;line-height:1.4">Delete “${(s.name || "Instruction").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}”?</p></main>
                      <footer>
                        <button class="kh-btn" data-act="cancel">Cancel</button>
                        <button class="kh-btn kh-btn-primary" data-act="ok">Delete</button>
                      </footer>`;
                    const closeOverlay = () => overlay.remove();
                    dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", closeOverlay);
                    dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => {
                        store.savedInstructions = (store.savedInstructions ?? []).filter(x => x.id !== s.id);
                        void saveEphorStore(store).then(() => { rebuildList(); rebuildSavedInstructionButtons(); closeOverlay(); });
                    });
                    overlay.appendChild(dlg);
                    document.body.appendChild(overlay);
                });
                row.appendChild(del);
                row.addEventListener("click", () => load(s.id));
                listDiv.appendChild(row);
            }
        };

        const load = (id: string | null) => {
            currentId = id;
            rebuildList();
            const rec = (store.savedInstructions ?? []).find(x => x.id === id);
            nameInp.value = rec?.name ?? "";
            bodyTa.value = rec?.body ?? "";
        };

        nameInp.addEventListener("input", () => {
            if (!currentId) return;
            const idx = (store.savedInstructions ?? []).findIndex(x => x.id === currentId);
            if (idx === -1) return;
            store.savedInstructions![idx].name = nameInp.value.trim();
            void saveEphorStore(store).then(() => {
                rebuildList();
                try { document.dispatchEvent(new CustomEvent("savedInstructionsChanged")); } catch {}
            });
        });

        bodyTa.addEventListener("input", () => {
            if (!currentId) return;
            const idx = (store.savedInstructions ?? []).findIndex(x => x.id === currentId);
            if (idx === -1) return;
            store.savedInstructions![idx].body = bodyTa.value;
            void saveEphorStore(store);
        });

        newBtn.addEventListener("click", () => {
            const name = (nameInp.value || "").trim() || "New instruction";
            const s: SavedInstruction = { id: crypto.randomUUID(), name, body: bodyTa.value || "" };
            store.savedInstructions = store.savedInstructions ?? [];
            store.savedInstructions.push(s);
            void saveEphorStore(store).then(() => { rebuildList(); rebuildSavedInstructionButtons(); load(s.id); });
        });

        closeBtn.addEventListener("click", () => modal2.remove());

        // init
        if (!Array.isArray(store.savedInstructions)) store.savedInstructions = [];
        rebuildList();
        load(store.savedInstructions[0]?.id ?? null);
    }

    refs.instrGearBtn?.addEventListener("click", () => openSavedInstructionsModal());
    // Live updates when instruction names/bodies change
    const onSavedInstrChanged = () => rebuildSavedInstructionButtons();
    document.addEventListener("savedInstructionsChanged", onSavedInstrChanged);
    rebuildSavedInstructionButtons();

    /* ------------------------------------------------------------------ *
     * Collapsible sections                                               *
     * ------------------------------------------------------------------ */
    // Grouped collapse for Projects/Chats/Models grid (clicking any title toggles all three)
    (function wireGroupedGridCollapse(){
        const t1 = modal.querySelector<HTMLElement>("#kh-title-projects");
        const t2 = modal.querySelector<HTMLElement>("#kh-title-chats");
        const t3 = modal.querySelector<HTMLElement>("#kh-title-models");
        const b1 = modal.querySelector<HTMLElement>("#kh-proj-body");
        const b2 = modal.querySelector<HTMLElement>("#kh-chat-body");
        const b3 = modal.querySelector<HTMLElement>("#kh-model-body");
        const c1 = modal.querySelector<HTMLElement>("#kh-proj-collapsed");
        const c2 = modal.querySelector<HTMLElement>("#kh-chat-collapsed");
        const c3 = modal.querySelector<HTMLElement>("#kh-model-collapsed");
        if (!(t1 && t2 && t3 && b1 && b2 && b3 && c1 && c2 && c3)) return;
        let collapsed = false;
        const apply = () => {
            const disp = collapsed ? "none" : "";
            const dispInv = collapsed ? "block" : "none";
            b1.style.display = disp; b2.style.display = disp; b3.style.display = disp;
            c1.style.display = dispInv; c2.style.display = dispInv; c3.style.display = dispInv;
        };
        const onClick = () => {
            collapsed = !collapsed; apply();
            try { log("UI", `Grid collapsed → ${collapsed}`); } catch {}
        };
        t1.addEventListener("click", onClick);
        t2.addEventListener("click", onClick);
        t3.addEventListener("click", onClick);
        // Allow clicking any "Click to expand" note to expand back
        const onExpandClick = () => {
            if (collapsed) {
                collapsed = false; apply();
                try { log("UI", "Grid expanded via collapsed note"); } catch {}
            }
        };
        c1.addEventListener("click", onExpandClick);
        c2.addEventListener("click", onExpandClick);
        c3.addEventListener("click", onExpandClick);
        apply();
    })();

    // Independent collapses for sections 4 and 5
    function wireSingleCollapse(titleSel: string, bodySel: string, collapsedSel: string): void {
        const title = modal.querySelector<HTMLElement>(titleSel);
        const body = modal.querySelector<HTMLElement>(bodySel);
        const collapsed = modal.querySelector<HTMLElement>(collapsedSel);
        if (!(title && body && collapsed)) return;
        let isCollapsed = false;
        const update = () => {
            body.style.display = isCollapsed ? "none" : "";
            collapsed.style.display = isCollapsed ? "block" : "none";
        };
        title.addEventListener("click", () => {
            isCollapsed = !isCollapsed; update();
            try { log("UI", `${titleSel} collapsed → ${isCollapsed}`); } catch {}
        });
        collapsed.addEventListener("click", () => {
            if (isCollapsed) {
                isCollapsed = false; update();
                try { log("UI", `${titleSel} expanded via collapsed note`); } catch {}
            }
        });
        update();
    }
    wireSingleCollapse("#kh-title-instr", "#kh-instr-body", "#kh-instr-collapsed");
    wireSingleCollapse("#kh-title-default", "#kh-default-section", "#kh-default-collapsed");

    // Include Default Instructions checkbox hides the whole Default area and its toolbar-left
    (function wireIncludeDefaultToggle(){
        const cbx = modal.querySelector<HTMLInputElement>("#kh-include-default");
        const section = modal.querySelector<HTMLElement>("#kh-default-section");
        const collapsedNote = modal.querySelector<HTMLElement>("#kh-default-collapsed");
        const leftToolbar = modal.querySelector<HTMLElement>("#kh-default-toolbar-left");
        if (!cbx || !section || !leftToolbar || !collapsedNote) return;
        const apply = () => {
            const on = cbx.checked;
            section.style.display = on ? "" : "none";
            // Keep Send controls aligned left; only hide left toolbar content
            leftToolbar.style.visibility = on ? "visible" : "hidden";
            leftToolbar.style.display = ""; // keep node in flow
            // Hide the collapsed-note when excluded entirely; otherwise preserve its state
            if (!on) collapsedNote.style.display = "none";
            try { log("UI", `Include Default Instructions → ${on}`); } catch {}
        };
        cbx.addEventListener("change", apply);
        apply();
    })();

    /* ------------------------------------------------------------------ *
     * AI Selections (presets)                                            *
     * ------------------------------------------------------------------ */
    function applyAiSelection(models: string[], selName?: string): void {
        const avail = new Set(state.availableModels.map(x => x.toLowerCase()));
        const sanitized = (models || []).filter(m => avail.has(String(m).toLowerCase()));
        if (useWorkflow) {
            const stg = store.workflowStages.find(x => x.id === currentStageId);
            if (stg) stg.selectedModels = [...sanitized];
        } else {
            store.selectedModels = [...sanitized];
        }
        void saveEphorStore(store);
        rebuildModelList(state, refs, refs.modelSearchInp.value, useWorkflow ? store.workflowStages.find(x => x.id === currentStageId)! : null);
        rebuildOutputTabs();
        updateWorkflowDirtyIndicator();
        try {
            const note = (document.getElementById("kh-model-saved-note") as HTMLSpanElement | null);
            if (note && sanitized.length) {
                note.textContent = selName ? `Loaded ${selName}` : "Loaded selection";
                note.style.color = "hsl(217.86deg 45% 56%)";
                note.style.display = "inline";
                note.style.transition = "opacity .4s ease";
                note.style.opacity = "1";
                window.setTimeout(() => { note.style.opacity = "0"; }, 2400);
                window.setTimeout(() => { note.style.display = "none"; note.textContent = ""; note.style.opacity = "1"; }, 3000);
            }
            log("UI", `Applied AI selection${selName ? ` '${selName}'` : ""} (${sanitized.length} models)`);
        } catch {}
    }

    function rebuildAiSelectionButtons(): void {
        try { /* keep UI resilient if toolbar missing */ if (!refs.aiSelRow) return; } catch { return; }
        refs.aiSelRow.textContent = "";
        const list = store.aiSelections ?? [];
        for (const sel of list) {
            const btn = document.createElement("button");
            btn.className = "kh-ph-btn";
            btn.textContent = sel.name || "Selection";
            btn.title = `${sel.name || "Selection"} — ${sel.models.length} models`;
            btn.addEventListener("click", () => applyAiSelection(sel.models, sel.name));
            refs.aiSelRow.appendChild(btn);
        }
        // Always keep gear enabled
        if (refs.aiSelGearBtn) refs.aiSelGearBtn.disabled = false;

        // Wire Clear selection button
        try {
            const btn = (modal.querySelector("#kh-ai-sel-clear") as HTMLButtonElement | null) || null;
            if (btn) {
                btn.onclick = null as any;
                btn.addEventListener("click", () => {
                    if (useWorkflow) {
                        const stg = store.workflowStages.find(x => x.id === currentStageId);
                        if (stg) stg.selectedModels = [];
                    } else {
                        store.selectedModels = [];
                    }
                    void saveEphorStore(store);
                    rebuildModelList(state, refs, refs.modelSearchInp.value, useWorkflow ? store.workflowStages.find(x => x.id === currentStageId)! : null);
                    rebuildOutputTabs();
                    updateWorkflowDirtyIndicator();
                    try { log("UI", "AI selection cleared"); } catch {}
                });
            }
        } catch {}

        // Do not persist the selection note; leave it ephemeral only on click
        try {
            const note = (document.getElementById("kh-model-saved-note") as HTMLSpanElement | null);
            if (note) { note.style.display = "none"; note.textContent = ""; note.style.opacity = "1"; }
        } catch {}
    }

    // Open manager modal
    refs.aiSelGearBtn?.addEventListener("click", () => {
        try { log("UI", "Open AI Selections manager"); } catch {}
        const currentModels = useWorkflow
            ? (store.workflowStages.find(x => x.id === currentStageId)?.selectedModels ?? [])
            : (store.selectedModels ?? []);
        openAiSelectionsModal(store, state.availableModels, currentModels);
    });

    // Live updates when presets change from the manager
    const onAiSelectionsChanged = () => rebuildAiSelectionButtons();
    document.addEventListener("aiSelectionsChanged", onAiSelectionsChanged);

    /* Add Placeholder button (circle plus) — open manager, create new, focus name */
    const addPhBtn = modal.querySelector<HTMLButtonElement>("#kh-add-placeholder");
    addPhBtn?.addEventListener("click", () => {
        try { log("UI", "Open Canned Prompts (via +)"); } catch {}
        openCannedPromptModal(store);
        // Defer to allow modal to mount
        window.setTimeout(() => {
            const m = document.getElementById("kh-canned-prompt-modal");
            const newBtn = m?.querySelector<HTMLButtonElement>("#kh-canned-new");
            newBtn?.click();
            const title = m?.querySelector<HTMLInputElement>("#kh-canned-title");
            title?.focus();
            try { log("UI", "New placeholder created and focused"); } catch {}
        }, 0);
    });

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
        // Apply mapped project for this ticket if user chose one before
        try {
            const pid = now ? (store.projectIdByContext?.[now] || "") : "";
            if (pid && pid !== store.selectedProjectId) {
                store.selectedProjectId = pid;
                store.selectedChannelId = null;
                await saveEphorStore(store);
                rebuildProjectList(state, refs, refs.projectSearchInp.value);
                rebuildChannelList(state, refs);
                void fetchChannels(state, refs, log);
                try { log("UI", `Applied per-ticket project mapping for ticket ${now} → ${pid}`); } catch {}
            }
        } catch {}
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
        // Apply per-ticket Mode/Workflow/Run preferences when switching tickets
        try {
            await applyTicketPrefsForCurrentTicket();
            updateQueryMode();
        } catch {}
    }, 800);

    // Cleanup watcher on modal close
    refs.closeBtn.addEventListener("click", () => {
        try { clearInterval(ticketWatch); } catch {}
    });
}
