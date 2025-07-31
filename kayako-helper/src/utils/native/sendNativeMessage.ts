// src/utils/native/sendNativeMessage.ts
export type Msg  = Record<string, unknown>;
export type Resp = Record<string, unknown>;

// src/utils/native/sendNativeMsg.ts
export function sendNativeMsg<T extends Msg = Msg, R extends Resp = Resp>(msg: T): Promise<R> {
    // Detect “real” extension pages (background, popup, options).
    // Content-scripts have no chrome.tabs.* API.
    const isExtensionPage = typeof chrome.tabs !== "undefined";

    if (isExtensionPage) {
        /* service-worker / popup ▸ call host directly */
        return new Promise<R>((resolve, reject) => {
            chrome.runtime.sendNativeMessage("com.kayako_helper", msg, (resp) => {
                if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                else                          resolve(resp as R);
            });
        });
    }

    /* content-script ▸ hop through background bridge */
    return new Promise<R>((resolve, reject) => {
        chrome.runtime.sendMessage(
            { _native: true, payload: msg },
            (reply: { ok: boolean; resp?: R; error?: string }) => {
                if (chrome.runtime.lastError)      return reject(chrome.runtime.lastError);
                if (!reply?.ok)                    return reject(new Error(reply?.error));
                resolve(reply.resp as R);
            }
        );
    });
}

console.debug("[KH] native transport:",
    { isExtPage: typeof chrome.tabs !== "undefined" });