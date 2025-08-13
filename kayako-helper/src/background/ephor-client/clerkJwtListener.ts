// src/background/ephor-client/clerkJwtListener.ts
import { EphorClient } from "./EphorClient";

chrome.runtime.onMessage.addListener(msg => {
    if (msg?.action === "clerk-jwt" && typeof msg.jwt === "string") {
        EphorClient.updateAuthToken(msg.jwt);
    }
});
