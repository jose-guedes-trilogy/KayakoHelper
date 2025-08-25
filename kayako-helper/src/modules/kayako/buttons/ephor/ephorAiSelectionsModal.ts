// Kayako Helper – ephorAiSelectionsModal.ts
// Manager for AI model selection presets. Mirrors canned-prompt modal structure.

import { EphorStore, AISelection, saveEphorStore } from "./ephorStore.ts";

export function openAiSelectionsModal(store: EphorStore, availableModels: string[]): void {
    if (document.getElementById("kh-ai-sel-modal")) return;

    const modal = document.createElement("div");
    modal.id = "kh-ai-sel-modal";
    Object.assign(modal.style, {
        position:"fixed", top:"120px", left:"50%", transform:"translateX(-50%)",
        minWidth:"760px", background:"#fff", border:"1px solid #ccc", borderRadius:"6px",
        padding:"12px", zIndex:"10001", boxShadow:"0 4px 16px rgba(0,0,0,.2)",
        fontFamily:"system-ui", fontSize:"13px", display:"flex", flexDirection:"column", gap:"10px",
    } as CSSStyleDeclaration);

    modal.innerHTML = /* HTML */`
      <div style="display:flex;align-items:center;gap:8px;">
        <h3 style="margin:0;font-size:15px;">AI Selections</h3>
        <button id="kh-ai-sel-close" class="kh-btn kh-close-button" style="margin-left:auto;">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:220px 1fr;gap:14px;min-height:320px;">
        <!-- left: list -->
        <div style="border:1px solid #ddd;border-radius:4px;padding:6px;display:flex;flex-direction:column;gap:6px;">
          <div id="kh-ai-sel-list" style="flex:1 1 auto;overflow-y:auto;"></div>
          <button id="kh-ai-sel-new" class="kh-btn">➕ New selection</button>
        </div>

        <!-- right: editor -->
        <div style="display:flex;flex-direction:column;gap:8px;min-height:0;">
          <input id="kh-ai-sel-name" type="text" placeholder="Selection name"
                 style="padding:4px 6px;border:1px solid #ccc;border-radius:4px;">
          <div id="kh-ai-sel-models" style="flex:1 1 auto;overflow:auto;border:1px solid #ddd;border-radius:4px;padding:6px;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const $ = <T extends HTMLElement>(q: string) => modal.querySelector<T>(q)!;
    const listDiv   = $("#kh-ai-sel-list");
    const newBtn    = $("#kh-ai-sel-new")  as HTMLButtonElement;
    const closeBtn  = $("#kh-ai-sel-close")as HTMLButtonElement;
    const nameInput = $("#kh-ai-sel-name")  as HTMLInputElement;
    const modelsDiv = $("#kh-ai-sel-models")as HTMLDivElement;

    let currentId: string | null = null;

    const rebuildModels = (selected: string[]) => {
        modelsDiv.textContent = "";
        const sel = new Set((selected || []).map(x => x.toLowerCase()));
        for (const m of availableModels) {
            const label = document.createElement("label");
            Object.assign(label.style, { display:"flex", alignItems:"center", gap:"6px", padding:"4px 6px" });
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.value = m;
            cb.checked = sel.has(m.toLowerCase());
            cb.addEventListener("change", () => {
                const idx = store.aiSelections!.findIndex(x => x.id === currentId);
                if (idx === -1) return;
                const list = new Set(store.aiSelections![idx].models.map(x => x.toLowerCase()));
                if (cb.checked) list.add(m.toLowerCase()); else list.delete(m.toLowerCase());
                // write back preserving original casing from availableModels
                store.aiSelections![idx].models = availableModels.filter(x => list.has(x.toLowerCase()));
                void saveEphorStore(store).then(() => document.dispatchEvent(new CustomEvent("aiSelectionsChanged")));
            });
            label.appendChild(cb);
            label.appendChild(document.createTextNode(m));
            modelsDiv.appendChild(label);
        }
    };

    const loadSelection = (id: string | null) => {
        currentId = id;
        rebuildList();
        if (!id) {
            nameInput.value = "";
            rebuildModels([]);
            return;
        }
        const sel = store.aiSelections!.find(s => s.id === id);
        nameInput.value = sel?.name ?? "";
        rebuildModels(sel?.models ?? []);
    };

    const rebuildList = () => {
        listDiv.textContent = "";
        for (const s of store.aiSelections ?? []) {
            const row = document.createElement("div");
            row.style.cssText = "display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:pointer;border-radius:3px;";
            if (s.id === currentId) row.style.background = "hsl(203 100% 95%)";
            const lab = document.createElement("span"); lab.textContent = s.name || "Selection"; lab.style.flex = "1";
            row.appendChild(lab);
            const del = document.createElement("button");
            del.textContent = "✕";
            Object.assign(del.style, { border:"none", background:"none", cursor:"pointer", padding:"0 4px" });
            del.addEventListener("click", ev => {
                ev.stopPropagation();
                const overlay = document.createElement("div"); overlay.className = "kh-dialog-overlay";
                const dlg = document.createElement("div"); dlg.className = "kh-dialog";
                dlg.innerHTML = `
                  <header>Delete Selection</header>
                  <main><p style="margin:0;line-height:1.4">Delete “${(s.name || "Selection").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}”?</p></main>
                  <footer>
                    <button class="kh-btn" data-act="cancel">Cancel</button>
                    <button class="kh-btn kh-btn-primary" data-act="ok">Delete</button>
                  </footer>`;
                const close = () => overlay.remove();
                dlg.querySelector<HTMLButtonElement>("[data-act=cancel]")!.addEventListener("click", close);
                dlg.querySelector<HTMLButtonElement>("[data-act=ok]")!.addEventListener("click", () => {
                    store.aiSelections = (store.aiSelections ?? []).filter(x => x.id !== s.id);
                    void saveEphorStore(store).then(() => {
                        document.dispatchEvent(new CustomEvent("aiSelectionsChanged"));
                        if (currentId === s.id) loadSelection(store.aiSelections?.[0]?.id ?? null);
                        close();
                    });
                });
                overlay.appendChild(dlg);
                document.body.appendChild(overlay);
            });
            row.appendChild(del);
            row.addEventListener("click", () => loadSelection(s.id));
            listDiv.appendChild(row);
        }
    };

    nameInput.addEventListener("input", () => {
        const idx = store.aiSelections!.findIndex(x => x.id === currentId);
        if (idx === -1) return;
        store.aiSelections![idx].name = nameInput.value.trim();
        void saveEphorStore(store).then(() => {
            rebuildList();
            document.dispatchEvent(new CustomEvent("aiSelectionsChanged"));
        });
    });

    newBtn.addEventListener("click", () => {
        const first = (store.aiSelections?.length ?? 0) === 0;
        let name = (nameInput.value || "").trim();
        if (!name) name = "New selection";
        let models: string[] = [];
        if (first) {
            const checked = Array.from(modelsDiv.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'));
            const set = new Set(checked.map(cb => String(cb.value).toLowerCase()));
            models = availableModels.filter(m => set.has(m.toLowerCase()));
        }
        const s: AISelection = { id: crypto.randomUUID(), name, models };
        store.aiSelections = store.aiSelections ?? [];
        store.aiSelections.push(s);
        void saveEphorStore(store).then(() => {
            document.dispatchEvent(new CustomEvent("aiSelectionsChanged"));
            loadSelection(s.id);
        });
    });

    closeBtn.addEventListener("click", () => modal.remove());

    // Live reflect external changes to the list
    const onAiSelChanged = () => rebuildList();
    document.addEventListener("aiSelectionsChanged", onAiSelChanged);
    // Cleanup on close
    closeBtn.addEventListener("click", () => document.removeEventListener("aiSelectionsChanged", onAiSelChanged));

    // init
    if (!Array.isArray(store.aiSelections)) store.aiSelections = [];
    rebuildList();
    loadSelection(store.aiSelections[0]?.id ?? null);
}


