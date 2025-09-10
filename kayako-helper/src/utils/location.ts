// src/utils/location.ts
/**
 * Return the numeric conversation id from URLs like
 * “…/agent/conversations/123456”. If we’re not on a conversation
 * page it returns `null`.
 */
export function currentConvId(): string | null {
    try {
        const path = window.location.pathname;
        // Accept URLs like:
        // - /agent/conversations/123456
        // - /agent/conversations/123456/
        // - /agent/conversations/123456/anything
        const match = path.match(/\/agent\/conversations\/(\d+)(?:\/|$)/);
        const id = match ? match[1] : null;
        if (!id) {
            try { console.debug('[KH][location] currentConvId: not a conversation path', { path }); } catch {}
        } else {
            try { console.debug('[KH][location] currentConvId', { id, path }); } catch {}
        }
        return id;
    } catch (err) {
        try { console.warn('[KH][location] currentConvId failed', err); } catch {}
        return null;
    }
}

/** `true` only when the current URL is a real conversation tab. */
export function isConvPage(): boolean {
    return currentConvId() !== null;
}

export interface RouteChangeOptions {
    immediate?: boolean;
}

/**
 * Observe SPA route changes. Calls `cb()` every time
 * `location.pathname` changes (and once immediately if `immediate`).
 * Returns the created `MutationObserver` so callers can disconnect.
 */
export function onRouteChange(
    cb: () => void,
    options: RouteChangeOptions = {}
): MutationObserver {
    const { immediate = true } = options;
    let prevPath = window.location.pathname;

    const obs = new MutationObserver((mutations: MutationRecord[]) => {
        if (window.location.pathname !== prevPath) {
            prevPath = window.location.pathname;
            cb();
        }
    });

    obs.observe(document.body, { childList: true, subtree: true });

    if (immediate) {
        cb();
    }

    return obs;
}
