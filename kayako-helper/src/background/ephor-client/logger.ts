import { CLR } from "./constants";

export type LogLevel = keyof typeof CLR;

/** Central logger. Swap the sink with `setLogger()` in dev-tools. */
export class Logger {
    private static verbose = false;
    private static sink: ((m: string, extra?: unknown) => void) | null = null;

    static setLogger(fn: typeof Logger.sink) { Logger.sink = fn; }
    static enableVerbose(v = true) {
        Logger.verbose = v;
        Logger.log("INFO", `Logger verbosity → ${v ? "FULL" : "BASIC"}`);
    }


    static log(level: LogLevel, m: string, extra?: unknown) {
        console.log(`%c[EPHOR] ${m}`, CLR[level], extra ?? "");
        Logger.sink?.(m, extra);
    }
}


