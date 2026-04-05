/**
 * Fetch JSON API with session cookie (same-origin).
 */
async function apiJson(url, options = {}) {
  const opts = { credentials: "same-origin", ...options };
  if (options.body != null) {
    opts.headers = { "Content-Type": "application/json", ...options.headers };
  } else if (options.headers) {
    opts.headers = options.headers;
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function apiGet(url) {
  return apiJson(url, { method: "GET" });
}

function apiPost(url, body) {
  return apiJson(url, { method: "POST", body: JSON.stringify(body || {}) });
}
