/* Kayako Helper – backgroundListeners.ts (rev-v1.1.0)
   ----------------------------------------------------
   • Adds BG_GET_STREAM_JWT action so content-scripts can
     request a fresh Clerk JWT without needing chrome.scripting.
*/

import { EphorClient }   from "./EphorClient.ts";
import { hiddenFetch  }  from "./hiddenFetch.ts";
import { HiddenEphorTab } from "./HiddenEphorTab.ts";

/* ------------------------------------------------------------------ */
if (self && EphorClient.isBackgroundContext()) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        try { console.log('[ephor.bg] message', msg?.action || msg); } catch {}

        /* regular proxy */
        if (msg?.action === EphorClient["BG_ACTION"]) {
            (async () => {
                try { sendResponse({ ok: true, data: await EphorClient["doFetch"](msg.url, msg.init) }); }
                catch (err: any) {
                    let parsed: any; try { parsed = JSON.parse(err.message); } catch { parsed = { message: err.message }; }
                    sendResponse({ ok: false, error: parsed });
                }
            })();
            return true;
        }

        /* hidden-tab fetch */
        if (msg?.action === EphorClient["BG_HIDDEN_ACTION"]) {
            (async () => {
                try {
                    const data = await hiddenFetch(msg.tabId, msg.url, msg.init);
                    sendResponse({ ok: true, data });
                } catch (err: any) {
                    console.error('[ephor.bg] hidden fetch error', err);
                    sendResponse({ ok: false, error: err?.message ?? String(err) });
                }
            })();
            return true;
        }

        /* NEW ▶ hand out a fresh Clerk JWT for Stream mode */
        if (msg?.action === "ephor.getStreamJwt") {
            (async () => {
                try {
                    const { token, expiresAt } = await new HiddenEphorTab().getSessionJwt();
                    sendResponse({ ok: true, token, expiresAt });
                } catch (err: any) {
                    sendResponse({ ok: false, error: err?.message ?? String(err) });
                }
            })();
            return true;
        }

        /* List projects via cookie/JWT through hidden tab */
        if (msg?.action === "ephor.listProjects") {
            (async () => {
                try {
                    const cli = new EphorClient({});
                    await cli.ready();
                    const data = await cli.listProjectsCookie();
                    sendResponse({ ok: true, data });
                } catch (err: any) {
                    console.error('[ephor.bg] listProjects error', err);
                    sendResponse({ ok: false, error: err?.message ?? String(err) });
                }
            })();
            return true;
        }

        /* Quiet join via invite and confirm */
        if (msg?.action === "ephor.joinByInvite" && msg?.inviteId && msg?.projectId) {
            (async () => {
                try {
                    const cli = new EphorClient({});
                    await cli.ready();
                    const ok = await cli.quietJoinByInvite(String(msg.inviteId), String(msg.projectId));
                    sendResponse({ ok, joined: ok });
                } catch (err: any) {
                    console.error('[ephor.bg] joinByInvite error', err);
                    sendResponse({ ok: false, error: err?.message ?? String(err) });
                }
            })();
            return true;
        }

        return false;
    });
}
