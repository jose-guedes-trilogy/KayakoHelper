/* contentScript.ts
   – Bootstraps individual features; contains no feature code itself
*/

import { bootCopyChatButton }  from './modules/exportChat/copyChatButton.ts';
import { bootAtlasHighlighter } from './modules/atlasHighlighter.js';
import { bootLightboxEnhancer } from './modules/lightboxEnhancer.js';
import { bootReplyResizer }    from './modules/replyResizer.js';

bootCopyChatButton();
bootAtlasHighlighter();
bootLightboxEnhancer();
bootReplyResizer();
