/* Logger helper – formats and streams messages */
import type { EphorStore } from "./ephorStore.ts";

export type LogFn = (msg: string, extra?: unknown) => void;

export function makeLogger(
    store: EphorStore,
    pre: HTMLPreElement,
    container: HTMLDivElement,
): LogFn {

    return (msg: string, extra?: any) => {
        const ts = new Date().toLocaleTimeString();
        let line = `[${ts}] ${msg}`;

        if (extra !== undefined) {
            line += "  " + (store.logFullResponses
                ? (typeof extra === "string"
                    ? extra
                    : JSON.stringify(extra, null, 2))
                : short(extra));
        }
        pre.textContent += line + "\n";
        container.scrollTop = container.scrollHeight;
    };

    function short(x: any): string {
        if (typeof x === "string") return x.length > 120 ? x.slice(0, 120) + "…" : x;
        if (Array.isArray(x))     return `[array ${x.length}]`;
        return "{…}";
    }
}
