export async function sendJsonRequest(request, fetchImpl = fetch) {
  const response = await fetchImpl(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const message = data?.message || data?.error || response.statusText;
    const error = new Error(`HTTP ${response.status}: ${message}`);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data;
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
