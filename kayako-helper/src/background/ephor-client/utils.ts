import {Logger} from "@/background/ephor-client/logger.ts";

/** `true` if a token looks like a JWT and not an API key. */
export const isJwt = (t = ""): boolean => !!t && !t.startsWith("eph-");

/** Decode the JWT exp claim → epoch-ms; fallback = +1 h. */
export const decodeJwtExp = (t: string): number => {
    try   { return JSON.parse(atob(t.split(".")[1])).exp * 1000; }
    catch { return Date.now() + 3_600_000; }
};

/**
 * Extract the next token / chunk from any shape Ephor currently emits.
 * Extend here whenever the backend introduces a new field.
 */
/**
 * Extract the next token / chunk from any shape Ephor currently emits.
 * Extend here whenever the backend introduces a new field.
 */
export function pickToken(ev: any): string | undefined {
    /* ① Legacy flat { delta:"H" } */
    if (typeof ev?.delta === "string") return ev.delta;

    /* ② New wrapped  { delta:{ content:"H" } } */
    if (typeof ev?.delta?.content === "string") return ev.delta.content;

    /* ③ OpenAI style { choices:[{ delta:{ content:"H" } }] } */
    if (typeof ev?.choices?.[0]?.delta?.content === "string")
        return ev.choices[0].delta.content;

    /* ④ Simple flat { content:"H" }                           */
    if (typeof ev?.content === "string") return ev.content;

    /* ⑤ Ephor August ’25 { output:"H" } or { text:"H" }       */
    if (typeof ev?.output === "string") return ev.output;
    if (typeof ev?.text   === "string") return ev.text;

    /* ⑥ Groq / Gemini mini { token:"H" }                      */
    if (typeof ev?.token === "string") return ev.token;

    /* ⑦ NEW: Web-socket chunk_out wrapper                     */
    if (typeof ev?.chunk === "string") return ev.chunk;

    /* 🚨 NOTHING matched – log once for forensics */
    Logger.log("WARN", "pickToken: Unrecognised event", ev);
    return undefined;
}


/** True if an event clearly indicates completion. */
export function isTerminalEvent(ev: any): boolean {
    try {
        if (ev?.is_final === true) return true;

        const finishReason = String(ev?.finish_reason ?? "").toLowerCase();
        if (finishReason && finishReason !== "null") return true;

        const typeId = String(ev?.type_id ?? "").toLowerCase();
        if (typeId === "end" || typeId === "final") return true;

        const phase = String(ev?.phase ?? ev?.status ?? ev?.state ?? ev?.event ?? "").toLowerCase();
        if (phase && /(done|complete|completed|final|finished)/.test(phase)) return true;
    } catch { /* noop */ }
    return false;
}

/** Extract time-to-complete in ms from any of the known fields. */
export function extractTimeToCompleteMs(ev: any): number | null {
    const cands = [
        ev?.slm_time_to_complete,
        ev?.metrics?.slm_time_to_complete,
        ev?.metrics?.time_to_complete_ms,
        ev?.time_to_complete_ms,
        ev?.duration_ms,
        ev?.elapsed_ms,
        ev?.usage?.time_ms,
    ];
    for (const v of cands) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}



