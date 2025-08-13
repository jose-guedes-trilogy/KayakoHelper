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
        <h3 style="margin:0;font-size:15px;">Canned Prompts</h3>
        <button id="kh-canned-close" class="kh-btn" style="margin-left:auto;">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:180px 1fr;gap:14px;min-height:280px;">
        <!-- left: list -->
        <div style="border:1px solid #ddd;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:6px;">
          <div id="kh-canned-list" style="flex:1 1 auto;overflow-y:auto;"></div>
          <button id="kh-canned-new" class="kh-btn">➕ New prompt</button>
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

    /* ---------- UI helpers ---------- */
    const rebuildList = () => {
        listDiv.textContent = "";
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
                if (!confirm(`Delete canned prompt “${cp.title}”?`)) return;
                store.cannedPrompts = store.cannedPrompts.filter(p => p.id !== cp.id);
                void saveEphorStore(store).then(() => {
                    rebuildList(); document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
                    if (currentId === cp.id) loadPrompt(null);
                });
            });
            row.appendChild(del);

            row.addEventListener("click", () => loadPrompt(cp.id));
            listDiv.appendChild(row);
        }
    };

    const loadPrompt = (id: string | null) => {
        currentId = id;
        rebuildList();
        const cp = store.cannedPrompts.find(p => p.id === id);
        titleInp.value = cp?.title ?? "";
        phInp.value    = cp?.placeholder ?? "";
        bodyTa.value   = cp?.body ?? "";
    };

    const writeBack = () => {
        if (!currentId) return;
        const idx = store.cannedPrompts.findIndex(p => p.id === currentId);
        if (idx === -1) return;

        store.cannedPrompts[idx] = {
            ...store.cannedPrompts[idx],
            title      : titleInp.value.trim(),
            placeholder: phInp.value.trim(),
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
            title:"New Prompt",
            placeholder:`@#PROMPT_${store.cannedPrompts.length+1}#@`,
            body:"",
        };
        store.cannedPrompts.push(cp);
        void saveEphorStore(store).then(() => {
            loadPrompt(cp.id); document.dispatchEvent(new CustomEvent("cannedPromptsChanged"));
        });
    });

    titleInp.addEventListener("input", writeBack);
    phInp   .addEventListener("input", writeBack);
    bodyTa  .addEventListener("input", writeBack);

    closeBtn.addEventListener("click", () => modal.remove());

    /* ---------- init ---------- */
    rebuildList();
    loadPrompt(store.cannedPrompts[0]?.id ?? null);
}
