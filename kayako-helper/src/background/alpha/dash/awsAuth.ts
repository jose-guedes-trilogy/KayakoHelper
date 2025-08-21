// awsAuth.ts — Robust Cognito → STS bridge + SigV4 signed fetches (v3)
// - Polls for idToken in MAIN world (up to 5s)
// - Deep-scans Next bundles & perf entries for Identity Pool ID
// - Caches idToken, IdentityPoolId and STS until expiry
// - Better debug so you can see exactly what failed

import { signAwsRequest, AwsCredentials } from "./awsSigV4";

type GetStsMsg = {
    type: "aws.getStsForOrigin";
    originUrl: string;
    region: string;
    userPoolId: string;
    identityPoolId?: string;
};

type SignedFetchMsg = {
    type: "aws.signedFetch";
    url: string;
    method?: string;
    body?: string | null;
    headers?: Record<string, string>;
    originUrl: string;
    region: string;
    userPoolId: string;
    identityPoolId?: string;
    timeoutMs?: number;
};

type StsResponse = {
    ok: boolean;
    credentials?: AwsCredentials & { expiration?: string };
    identityPoolId?: string;
    source?: "cache" | "existingTab" | "ephemeralTab";
    error?: string;
    debug?: any;
};

type FetchResponse = {
    ok: boolean;
    status: number;
    statusText: string;
    url: string;
    headers: Record<string, string>;
    text?: string;
    error?: string;
    debug?: any;
};

const DEBUG = true;
function dlog(...a: any[]) {
    if (DEBUG) console.log("[awsAuth]", ...a);
}

// ------------ caches ------------
let idTokenCache: Record<string, { token: string; expMs: number }> = {};
let idpCache: Record<string, string> = {};
let stsCache: Record<string, { creds: AwsCredentials; expMs: number; idp: string }> =
    {};

// ------------ helpers ------------
function jwtExpMs(jwt: string): number {
    try {
        const [, p] = jwt.split(".");
        const json = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/")));
        return (json.exp as number) * 1000;
    } catch {
        return 0;
    }
}

async function waitForComplete(tabId: number) {
    await new Promise<void>((resolve) => {
        const fn = (tid: number, info: chrome.tabs.TabChangeInfo) => {
            if (tid === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(fn);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(fn);
        chrome.tabs.get(tabId, (t) => {
            // @ts-ignore
            if (t && t.status === "complete") {
                chrome.tabs.onUpdated.removeListener(fn);
                resolve();
            }
        });
    });
}

async function findOrOpenAppTab(
    originUrl: string
): Promise<{ tabId: number; created: boolean }> {
    const patt = originUrl.replace(/\/+$/, "") + "/*";
    const hits = await chrome.tabs.query({ url: patt });
    if (hits.length) return { tabId: hits[0].id!, created: false };
    const tab = await chrome.tabs.create({ url: originUrl, pinned: true, active: false });
    try {
        await chrome.tabs.update(tab.id!, { autoDiscardable: false as any });
    } catch {}
    await waitForComplete(tab.id!);
    return { tabId: tab.id!, created: true };
}

// ---------- injected MAIN-world helpers (kept self-contained) ----------
function injectedReadIdToken(): { idToken?: string; username?: string } | null {
    try {
        const ls = window.localStorage;
        const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i));
        const cog = keys.filter((k) => k && k.startsWith("CognitoIdentityServiceProvider."));
        for (const k of cog) {
            const parts = k!.split(".");
            if (parts.length < 4) continue;
            const tokenType = parts[parts.length - 1];
            const user = parts.slice(2, parts.length - 1).join(".");
            const v = ls.getItem(k!);
            if (tokenType === "idToken" && v) return { idToken: v, username: user || undefined };
        }
        return null;
    } catch {
        return null;
    }
}

function injectedQuickFindIdp(_region: string) {
    // NOTE: do NOT assume the identity pool shares the user-pool region
    // Matches: "us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
    const tryScan = (txt: string | null) => {
        if (!txt) return null;
        const m = /[a-z0-9-]+:[0-9a-fA-F-]{8,}/i.exec(txt);
        return m ? m[0] : null;
    };
    const out: any = { buildId: null, scripts: [] as string[], links: [] as string[] };

    try {
        const el = document.getElementById("__NEXT_DATA__") as HTMLScriptElement | null;
        if (el?.textContent) {
            const data = JSON.parse(el.textContent);
            out.buildId = data?.buildId || null;
            const stack = [data];
            while (stack.length) {
                const cur = stack.pop();
                if (cur && typeof cur === "object") {
                    for (const [, v] of Object.entries(cur)) {
                        if (typeof v === "string") {
                            const m = tryScan(v);
                            if (m) return { idp: m, ...out };
                        } else if (v && typeof v === "object") stack.push(v);
                    }
                }
            }
        }
    } catch {}

    try {
        for (const s of Array.from(document.scripts)) {
            const m = tryScan(s.textContent || "");
            if (m) return { idp: m, ...out };
            if ((s as HTMLScriptElement).src) out.scripts.push((s as HTMLScriptElement).src);
        }
    } catch {}

    try {
        const links = Array.from(
            document.querySelectorAll('link[rel="modulepreload"],link[as="script"]')
        ) as HTMLLinkElement[];
        out.links = links.map((l) => l.href).filter(Boolean);
    } catch {}

    return out; // {idp?:string, buildId?:string, scripts:[], links:[]}
}

function injectedPerfResources(): string[] {
    const set = new Set<string>();
    try {
        for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
            if (typeof e.name === "string") set.add(e.name);
        }
    } catch {}
    return Array.from(set);
}

// ---------- wrappers ----------
async function execReadIdToken(tabId: number) {
    const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: injectedReadIdToken,
    });
    return result as { idToken?: string; username?: string } | null;
}

async function pollIdToken(tabId: number, timeoutMs = 5000, intervalMs = 200) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const r = await execReadIdToken(tabId);
        if (r?.idToken) return r;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
}

async function execQuickIdp(tabId: number, region: string) {
    const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: injectedQuickFindIdp,
        args: [region],
    });
    return result as any;
}

async function execPerf(tabId: number) {
    const [{ result } = { result: [] }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: injectedPerfResources,
    });
    return (result || []) as string[];
}

// Fetch URL text **inside the page tab** (MAIN world) with timeout.
async function execFetchTextInTab(tabId: number, url: string, timeoutMs = 7000) {
    const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (u: string, tms: number) => {
            const controller = new AbortController();
            const to = setTimeout(() => controller.abort(), tms);
            try {
                const r = await fetch(u, { credentials: "omit", mode: "cors", signal: controller.signal });
                const text = r.ok ? await r.text() : "";
                return { ok: r.ok, status: r.status, statusText: r.statusText, text };
            } catch (e: any) {
                return { ok: false, error: String(e?.message || e) };
            } finally {
                clearTimeout(to);
            }
        },
        args: [url, timeoutMs],
    });
    return result as any;
}

function sameOrigin(u: string, base: string) {
    try {
        return new URL(u, base).origin === new URL(base).origin;
    } catch {
        return false;
    }
}

// ---------- main primitives ----------
async function getIdToken(originUrl: string): Promise<{
    token?: string;
    source?: "cache" | "existingTab" | "ephemeralTab";
    debug?: any;
}> {
    const cached = idTokenCache[originUrl];
    const now = Date.now() + 60_000;
    if (cached && cached.expMs > now) return { token: cached.token, source: "cache" };

    const patt = originUrl.replace(/\/+$/, "") + "/*";
    const hits = await chrome.tabs.query({ url: patt });
    if (hits.length) {
        const r = await pollIdToken(hits[0].id!, 5000);
        if (r?.idToken) {
            idTokenCache[originUrl] = { token: r.idToken, expMs: jwtExpMs(r.idToken) };
            return { token: r.idToken, source: "existingTab" };
        }
    }

    const { tabId, created } = await findOrOpenAppTab(originUrl);
    try {
        const r = await pollIdToken(tabId, 5000);
        if (r?.idToken) {
            idTokenCache[originUrl] = { token: r.idToken, expMs: jwtExpMs(r.idToken) };
            return { token: r.idToken, source: created ? "ephemeralTab" : "existingTab" };
        }
        return {
            token: undefined,
            source: created ? "ephemeralTab" : "existingTab",
            debug: { note: "no idToken after polling" },
        };
    } finally {
        try {
            const t = await chrome.tabs.get(tabId);
            if (t && created && !t.active) await chrome.tabs.remove(tabId);
        } catch {}
    }
}

async function storageGet(keys: string[]): Promise<Record<string, any>> {
    return await new Promise<Record<string, any>>((resolve) =>
        chrome.storage.local.get(keys, (items) => resolve(items as Record<string, any>))
    );
}

async function getStoredIdentityPoolId(originUrl: string): Promise<string | undefined> {
    try {
        const origin = new URL(originUrl).origin;
        const keyByOrigin = `alpha.identityPoolId|${origin}`;
        const keyGlobal = `alpha.identityPoolId`;
        const items = await storageGet([keyByOrigin, keyGlobal]);
        const v = items[keyByOrigin] || items[keyGlobal];
        return typeof v === "string" && /[a-z0-9-]+:[0-9a-fA-F-]{8,}/i.test(v) ? v : undefined;
    } catch {
        return undefined;
    }
}

async function discoverIdentityPoolId(
    originUrl: string,
    region: string,
    identityPoolId?: string
): Promise<{ idp?: string; debug: any }> {
    if (idpCache[originUrl]) return { idp: idpCache[originUrl], debug: { cache: true } };

    // 0) Manual overrides via storage
    try {
        const k = `alpha.identityPoolId|${new URL(originUrl).origin}`;
        const st = await chrome.storage?.local.get(k);
        const manual = st?.[k];
        if (typeof manual === "string" && manual.includes(":")) {
            idpCache[originUrl] = manual;
            return { idp: manual, debug: { manualOverride: true } };
        }
    } catch {}
    try {
        const k2 = `alpha.identityPoolId`;
        const st2 = await chrome.storage?.local.get(k2);
        const manual2 = st2?.[k2];
        if (typeof manual2 === "string" && manual2.includes(":")) {
            idpCache[originUrl] = manual2;
            return { idp: manual2, debug: { manualOverrideGlobal: true } };
        }
    } catch {}

    const dbg: any = { tries: [] };

    // 1) Stored value
    const stored = await getStoredIdentityPoolId(originUrl);
    if (stored) {
        idpCache[originUrl] = stored;
        return { idp: stored, debug: { storage: true } };
    }

    // 2) Scan the app tab
    const { tabId, created } = await findOrOpenAppTab(originUrl);
    try {
        const quick = await execQuickIdp(tabId, region);
        dbg.tries.push({ kind: "quick", quick });
        if (quick?.idp) {
            idpCache[originUrl] = quick.idp;
            return { idp: quick.idp, debug: dbg };
        }

        const tab = await chrome.tabs.get(tabId);
        const origin = new URL(tab.url || originUrl).origin;

        const can = new Set<string>();
        // Allow cross-origin; many apps load config from CDNs
        (quick?.scripts || []).forEach((s: string) => {
            try {
                can.add(new URL(s, origin).toString());
            } catch {}
        });
        (quick?.links || []).forEach((s: string) => {
            try {
                can.add(new URL(s, origin).toString());
            } catch {}
        });

        const perf = await execPerf(tabId);
        perf.forEach((s) => {
            try {
                can.add(new URL(s, origin).toString());
            } catch {}
        });

        if (quick?.buildId) {
            can.add(new URL(`/_next/static/${quick.buildId}/build-manifest.json`, origin).toString());
            can.add(new URL(`/_next/static/${quick.buildId}/_buildManifest.js`, origin).toString());
            can.add(new URL(`/_next/static/${quick.buildId}/_ssgManifest.js`, origin).toString());
        }

        let scanned = 0;
        // Stricter: "<region>:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
        const idpRe =
            /\b(?:[a-z]{2}-[a-z-]+-\d):[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}\b/;

        const candidates = Array.from(can).filter(
            (u) => /\.(?:js|json)(?:\?|$)/i.test(u) && !/\.(?:css|png|jpg|gif|svg|ico)(?:\?|$)/i.test(u)
        );

        for (const u of candidates) {
            if (scanned++ > 60) break;

            try {
                // (a) Prefer running in page context (through the HAR proxy)
                const proxied: any = await chrome.runtime.sendMessage({
                    type: "har-proxy-tab-fetch",
                    originUrl,
                    request: { url: u, method: "GET", includeCredentials: false, timeoutMs: 7000 },
                });

                let txt = "";
                if (proxied?.ok) {
                    txt = proxied.text || "";
                } else {
                    // (b) Fallback: execute a fetch inside the tab (MAIN world)
                    const inj = await execFetchTextInTab(tabId, u, 7000);
                    if (inj?.ok) {
                        txt = inj.text || "";
                    } else {
                        // (c) Final fallback: worker-side fetch (requires host_permissions)
                        try {
                            const r = await fetch(u, { credentials: "omit", mode: "cors" as RequestMode });
                            if (r.ok) txt = await r.text();
                        } catch {}
                        if (!txt) {
                            dbg.tries.push({
                                kind: "scanErr",
                                url: u,
                                err: proxied?.error || inj?.error || "proxy+inject fetch failed",
                            });
                            continue;
                        }
                    }
                }

                const m = idpRe.exec(txt);
                if (m) {
                    const [idRegion] = m[0].split(":");
                    if (!/^[a-z]{2}-[a-z-]+-\d$/.test(idRegion)) continue; // guard against false positives
                    identityPoolId = m[0];

                    // Cache and persist immediately
                    idpCache[originUrl] = identityPoolId;
                    try {
                        const originOnly = new URL(originUrl).origin;
                        await chrome.storage?.local.set({
                            [`alpha.identityPoolId|${originOnly}`]: identityPoolId,
                        } as any);
                    } catch {}
                    break;
                }
            } catch (e: any) {
                dbg.tries.push({ kind: "scanErr", url: u, err: String(e?.message || e) });
            }
        }

        dbg.tries.push({ kind: "scanDone", scanned: Math.min(scanned, 150) });
        return { idp: identityPoolId, debug: dbg };
    } finally {
        try {
            const t = await chrome.tabs.get(tabId);
            if (t && created && !t.active) await chrome.tabs.remove(tabId);
        } catch {}
    }
}

async function getSts(
    originUrl: string,
    region: string,
    userPoolId: string,
    identityPoolId?: string
): Promise<StsResponse> {
    const got = await getIdToken(originUrl);
    if (!got.token) return { ok: false, error: "No idToken available", source: got.source, debug: got.debug };

    let idp = identityPoolId || idpCache[originUrl];
    if (!idp) {
        const disc = await discoverIdentityPoolId(originUrl, region, identityPoolId);
        idp = disc.idp;
        if (!idp) return { ok: false, error: "Identity Pool ID not found", source: got.source, debug: disc.debug };

        // Persist discovered IDP for future runs
        try {
            const originOnly = new URL(originUrl).origin;
            await chrome.storage?.local.set({ [`alpha.identityPoolId|${originOnly}`]: idp } as any);
        } catch {}
        idpCache[originUrl] = idp;
    }

    const key = `${originUrl}|${idp}`;
    const now = Date.now() + 60_000;
    const cached = stsCache[key];
    if (cached && cached.expMs > now) {
        return { ok: true, credentials: { ...cached.creds }, identityPoolId: idp, source: "cache" };
    }

    // Derive regions independently:
    //  - User Pool region from userPoolId prefix (e.g., "us-east-1_EJpi..." -> "us-east-1")
    //  - Identity region from identityPoolId prefix (e.g., "eu-west-1:GUID" -> "eu-west-1")
    const userPoolRegion = userPoolId && userPoolId.includes("_") ? userPoolId.split("_")[0] : region;
    const identityRegion = idp.split(":")[0] || region;

    const provider = `cognito-idp.${userPoolRegion}.amazonaws.com/${userPoolId}`;
    const endpoint = `https://cognito-identity.${identityRegion}.amazonaws.com/`;

    async function ci(action: string, body: any) {
        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-amz-json-1.1",
                "X-Amz-Target": `AWSCognitoIdentityService.${action}`,
            },
            body: JSON.stringify(body),
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${action} ${res.status}: ${text}`);
        return JSON.parse(text);
    }

    const { IdentityId } = await ci("GetId", { IdentityPoolId: idp, Logins: { [provider]: got.token } });
    const { Credentials } = await ci("GetCredentialsForIdentity", {
        IdentityId,
        Logins: { [provider]: got.token },
    });

    const creds: AwsCredentials = {
        accessKeyId: Credentials.AccessKeyId,
        secretAccessKey: Credentials.SecretKey,
        sessionToken: Credentials.SessionToken,
    };
    stsCache[key] = { creds, expMs: new Date(Credentials.Expiration).getTime(), idp };
    return {
        ok: true,
        credentials: { ...creds, expiration: Credentials.Expiration },
        identityPoolId: idp,
        source: got.source,
    };
}

// ---------- public installer ----------
export function installAwsAuthBridge() {
    chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
        if (!msg) return;

        if (msg.type === "aws.getStsForOrigin") {
            (async () => {
                try {
                    const m = msg as GetStsMsg;
                    const r = await getSts(m.originUrl, m.region, m.userPoolId, m.identityPoolId);
                    sendResponse(r);
                } catch (e: any) {
                    sendResponse({ ok: false, error: String(e?.message || e) } as StsResponse);
                }
            })();
            return true;
        }

        if (msg.type === "aws.signedFetch") {
            (async () => {
                const m = msg as SignedFetchMsg;
                try {
                    const sts = await getSts(m.originUrl, m.region, m.userPoolId, m.identityPoolId);
                    if (!sts.ok || !sts.credentials) {
                        sendResponse({
                            ok: false,
                            status: 0,
                            statusText: "NO_CREDS",
                            url: m.url,
                            headers: {},
                            error: sts.error || "Failed to obtain STS",
                            debug: sts.debug,
                        } as FetchResponse);
                        return;
                    }

                    const signed = await signAwsRequest({
                        method: m.method || "GET",
                        url: m.url,
                        region: m.region,
                        credentials: sts.credentials,
                        headers: m.headers || {},
                        body: m.body ?? "",
                    });

                    // Prefer to run the signed request inside the app tab (page context) to satisfy CORS.
                    // Falls back to worker-side fetch if the proxy path fails.
                    try {
                        const proxied: any = await chrome.runtime.sendMessage({
                            type: "har-proxy-tab-fetch",
                            originUrl: m.originUrl,
                            request: {
                                url: m.url,
                                method: m.method || "GET",
                                headers: signed,
                                body: m.body ?? null,
                                includeCredentials: false,
                                timeoutMs: m.timeoutMs ?? 30000,
                            },
                        });
                        if (!proxied) throw new Error("No response from har-proxy-tab-fetch");
                        sendResponse({
                            ok: proxied.ok,
                            status: proxied.status,
                            statusText: proxied.statusText,
                            url: proxied.url,
                            headers: proxied.headers || {},
                            text: proxied.text,
                        } as FetchResponse);
                    } catch (_proxyErr) {
                        // Fallback (single attempt) — worker-side fetch.
                        const res = await fetch(m.url, {
                            method: (m.method || "GET") as any,
                            headers: signed as HeadersInit,
                            body: m.body ?? null,
                            credentials: "omit",
                            mode: "cors",
                        });
                        const text = await res.text();
                        const headers: Record<string, string> = {};
                        res.headers.forEach((v, k) => (headers[k] = v));
                        sendResponse({
                            ok: res.ok,
                            status: res.status,
                            statusText: res.statusText,
                            url: res.url,
                            headers,
                            text,
                        } as FetchResponse);
                    }
                } catch (e: any) {
                    sendResponse({
                        ok: false,
                        status: 0,
                        statusText: "FETCH_ERR",
                        url: m.url,
                        headers: {},
                        error: String(e?.message || e),
                    } as FetchResponse);
                }
            })();
            return true;
        }
    });
}
