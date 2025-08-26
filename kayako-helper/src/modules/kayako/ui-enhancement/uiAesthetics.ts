/* OmniHelper – uiAesthetics orchestrator */

import { initDarkModeCompat } from './uiAesthetics/darkModeCompat.ts';
import { initHideMessenger } from './uiAesthetics/hideMessenger.ts';
import {
    initTimestampTooltips,
    initSideConversationTimestamps,
    initHoverTimeTooltips,
    initDaySeparatorTooltips
} from './uiAesthetics/timeTooltips.ts';
import { initSidePanelResizer } from './uiAesthetics/sidePanelResizer.ts';

export function bootUiAesthetics(): void {
    initDarkModeCompat();
    initHideMessenger();
    initTimestampTooltips();
    initSideConversationTimestamps();
    initHoverTimeTooltips();
    initDaySeparatorTooltips();
    initSidePanelResizer();
}

bootUiAesthetics();
