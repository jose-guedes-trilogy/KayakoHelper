import type { ToBackground, FromBackground } from '@/messageTypes';

chrome.runtime.onMessage.addListener((msg: ToBackground, _sender, sendResponse) => {
    switch (msg.action) {
        case 'createFolder':
            chrome.runtime.sendNativeMessage(
                'com.kayako_helper',
                { ticketId: msg.ticketId, location: msg.location },
                resp => {
                    if (chrome.runtime.lastError) {
                        sendResponse(<FromBackground>{
                            action: 'createFolderResult',
                            success: false,
                            error: chrome.runtime.lastError.message
                        });
                    } else {
                        sendResponse(<FromBackground>{
                            action: 'createFolderResult',
                            success: resp.success,
                            alreadyExisted: resp.alreadyExisted,
                            path: resp.path,
                            error: resp.error
                        });
                    }
                }
            );
            return true;

        case 'saveMetadata':
            chrome.storage.local.get('ticketStats', data => {
                const stats = data.ticketStats || {};
                const e = stats[msg.ticketId] || { count: 0, name: msg.name, email: msg.email, subject: msg.subject };
                e.name = msg.name;
                e.email = msg.email;
                e.subject = msg.subject;
                stats[msg.ticketId] = e;
                chrome.storage.local.set({ ticketStats: stats });
            });
            break;

        case 'incrementReply':
            chrome.storage.local.get('ticketStats', data => {
                const stats = data.ticketStats || {};
                const e = stats[msg.ticketId] || { count: 0, name: '', email: '', subject: '' };
                e.count = (e.count || 0) + 1;
                stats[msg.ticketId] = e;
                chrome.storage.local.set({ ticketStats: stats });
            });
            break;

        case 'setTrainingMode':
            chrome.storage.sync.set({ trainingMode: msg.enabled }, () => {
                chrome.runtime.sendMessage(<FromBackground>{
                    action: 'trainingMode',
                    enabled: msg.enabled
                });
            });
            break;

        case 'getStats':
            chrome.storage.local.get('ticketStats', data => {
                const stats = data.ticketStats || {};
                const e = stats[msg.ticketId] || { count: 0, name: '', email: '', subject: '' };
                sendResponse(<FromBackground>{
                    action: 'stats',
                    ticketId: msg.ticketId,
                    count: e.count,
                    name: e.name,
                    email: e.email,
                    subject: e.subject
                });
            });
            return true;

        case 'getTrainingMode':
            chrome.storage.sync.get({ trainingMode: true }, items => {
                sendResponse(<FromBackground>{
                    action: 'trainingMode',
                    enabled: items.trainingMode as boolean
                });
            });
            return true;
    }
});