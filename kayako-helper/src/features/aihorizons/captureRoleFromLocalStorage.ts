/*
   Reads/watches localStorage.currentUserRole on aihorizons.school
   and copies it into chrome.storage.sync as 'aih_customSisRole'.
   Load this ONLY on https://aihorizons.school/*.
*/
function captureRoleFromLocalStorage(): void {
    const KEY = 'currentUserRole';
    const save = (val: string | null) => {
        try {
            chrome.storage.sync.set({ aih_customSisRole: val || '' });
        } catch {}
    };

    // initial read
    try { save(localStorage.getItem(KEY)); } catch {}

    // watch writes in this tab
    try {
        const _setItem = Storage.prototype.setItem;
        const _removeItem = Storage.prototype.removeItem;
        Storage.prototype.setItem = function(name: string, value: string): any {
            if (name === KEY) save(value);
            // @ts-ignore - preserve args
            return _setItem.apply(this, arguments as any);
        };
        Storage.prototype.removeItem = function(name: string): any {
            if (name === KEY) save('');
            // @ts-ignore - preserve args
            return _removeItem.apply(this, arguments as any);
        };
    } catch {}

    // watch changes from other tabs
    try {
        window.addEventListener('storage', (ev) => {
            if (ev.key === KEY && ev.storageArea === localStorage) save(ev.newValue);
        });
    } catch {}
}

// Auto-run in content script context
try { captureRoleFromLocalStorage(); } catch {}


