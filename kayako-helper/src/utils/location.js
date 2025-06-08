/* utils/location.js
   – URL helpers shared across modules                                */

/**
 * Return the numeric conversation id from URLs like
 * “…/agent/conversations/123456”.  If we’re not on a conversation
 * page it returns `null`.
 */
export function currentConvId () {
    const m = location.pathname.match(/\/agent\/conversations\/(\d+)$/);
    return m ? m[1] : null;
}

/** `true` only when the current URL is a real conversation tab. */
export function isConvPage () {
    return currentConvId() !== null;
}

/**
 * Observe SPA route changes.  Calls `cb()` every time
 * `location.pathname` changes (and once immediately).  Returns the
 * created `MutationObserver` so callers can disconnect if they like.
 */
export function onRouteChange (cb, { immediate = true } = {}) {
    let prev = location.pathname;
    const obs = new MutationObserver(() => {
        if (location.pathname !== prev) {
            prev = location.pathname;
            cb();
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    if (immediate) cb();
    return obs;
}
