/* Kayako Helper – utils/messageTypes.ts */

export type ToBackground =
    | { action: 'createFolder';   ticketId: string; location: 'V' | 'DOWNLOADS' }
    | { action: 'visitTicket';    ticketId: string }                  // NEW
    | { action: 'saveMetadata';   ticketId: string; name: string; email: string; subject: string }
    | { action: 'saveNotes';      ticketId: string; notes: string }
    | { action: 'incrementReply'; ticketId: string }
    | { action: 'setTrainingMode';         enabled: boolean }
    | { action: 'getStats';       ticketId: string }
    | { action: 'getAllTickets' }
    | { action: 'deleteTicket';   ticketId: string }
    | { action: 'getTrainingMode' }
    | { action: 'setStyleEnabled';   styleId: 'compactStyles'; enabled: boolean }
    | { action: 'setAllStylesEnabled';       enabled: boolean };

export type FromBackground =
    | { action: 'createFolderResult'; success: boolean; alreadyExisted?: boolean; path?: string; error?: string }
    | { action: 'stats'; ticketId: string; count: number; name: string; email: string; subject: string; notes: string }
    | { action: 'allTickets';
    tickets: Record<string, { count: number; name: string; email: string; subject: string; notes: string }> }
    | { action: 'trainingMode'; enabled: boolean };
