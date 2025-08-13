/* Kayako Helper – clerkTokenInjector.ts
   Injects the external bridge file above the page's CSP,
   listens for the JWT, then forwards it to background + storage.
*/

const FLAG = "__kh_clerk_injected__";
if (!(window as any)[FLAG]) {
    (window as any)[FLAG] = true;

    // 1. Inject the bridge <script src="chrome-extension://.../clerkTokenBridge.js">
    const src = chrome.runtime.getURL("dist/clerkTokenBridge.js");
    const s   = document.createElement("script");
    s.src     = src;
    s.async   = true;
    (document.documentElement || document.head || document.body).appendChild(s);
    // (optional) clean-up after load to keep DOM tidy
    s.addEventListener("load", () => s.remove());
}

// 2. Wait for the message from the page context
window.addEventListener("message", ev => {
    const { data } = ev;
    if (!data || data.source !== "kh-clerk" || !data.jwt) return;

    chrome.runtime.sendMessage({ action: "clerk-jwt", jwt: data.jwt });
});
