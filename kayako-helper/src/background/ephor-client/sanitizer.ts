// logger-sanitize.ts
export function headersToObject(h: HeadersInit | undefined) {
    if (!h) return {};
    if (h instanceof Headers) return Object.fromEntries(h.entries());
    if (Array.isArray(h)) return Object.fromEntries(h);
    return { ...(h as Record<string, string>) };
}

const SECRET_KEYS = new Set([
    "authorization",
    "proxy-authorization",
    "x-api-key",
    "api-key",
    "x-clerk-auth",
    "x-supa-token",
]);

function mask(val: string) {
    if (!val) return "";
    const s = String(val);
    if (s.length <= 10) return "•••";
    return s.slice(0, 4) + "…" + s.slice(-4); // show 4+4;
}

export function sanitizeForLog(input: any) {
    try {
        const cloned = JSON.parse(JSON.stringify(input ?? {}));
        if (cloned?.headers) {
            const obj = headersToObject(cloned.headers);
            for (const k of Object.keys(obj)) {
                if (SECRET_KEYS.has(k.toLowerCase())) obj[k] = mask(obj[k]);
            }
            cloned.headers = obj;
        }
        return cloned;
    } catch {
        return { note: "unloggable object" };
    }
}
