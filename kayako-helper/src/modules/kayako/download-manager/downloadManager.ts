/* modules/download-manager/downloadManager.ts
   ──────────────────────────────────────────────────────────
   One-liner wrapper to keep existing import paths working. */

import { bootCreateFolderButton } from '@/modules/kayako/buttons/createFolderButton.ts';
import {bootKayakoAttachments} from "@/modules/gemini/kayakoAttachments.ts";

export function  bootDownloadManager() {
    bootCreateFolderButton();

    /* Transfer Kayako attachments to Gemini */
    bootKayakoAttachments();
}
