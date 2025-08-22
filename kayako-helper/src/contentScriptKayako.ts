/* src/contentScriptKayako.ts
   – Bootstraps individual features; contains no feature code itself
*/
import '@/styles/extensionStyles.scss';
import '@/modules/kayako/styleManager.ts'

import { setUpUI }                  from '@/utils/setUpUI';

import { bootLocationWatcher }      from '@/modules/kayako/locationWatcher.ts';
import { bootCopyChatButton }       from '@/modules/kayako/buttons/copy-chat/copyChatButton.ts';
import { bootAtlasHighlighter }     from '@/modules/kayako/atlasHighlighter.js';
import { bootLightboxEnhancer }     from '@/modules/kayako/lightboxEnhancer.js';
import { bootReplyResizer }         from '@/modules/kayako/reply-box/replyResizer.js';
import { bootDownloadManager }      from '@/modules/kayako/download-manager/downloadManager';
import { bootReplyTracker }         from '@/modules/kayako/replyTracker.ts';
import { bootTrainingMode }         from '@/modules/kayako/trainingMode.ts';
import { bootNewlineSpacer }        from '@/modules/kayako/newlineSpacer.ts';
import { bootSearchEnhancer }       from '@/modules/kayako/searchEnhancer.ts';
import { bootCopyTicketURL }        from "@/modules/kayako/conversation-window-header/copyTicketURL.ts";
import { bootSendToQcButton }       from "@/modules/kayako/buttons/sendToQCButton.ts";
import { bootExtraPostButtons }     from "@/modules/kayako/extraPostButtons.ts";
import { bootTagCleaner }           from "@/modules/kayako/ui-enhancement/tagCleaner";
import { bootExportChatButton }     from "@/modules/kayako/buttons/export-chat/exportChatButton.ts";
import { bootCopySearchChats }      from "@/modules/kayako/buttons/copy-search/copySearchChats.ts";
import { bootSendChunks }           from "@/modules/kayako/reply-box/sendInChunks.ts";
import { bootAssetsInspector }      from "@/modules/kayako/buttons/assets-inspector/assetsInspectorIndex.ts";
import { bootEmbeddingsSearch }     from "@/modules/kayako/embeddingsSearch.ts";
import { bootTargetBlankLinks }     from "@/modules/kayako/ui-enhancement/targetBlankLinks.ts";
import {bootHoverTicketPreview} from "@/modules/kayako/hoverTicketPreview.ts";
import {bootEphorButton} from "@/modules/kayako/buttons/ephor/buttonEphor.ts";
import "@/modules/ephor/clerkTokenInjector.ts";
import { bootSideConversations } from '@/modules/kayako/sideConversations.ts';
import { bootQcerFeatures } from '@/modules/kayako/qcerFeatures.ts';

import {bootCredProbeClient, bootRequestReplicator} from "@/modules/alpha/dash/RequestReplicator.ts";
import {bootUiAesthetics} from "@/modules/kayako/ui-enhancement/uiAesthetics.ts";

/* ---------- Global UI ---------- */
setUpUI();


/* ---------- Boot modules ---------- */

bootLocationWatcher();

bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
bootTrainingMode();
bootReplyTracker();
bootNewlineSpacer();
bootSearchEnhancer();
bootCopyTicketURL();
bootTagCleaner();
bootTargetBlankLinks();

bootExtraPostButtons();
bootQcerFeatures();
bootDownloadManager();
bootCopyChatButton();
bootSendToQcButton();
bootExportChatButton().then(r => {});
bootEphorButton().then(r => {});

bootCopySearchChats();

//bootSendChunks();
bootAssetsInspector();

//bootEmbeddingsSearch();
bootHoverTicketPreview();

bootSideConversations();


bootUiAesthetics();

//bootRequestReplicator();
//bootCredProbeClient().then(r => {});
