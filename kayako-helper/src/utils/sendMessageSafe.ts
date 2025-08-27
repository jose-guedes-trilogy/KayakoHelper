/* Kayako Helper – utils/sendMessageSafe.ts */

/**
 * Safe wrapper for chrome.runtime.sendMessage that avoids unhandled
 * "Extension context invalidated" errors when the extension is reloaded
 * or unavailable. Adds debug logs for visibility.
 */
export function sendMessageSafe<TMessage = unknown>(message: TMessage, context?: string): void {
    const log = (label: string, data?: unknown) => { try { console.debug(`[KH] sendMessageSafe ${label}`, { context, ...((data as object) || {}), message }); } catch {} };
    try {
        // Skip when Chrome APIs are unavailable or extension was reloaded
        const runtime = (globalThis as any)?.chrome?.runtime;
        if (!runtime?.id) { log('skip: runtime.id missing'); return; }

        // Some MV3 environments still support callback style with lastError; prefer that to catch specific errors
        let attempts = 0;
        const maxAttempts = 3;
        const send = () => {
            attempts += 1;
            try {
                if (runtime.sendMessage.length >= 2) {
                    // callback form: sendMessage(message, responseCallback)
                    runtime.sendMessage(message, () => {
                        const lastError = (chrome.runtime as any).lastError;
                        if (lastError) {
                            const msg = String(lastError.message || '');
                            // Detect transient cases where the service worker just restarted
                            const transient = /Extension context invalidated|The message port closed|Receiving end does not exist|Service worker is shutting down/i.test(msg);
                            log('lastError', { attempts, msg });
                            if (transient && attempts < maxAttempts) {
                                const delay = Math.min(500 * Math.pow(2, attempts - 1), 2000);
                                setTimeout(send, delay);
                            }
                        }
                    });
                } else {
                    // promise form
                    const p = runtime.sendMessage(message);
                    if (p && typeof p.then === 'function') {
                        (p as Promise<unknown>).catch((err: unknown) => {
                            const msg = String((err as any)?.message || err || '');
                            const transient = /Extension context invalidated|The message port closed|Receiving end does not exist|Service worker is shutting down/i.test(msg);
                            log('promise rejection', { attempts, msg });
                            if (transient && attempts < maxAttempts) {
                                const delay = Math.min(500 * Math.pow(2, attempts - 1), 2000);
                                setTimeout(send, delay);
                            }
                        });
                    }
                }
            } catch (err) {
                const msg = String((err as any)?.message || err || '');
                const transient = /Extension context invalidated|The message port closed|Receiving end does not exist|Service worker is shutting down/i.test(msg);
                log('threw', { attempts, msg });
                if (transient && attempts < maxAttempts) {
                    const delay = Math.min(500 * Math.pow(2, attempts - 1), 2000);
                    setTimeout(send, delay);
                }
            }
        };
        send();
    } catch (err) {
        log('outer threw', { err });
    }
}

/* ────────────────────────────────────────────────────────────────── */
/* requestMessageSafe: Promise-based safe request with retries/timeouts */
/* ────────────────────────────────────────────────────────────────── */
export interface RequestOptions {
    timeoutMs?: number;
    maxAttempts?: number;
    delayBaseMs?: number;
}

export async function requestMessageSafe<TReq = unknown, TResp = unknown>(
    message: TReq,
    context?: string,
    opts?: RequestOptions,
): Promise<TResp | null> {
    const runtime = (globalThis as any)?.chrome?.runtime;
    const timeoutMs   = opts?.timeoutMs ?? 5000;
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? 3);
    const delayBaseMs = opts?.delayBaseMs ?? 400;
    const log = (label: string, data?: unknown) => { try { console.debug(`[KH] requestMessageSafe ${label}`, { context, ...((data as object) || {}), message }); } catch {} };

    if (!runtime?.id) { log('skip: runtime.id missing'); return null; }

    const isTransient = (msg: string) => /Extension context invalidated|The message port closed|Receiving end does not exist|Service worker is shutting down/i.test(msg);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const response = await new Promise<TResp>((resolve, reject) => {
                let done = false;
                const timer = setTimeout(() => {
                    if (done) return;
                    done = true;
                    reject(new Error('timeout'));
                }, timeoutMs);

                const onComplete = (res?: TResp) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    const lastError = (chrome.runtime as any).lastError;
                    if (lastError) {
                        reject(new Error(String(lastError.message || lastError)));
                    } else {
                        resolve(res as TResp);
                    }
                };

                try {
                    if (runtime.sendMessage.length >= 2) {
                        runtime.sendMessage(message, onComplete);
                    } else {
                        const p = runtime.sendMessage(message);
                        if (p && typeof p.then === 'function') {
                            (p as Promise<TResp>).then((res) => onComplete(res)).catch((err) => reject(err));
                        } else {
                            // Unexpected path: treat as success
                            onComplete(undefined as unknown as TResp);
                        }
                    }
                } catch (err) {
                    reject(err);
                }
            });
            return response;
        } catch (err) {
            const msg = String((err as any)?.message || err || '');
            log('attempt failed', { attempt, msg });
            if (attempt < maxAttempts && (isTransient(msg) || msg === 'timeout')) {
                const delay = Math.min(delayBaseMs * Math.pow(2, attempt - 1), 2000);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            return null;
        }
    }
    return null;
}


