// src/background/ephor-client/rateLimiter.ts
// Simple sliding-window rate limiter shared across all clients/contexts.

import { Logger } from "./logger";

export type RateLimitCfg = {
    maxCalls: number;   // e.g. 12
    windowMs: number;   // e.g. 4000 (4s)
};

const DEFAULT_CFG: RateLimitCfg = { maxCalls: 12, windowMs: 4000 };

// One bucket per origin (host+proto) so we don't block unrelated hosts.
class SlidingWindowRL {
    private hits: number[] = [];
    private cfg: { maxCalls: number; windowMs: number };
    private tag?: string; // 👈 NEW

    constructor(cfg: { maxCalls: number; windowMs: number }, tag?: string) {
        this.cfg = cfg;
        this.tag = tag;
    }

    public updateConfig(cfg: RateLimitCfg) {
        this.cfg = { ...cfg };
        const now = Date.now();
        this.hits = this.hits.filter(t => now - t < this.cfg.windowMs);
    }

    async acquire(signal?: AbortSignal): Promise<void> {
        while (true) {
            if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

            const now = Date.now();
            this.hits = this.hits.filter(t => now - t < this.cfg.windowMs);

            if (this.hits.length < this.cfg.maxCalls) {
                this.hits.push(now);
                return;
            }

            const oldest   = this.hits[0];
            const sleepFor = Math.max(5, this.cfg.windowMs - (now - oldest));

            // 👇 Visible throttle log without changing call sites
            const tag = this.tag ? ` (${this.tag})` : "";
            Logger.log("WARN", `THROTTLE${tag} – waiting ${sleepFor} ms (${this.hits.length}/${this.cfg.maxCalls})`);

            await new Promise(r => setTimeout(r, sleepFor));
        }
    }
}

const buckets = new Map<string, SlidingWindowRL>();
let globalCfg: RateLimitCfg = { ...DEFAULT_CFG };

export function setRateLimitConfig(cfg?: Partial<RateLimitCfg>) {
    if (!cfg) return;
    globalCfg = { ...globalCfg, ...cfg };
    // propagate to existing buckets
    for (const rl of buckets.values()) rl.updateConfig(globalCfg);
}

function bucketFor(url: string): SlidingWindowRL {
    let origin = "global";
    try { origin = new URL(url).origin; } catch {}
    let b = buckets.get(origin);
    if (!b) {
        // Use the current global configuration when creating a new bucket
        // so callers can tune limits centrally via setRateLimitConfig().
        b = new SlidingWindowRL({ maxCalls: globalCfg.maxCalls, windowMs: globalCfg.windowMs }, origin);
        buckets.set(origin, b);
    }
    return b;
}

// Whatever helper you already export — no signature changes.
export async function throttleForUrl(url: string, signal?: AbortSignal) {
    return bucketFor(url).acquire(signal);
}
