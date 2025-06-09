// src/selectors.ts
export const SEL = {
    /* UI */
    tabStrip:            '[class^="ko-tab-strip__tabs_"]', // where the export button goes

    /* Timeline - contains all posts */
    timeline:            '[class^="ko-agent-content_layout__timeline__"]',
    messageOrNote:       '.message-or-note',

    /* Inside a “post” */
    creatorLabel:        '[class*="creator"]', // catches Ko’s hashed class
    contentBody:         '[class*="list_item__content"]',

    /* ATLAS quirks */
    atlasName:           'ATLAS',
    greetingRegex: /Hi,[\s\xa0]*([^!]+?)\s*!/, // Hi, <anything that isn't an exclamation mark> !

    /* New for the lightbox feature - Used to make images clickable */
    lightboxModal:   '[class*="ko-lightbox__modal"]',
    lightboxImage:   '[class*="ko-lightbox__lightbox-image"]',
    hiddenImg:       'img[class*="ko-lightbox__hidden-image"]',

    /* Reply‑box resize feature */
    replyArea:     '[class*="ko-agent-content_layout__reply-area_"]',
    editorChrome:  '[class*="ko-agent-content_layout__reply-area_"]',
    editorWrapper: '.fr-wrapper',
    replyInner:    '.fr-element',
};
