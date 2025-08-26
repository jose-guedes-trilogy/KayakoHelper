/* Kayako Helper – utils/sendMessageSafe.ts */

/**
 * Safe wrapper for chrome.runtime.sendMessage that avoids unhandled
 * "Extension context invalidated" errors when the extension is reloaded
 * or unavailable. Adds debug logs for visibility.
 */
export function sendMessageSafe<TMessage = unknown>(message: TMessage, context?: string): void {
    try {
        // If the extension context is gone, silently skip
        if (!(globalThis as any)?.chrome?.runtime?.id) {
            try { console.debug('[KH] sendMessageSafe: runtime.id missing, skipping', { context, message }); } catch {}
            return;
        }

        const maybePromise = (chrome.runtime as any).sendMessage(message);
        if (maybePromise && typeof maybePromise.then === 'function' && typeof maybePromise.catch === 'function') {
            // MV3 returns a Promise
            (maybePromise as Promise<unknown>).catch(err => {
                try { console.debug('[KH] sendMessageSafe promise rejection', { err, context, message }); } catch {}
            });
        }
    } catch (err) {
        // MV2 or sync throw when context invalidated
        try { console.debug('[KH] sendMessageSafe threw', { err, context, message }); } catch {}
    }
}


