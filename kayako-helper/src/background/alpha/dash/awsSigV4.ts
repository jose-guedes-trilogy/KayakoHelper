// awsSigV4.ts — Minimal AWS SigV4 signer for API Gateway (execute-api)

export interface AwsCredentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
}

function toHex(buf: ArrayBuffer): string {
    const b = new Uint8Array(buf);
    let s = "";
    for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
    return s;
}

function encodeRfc3986(str: string): string {
    return encodeURIComponent(str)
        .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
        .replace(/%7E/g, "~");
}

function canonicalURI(pathname: string): string {
    // Encode each segment, preserve '/' between segments
    return pathname
        .split("/")
        .map(seg => encodeRfc3986(seg))
        .join("/");
}

function canonicalQueryString(url: URL): string {
    const pairs: [string, string][] = [];
    url.searchParams.forEach((v, k) => {
        pairs.push([encodeRfc3986(k), encodeRfc3986(v)]);
    });
    pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
    return pairs.map(([k, v]) => `${k}=${v}`).join("&");
}

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
    const enc = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
    const hash = await crypto.subtle.digest("SHA-256", enc);
    return toHex(hash);
}

async function hmac(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

async function hmacStr(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
    return hmac(key, data);
}

async function kSigning(secretKey: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
    const kDate = await hmacStr(new TextEncoder().encode("AWS4" + secretKey), date);
    const kRegion = await hmacStr(kDate, region);
    const kService = await hmacStr(kRegion, service);
    return hmacStr(kService, "aws4_request");
}

export async function signAwsRequest(opts: {
    method: string;
    url: string;
    region: string;
    service?: string; // default "execute-api"
    headers?: Record<string, string>;
    body?: string | ArrayBuffer | null;
    credentials: AwsCredentials;
}): Promise<Record<string, string>> {
    const service = opts.service ?? "execute-api";
    const url = new URL(opts.url);
    const method = opts.method.toUpperCase();

    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
    const dateStamp = amzDate.slice(0, 8);

    const payload = opts.body ?? "";
    const payloadHash = await sha256Hex(typeof payload === "string" ? payload : payload);

    // Canonical request
    const canonHeaders: Record<string, string> = {};
    const inputHeaders = opts.headers || {};
    for (const [k, v] of Object.entries(inputHeaders)) {
        if (v == null) continue;
        canonHeaders[k.toLowerCase()] = String(v).trim();
    }
    canonHeaders["host"] = url.host;
    canonHeaders["x-amz-date"] = amzDate;

    const sortedHeaderKeys = Object.keys(canonHeaders).sort();
    const canonicalHeadersStr = sortedHeaderKeys.map(k => `${k}:${canonHeaders[k]}\n`).join("");
    const signedHeaders = sortedHeaderKeys.join(";");

    const canonicalRequest =
        method + "\n" +
        canonicalURI(url.pathname) + "\n" +
        canonicalQueryString(url) + "\n" +
        canonicalHeadersStr + "\n" +
        signedHeaders + "\n" +
        payloadHash;

    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    const scope = `${dateStamp}/${opts.region}/${service}/aws4_request`;
    const stringToSign =
        "AWS4-HMAC-SHA256\n" +
        amzDate + "\n" +
        scope + "\n" +
        canonicalRequestHash;

    const kSign = await kSigning(opts.credentials.secretAccessKey, dateStamp, opts.region, service);
    const signature = toHex(await hmac(kSign, stringToSign));

    const authHeader = `AWS4-HMAC-SHA256 Credential=${opts.credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const out: Record<string, string> = {
        authorization: authHeader,
        "x-amz-date": amzDate,
        host: url.host,
    };
    if (opts.credentials.sessionToken) {
        out["x-amz-security-token"] = opts.credentials.sessionToken;
    }
    // Optional but sometimes expected:
    out["x-amz-content-sha256"] = payloadHash;

    // Merge (caller’s values win)
    return Object.assign({}, inputHeaders, out);
}
