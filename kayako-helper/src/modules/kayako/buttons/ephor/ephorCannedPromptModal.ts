// Kayako Helper – ephorCannedPromptModal.ts (v1.0.0)

import { EphorStore, CannedPrompt, saveEphorStore } from "./ephorStore.ts";

/**
 * Opens the canned-prompt manager.
 * Emits a global “cannedPromptsChanged” event whenever the list mutates.
 */
export function openCannedPromptModal(store: EphorStore): void {
    if (document.getElementById("kh-canned-prompt-modal")) return;

    /* ---------- modal shell ---------- */
    const modal = document.createElement("div");
    modal.id = "kh-canned-prompt-modal";
    Object.assign(modal.style, {
        position:"fixed", top:"120px", left:"50%", transform:"translateX(-50%)",
        minWidth:"720px", background:"#fff", border:"1px solid #ccc", borderRadius:"6px",
        padding:"12px", zIndex:"10001", boxShadow:"0 4px 16px rgba(0,0,0,.2)",
        fontFamily:"system-ui", fontSize:"13px", display:"flex", flexDirection:"column", gap:"10px",
    } as CSSStyleDeclaration);

    modal.innerHTML = /* HTML */`
      <div style="display:flex;align-items:center;gap:8px;">
        <h3 style="margin:0;font-size:15px;">Placeholders</h3>
        <button id="kh-canned-close" class="kh-btn kh-close-button" style="margin-left:auto;">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:180px 1fr;gap:14px;min-height:280px;">
        <!-- left: list -->
        <div style="border:1px solid #ddd;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:6px;">
          <div id="kh-canned-list" style="flex:1 1 auto;overflow-y:auto;"></div>
          <button id="kh-canned-new" class="kh-btn">➕ New placeholder</button>
        </div>

        <!-- right: editor -->
        <div style="display:flex;flex-direction:column;gap:6px;">
          <input id="kh-canned-title" type="text" placeholder="Title"
                 style="padding:4px 6px;border:1px solid #ccc;border-radius:4px;">
          <input id="kh-canned-placeholder" type="text" placeholder="@#PLACEHOLDER#@"
                 style="padding:4px 6px;border:1px solid #ccc;border-radius:4px;">
          <textarea id="kh-canned-body"
                    style="flex:1 1 auto;padding:6px;border:1px solid #ccc;border-radius:4px;
                           resize:vertical;"></textarea>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    /* ---------- refs ---------- */
    const $ = <T extends HTMLElement>(q: string) => modal.querySelector<T>(q)!;
    const listDiv        = $("#kh-canned-list");
    const newBtn         = $("#kh-canned-new")  as HTMLButtonElement;
    const closeBtn       = $("#kh-canned-close")as HTMLButtonElement;
    const titleInp       = $("#kh-canned-title")       as HTMLInputElement;
    const phInp          = $("#kh-canned-placeholder") as HTMLInputElement;
    const bodyTa         = $("#kh-canned-body")        as HTMLTextAreaElement;

    let currentId: string | null = null;
    const SYSTEM_TRANSCRIPT_ID = "__system_transcript__";
    const SYSTEM_FILE_ID       = "__system_file__";
    const SYSTEM_PAST_ID       = "__system_past__";
    const SYSTEM_STYLE_ID      = "__system_style__";
    // Removed: Recent Tickets merged into Past Tickets

    const isSystem = (id: string | null) => id === SYSTEM_TRANSCRIPT_ID || id === SYSTEM_FILE_ID || id === SYSTEM_PAST_ID || id === SYSTEM_STYLE_ID;

    const normalizePlaceholder = (raw: string): string => {
        const s = (raw || "").trim();
        // Extract core if already wrapped
        let core = s;
        const m = s.match(/^@#\s*(.*?)\s*#@$/);
        if (m) core = m[1];
        // Sanitize core: uppercase, replace invalid with underscore
        core = core
            .toUpperCase()
            .replace(/[^A-Z0-9_.-]+/g, "_")
            .replace(/^_+|_+$/g, "");
        if (!core) core = "PLACEHOLDER";
        return `@#${core}#@`;
    };

    const isValidPlaceholder = (s: string) => /^@#\s*[A-Z0-9_.-]+\s*#@$/.test((s || "").trim());

    const isDuplicatePlaceholder = (normalized: string, excludeId: string | null): boolean => {
        const norm = (v: string) => v.trim().toUpperCase();
        const n = norm(normalized);
        // Check against system placeholders
        const system = ["@#TRANSCRIPT#@","@#FILE_ANALYSIS#@","@#PAST_TICKETS#@","@#STYLE_GUIDE#@"]; 
        if (system.includes(n)) return true;
        // Check against saved
        return (store.cannedPrompts || []).some(p => (excludeId ? p.id !== excludeId : true) && norm(p.placeholder) === n);
    };

    /* ---------- UI helpers ---------- */
    const rebuildList = () => {
        listDiv.textContent = "";
        const addSys = (id: string, label: string) => {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:pointer;border-radius:3px;";
            if (currentId === id) row.style.background = "hsl(203 100% 95%)";
            const lab = document.createElement("span"); lab.textContent = label; lab.style.flex = "1";
            const tag = document.createElement("span"); tag.textContent = "system"; tag.style.cssText = "font-size:11px;color:#334;opacity:.7;border:1px solid #adc1e3;padding:1px 6px;border-radius:999px;";
            row.appendChild(lab); row.appendChild(tag);
            row.addEventListener("click", () => loadPrompt(id));
            listDiv.appendChild(row);
        };
        addSys(SYSTEM_TRANSCRIPT_ID, "Transcript");
        addSys(SYSTEM_FILE_ID, "File Analysis");
        addSys(SYSTEM_PAST_ID, "Past Tickets");
        addSys(SYSTEM_STYLE_ID, "Style Guide");
        // Recent Tickets merged into Past Tickets

        for (const cp of store.cannedPrompts) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:pointer;border-radius:3px;";
            if (cp.id === currentId) row.style.background = "hsl(203 100% 95%)";

            const lab = document.createElement("span");
            lab.textContent = cp.title || cp.placeholder;
            lab.style.flex = "1";
            row.appendChild(lab);

            /* delete “x” */
            const del = document.createElement("button");
            del.textContent = "✕";
            Object.assign(del.style, { border:"none", background:"none", cursor:"pointer", padding:"0 4px" });
            del.addEventListener("click", ev => {
                ev.stopPropagation();
                const overlay = document.createElement("div");
                overlay.className = "kh-dialog-overlay";
                const dlg = document.createElement("div");
                dlg.className = "kh-dialog";
                dlg.innerHTML = `
                  <header>Delete Placeholder</header>
                  <main><p style="margin:0;line-height:1.4">Delete “${(cp.title || cp.placeholder).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}”?</p></main>
                  <footer>
                    <button class="kh-btn" data-act="cancel">Cancel</button>
                    <button class="kh-btn kh-btn-primary" data-act="ok">Delete</button>
                  </footer>`;
                const close = () => overlay.remove();
                dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", close);
                dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => {
                    store.cannedPrompts = store.cannedPrompts.filter(p => p.id !== cp.id);
                    void saveEphorStore(store).then(() => {
                        rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
                        if (currentId === cp.id) loadPrompt(null);
                        close();
                    });
                });
                overlay.appendChild(dlg);
                document.body.appendChild(overlay);
            });
            row.appendChild(del);

            row.addEventListener("click", () => loadPrompt(cp.id));
            listDiv.appendChild(row);
        }
    };

    const loadPrompt = (id: string | null) => {
        currentId = id;
        rebuildList();
        const sys = isSystem(id);
        if (sys) {
            if (id === SYSTEM_TRANSCRIPT_ID) {
                titleInp.value = "Transcript";
                phInp.value    = "@#TRANSCRIPT#@";
                bodyTa.value   = "Includes the entire ticket transcript for the current case.";
            } else if (id === SYSTEM_FILE_ID) {
                titleInp.value = "File Analysis";
                phInp.value    = "@#FILE_ANALYSIS#@";
                bodyTa.value   = (store.systemPromptBodies?.fileAnalysis ?? "Describe how to analyze and extract insights from attached files.");
            } else if (id === SYSTEM_PAST_ID) {
                titleInp.value = "Past Tickets";
                phInp.value    = "@#PAST_TICKETS#@";
                bodyTa.value   = (store.systemPromptBodies?.pastTickets ?? "Insert relevant excerpts from the customer's previous tickets.");
            } else if (id === SYSTEM_STYLE_ID) {
                titleInp.value = "Style Guide";
                phInp.value    = "@#STYLE_GUIDE#@";
                bodyTa.value   = (store.systemPromptBodies?.styleGuide ?? "Guidelines for tone, formatting, and response style.");
            }
        } else {
            const cp = store.cannedPrompts.find(p => p.id === id);
            titleInp.value = cp?.title ?? "";
            phInp.value    = cp?.placeholder ?? "";
            bodyTa.value   = cp?.body ?? "";
        }
        // Disable editing for all system placeholders
        titleInp.disabled = isSystem(id);
        phInp.disabled    = isSystem(id);
        bodyTa.disabled   = isSystem(id);
    };

    const writeBack = () => {
        if (!currentId) return;
        if (currentId === SYSTEM_TRANSCRIPT_ID) return;
        if (currentId === SYSTEM_FILE_ID) {
            store.systemPromptBodies = store.systemPromptBodies || { fileAnalysis:"", pastTickets:"", styleGuide:"" };
            store.systemPromptBodies.fileAnalysis = bodyTa.value;
            void saveEphorStore(store).then(() => { rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged")); });
            return;
        }
        if (currentId === SYSTEM_PAST_ID) {
            store.systemPromptBodies = store.systemPromptBodies || { fileAnalysis:"", pastTickets:"", styleGuide:"" };
            store.systemPromptBodies.pastTickets = bodyTa.value;
            void saveEphorStore(store).then(() => { rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged")); });
            return;
        }
        if (currentId === SYSTEM_STYLE_ID) {
            store.systemPromptBodies = store.systemPromptBodies || { fileAnalysis:"", pastTickets:"", styleGuide:"" };
            store.systemPromptBodies.styleGuide = bodyTa.value;
            void saveEphorStore(store).then(() => { rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged")); });
            return;
        }
        const idx = store.cannedPrompts.findIndex(p => p.id === currentId);
        if (idx === -1) return;

        const nextPlaceholder = normalizePlaceholder(phInp.value);
        // prevent duplicates
        if (isDuplicatePlaceholder(nextPlaceholder, currentId)) {
            phInp.style.borderColor = "#c33";
            return;
        }
        phInp.style.borderColor = "#ccc";
        store.cannedPrompts[idx] = {
            ...store.cannedPrompts[idx],
            title      : titleInp.value.trim(),
            placeholder: nextPlaceholder,
            body       : bodyTa.value,
        };
        void saveEphorStore(store).then(() => {
            rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
        });
    };

    /* ---------- events ---------- */
    newBtn.addEventListener("click", () => {
        const cp: CannedPrompt = {
            id: crypto.randomUUID(),
            title:"New Placeholder",
            placeholder:`@#PROMPT_${store.cannedPrompts.length+1}#@`,
            body:"",
        };
        store.cannedPrompts.push(cp);
        void saveEphorStore(store).then(() => {
            loadPrompt(cp.id); document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
        });
    });

    titleInp.addEventListener("input", writeBack);
    phInp.addEventListener("input", () => {
        // live validation styling; defer save until blur or valid
        const valid = isValidPlaceholder(phInp.value);
        phInp.style.borderColor = valid ? "#ccc" : "#c33";
        if (valid) writeBack();
    });
    phInp.addEventListener("blur", () => {
        if (isSystem(currentId)) return;
        const normalized = normalizePlaceholder(phInp.value);
        phInp.value = normalized;
        phInp.style.borderColor = "#ccc";
        writeBack();
    });
    bodyTa.addEventListener("input", writeBack);

    closeBtn.addEventListener("click", () => modal.remove());

    /* ---------- init ---------- */
    rebuildList();
    loadPrompt(store.cannedPrompts[0]?.id ?? null);
}
