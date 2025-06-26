import { initMakeTabActiveButton } from '@/modules/activeTabButton';

/* contentScriptEphor.ts – v1.1
 * Shows “Make Active” when visiting ephor.ai.
 * ------------------------------------------------------------------------- */
(async () => {
    await initMakeTabActiveButton(() => location.hostname.endsWith('ephor.ai'));
})();
