// src/background/sendNativeMessageBg.ts  (MV3 service-worker)
import type { Msg } from "@/utils/native/sendNativeMessage";

chrome.runtime.onMessage.addListener(
    (req: { _native?: true; payload?: Msg }, _sender, sendResponse) => {
        if (!req._native) return;              // ignore other messages

        chrome.runtime.sendNativeMessage(
            "com.kayako_helper",
            req.payload!,
            (resp) => {
                if (chrome.runtime.lastError) {
                    sendResponse({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    sendResponse({ ok: true, resp });
                }
            }
        );

        return true;   // keep the message channel open for async reply
    }
);
