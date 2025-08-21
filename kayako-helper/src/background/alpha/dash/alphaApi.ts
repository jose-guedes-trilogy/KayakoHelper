// alphaApi.ts
export const APP_ORIGIN = "https://dash.alpha.school/";
export const REGION = "us-east-1";
export const USER_POOL_ID = "us-east-1_EJpiGT57W";

// 👉 Add it here if you have it (format: us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
export const IDENTITY_POOL_ID: string | undefined = /* "us-east-1:YOUR-GUID" */ undefined;

export async function getUserListSigned(nextToken?: string): Promise<any> {
    const url = new URL("/prod/get-user-list", "https://ftgwtrk63c.execute-api.us-east-1.amazonaws.com");
    if (nextToken) url.searchParams.set("nextToken", nextToken);

    const res = await chrome.runtime.sendMessage({
        type: "aws.signedFetch",
        url: url.toString(),
        method: "GET",
        headers: { accept: "application/json, text/plain, */*" },
        body: null,
        originUrl: APP_ORIGIN,
        region: REGION,
        userPoolId: USER_POOL_ID,
        identityPoolId: IDENTITY_POOL_ID,
        timeoutMs: 30000,
    });

    if (!res) throw new Error("No response from background");
    if (!res.ok) {
        const msg = res.error ? res.error : `HTTP ${res.status} ${res.statusText}`;
        const dbg = res.debug ? ` [debug: ${JSON.stringify(res.debug).slice(0,300)}…]` : "";
        throw new Error(msg + dbg + " — " + (res.text || ""));
    }
    const ct = res.headers["content-type"] || res.headers["Content-Type"] || "";
    return ct.includes("application/json") ? JSON.parse(res.text || "{}") : res.text;
}
