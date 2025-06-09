/* contentScript.js
   – Bootstraps individual features; contains no feature code itself
*/

import { bootCopyChatButton }  from './modules/copyChatButton';
import { bootAtlasHighlighter } from './modules/atlasHighlighter';
import { bootLightboxEnhancer } from './modules/lightboxEnhancer';
import { bootReplyResizer }    from './modules/replyResizer';

bootCopyChatButton();   // Only copies when URL is a conversation
bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
