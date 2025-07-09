// utils/native/sendNativeMsg.ts
// --------------------------------------------------------------
// Thin wrapper around chrome.runtime.sendNativeMessage that gives
// you both a callback AND a Promise flavour.

type Msg = Record<string, unknown>;
type Resp = Record<string, unknown>;

export function sendNativeMsg<T extends Msg = Msg, R extends Resp = Resp>(
    msg: T,
    cb?: (resp: R) => void
): Promise<R> {
    return new Promise<R>((resolve, reject) => {
        chrome.runtime.sendNativeMessage(
            "com.kayako_helper",       // ← your manifest ID
            msg,
            (resp) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    cb?.(resp as R);
                    resolve(resp as R);
                }
            }
        );
    });
}
