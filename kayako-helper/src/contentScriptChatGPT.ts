/* src/contentScriptChatGPT.ts */

import {initMakeTabActiveButton} from '@/modules/activeTabButton';

/* ===========================================================================
 * contentScriptChatGPT.ts – v1.0
 * Shows “Make Active” when visiting chat.openai.com so the tab can be set as
 * the target for “active-tab” exports without running an export first.
 * ---------------------------------------------------------------------------
 */

(async () => {
    await initMakeTabActiveButton(() => location.hostname.endsWith('chat.openai.com'));
})();