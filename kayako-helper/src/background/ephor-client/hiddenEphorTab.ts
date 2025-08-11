/* Kayako Helper – HiddenEphorTab.ts (rev-v1.0.0)
   ------------------------------------------------
   • Own file for clarity: all logic around the
     “hidden https://app.ephor.ai/blank” tab lives here.
*/

import { hiddenFetch }      from "./hiddenFetch.ts";

/* ------------------------------------------------------------------ */
export class HiddenEphorTab {
    /* single shared tab across the extension ------------------------ */
    private static sharedTabId: number | null = null;
    static get tabId(): number | null { return this.sharedTabId; }

    constructor(private readonly preferredTabId?: number) {}

    /* ---------- ensure (or create) the /blank tab ------------------ */
    private static async ensureTab(): Promise<number | undefined> {
        if (!chrome?.tabs?.create) return undefined;         // MV2 / tests

        if (this.sharedTabId !== null) {
            try { await chrome.tabs.get(this.sharedTabId); return this.sharedTabId; }
            catch { this.sharedTabId = null; }               // tab was closed
        }

        const tab = await chrome.tabs.create({
            url   : "https://app.ephor.ai/home",
            active: false,
            pinned: true,
        });
        this.sharedTabId = tab.id!;

        /* wait for load ------------------------------------------------ */
        await new Promise<void>(resolve => {
            const listener = (id: number, _ci: any, info: chrome.tabs.TabChangeInfo) => {
                if (id === this.sharedTabId && info.status === "complete") {
                    chrome.tabs.onUpdated.removeListener(listener);
                    resolve();
                }
            };
            chrome.tabs.onUpdated.addListener(listener);
        });
        return this.sharedTabId!;
    }

    /* ---------- Clerk session JWT ---------------------------------- */
    public async getSessionJwt(): Promise<{ token: string; expiresAt: number }> {
        const tabId = await HiddenEphorTab.ensureTab();
        if (tabId === undefined || !chrome.scripting?.executeScript) {
            throw new Error("HiddenEphorTab: chrome.scripting unavailable.");
        }

        const [{ result }] = await chrome.scripting.executeScript<{
            token: string; exp: number;
        }>({
            target: { tabId },
            world : "MAIN",
            func  : async () => {
                // Wait until Clerk booted
                // @ts-ignore – Clerk injected by app
                await (window as any).Clerk.load?.();
                // @ts-ignore
                const jwt: string = await (window as any).Clerk.session?.getToken?.();
                if (!jwt) throw new Error("Failed to obtain Clerk JWT");

                const payload = JSON.parse(atob(jwt.split(".")[1]));
                return { token: jwt, exp: payload.exp * 1000 };
            },
        });
        return { token: result.token, expiresAt: result.exp };
    }

    /* ---------- proxy fetch through the tab (cookies!) -------------- */
    public async fetch<T = unknown>(url: string, init: RequestInit = {}) {
        const tabId = await HiddenEphorTab.ensureTab();      // may be undefined
        return hiddenFetch<T>(tabId, url, init);
    }
}
