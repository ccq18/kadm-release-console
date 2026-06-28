import http from "node:http";
import https from "node:https";

export async function sendJsonRequest(request, fetchImpl = fetch) {
  const text = await sendTextRequest(request, fetchImpl);
  const data = text ? JSON.parse(text) : null;

  return data;
}

export async function sendTextRequest(request, fetchImpl = fetch) {
  const response = request.insecureTLS
    ? await sendNodeJsonRequest(request)
    : await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

  const text = typeof response.text === "function" ? await response.text() : response.text;

  if (!response.ok) {
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    const message = data?.message || data?.error || text || response.statusText;
    const error = new Error(`HTTP ${response.status}: ${message}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return text;
}

export function joinUrl(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function jsonHeaders(token, extra = {}) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...extra
  };
}

async function sendNodeJsonRequest(request) {
  const url = new URL(request.url);
  const transport = url.protocol === "https:" ? https : http;

  const response = await new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      {
        method: request.method,
        headers: request.headers,
        rejectUnauthorized: request.insecureTLS ? false : true
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () => {
          resolve({
            ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
            status: res.statusCode || 0,
            statusText: res.statusMessage || "",
            text
          });
        });
      }
    );

    req.on("error", reject);
    if (request.body) {
      req.write(request.body);
    }
    req.end();
  });

  return {
    ...response,
    text: async () => response.text
  };
}
