/* public/tagCleanerInjector.js  – v3.6  (no-cache, document_start)
 *
 * Injected at document_start from the isolated content-script world.
 * Hooks BOTH fetch() and XMLHttpRequest so we always capture Kayako’s
 * /cases/<id>/posts?include=… payload and relay it to the content-script.
 * — DOES NOT stash JSON on window any more (fresh data every time).         */

(() => {
    const TARGET = /\/api\/v1\/cases\/\d+\/posts\b/;

    /* relay message to the content-script world */
    const relay = (kind, json) =>
        window.postMessage({ source: "KTC", kind, json }, "*");

    /* ---------- 1 ▪ fetch() ------------------------------------------------ */
    const fetch0 = window.fetch;
    window.fetch = async function (...args) {
        const url = typeof args[0] === "string" ? args[0] : (args[0]?.url ?? "");
        const hit = TARGET.test(url);

        if (hit) relay("POSTS_FETCH_STARTED");

        const res = await fetch0.apply(this, args);

        if (hit) {
            res.clone().json().then(async json => {
                relay("POSTS_JSON", json);  /* ⬅️  main page */

                /* auto-follow one extra page (limit 100) if needed */
                try {
                    const total = json.total_count ?? 0;
                    const limit = json.limit        ?? 0;
                    if (total > limit && typeof json.next_url === "string") {
                        const next = json.next_url.replace(/([?&])limit=\d+/, "$1limit=100");
                        const res2 = await fetch0.call(this, next, { credentials: "include" });
                        if (res2.ok) relay("POSTS_JSON", await res2.json());
                    }
                } catch { /* ignore */ }
            }).catch(() => {/* ignore */});
        }
        return res;
    };

    /* ---------- 2 ▪ XMLHttpRequest ---------------------------------------- */
    const XHR0 = window.XMLHttpRequest;
    function XHRproxy() {
        const xhr = new XHR0();
        let _url = "";

        const open0 = xhr.open;
        xhr.open = function (method, url, ...rest) {
            if (typeof url === "string" && TARGET.test(url)) {
                _url = url;
                relay("POSTS_FETCH_STARTED");
            }
            return open0.call(this, method, url, ...rest);
        };

        xhr.addEventListener("readystatechange", function () {
            if (xhr.readyState === 4 && _url && TARGET.test(_url)) {
                try {
                    const json = JSON.parse(xhr.responseText);
                    relay("POSTS_JSON", json);                /* ⬅️  main page */

                    /* same one-step look-ahead as fetch() */
                    try {
                        const total = json.total_count ?? 0;
                        const limit = json.limit        ?? 0;
                        if (total > limit && typeof json.next_url === "string") {
                            const next = json.next_url.replace(/([?&])limit=\d+/, "$1limit=100");
                            fetch(next, { credentials: "include" })
                                .then(r => r.ok ? r.json() : null)
                                .then(j => { if (j) relay("POSTS_JSON", j); });
                        }
                    } catch { /* ignore */ }
                } catch { /* ignore */ }
            }
        });

        return xhr;
    }

    /* copy static constants (DONE, OPENED, …) */
    Object.setPrototypeOf(XHRproxy, XHR0);
    ["UNSENT","OPENED","HEADERS_RECEIVED","LOADING","DONE"].forEach(
        k => { XHRproxy[k] = XHR0[k]; }
    );

    window.XMLHttpRequest = XHRproxy;
})();
