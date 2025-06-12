// src/selectors.ts

// Type for CSS selector strings
type Selector = string;

// Type for RegExp patterns
type RegExpPattern = RegExp;

// Type for the SEL object
interface KayakoSelectors {
    // UI
    tabStrip: Selector;

    // Timeline
    timeline: Selector;
    messageOrNote: Selector;

    // Post content
    creatorLabel: Selector;
    contentBody: Selector;

    // ATLAS
    atlasName: string;
    greetingRegex: RegExpPattern;

    // Lightbox
    lightboxModal: Selector;
    lightboxImage: Selector;
    hiddenImg: Selector;

    // Editor
    editorChrome: Selector;
    editorWrapper: Selector;
    replyInner: Selector;
    headerSelector: Selector;
    editorSelector: Selector;

    // Buttons
    sendReplyButtonBaseSelector: Selector;
    sendReplyButtonAsNote: Selector;

    // Ticket Info
    requesterName: Selector;
    requesterEmail: Selector;
    ticketSubject: Selector;
}

export const KAYAKO_SELECTORS: KayakoSelectors = {
    /* UI */
    tabStrip:            '[class^="ko-tab-strip__tabs_"]', // where the export button goes

    /* Timeline - contains all posts */
    timeline:            '[class^="ko-agent-content_layout__timeline__"]',
    messageOrNote:       '.message-or-note',

    /* Inside a "post" */
    creatorLabel:        '[class*="creator"]', // catches Ko's hashed class
    contentBody:         '[class*="list_item__content"]',

    /* ATLAS quirks */
    atlasName:           'ATLAS',
    greetingRegex: /Hi,[\s\xa0]*([^!]+?)\s*!/, // Hi, <anything that isn't an exclamation mark> !

    /* New for the lightbox feature - Used to make images clickable */
    lightboxModal:   '[class*="ko-lightbox__modal"]',
    lightboxImage:   '[class*="ko-lightbox__lightbox-image"]',
    hiddenImg:       'img[class*="ko-lightbox__hidden-image"]',

    /* Reply‑box resize feature */
    editorChrome:  '[class*="ko-agent-content_layout__reply-area_"]',
    editorWrapper: '.fr-wrapper',
    replyInner:    '.fr-element',
    headerSelector: '[class*="ko-text-editor__header_"]',
    editorSelector: '.fr-element.fr-view',

    /* Send reply button */
    sendReplyButtonBaseSelector: '[class*="ko-button__primary-with-options_"]',
    sendReplyButtonAsNote: '[class*="ko-button__note_"]',

    /* Ticket Information */
    requesterName: '[class*="ko-editable-text__emphasizedText"]',
    requesterEmail: '[class*="ko-identities_identity_trigger__name_"]',
    ticketSubject: '[class*="ko-tabs_case__subject_"]'
};

interface ExtensionSelectors {
    tabStripCustomButtonArea: Selector,

    tabStripButtonClass: Selector,

    createFolderButton: Selector,
    copyChatButton: Selector
}
export const EXTENSION_SELECTORS: ExtensionSelectors = {
    tabStripCustomButtonArea: '#tab-strip-custom-btn-area',

    tabStripButtonClass: '.tab-strip-btn',

    createFolderButton: '#ktx-create-folder-btn',
    copyChatButton: '#ktx-copy-chat-btn'
};