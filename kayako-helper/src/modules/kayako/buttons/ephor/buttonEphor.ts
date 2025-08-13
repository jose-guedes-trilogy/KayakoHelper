/* Kayako Helper – buttonEphor.ts (rev-v2.2.1)
   • FIX: token now obtained via new auth bucket when available.
   • Minor numeric lint fixes.
*/
import { EXTENSION_SELECTORS } from "@/generated/selectors.ts";
import { fetchTranscript } from "@/utils/api.js";
import { EphorStore, loadEphorStore, EphorProject } from "@/modules/kayako/buttons/ephor/ephorStore.ts";
import { openEphorSettingsModal } from "./ephorSettingsModal.ts";
import { EphorClient } from "@/background/ephorClient.ts";
import { runAiReplyWorkflow } from "@/modules/kayako/buttons/ephor/aiReplyWorkflow.ts";
import { HeaderSlot, registerEditorHeaderButton } from "@/modules/kayako/buttons/buttonManager.ts";

const BTN_ID  = "#kh-ephor-btn";
const MENU_ID = "#kh-ephor-menu";
const ICON    = "🤖";

let store : EphorStore;
let misc  : { apiBase: string; token?: string };
let client: EphorClient;
let lastMenuSig = "";

export async function bootEphorButton(): Promise<void> {
    store = await loadEphorStore();
    misc  = (await chrome.storage.local.get("kh-ephor-misc"))["kh-ephor-misc"] ?? { apiBase: "https://api.ephor.ai", token: "" };

    client = new EphorClient({ apiBase: misc.apiBase });  // token managed via storage

    registerEditorHeaderButton({
        id: BTN_ID,
        type: "split",
        slot: HeaderSlot.SECOND,
        label: () => `${ICON} Ephor`,
        rightId: MENU_ID,
        rightLabel: "▾",
        buildMenu: rebuildDropdown,
        onClick: () => { void onMainClick(); },
        onContextMenu: ev => { ev.preventDefault(); ev.stopPropagation(); void openEphorSettingsModal(store, client); },
    });
}

/* ------------------------------------------------------------------ */
async function onMainClick(): Promise<void> {
    const auth = (await chrome.storage.local.get("kh-ephor-auth"))["kh-ephor-auth"];
    if (!auth?.token && !misc.token) { alert("Please log in / set an Ephor API token first."); return; }

    /* pick best project */
    const product = findProductName()?.toLowerCase() ?? "";
    const proj = store.projects.find(p => (p as any)?.product?.toLowerCase?.() === product)
        || store.projects.find(p => p.name.toLowerCase() === product)
        || store.projects[0];
    if (!proj) { alert("No Ephor project configured yet. Open settings to fetch projects."); return; }

    /* status pop-up */
    const prog = document.createElement("div");
    Object.assign(prog.style, {
        position:"fixed", top:"120px", left:"50%", transform:"translateX(-50%)",
        background:"#fff", border:"1px solid #ccc", borderRadius:"6px", padding:"10px 16px",
        zIndex:"10000", boxShadow:"0 4px 12px rgba(0,0,0,.2)", fontFamily:"system-ui", fontSize:"14px",
    } as CSSStyleDeclaration);
    prog.textContent = "Preparing transcript…";
    document.body.appendChild(prog);
    const setMsg = (m: string) => { prog.textContent = m; };

    try {
        const transcript = await fetchTranscript(1000);
        const reply      = await runAiReplyWorkflow({ client, store, projectId: proj.project_id, transcript, onStatus: setMsg });
        setMsg("Copying reply to clipboard…");
        await navigator.clipboard.writeText(reply);
        setMsg("✅ Reply ready – pasted into clipboard!");
    } catch (err) {
        console.error("[ephor] workflow failed", err);
        setMsg(`❌ Failed: ${(err as Error).message}`);
    } finally {
        setTimeout(() => prog.remove(), 5000);
    }
}

/* ------------------------------------------------------------------ */
function rebuildDropdown(menu: HTMLElement): void {
    const sig = JSON.stringify(store.projects.map(p => p.project_id));
    if (sig === lastMenuSig) return;
    lastMenuSig = sig;

    menu.textContent = "";
    if (store.projects.length === 0) {
        const li = Object.assign(document.createElement("div"), { textContent: "No projects" });
        li.style.padding = "6px 10px";
        menu.appendChild(li);
        return;
    }
    for (const p of store.projects) {
        const row = document.createElement("div");
        row.className      = EXTENSION_SELECTORS.twoPartBtnDropdownItem.slice(1);
        row.style.cursor   = "pointer";
        row.textContent    = `Create chat in “${p.name}”`;
        row.addEventListener("click", () => void onProjectClick(p));
        menu.appendChild(row);
    }
}

/* create new channel ----------------------------------------------- */
async function onProjectClick(p: EphorProject): Promise<void> {
    const name = prompt(`Enter a name for the new chat in “${p.name}”:`); if (!name) return;
    try {
        const ch = await client.createChannel(p.project_id, name);
        console.info("[Ephor] Created channel:", ch);
        alert(`Successfully created channel “${ch.channel_name ?? ch.name}” in project “${p.name}”!`);
    } catch (err) {
        console.error("[ephor] channel creation failed", err);
        alert(`Failed to create channel: ${(err as Error).message}`);
    }
}

/* helpers ----------------------------------------------------------- */
const findProductName = (): string | null => {
    const el = document.querySelector('[id^="ko-info-bar-select-trigger"][class*="Product"] span[title]');
    return el ? (el as HTMLElement).innerText.trim() : null;
};
