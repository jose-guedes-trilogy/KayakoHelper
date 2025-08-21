/* Kayako Helper – buttonEphor.ts (rev-v2.4.3)
   ────────────────────────────────────────────
   • Back to a single, normal editor-header button (no split/chevron).
   • Boot guard to avoid duplicate registrations (blinking fix #1).
   • Inline HTML label uses a cached sig via buttonManager (blinking fix #2).
   • SVG uses currentColor (no inline <style>, visible on light/dark).
*/
import { fetchTranscript }                  from "@/utils/api.js";
import {
    EphorStore, loadEphorStore, saveEphorStore,
}                                           from "@/modules/kayako/buttons/ephor/ephorStore.ts";
import { openEphorSettingsModal }           from "./ephorSettingsModal.ts";
import { EphorClient }                      from "@/background/ephorClient.ts";
import { runAiReplyWorkflow }               from "@/modules/kayako/buttons/ephor/aiReplyWorkflow.ts";
import {
    HeaderSlot, registerEditorHeaderButton,
}                                           from "@/modules/kayako/buttons/buttonManager.ts";

const BTN_ID  = "#kh-ephor-btn";

/* ────────────────────────────────────────────────────────────────────
   ICON SVG – sanitized, no <style>, fills inherit currentColor
   (keeps DOM stable and visible in light/dark themes)
   ──────────────────────────────────────────────────────────────────── */
const ICON_SVG = `
<span class="kh-ephor-icon" style="display:inline-flex;align-items:center;line-height:0;">
  <img src="${chrome.runtime.getURL("images/ephor-icon.png")}" alt="Ephor" style="width:16px;height:16px;display:block;" />
</span>
` as const;

let store : EphorStore;
let misc  : { apiBase: string; token?: string };
let client: EphorClient;

export async function bootEphorButton(): Promise<void> {
    /* ── boot guard (prevents duplicate registrations) ─────────────── */
    if ((window as any).__khEphorBooted) return;
    (window as any).__khEphorBooted = true;

    store = await loadEphorStore();
    misc  = (await chrome.storage.local.get("kh-ephor-misc"))["kh-ephor-misc"]
        ?? { apiBase:"https://api.ephor.ai", token:"" };

    /* ─── 1.  Initialise client ───────────────────────────────────── */
    client = new EphorClient({ apiBase: misc.apiBase });      // token managed via storage

    /* ─── 2.  Pick sane default connection mode (if user never set) ─ */
    const auth      = (await chrome.storage.local.get("kh-ephor-auth"))["kh-ephor-auth"] ?? {};
    const hasJwt    = !!auth.token && !auth.token.startsWith("eph-");
    const hasOAuth  = !!auth.refreshToken;
    const hasApiKey = !!misc.token && misc.token.startsWith("eph-");

    if (!store.preferredMode) {
        store.preferredMode = (hasJwt || hasOAuth) ? "stream" : "multiplexer";
        await saveEphorStore(store);
        console.info("[Ephor] Auto-selecting connection mode →", store.preferredMode);
    }

    /* ─── 3.  Register UI button (SIMPLE) ─────────────────────────── */
    registerEditorHeaderButton({
        id: BTN_ID,
        type: "simple",
        slot: HeaderSlot.SECOND,
        /* HTML label: inline SVG + text (HTML-aware in manager) */
        label: () => `${ICON_SVG}<span class="kh-ephor-text" style="margin-left:.35em;">Ephor</span>`,
        onClick  : () => { void openEphorSettingsModal(store, client); },
        onContextMenu: ev => {
            ev.preventDefault(); ev.stopPropagation();
            void onMainClick();
        },
    });
}


/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
async function onMainClick(): Promise<void> {
    store = await loadEphorStore();

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

        const reply = await runAiReplyWorkflow(
            client,
            store,
            (store.projects.find(p => p.name === proj.name) ?? proj).project_id,
            transcript,
            setMsg,
            undefined,
        );

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

/* helpers ----------------------------------------------------------- */
const findProductName = (): string | null => {
    const el = document.querySelector('[id^="ko-info-bar-select-trigger"][class*="Product"] span[title]');
    return el ? (el as HTMLElement).innerText.trim() : null;
};
