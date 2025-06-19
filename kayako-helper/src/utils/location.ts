// src/utils/location.ts
/**
 * Return the numeric conversation id from URLs like
 * “…/agent/conversations/123456”. If we’re not on a conversation
 * page it returns `null`.
 */
export function currentConvId(): string | null {
    const match = window.location.pathname.match(/\/agent\/conversations\/(\d+)$/);
    return match ? match[1] : null;
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
