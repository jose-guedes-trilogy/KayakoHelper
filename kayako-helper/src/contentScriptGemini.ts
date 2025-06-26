/* src/contentScriptGemini.ts */

import {bootGeminiUploader} from '@/modules/download-manager/geminiUploader';
import {initMakeTabActiveButton} from '@/modules/activeTabButton';

/* ===========================================================================
 * contentScriptGemini.ts – v1.0
 * Shows “Make Active” when visiting gemini.google.com/app.
 * ---------------------------------------------------------------------------
 */

bootGeminiUploader();

(() => {
    initMakeTabActiveButton(() => location.hostname.endsWith('gemini.google.com'));
})();
