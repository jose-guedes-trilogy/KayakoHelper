/* contentScript.js
   – Bootstraps individual features; contains no feature code itself
*/

import { bootCopyChatButton }  from './modules/copyChatButton.js';
import { bootAtlasHighlighter } from './modules/atlasHighlighter.js';
import { bootLightboxEnhancer } from './modules/lightboxEnhancer.js';
import { bootReplyResizer }    from './modules/replyResizer.js';

bootCopyChatButton();   // Only copies when URL is a conversation
bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
