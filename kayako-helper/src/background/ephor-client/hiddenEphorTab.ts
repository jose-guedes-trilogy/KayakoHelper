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

    /* simple retain/release to debounce auto-closing */
    private static activeUsers = 0;
    private static closeTimer: number | null = null as unknown as number | null;
    private static retain(): void {
        this.activeUsers++;
        if (this.closeTimer != null) {
            try { clearTimeout(this.closeTimer as unknown as number); } catch {}
            this.closeTimer = null;
        }
    }
    private static scheduleRelease(reason: string): void {
        this.activeUsers = Math.max(0, this.activeUsers - 1);
        if (this.activeUsers === 0) {
            try { if (this.closeTimer != null) clearTimeout(this.closeTimer as unknown as number); } catch {}
            this.closeTimer = setTimeout(() => {
                this.closeTimer = null;
                void this.closeTabIfOpen(reason || 'idle');
            }, 600) as unknown as number;
        }
    }

    /** Public acquire/release helpers for long-lived sequences */
    static async acquire(): Promise<number | undefined> {
        HiddenEphorTab.retain();
        try { return await HiddenEphorTab.ensureTab(); }
        catch (e) { HiddenEphorTab.scheduleRelease('acquire-failed'); throw e; }
    }
    static release(reason: string = 'manual'): void {
        HiddenEphorTab.scheduleRelease(reason);
    }

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

    /** Close and clear the shared hidden tab if it exists. */
    private static async closeTabIfOpen(reason: string = ""): Promise<void> {
        try {
            if (this.sharedTabId != null) {
                const id = this.sharedTabId;
                this.sharedTabId = null;
                try { await chrome.tabs.remove(id); } catch {}
                try { console.info('[HiddenEphorTab] closed hidden tab', { id, reason }); } catch {}
            }
        } catch {}
    }

    /* ---------- Clerk session JWT ---------------------------------- */
    public async getSessionJwt(): Promise<{ token: string; expiresAt: number }> {
        HiddenEphorTab.retain();
        try {
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
        } finally {
            HiddenEphorTab.scheduleRelease('getSessionJwt');
        }
    }

    /* ---------- proxy fetch through the tab (cookies!) -------------- */
    public async fetch<T = unknown>(url: string, init: RequestInit = {}) {
        HiddenEphorTab.retain();
        try {
            const tabId = await HiddenEphorTab.ensureTab();      // may be undefined
            const res = await hiddenFetch<T>(tabId, url, init);
            return res;
        } finally {
            HiddenEphorTab.scheduleRelease('hiddenFetch');
        }
    }
}
