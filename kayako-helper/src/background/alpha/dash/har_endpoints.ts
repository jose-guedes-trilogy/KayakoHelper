// AUTO-GENERATED FROM HAR: har_endpoints.ts
export interface EndpointSpec {
  id: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";
  baseUrl: string;
  host: string;
  pathTemplate: string;
  exampleUrl: string;
  queryKeys: string[];
  requiredHeaders: Record<string, string>;
  cookieNames: string[];
  sampleBody?: string;
  sampleBodyMime?: string | null;
  responseStatuses: number[];
  responseMimeTypes: string[];
  observations: { needsAuthHeader: boolean; likelyCSRF: boolean; };
  samplesSeen: number;
}
export const HAR_ENDPOINTS: EndpointSpec[] = [
  {
    id: "GET api.iconify.design/eva.json",
    method: "GET",
    baseUrl: "https://api.iconify.design",
    host: "api.iconify.design",
    pathTemplate: "/eva.json",
    exampleUrl: "https://api.iconify.design/eva.json?icons=edit-2-outline%2Ctrash-2-outline",
    queryKeys: ["icons"],
    requiredHeaders: {"accept": "*/*", "origin": "http\u2026hool", "referer": "http\u2026ool/"},
    cookieNames: [],
    sampleBody: undefined,
    sampleBodyMime: null,
    responseStatuses: [200],
    responseMimeTypes: ["application/json"],
    observations: {"needsAuthHeader": false, "likelyCSRF": false},
    samplesSeen: 1,
  },
  {
    id: "GET ftgwtrk63c.execute-api.us-east-1.amazonaws.com/prod/get-user-list",
    method: "GET",
    baseUrl: "https://ftgwtrk63c.execute-api.us-east-1.amazonaws.com",
    host: "ftgwtrk63c.execute-api.us-east-1.amazonaws.com",
    pathTemplate: "/prod/get-user-list",
    exampleUrl: "https://ftgwtrk63c.execute-api.us-east-1.amazonaws.com/prod/get-user-list?nextToken=CAISqwIIARKEAggDEv8BAAccoKwzj9ETOaYKEiztr5cG05PehTvcAsrbt9AgK89YeyJAbiI6IlBhZ2luYXRpb25Db250aW51YXRpb25EVE8iLCJuZXh0S2V5IjoiQUFBQUFBQUFEYnJBQVFFQmU1OWxaUXBHUVhXTmFhckk3VGxaaWl4V2svRC9xVXRPb0I0RHYvTlJRWnhsYm1ZN05EYzRNV0l3WldZdE5qUmtOeTAwWTJJMkxXSTJPVEl0WldVM05UZ3paVEpsTm1ZM093PT0iLCJwYWdpbmF0aW9uRGVwdGgiOjE1MDAsInByZXZpb3VzUmVxdWVzdFRpbWUiOjE3NTU1NTY3MTYwODh9GiAlb%2BSa8ZYrg%2BD1YNYUzX11WvkeBFyaKJAVOxrJXAlK7g%3D%3D",
    queryKeys: ["nextToken"],
    requiredHeaders: {"accept": "appl\u2026 */*", "origin": "http\u2026hool", "referer": "http\u2026ool/"},
    cookieNames: [],
    sampleBody: undefined,
    sampleBodyMime: null,
    responseStatuses: [200],
    responseMimeTypes: ["application/json"],
    observations: {"needsAuthHeader": false, "likelyCSRF": false},
    samplesSeen: 3,
  },
  {
    id: "OPTIONS ftgwtrk63c.execute-api.us-east-1.amazonaws.com/prod/get-user-list",
    method: "OPTIONS",
    baseUrl: "https://ftgwtrk63c.execute-api.us-east-1.amazonaws.com",
    host: "ftgwtrk63c.execute-api.us-east-1.amazonaws.com",
    pathTemplate: "/prod/get-user-list",
    exampleUrl: "https://ftgwtrk63c.execute-api.us-east-1.amazonaws.com/prod/get-user-list?nextToken=CAISqwIIARKEAggDEv8BAAccoKwzj9ETOaYKEiztr5cG05PehTvcAsrbt9AgK89YeyJAbiI6IlBhZ2luYXRpb25Db250aW51YXRpb25EVE8iLCJuZXh0S2V5IjoiQUFBQUFBQUFEYnJBQVFFQmU1OWxaUXBHUVhXTmFhckk3VGxaaWl4V2svRC9xVXRPb0I0RHYvTlJRWnhsYm1ZN05EYzRNV0l3WldZdE5qUmtOeTAwWTJJMkxXSTJPVEl0WldVM05UZ3paVEpsTm1ZM093PT0iLCJwYWdpbmF0aW9uRGVwdGgiOjE1MDAsInByZXZpb3VzUmVxdWVzdFRpbWUiOjE3NTU1NTY3MTYwODh9GiAlb%2BSa8ZYrg%2BD1YNYUzX11WvkeBFyaKJAVOxrJXAlK7g%3D%3D",
    queryKeys: ["nextToken"],
    requiredHeaders: {"accept": "*/*", "origin": "http\u2026hool", "referer": "http\u2026ool/"},
    cookieNames: [],
    sampleBody: undefined,
    sampleBodyMime: null,
    responseStatuses: [204],
    responseMimeTypes: ["x-unknown"],
    observations: {"needsAuthHeader": false, "likelyCSRF": false},
    samplesSeen: 3,
  },
  {
    id: "POST api-js.mixpanel.com/track/",
    method: "POST",
    baseUrl: "https://api-js.mixpanel.com",
    host: "api-js.mixpanel.com",
    pathTemplate: "/track/",
    exampleUrl: "https://api-js.mixpanel.com/track/?verbose=1&ip=1&_=1755556716767",
    queryKeys: ["_", "ip", "verbose"],
    requiredHeaders: {"referer": "http\u2026ool/", "content-type": "appl\u2026oded"},
    cookieNames: [],
    sampleBody: "data=%5B%0A%20%20%20%20%7B%22event%22%3A%20%22Page%20View%22%2C%22properties%22%3A%20%7B%22%24os%22%3A%20%22Windows%22%2C%22%24browser%22%3A%20%22Chrome%22%2C%22%24current_url%22%3A%20%22https%3A%2F%2Fdash.alpha.school%2Fuser%2Flist%2F%22%2C%22%24browser_version%22%3A%20139%2C%22%24screen_height%22%3A%201080%2C%22%24screen_width%22%3A%201920%2C%22mp_lib%22%3A%20%22web%22%2C%22%24lib_version%22%3A%20%222.47.0%22%2C%22%24insert_id%22%3A%20%22a6wduateuj35d47h%22%2C%22time%22%3A%201755556711.833%2C%22distinct_id%22%3A%20%22jose.guedes%40trilogy.com%22%2C%22%24device_id%22%3A%20%221987fbcbcd22e07-04435c1e6491278-26011151-1fa400-1987fbcbcd22e07%22%2C%22%24initial_referrer%22%3A%20%22https%3A%2F%2Fsupport.alpha.school%2F%22%2C%22%24initial_referring_domain%22%3A%20%22support.alpha.school%22%2C%22\u2026",
    sampleBodyMime: "application/x-www-form-urlencoded",
    responseStatuses: [0],
    responseMimeTypes: ["x-unknown"],
    observations: {"needsAuthHeader": false, "likelyCSRF": false},
    samplesSeen: 1,
  },
  {
    id: "POST o924797.ingest.sentry.io/api/{id}/envelope/",
    method: "POST",
    baseUrl: "https://o924797.ingest.sentry.io",
    host: "o924797.ingest.sentry.io",
    pathTemplate: "/api/{id}/envelope/",
    exampleUrl: "https://o924797.ingest.sentry.io/api/4505607679311872/envelope/?sentry_key=e747f660b6c74af387579c3319cd0f2c&sentry_version=7&sentry_client=sentry.javascript.nextjs%2F7.77.0",
    queryKeys: ["sentry_client", "sentry_key", "sentry_version"],
    requiredHeaders: {"referer": "http\u2026ool/", "content-type": "text\u2026TF-8"},
    cookieNames: [],
    sampleBody: "{\"event_id\":\"75ce2df37cde4395a26a7541d6b338c6\",\"sent_at\":\"2025-08-18T22:39:01.756Z\",\"sdk\":{\"name\":\"sentry.javascript.nextjs\",\"version\":\"7.77.0\"},\"trace\":{\"environment\":\"production\",\"release\":\"621cec9ae789c5df01ed851c9b9aec720388564e\",\"public_key\":\"e747f660b6c74af387579c3319cd0f2c\",\"trace_id\":\"23e4a105758342a9827c154459ccfc1e\",\"sample_rate\":\"1\",\"transaction\":\"/user/list\",\"sampled\":\"true\"}}\n{\"type\":\"transaction\"}\n{\"contexts\":{\"trace\":{\"op\":\"pageload\",\"span_id\":\"97c9b7f079ba0658\",\"status\":\"deadline_exceeded\",\"tags\":{\"routing.instrumentation\":\"next-router\",\"effectiveConnectionType\":\"4g\",\"deviceMemory\":\"8 GB\",\"hardwareConcurrency\":\"16\",\"lcp.element\":\"h4.MuiTypography-root.MuiTypography-h4.MuiTypography-gutterBottom.css-1l77oo1\",\"lcp.size\":3190},\"trace_id\":\"23e4a105758342a9827c154459ccfc1e\"}},\"s\u2026",
    sampleBodyMime: "text/plain;charset=UTF-8",
    responseStatuses: [0],
    responseMimeTypes: ["x-unknown"],
    observations: {"needsAuthHeader": false, "likelyCSRF": false},
    samplesSeen: 1,
  },
];
