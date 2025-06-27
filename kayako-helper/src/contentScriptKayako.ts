/* src/contentScriptKayako.ts
   – Bootstraps individual features; contains no feature code itself
*/
import '@/styles/global.scss';
import '@/modules/kayako/styleManager.ts'

import { setUpUI }                  from '@/utils/setUpUI';

import { bootCopyChatButton }       from '@/modules/kayako/buttons/copy-chat/copyChatButton.ts';
import { bootAtlasHighlighter }     from '@/modules/kayako/atlasHighlighter.js';
import { bootLightboxEnhancer }     from '@/modules/kayako/lightboxEnhancer.js';
import { bootReplyResizer }         from '@/modules/kayako/replyResizer.js';
import { bootDownloadManager }      from '@/modules/kayako/download-manager/downloadManager';
import { bootReplyTracker }         from '@/modules/kayako/replyTracker.ts';
import { bootTrainingMode }         from '@/modules/kayako/trainingMode.ts';
import { bootNewlineSpacer }        from '@/modules/kayako/newlineSpacer.ts';
import { bootSearchEnhancer }       from '@/modules/kayako/searchEnhancer.ts';
import { bootCopyTicketURL }        from "@/modules/kayako/copyTicketURL.ts";
import { bootSendToQcButton }       from "@/modules/kayako/buttons/sendToQCButton.ts";
import { bootExtraPostButtons }     from "@/modules/kayako/extraPostButtons.ts";
import { bootTagCleaner }           from "@/modules/kayako/ui-clean-up/tagCleaner";
import { bootExportChatButton }     from "@/modules/kayako/buttons/export-chat/exportChatButton.ts";

/* ---------- Global UI ---------- */
setUpUI();


/* ---------- Boot modules ---------- */

bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
bootTrainingMode();
bootReplyTracker();
bootNewlineSpacer();
bootSearchEnhancer();
bootCopyTicketURL();
bootTagCleaner();

bootExtraPostButtons();
bootDownloadManager();
bootCopyChatButton();
bootSendToQcButton();
bootExportChatButton().then(r => {});
