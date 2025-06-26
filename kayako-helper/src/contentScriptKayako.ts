/* src/contentScriptKayako.ts
   – Bootstraps individual features; contains no feature code itself
*/
import '@/styles/global.scss';
import '@/modules/styleManager'

import { setUpUI }                  from '@/utils/setUpUI';

import { bootCopyChatButton }       from '@/modules/copy-chat/copyChatButton.ts';
import { bootAtlasHighlighter }     from '@/modules/atlasHighlighter.js';
import { bootLightboxEnhancer }     from '@/modules/lightboxEnhancer.js';
import { bootReplyResizer }         from '@/modules/replyResizer.js';
import { bootDownloadManager }      from '@/modules/download-manager/downloadManager';
import { bootReplyTracker }         from '@/modules/replyTracker';
import { bootTrainingMode }         from '@/modules/trainingMode';
import { bootNewlineSpacer }        from '@/modules/newlineSpacer';
import { bootSearchEnhancer }       from '@/modules/searchEnhancer';
import { bootCopyTicketURL }        from "@/modules/copyTicketURL";
import { bootSendToQcButton }       from "@/modules/buttons/sendToQC";
import { bootExtraPostButtons }     from "@/modules/extraPostButtons";
import { bootTagCleaner }           from "@/modules/ui-clean-up/tagCleaner";
import {bootExportChatButton} from "@/modules/export-chat/exportChatButton";

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
