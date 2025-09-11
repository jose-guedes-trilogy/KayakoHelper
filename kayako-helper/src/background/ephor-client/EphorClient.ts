/* Kayako Helper – EphorClient.ts (rev-v1.3.1 • 2025-08-06)
   ─────────────────────────────────────────────────────────
   • Extracted constants, types, utils and logger into their own files.
   • Switched all logging to the central Logger.
   • Replaced helper statics with imports (`isJwt`, `decodeJwtExp`).
   • Renamed `isBackgroundContext()` → `isBackground()`.
   • NEW: AbortSignal support across stream/multiplexer/WebSocket/SSE.
   • No runtime behaviour changed otherwise.
*/

import { HiddenEphorTab } from "./HiddenEphorTab.ts";
import { throttleForUrl, setRateLimitConfig } from "./rateLimiter.ts";

import { AUTH_KEY, MISC_KEY } from "./constants.ts";
import {isJwt, decodeJwtExp, pickToken, extractTimeToCompleteMs, isTerminalEvent} from "./utils.ts";
import { Logger } from "./logger.ts";
import type {
    InteractionPayload,
    StreamResponse,
    ChannelMessagePayload,
    MuxResponse,
    EphorClientOpts,
    StoredAuth,
} from "./types.ts";

/* ------------------------------------------------------------------ */
/* 🆕 One-liner used everywhere to stamp the referrer                  */
/* ------------------------------------------------------------------ */
const withReferrer = (init: RequestInit = {}): RequestInit => ({
    referrer: "https://app.ephor.ai/",
    ...init,
});

/* ------------------------------------------------------------------ */
export class EphorClient {
    /* ─────────────────────────────────────────────────────────── */
    private static _instances = new Set<EphorClient>();

    private apiBase = "";
    private token = ""; // API key (eph-…)
    private jwtToken = ""; // Clerk / OAuth JWT (Stream only)
    private refreshToken = "";
    private expiresAt = 0; // jwtToken’s exp
    private serverId = "default";

    private hiddenTab: HiddenEphorTab;
    private readonly tabId?: number;

    private readonly _initPromise: Promise<void>;

    static BG_ACTION = "ephor.proxy";
    static BG_HIDDEN_ACTION = "ephor.hidden.fetch";

    /* dev toggle (exposed for legacy callers) */
    private static verbose = false;
    static setLogger = Logger.setLogger;


    // EphorClient.ts
    async createMessage(projectId: string, channelId: string, body: {
        content: string;
        parent_id?: string;   // "" for first message
        role?: "user" | "assistant" | "system";
        artifacts?: any[];
    }) {
        // Ensure we NEVER send an empty parent_id – fabricate if missing/blank.
        const payload: any = { role: "user", parent_id: "", artifacts: [], ...body };
        if (!payload.parent_id || (typeof payload.parent_id === "string" && payload.parent_id.trim() === "")) {
            payload.parent_id = crypto.randomUUID();
        }
        return this.request(`/api/v1/projects/${projectId}/channels/${channelId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
    }


    /* ------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------ */
    constructor(opts: EphorClientOpts) {
        this.apiBase = (opts.apiBase || "https://api.ephor.ai").replace(/\/$/, "");

        this.tabId = opts.tabId;
        this.hiddenTab = new HiddenEphorTab(this.tabId);

        EphorClient._instances.add(this);

        /* async initialisation */
        this._initPromise = (async () => {
            const raw = await chrome.storage.local.get([AUTH_KEY, MISC_KEY]);

            if (raw[AUTH_KEY]) this.applyAuth(raw[AUTH_KEY] as StoredAuth);

            /* legacy misc cache */
            if (!this.token && raw[MISC_KEY]?.token) this.token = raw[MISC_KEY].token;
            if (!this.jwtToken && raw[MISC_KEY]?.jwtToken) {
                this.jwtToken = raw[MISC_KEY].jwtToken;
                this.expiresAt = decodeJwtExp(this.jwtToken);
            }

            /* CLI overrides */
            if (opts.token) this.token = opts.token;
            if (opts.jwtToken) {
                this.jwtToken = opts.jwtToken;
                this.expiresAt = decodeJwtExp(opts.jwtToken);
            }
            if (opts.refreshToken) this.refreshToken = opts.refreshToken;
            if (opts.expiresAt) this.expiresAt = opts.expiresAt;
            if (opts.serverId) this.serverId = opts.serverId;

            /* No JWT at all? → attempt silent login */
            if (!this.jwtToken && !this.refreshToken) {
                try {
                    await this.refreshClerkSession();
                } catch {
                    /* anonymous is fine */
                }
            }

            await this.saveAuth();
        })();

        // Optional: allow overriding RL via storage (kh-ephor-rl)
        chrome.storage.local.get("kh-ephor-rl").then(r => {
            const cfg = r["kh-ephor-rl"];
            if (cfg && typeof cfg === "object") setRateLimitConfig(cfg);
        });


        /* dev console toggle */
        chrome.storage.local.get("kh-ephor-store").then(r => {
            const v = !!r["kh-ephor-store"]?.logFullResponses;
            EphorClient.verbose = v;
            Logger.enableVerbose(v);
        });
    }

    /* ------------------------------------------------------------------
     * Public helper: await initialisation
     * ------------------------------------------------------------------ */
    public async ready(): Promise<void> {
        return this._initPromise;
    }

    /* ------------------------------------------------------------------
     * JWT hot-swap (used by clerkJwtListener)
     * ------------------------------------------------------------------ */
    static updateAuthToken(jwt: string): void {
        const exp = decodeJwtExp(jwt);

        for (const inst of EphorClient._instances) {
            inst.jwtToken = jwt;
            inst.expiresAt = exp;
            inst.saveAuth().catch(() => {});
        }

        // Preserve any existing API key and fields when persisting the JWT.
        (async () => {
            try {
                const raw = await chrome.storage.local.get(AUTH_KEY);
                const prev = (raw[AUTH_KEY] ?? {}) as Partial<StoredAuth>;
                await chrome.storage.local.set({
                    [AUTH_KEY]: {
                        ...prev,
                        jwtToken: jwt,
                        expiresAt: exp,
                    },
                });
            } catch {
                /* non-fatal */
            }
        })();

        Logger.log("INFO", "Clerk JWT hot-swapped & persisted");
    }


    /* ------------------------------------------------------------------
     * STREAM-JWT acquisition
     * ------------------------------------------------------------------ */
    private _streamJwt = "";
    private _streamJwtExp = 0;

    private async ensureStreamJwt(): Promise<void> {
        const soon = Date.now() + 90_000;

        /* 0️⃣ cached */
        if (this._streamJwt && this._streamJwtExp > soon) return;

        /* 1️⃣ in-memory jwtToken */
        if (this.jwtToken) {
            const exp = decodeJwtExp(this.jwtToken);
            if (exp > soon) {
                this._streamJwt = this.jwtToken;
                this._streamJwtExp = exp;
                return;
            }
        }

        /* 2️⃣ background HiddenEphorTab */
        if (EphorClient.isBackgroundContext() && chrome.scripting?.executeScript) {
            try {
                const { token, expiresAt } = await this.hiddenTab.getSessionJwt();
                this._streamJwt = token;
                this._streamJwtExp = expiresAt;
                this.jwtToken = token;
                this.expiresAt = expiresAt;
                await this.saveAuth();
                return;
            } catch {
                /* fall through */
            }
        }

        /* 3️⃣ service-worker relay */
        try {
            const got = await new Promise<{ ok: boolean; token?: string; expiresAt?: number }>(res =>
                chrome.runtime.sendMessage({ action: "ephor.getStreamJwt" }, res),
            );
            if (got?.ok && got.token) {
                this._streamJwt = got.token;
                this._streamJwtExp = got.expiresAt ?? Date.now() + 50 * 60_000;
                this.jwtToken = got.token;
                this.expiresAt = this._streamJwtExp;
                await this.saveAuth();
                return;
            }
        } catch {
            /* fall through */
        }

        /* 4️⃣ storage fallback */
        const raw = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY] as Partial<StoredAuth> | undefined;
        const legacyJwt = raw?.token && isJwt(raw.token) ? raw.token : "";
        const storedJwt = raw?.jwtToken || legacyJwt;
        const exp = storedJwt ? decodeJwtExp(storedJwt) : 0;
        if (storedJwt && exp > soon) {
            this._streamJwt = storedJwt;
            this._streamJwtExp = exp;
            this.jwtToken = storedJwt;
            this.expiresAt = exp;
            if (legacyJwt) await this.saveAuth(); // migrate
            return;
        }

        throw new Error("Unable to obtain Clerk JWT for streaming – please log in to ephor.ai once.");
    }

    /* ------------------------------------------------------------------
     * STREAM interaction – supports WebSocket or SSE; AbortSignal-aware
     * ------------------------------------------------------------------ */
    async streamInteraction(payload: InteractionPayload, signal?: AbortSignal): Promise<StreamResponse> {
        await this.ensureStreamJwt(); // makes sure _streamJwt is ready

        const url = `${this.apiBase}/api/v1/interact/stream`;

        await throttleForUrl(url, signal);

        Logger.log("INFO", "STREAM ⟶", { url, payload });

        const res = await fetch(
            url,
            withReferrer({
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json, text/plain, */*",
                    Authorization: `Bearer ${this._streamJwt}`,
                },
                body: JSON.stringify(payload),
                signal,
            }),
        );

        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
            const json = await res.json();
            Logger.log("INFO", "STREAM ← JSON-ACK", json);

            // ⬇️ Add this guard
            if (!res.ok || (json && json.detail)) {
                throw new Error(`HTTP ${res.status} – ${JSON.stringify(json)}`);
            }

            const wsOutput = await this.streamViaWebSocket(
                {
                    channelId: String(payload["channel_id"] ?? json.item_id ?? ""),
                    userMsgId: String(json.message_id ?? ""),
                },
                signal,
            );
            return { ...json, output: wsOutput };
        }


        /* ── (B) SSE branch (legacy) ── */
        if (!res.ok) {
            const err = await res.text().catch(() => "");
            throw new Error(`HTTP ${res.status} – ${err}`);
        }
        if (!ct.includes("text/event-stream")) throw new Error(`Unexpected Content-Type: ${ct}`);

        const reader  = res.body!.getReader();
        const decoder = new TextDecoder();
        const delim   = /\r?\n\r?\n/; // frame separator
        let buffer    = "";

        const allow = new Set(["text","assistant","answer","completion"]);
        let output = "";

        // NEW: soft end state
        let firstTokAt = 0;
        let lastTokAt  = 0;
        let etaMs: number | null = null;
        const GRACE_MS = 600;
        const IDLE_MS  = 1500;
        let sawTerminal = false;

        // helper to decide early finish
        const shouldFinish = () => {
            const now = Date.now();
            const started    = firstTokAt > 0;
            const idle       = started && now - lastTokAt >= IDLE_MS;
            const etaElapsed = started && etaMs != null && (now - firstTokAt) >= (etaMs + GRACE_MS);
            return sawTerminal || (etaElapsed && idle) || (started && idle && etaMs == null);
        };

        // parse one SSE frame’s data lines
        const handleFrame = (frame: string) => {
            frame.trim().split(/\r?\n/).forEach(line => {
                if (!line.startsWith("data:")) return;
                const raw = line.slice(5).trim();
                if (raw === "[DONE]") { sawTerminal = true; return; }
                try {
                    const ev = JSON.parse(raw);

                    // ETA?
                    if (etaMs == null) {
                        const ttc = extractTimeToCompleteMs(ev);
                        if (ttc) etaMs = ttc;
                    }

                    // token?
                    const tok = pickToken(ev);
                    if (tok !== undefined) {
                        output += tok;
                        const now = Date.now();
                        if (!firstTokAt) firstTokAt = now;
                        lastTokAt = now;
                    }

                    // terminal?
                    if (isTerminalEvent(ev)) sawTerminal = true;
                } catch (e) {
                    Logger.log("ERR", "SSE parse fail", { raw, e });
                }
            });
        };

        while (true) {
            if (signal?.aborted) {
                try { await reader.cancel(); } catch {}
                throw new DOMException("Aborted", "AbortError");
            }
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // pull frames
            let m: RegExpMatchArray | null;
            while ((m = buffer.match(delim)) && m.index !== undefined) {
                const idx = m.index;
                const frame = buffer.slice(0, idx);
                buffer = buffer.slice(idx + m[0].length);
                handleFrame(frame);

                // NEW: early exit
                if (shouldFinish()) {
                    try { await reader.cancel(); } catch {}
                    return { output };
                }
            }
        }
        // tail
        if (buffer.trim()) handleFrame(buffer);

        return { output };
    }



// EphorClient.ts
    private async streamViaWebSocket(
        ids: { channelId: string; userMsgId: string },
        signal?: AbortSignal,
    ): Promise<string> {
        const wsUrl = this.apiBase.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(this._streamJwt)}`;

        return new Promise<string>((resolve, reject) => {
            const chunks: string[] = [];
            let assistantId: string | null = null;
            let boundItemId: string | null = null;

            // soft-finish controls
            let firstTokAt = 0;
            let lastTokAt  = 0;
            let etaMs: number | null = null;
            let sawTerminal = false;

            const GRACE_MS       = 600;     // buffer beyond ETA
            const IDLE_MS        = 3000;    // idle after tokens → finish -- INCREASED FROM 1500
            const QUIET_OPEN_MS  = 15000;   // nothing at all → finish -- INCREASED FROM 4000

            let finished = false;
            const finish = (err?: string) => {
                if (finished) return;
                finished = true;
                try { sock.close(); } catch {}
                cleanup();
                err ? reject(new (err === "Aborted" ? DOMException : Error)(err, err === "Aborted" ? "AbortError" : undefined as any))
                    : resolve(chunks.join(""));
            };

            const cleanup = () => {
                clearTimeout(hardTo);
                clearTimeout(openQuietTo);
                clearInterval(pulse);
                signal?.removeEventListener("abort", onAbort as any);
            };

            const onAbort = () => finish("Aborted");

            const hardTo      = setTimeout(() => finish("WebSocket timeout"), 180_000);
            const openQuietTo = setTimeout(() => { if (!firstTokAt && !sawTerminal) finish(); }, QUIET_OPEN_MS);

            if (signal) {
                if (signal.aborted) return onAbort();
                signal.addEventListener("abort", onAbort, { once: true });
            }

            const sock = new WebSocket(wsUrl);

            const pulse = setInterval(() => {
                const now = Date.now();
                const started    = firstTokAt > 0;
                const idle       = started && now - lastTokAt >= IDLE_MS;
                const etaElapsed = started && etaMs != null && (now - firstTokAt) >= (etaMs + GRACE_MS);
                if (sawTerminal || (etaElapsed && idle) || (started && idle && etaMs == null)) {
                    finish();
                }
            }, 200);

            sock.onmessage = ev => {
                try {
                    const outer = JSON.parse(ev.data); // { type, item_id, data }
                    const outerType = String(outer?.type || "").toLowerCase();

                    // Bind once to the stream's item_id so we don't drop valid frames if the server uses a different id than channelId.
                    if (!boundItemId && outer?.item_id) boundItemId = String(outer.item_id);
                    if (boundItemId && outer?.item_id && String(outer.item_id) !== boundItemId) return;

                    // Terminal outer frames (not chunk_out)
                    if (/(done|end|final|complete|completed|channel_end|close)/.test(outerType)) {
                        sawTerminal = true;
                        return;
                    }

                    if (outerType !== "chunk_out") return;

                    const inner = typeof outer.data === "string" ? JSON.parse(outer.data) : (outer.data ?? {});
                    // Ignore echo of our own user message
                    if (inner?.message_id === ids.userMsgId) return;

                    // Stick to the first assistant message id we see
                    if (!assistantId && inner?.message_id) assistantId = inner.message_id;
                    if (assistantId && inner?.message_id && inner.message_id !== assistantId) return;

                    if (etaMs == null) {
                        const ttc = extractTimeToCompleteMs(inner);
                        if (ttc) etaMs = ttc;
                    }

                    const tok = pickToken(inner);
                    if (typeof tok === "string" && tok.length) {
                        chunks.push(tok);
                        const now = Date.now();
                        if (!firstTokAt) firstTokAt = now;
                        lastTokAt = now;
                    }

                    if (isTerminalEvent(inner)) {
                        sawTerminal = true;
                    }
                } catch {
                    finish("WS parse error");
                }
            };

            sock.onerror = () => finish("WebSocket error");
            sock.onclose = () => finish(); // if server closes, we're done
        });
    }



    /* ------------------------------------------------------------------
     * Basic API helpers (no auth changes here)
     * ------------------------------------------------------------------ */
    async listProjects() {
        return this.request("/api/v1/projects", { method: "GET" });
    }

    /**
     * List projects using the Clerk cookie/JWT through the hidden app tab.
     * Does not require an API key.
     */
    async listProjectsCookie(): Promise<any> {
        await this.ensureStreamJwt();
        const url = `${this.apiBase}/api/v1/projects`;
        return this.hiddenTab.fetch<any>(url, {
            headers: {
                Accept: "application/json, text/plain, */*",
                Authorization: `Bearer ${this._streamJwt}`,
            },
        });
    }

    async listModels(): Promise<string[]> {
        return [
            "gemini-2.5-pro",
            "gemini-2.5-flash",
            "phi-4",
            "o3",
            "kimi-k2",
            "cerebras-4-scout",
            "claude-4-sonnet-latest-thinking",
            "grok-3-mini",
            "claude-4-opus-latest-thinking",
            "minimax-m1",
            "bedrock-amazon-nova-premier",
            "deepseek-r1",
            "minimax-01",
            "o4-mini",
            "mistral-small-31",
            "deepseek-v3",
            "perplexity_online_large",
            "grok-4",
            "mistral-medium-3",
            "groq-r1-llama",
            "anthropic-haiku35",
            "grok-3",
            "o3-pro",
            "gpt-4.1",
        ];
    }

    async queryProject(body: { query: string; projectId: string; model: string }) {
        return this.request("/api/v1/multiplexer/query-project", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: body.query, project_id: body.projectId, model: body.model }),
        });
    }

    async createChannel(projectId: string, name: string) {
        return this.request(`/api/v1/projects/${projectId}/channels`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, state: "private" }),
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

    /**
     * Attempt to silently join a project via invite id.
     * 1) Try a background hidden fetch to the invite URL.
     * 2) Poll /projects via cookie/JWT to verify membership.
     * 3) Fallback: open the join URL in the hidden pinned tab, close it after load, and re-check.
     */
    async quietJoinByInvite(inviteId: string, projectId: string, timeoutMs = 12_000): Promise<boolean> {
        const joinUrl = `https://app.ephor.ai/join/${inviteId}`;
        const start = Date.now();

        const hasJoined = async (): Promise<boolean> => {
            try {
                const list = await this.listProjectsCookie();
                const items: any[] = Array.isArray(list) ? list : (list?.items ?? list?.data ?? []);
                return items.some((p: any) => String(p.id ?? p.project_id ?? p.uuid) === projectId);
            } catch { return false; }
        };

        // Attempt join via hidden tab fetch in a loop until membership reflects
        // Keep the hidden tab retained across the whole join flow to avoid home reload loops
        try {
            await (HiddenEphorTab as any).acquire?.();
            try { await this.hiddenTab.fetch<string>(joinUrl, { method: "GET" }); } catch {}
        } finally {
            try { (HiddenEphorTab as any).release?.('join-prefetch'); } catch {}
        }

        // Poll for membership
        while (Date.now() - start < timeoutMs) {
            if (await hasJoined()) return true;
            await new Promise(r => setTimeout(r, 700));
        }

        // Fallback: drive hidden tab to the join URL (never open a normal tab)
        try {
            await (HiddenEphorTab as any).acquire?.();
            const tabId = (HiddenEphorTab as any)["tabId"]?.() ?? (HiddenEphorTab as any)["tabId"];
            const ensureId = (HiddenEphorTab as any)["ensureTab"] ? await (HiddenEphorTab as any)["ensureTab"]() : tabId;
            if (ensureId != null && chrome.tabs?.update) {
                await chrome.tabs.update(ensureId, { url: joinUrl, active: false, pinned: true });
                await new Promise<void>(resolve => {
                    const lis = (id: number, _ci: any, info: chrome.tabs.TabChangeInfo) => {
                        if (id === ensureId && info.status === "complete") {
                            chrome.tabs.onUpdated.removeListener(lis);
                            resolve();
                        }
                    };
                    chrome.tabs.onUpdated.addListener(lis);
                });
            }
        } catch {}
        finally {
            try { (HiddenEphorTab as any).release?.('join-fallback'); } catch {}
        }

        const start2 = Date.now();
        while (Date.now() - start2 < 8_000) {
            if (await hasJoined()) return true;
            await new Promise(r => setTimeout(r, 700));
        }
        return false;
    }

    /* ------------------------------------------------------------------
     * Multiplexer helper – **API-key ONLY**
     * ------------------------------------------------------------------ */
    async multiplexerChannelMessage(p: ChannelMessagePayload, signal?: AbortSignal): Promise<MuxResponse> {
        if (!this.token) throw new Error("API key missing – set the 'token' value for Multiplexer calls.");

        const url = `${this.apiBase}/chat`;
        Logger.log("INFO", "MUX →", p);

        try {
            const res = await fetch(
                url,
                withReferrer({
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: this.token,
                    },
                    body: JSON.stringify(p),
                    signal,
                }),
            );

            if (!res.ok) throw new Error(`HTTP ${res.status} – ${await res.text()}`);

            const json = (await res.json()) as MuxResponse;
            Logger.log("INFO", "MUX ←", json);
            return json;
        } catch (err) {
            Logger.log("ERR", "MUX ✗", err);
            throw err;
        }
    }

    /* ------------------------------------------------------------------
     * CORE request wrapper – **API-key ONLY**
     * ------------------------------------------------------------------ */
    private async request(path: string, init: RequestInit): Promise<any> {
        /* OAuth refresh lane only – JWT never needed for API calls */
        if (this.refreshToken) await this.ensureValidToken();

        const url = `${this.apiBase}${path}`;
        init.headers = {
            ...(init.headers || {}),
            Accept: "application/json",
            Authorization: this.buildAuthHeader(),
        } as Record<string, string>;

        Logger.log("INFO", `REQUEST → ${url}`, init);

        if (EphorClient.isBackgroundContext()) return this.tryFetchWithRetry(url, init);

        /* content-script ➜ service-worker proxy */
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
                {
                    action: EphorClient.BG_ACTION,
                    url,
                    init: {
                        ...init,
                        headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)),
                    },
                },
                (resp: { ok: boolean; data?: any; error?: any }) => {
                    if (chrome.runtime.lastError) return reject({ message: chrome.runtime.lastError.message });
                    if (!resp.ok) {
                        Logger.log("ERR", "proxy error", resp.error);
                        return reject(resp.error);
                    }
                    Logger.log("INFO", `RESPONSE ← ${url}`, resp.data);
                    resolve(resp.data);
                },
            );
        });
    }

    /* ------------------------------------------------------------------
     * Fetch with one OAuth refresh retry
     * ------------------------------------------------------------------ */
    private async tryFetchWithRetry(url: string, init: RequestInit) {
        try {
            return await EphorClient.doFetch(url, init);
        } catch (err: any) {
            let parsed: any;
            try {
                parsed = JSON.parse(err.message);
            } catch {}
            if (parsed?.status === 401 && this.refreshToken) {
                Logger.log("WARN", "401 – refreshing token & retrying…");
                await this.ensureValidToken();
                (init.headers as Record<string, string>).Authorization = this.buildAuthHeader();
                return EphorClient.doFetch(url, init);
            }
            throw err;
        }
    }

    /* ------------------------------------------------------------------
     * Token refresh helpers (OAuth only – JWT skipped)
     * ------------------------------------------------------------------ */
    private refreshing: Promise<void> | null = null;

    private async ensureValidToken() {
        if (!this.refreshToken) return; // nothing to do

        const soon = Date.now() + 90_000;

        if (this.refreshing) await this.refreshing;
        if (this.jwtToken && this.expiresAt > soon) return;

        this.refreshing = this.refreshAccessToken().finally(() => {
            this.refreshing = null;
        });
        return this.refreshing;
    }

    private async refreshClerkSession() {
        /* still needed for Stream mode */
        const { token, expiresAt } = await this.hiddenTab.getSessionJwt();
        this.applyAuth({ jwtToken: token, expiresAt });
        await this.saveAuth();
    }

    /* ---------- OAuth helpers ---------- */
    private async refreshAccessToken() {
        const url = `${this.apiBase}/api/v1/ebus/oauth/refresh`;
        const payload = { server_id: this.serverId, refresh_token: this.refreshToken };

        Logger.log("INFO", "REQUEST → OAuth refresh", payload);
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(payload),
        });

        const ct = res.headers.get("content-type") || "";

        const json = await res.json();

        if (ct.includes("application/json") && json.request_id && !json.output) {
            const answer = await this.fetchFinalOutput(json.request_id);
            return { ...answer, output: answer.output ?? "" };
        }

        Logger.log(res.ok ? "INFO" : "ERR", "OAuth refresh ←", json);

        if (!res.ok || !json?.success) throw new Error("Failed to refresh Ephor token.");

        const tr = json.token_response ?? {};
        this.applyAuth({
            jwtToken: tr.access_token,
            refreshToken: tr.refresh_token ?? this.refreshToken,
            expiresAt: new Date(tr.expires_at ?? Date.now() + 3_600_000).valueOf(),
        });
        await this.saveAuth();
    }

    /* ------------------------------------------------------------------
     * Utilities
     * ------------------------------------------------------------------ */
    private applyAuth(auth: Partial<StoredAuth>) {
        /* migrate legacy “token contains JWT” */
        if (auth.token && isJwt(auth.token) && !auth.jwtToken) {
            this.jwtToken = auth.token;
            this.expiresAt = decodeJwtExp(auth.token);
        } else {
            if (auth.token) this.token = auth.token;
            if (auth.jwtToken) this.jwtToken = auth.jwtToken;
        }
        if (auth.refreshToken) this.refreshToken = auth.refreshToken;
        if (auth.expiresAt) this.expiresAt = auth.expiresAt;
        if (auth.serverId) this.serverId = auth.serverId;
    }

    private async saveAuth() {
        // Merge with what's already stored so we never wipe a previously saved API key.
        const prevRaw = (await chrome.storage.local.get(AUTH_KEY))[AUTH_KEY] as Partial<StoredAuth> | undefined;

        const stored: StoredAuth = {
            token       : this.token        ?? prevRaw?.token        ?? "",
            jwtToken    : this.jwtToken     ?? prevRaw?.jwtToken     ?? "",
            refreshToken: this.refreshToken ?? prevRaw?.refreshToken ?? "",
            expiresAt   : this.expiresAt    ?? prevRaw?.expiresAt    ?? 0,
            serverId    : this.serverId     ?? prevRaw?.serverId     ?? "default",
        };

        await chrome.storage.local.set({ [AUTH_KEY]: stored });

        // Only overwrite misc fields when we actually have values.
        const miscRaw = await chrome.storage.local.get(MISC_KEY);
        const misc = miscRaw[MISC_KEY] ?? {};
        if (this.token)    misc.token = this.token;
        if (this.jwtToken) misc.jwtToken = this.jwtToken;
        await chrome.storage.local.set({ [MISC_KEY]: misc });
    }


    /* ------------------------------------------------------------------
     * Static helpers
     * ------------------------------------------------------------------ */
    static async doFetch(url: string, init: RequestInit) {
        await throttleForUrl(url, (init as any)?.signal);

        const res = await fetch(url, withReferrer(init));
        const text = await res.text();
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            body = text;
        }

        Logger.log(res.ok ? "INFO" : "ERR", `FETCH ${res.ok ? "←" : "✗"} ${url} (${res.status})`, body);

        if (EphorClient.verbose) console.log("[Ephor] ⇠", url, { status: res.status, ok: res.ok, body });

        if (!res.ok) {
            try { console.error('[Ephor] FETCH ✗', { url, status: res.status, body }); } catch {}
            throw new Error(JSON.stringify({ status: res.status, url, body }));
        }
        return body;
    }

    private async fetchFinalOutput(requestId: string, attempt = 0): Promise<any> {
        /* ---------- ABSOLUTE endpoint on the real API host ---------- */
        const url = `${this.apiBase}/api/v1/interact/events?request_id=${requestId}`;
        // this.apiBase is already "https://api.ephor.ai"

        try {
            /* Run the fetch INSIDE the hidden app.ephor.ai tab
               so the Clerk cookie (__session) is first-party. */
            const sse = await this.hiddenTab.fetch<string>(url, {
                headers: { Accept: "application/json, text/plain, */*", Authorization: `Bearer ${this._streamJwt}` }, // keep the JWT
            });

            console.log("[Ephor] Got SSE for request", requestId, sse);
            /* Strip SSE framing */
            const dataLine = sse
                .split(/\r?\n/)
                .find(l => l.startsWith("data:"))
                ?.slice(5)
                .trim();
            if (!dataLine) throw new Error("no data line in SSE");
            return JSON.parse(dataLine); // → { output:"…", … }
        } catch (err: any) {
            /* endpoint isn’t up yet – retry for ~1 min */
            const DELAY_MS = 1_000; // 1 s between polls
            const MAX_TRIES = 8; // ~8 seconds, bump if needed

            if (/404|Failed to fetch/.test(err.message) && attempt < MAX_TRIES) {
                await new Promise(r => setTimeout(r, DELAY_MS));
                console.log(`[Ephor] Fetching output for request ${requestId} (attempt ${attempt})`);
                return this.fetchFinalOutput(requestId, attempt + 1);
            }
            throw err; // propagate real errors
        }
    }

    static isBackgroundContext() {
        return typeof window === "undefined" || typeof document === "undefined";
    }

    /** Used only inside `request()` – never returns the JWT. */
    private buildAuthHeader(): string {
        return this.token || "";
    }
}

/* ------------------------------------------------------------------ *
 * Re-export shared hidden-tab id                                      *
 * ------------------------------------------------------------------ */
export const hiddenEphorTabId = HiddenEphorTab["tabId"];