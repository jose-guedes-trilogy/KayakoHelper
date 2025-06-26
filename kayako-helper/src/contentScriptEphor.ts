/* src/contentScriptEphor.ts */

import {initMakeTabActiveButton} from '@/modules/activeTabButton';

/* ===========================================================================
 * contentScriptEphor.ts – v1.0
 * Shows “Make Active” when visiting ephor.ai.
 * ---------------------------------------------------------------------------
 */

(() => {
    initMakeTabActiveButton(() => location.hostname.endsWith('ephor.ai'));
})();
