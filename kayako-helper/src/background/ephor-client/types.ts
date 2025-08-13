/* API payloads & responses */
export type InteractionPayload    = Record<string, unknown>;
export interface StreamResponse   { output?: string; [k: string]: unknown; }
export type ChannelMessagePayload = Record<string, unknown>;
export type MuxResponse           = Record<string, unknown>;

/* Auth / initial-state objects */
export interface EphorClientOpts {
    apiBase      : string;
    token?       : string;   // API key  (eph-…)
    jwtToken?    : string;   // Clerk / OAuth JWT (Stream mode)
    refreshToken?: string;
    expiresAt?   : number;
    serverId?    : string;
    tabId?       : number;
}
export type StoredAuth = {
    token       : string;
    jwtToken    : string;
    refreshToken: string;
    expiresAt   : number;
    serverId    : string;
};
