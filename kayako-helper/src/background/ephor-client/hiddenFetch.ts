/* Kayako Helper – hiddenFetch.ts (rev-v1.1.0 – adds referrer)        */
import { throttleForUrl } from "./rateLimiter.ts";

import { EphorClient } from "./EphorClient.ts";

/* ------------------------------------------------------------------ */
const REF = "https://app.ephor.ai/";

/* ------------------------------------------------------------------ */
export async function hiddenFetch<T = unknown>(
    tabId: number | undefined,
    url  : string,
    init : RequestInit = {},
): Promise<T | string> {
    await throttleForUrl(url, (init as any)?.signal);

    /* ---------- ALWAYS log outgoing --------------------------------- */
    const cleanInit = {
        method     : init.method  ?? "GET",
        headers    : init.headers ?? {},
        credentials: init.credentials ?? "include",
        body       : typeof init.body === "string" || typeof init.body === "undefined"
            ? init.body
            : "[non-string body]",
    };
    EphorClient["log"]?.("HIDDEN FETCH REQUEST", { tabId, url, init: cleanInit });

    const tryJson = <U>(text: string): U | string => {
        try { return JSON.parse(text) as U; } catch { return text; }
    };

    /* ---------- PATH A – execute in hidden tab ---------------------- */
    if (tabId !== undefined && chrome?.scripting?.executeScript) {
        const [{ result }] = await chrome.scripting.executeScript<{
            ok: boolean; status: number; body: string;
        }>({
            target: { tabId },
            func  : async (u: string, i: RequestInit, ref: string) => {
                const r = await fetch(u, { ...i, credentials:"include", referrer: ref });
                return { ok: r.ok, status: r.status, body: await r.text() };
            },
            args: [url, init, REF],
        });

        EphorClient["log"]?.(
            result.ok ? "HIDDEN FETCH RESPONSE" : "HIDDEN FETCH ERROR",
            { url, status: result.status, ok: result.ok, body: result.body },
        );

        if (!result.ok)
            throw new Error(JSON.stringify({ status: result.status, url, body: result.body }));
        return result.body ? tryJson<T>(result.body) : ({} as T);
    }

    /* ---------- PATH B – plain fetch -------------------------------- */
    const r    = await fetch(url, { ...init, credentials:"include", referrer: REF });
    const text = await r.text();

    EphorClient["log"]?.(
        r.ok ? "FETCH RESPONSE" : "FETCH ERROR",
        { url, status: r.status, ok: r.ok, body: text },
    );

    if (!r.ok)
        throw new Error(JSON.stringify({ status: r.status, url, body: text }));
    return text ? tryJson<T>(text) : ({} as T);
}
