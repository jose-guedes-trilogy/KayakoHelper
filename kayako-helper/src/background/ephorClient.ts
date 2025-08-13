/* Kayako Helper – src/background/ephorClient.ts (rev-v4.0.7)
   ───────────────────────────────────────────────────────────
   • Fixes “Cannot read properties of undefined (reading 'get')”
     by performing cookie cloning in the background page when
     chrome.cookies is unavailable in the calling context.
   • No behaviour changes for OAuth users.
*/

import type { EphorChannel } from "@/modules/kayako/buttons/ephor/ephorStore.ts";

/* ------------------------------------------------------------------ */
/* Types / constants                                                   */
/* ------------------------------------------------------------------ */
export interface EphorClientOpts {
    apiBase      : string;
    token?       : string;
    refreshToken?: string;
    expiresAt?   : number;
    serverId?    : string;
}

type StoredAuth = {
    token       : string;
    refreshToken: string;
    expiresAt   : number;
    serverId    : string;
};

const AUTH_KEY        = "kh-ephor-auth";
const MISC_KEY        = "kh-ephor-misc";
const SESSION_COOKIE  = "__session";
const BG_CLONE_ACTION = "ephor.cloneCookie";

/* ------------------------------------------------------------------ */
export class EphorClient {
    private apiBase      : string;
    private token        = "";
    private refreshToken = "";
    private expiresAt    = 0;
    private serverId     = "default";

    /** content→background hop identifier */
    static BG_ACTION = "ephor.proxy";

    /** console dump of full req/resp bodies */
    private static verbose = false;

    /** UI logger hook */
    private static logger?: (msg: string, extra?: any) => void;
    static setLogger(fn: ((m: string, e?: any) => void) | null) { EphorClient.logger = fn ?? undefined; }
    private static log(msg: string, extra?: any) { EphorClient.logger?.(msg, extra); }

    /* ----------------------------- ctor ------------------------------ */
    constructor(opts: EphorClientOpts) {
        this.apiBase = opts.apiBase.replace(/\/$/, "");

        (async () => {
            const raw   = await chrome.storage.local.get([AUTH_KEY, MISC_KEY]);
            const saved = raw[AUTH_KEY] as StoredAuth | undefined;
            if (saved) this.applyAuth(saved);

            if (!this.token && raw[MISC_KEY]?.token) this.token = raw[MISC_KEY].token;

            if (opts.token)        this.token        = opts.token;
            if (opts.refreshToken) this.refreshToken = opts.refreshToken;
            if (opts.expiresAt)    this.expiresAt    = opts.expiresAt;
            if (opts.serverId)     this.serverId     = opts.serverId;

            await this.saveAuth();
        })();

        chrome.storage.local.get("kh-ephor-store")
            .then(r => { EphorClient.verbose = !!r["kh-ephor-store"]?.logFullResponses; });
        chrome.storage.onChanged.addListener(ch => {
            if ("kh-ephor-store" in ch)
                EphorClient.verbose = !!ch["kh-ephor-store"].newValue?.logFullResponses;
        });
    }

    static setVerbose(flag: boolean) { EphorClient.verbose = flag; }

    /* ------------------------------------------------------------------ *
     * PUBLIC helpers (unchanged)                                         *
     * ------------------------------------------------------------------ */
    async listProjects() {
        return this.request("/api/v1/projects", { method: "GET" });
    }
    async listModels(): Promise<string[]> {
        return [
            "cerebras-3.3-70b","claude-3-haiku-20240307","claude-3-opus-20240229","claude-3-sonnet-20240229",
            "command-r-plus","command-r","dbrx-instruct","gemini-2.5-flash","gemini-1.5-pro",
            "gpt-3.5-turbo","gpt-4-turbo","gpt-4o","llama-3-70b-instruct","llama-3-8b-instruct",
            "mixtral-8x22b-instruct","mixtral-8x7b-instruct","reka-core","reka-flash","reka-haiku",
        ];
    }
    async queryProject(body: { query: string; projectId: string; model: string }) {
        return this.request("/api/v1/multiplexer/query-project", {
            method : "POST",
            headers: { "Content-Type": "application/json" },
            body   : JSON.stringify({ query: body.query, project_id: body.projectId, model: body.model }),
        });
    }
    async createChannel(projectId: string, name: string) {
        return this.request(`/api/v1/projects/${projectId}/channels`, {
            method : "POST",
            headers: { "Content-Type": "application/json" },
            body   : JSON.stringify({ name, state: "private" }),
        });
    }
    async listChannels(projectId: string) {
        return this.request(`/api/v1/projects/${projectId}/channels`, { method: "GET" });
    }
    async getChannelDetails(projectId: string, channelId: string) {
        return this.request(`/api/v1/projects/${projectId}/channels/${channelId}`, { method: "GET" });
    }
    async getChannelMessages(projectId: string, channelId: string) {
        return this.request(`/api/v1/projects/${projectId}/channels/${channelId}/messages`, { method: "GET" });
    }

    public hasOAuth(): boolean { return !!this.refreshToken; }

    /* ------------------------------------------------------------------ *
     * Ensure api.ephor.ai has SameSite=None session cookie               *
     * ------------------------------------------------------------------ */
    private cookiesPatched = false;
    private async ensureCrossSiteCookie(): Promise<void> {
        if (this.refreshToken || this.cookiesPatched) return;

        const doClone = async (): Promise<void> => {
            const src = await chrome.cookies.get({ url: "https://ephor.ai", name: SESSION_COOKIE });
            if (!src?.value) throw new Error("Ephor session cookie not found – log in at ephor.ai first.");

            await chrome.cookies.set({
                url           : "https://api.ephor.ai/",   // required for Chrome’s cookie API
                name          : SESSION_COOKIE,
                value         : src.value,
                domain        : "ephor.ai",               // **CHANGED** (was api.ephor.ai)
                path          : "/",
                secure        : true,
                httpOnly      : false,
                sameSite      : "no_restriction",
                expirationDate: src.expirationDate,
                storeId       : src.storeId,
            });
            this.cookiesPatched = true;
        };

        /* chrome.cookies API is unavailable in content scripts */
        if (chrome.cookies?.get) {
            await doClone();
        } else {
            await new Promise<void>((resolve, reject) => {
                chrome.runtime.sendMessage({ action: BG_CLONE_ACTION }, (resp: { ok: boolean; error?: any }) => {
                    if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
                    if (!resp?.ok) return reject(resp?.error ?? "Cookie clone failed");
                    this.cookiesPatched = true;
                    resolve();
                });
            });
        }
    }

    /* ------------------------------------------------------------------ *
     * Send prompt                                                        *
     * ------------------------------------------------------------------ */
    async streamInteraction(body: any) {
        await this.ensureCrossSiteCookie();
        return this.request("/api/v1/interact/stream", {
            method      : "POST",
            headers     : { "Content-Type": "application/json" },
            credentials : "include",
            body        : JSON.stringify(body),
        });
    }

    /* ------------------------------------------------------------------ *
     * CORE request wrapper                                               *
     * ------------------------------------------------------------------ */
    private async request(path: string, init: RequestInit): Promise<any> {
        if (this.refreshToken) await this.ensureValidToken();

        const url = `${this.apiBase}${path}`;
        const hdr: Record<string,string> = {
            ...(init.headers || {}) as Record<string,string>,
            Accept: "application/json",
        };

        const isStream = path.startsWith("/api/v1/interact/stream");
        if (this.refreshToken || (!isStream && this.token)) hdr.Authorization = this.buildAuthHeader();
        init.headers = hdr;

        EphorClient.log("REQUEST", { url, init });

        if (EphorClient.isBackgroundContext()) return this.tryFetchWithRetry(url, init);

        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                { action: EphorClient.BG_ACTION, url, init: { ...init, headers: Object.fromEntries(Object.entries(hdr)) } },
                (resp: { ok: boolean; data?: any; error?: any }) => {
                    if (chrome.runtime.lastError) return reject({ message: chrome.runtime.lastError.message });
                    if (!resp.ok) { EphorClient.log("ERROR", resp.error); return reject(resp.error); }
                    EphorClient.log("RESPONSE", { url, data: resp.data });
                    resolve(resp.data);
                },
            );
        });
    }

    /* ------------------------------------------------------------------ *
     * Retry wrapper, OAuth helpers, utils (unchanged)                    *
     * ------------------------------------------------------------------ */
    private async tryFetchWithRetry(url: string, init: RequestInit) {
        try {
            return await EphorClient.doFetch(url, init);
        } catch (err: any) {
            if (!this.refreshToken) throw err;
            let parsed: any; try { parsed = JSON.parse(err.message); } catch {}
            if (parsed?.status === 401) {
                EphorClient.log("INFO", "Token rejected – refreshing & retrying…");
                await this.refreshAccessToken();
                (init.headers as Record<string,string>).Authorization = this.buildAuthHeader();
                return EphorClient.doFetch(url, init);
            }
            throw err;
        }
    }

    private refreshing: Promise<void> | null = null;
    private async ensureValidToken() {
        if (!this.refreshToken) return;
        if (this.refreshing) await this.refreshing;
        const soon = Date.now() + 90_000;
        if (this.token && this.expiresAt > soon) return;
        this.refreshing = this.refreshAccessToken().finally(() => { this.refreshing = null; });
        return this.refreshing;
    }

    private async refreshAccessToken() {
        const url = `${this.apiBase}/api/v1/ebus/oauth/refresh`;
        const payload = { server_id: this.serverId, refresh_token: this.refreshToken };

        EphorClient.log("REQUEST", { url, payload });

        const res  = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(payload) });
        const json = await res.json();
        EphorClient.log(res.ok ? "RESPONSE" : "ERROR", json);

        if (!res.ok || !json?.success) throw new Error("Failed to refresh Ephor token.");

        const tr = json.token_response ?? {};
        this.applyAuth({
            token       : tr.access_token,
            refreshToken: tr.refresh_token ?? this.refreshToken,
            expiresAt   : (new Date(tr.expires_at ?? Date.now() + 3_600_000)).valueOf(),
        });
        await this.saveAuth();
    }

    private buildAuthHeader(): string { return this.refreshToken ? `Bearer ${this.token}` : this.token; }

    private applyAuth(auth: Partial<StoredAuth>) {
        if (auth.token)        this.token        = auth.token;
        if (auth.refreshToken) this.refreshToken = auth.refreshToken;
        if (auth.expiresAt)    this.expiresAt    = auth.expiresAt;
        if (auth.serverId)     this.serverId     = auth.serverId;
    }

    private async saveAuth() {
        if (this.refreshToken) {
            const stored: StoredAuth = {
                token       : this.token,
                refreshToken: this.refreshToken,
                expiresAt   : this.expiresAt,
                serverId    : this.serverId,
            };
            await chrome.storage.local.set({ [AUTH_KEY]: stored });
        }
        const misc = (await chrome.storage.local.get(MISC_KEY))[MISC_KEY] ?? {};
        misc.token = this.token;
        await chrome.storage.local.set({ [MISC_KEY]: misc });
    }

    static async doFetch(url: string, init: RequestInit) {
        const res  = await fetch(url, init);
        const text = await res.text();
        let body: unknown; try { body = JSON.parse(text); } catch { body = text; }
        EphorClient.log(res.ok ? "RESPONSE" : "ERROR", { url, status: res.status, ok: res.ok, body });
        if (EphorClient.verbose) console.log("[Ephor] ⇠", url, { status: res.status, ok: res.ok, body });
        if (!res.ok) throw new Error(JSON.stringify({ status: res.status, url, body }));
        return body;
    }

    static isBackgroundContext() { return typeof window === "undefined" || typeof document === "undefined"; }
}

/* ------------------------------------------------------------------ *
 * Background proxy & cookie-clone handler                             *
 * ------------------------------------------------------------------ */
if (self && EphorClient.isBackgroundContext()) {
    const cloneCookieInBg = async (): Promise<void> => {
        const src = await chrome.cookies.get({ url: "https://ephor.ai", name: SESSION_COOKIE });
        if (!src?.value) throw new Error("Session cookie missing");
        await chrome.cookies.set({
            url           : "https://api.ephor.ai/",
            name          : SESSION_COOKIE,
            value         : src.value,
            domain        : "ephor.ai",               // **CHANGED** (was api.ephor.ai)
            path          : "/",
            secure        : true,
            httpOnly      : false,
            sameSite      : "no_restriction",
            expirationDate: src.expirationDate,
            storeId       : src.storeId,
        });
    };

    chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
        if (msg?.action === EphorClient.BG_ACTION) {
            (async () => {
                try { sendResponse({ ok: true, data: await EphorClient.doFetch(msg.url, msg.init) }); }
                catch (err: any) {
                    let parsed: any; try { parsed = JSON.parse(err.message); } catch { parsed = { message: err.message }; }
                    sendResponse({ ok: false, error: parsed });
                }
            })();
            return true;
        }
        if (msg?.action === BG_CLONE_ACTION) {
            (async () => {
                try { await cloneCookieInBg(); sendResponse({ ok: true }); }
                catch (e: any) { sendResponse({ ok: false, error: e.message }); }
            })();
            return true;
        }
        return false;
    });
}
