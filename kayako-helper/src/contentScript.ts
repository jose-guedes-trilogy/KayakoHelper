/* contentScript.ts
   – Bootstraps individual features; contains no feature code itself
*/

import { bootCopyChatButton }  from '@/modules/copy-chat/copyChatButton.ts';
import { bootAtlasHighlighter } from '@/modules/atlasHighlighter.js';
import { bootLightboxEnhancer } from '@/modules/lightboxEnhancer.js';
import { bootReplyResizer }    from '@/modules/replyResizer.js';
import { bootDownloadManager } from "@/modules/downloadManager";
import {bootReplyTracker} from "@/modules/replyTracker";
import {bootTrainingMode} from "@/modules/trainingMode";
import bootNewlineSpacer from "@/modules/newlineSpacer";
import {bootSearchEnhancer} from "@/modules/searchEnhancer";
import {injectStyles} from "@/utils/dom";
import {EXTENSION_SELECTORS, KAYAKO_SELECTORS} from "@/selectors";
import {setUpUI} from "@/setUpUI";

/* Set up UI */
setUpUI();

/* CSS */
injectStyles(`
    ${KAYAKO_SELECTORS.tabStrip} 
    { 
        height: unset; 
    }
    
    ${EXTENSION_SELECTORS.tabStripButtonClass} {
        padding: 0 12px;
        font-size: 14px;
        cursor: pointer;
        height: 100%;
        border-radius: 8px;
        border: none;
    }
    `,

    'ko-tab-strip__tabs-css');

// NOTE BACKGROUND COLOR: background: hsl(203 82% 98% / 1)
// NOTE BORDER COLOR: border-color: hsl(203deg 35.45% 76.31%)

/* Boot modules */
bootCopyChatButton();
bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
bootDownloadManager();
bootTrainingMode();
bootReplyTracker();
bootNewlineSpacer()
//bootSearchEnhancer();

