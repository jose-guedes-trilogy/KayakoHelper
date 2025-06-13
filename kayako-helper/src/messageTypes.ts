/* messageTypes.ts
    - Types for messages sent between content-script and background-script */

export type ToBackground =
    | { action: 'createFolder'; ticketId: string; location: 'V' | 'DOWNLOADS' }
    | { action: 'saveMetadata'; ticketId: string; name: string; email: string; subject: string }
    | { action: 'incrementReply'; ticketId: string }
    | { action: 'setTrainingMode'; enabled: boolean }
    | { action: 'getStats'; ticketId: string }
    | { action: 'getTrainingMode' }
    | { action: 'setStyleEnabled'; styleId: 'compactStyles'; enabled: boolean }
    | { action: 'setAllStylesEnabled'; enabled: boolean };


export type FromBackground =
    | { action: 'createFolderResult'; success: boolean; alreadyExisted?: boolean; path?: string; error?: string }
    | { action: 'stats'; ticketId: string; count: number; name: string; email: string; subject: string }
    | { action: 'trainingMode'; enabled: boolean }
    ;