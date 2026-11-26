import { config } from "./config.js";

async function request(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (config.publishableKey) headers.apikey = config.publishableKey;
  const response = await fetch(`${config.apiBase}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  return payload;
}

export const api = {
  conversations: () => request("/conversations"),
  messages: (id) => request(`/conversations/${encodeURIComponent(id)}/messages`),
  sendText: (conversationId, text) => request("/send/text", { method: "POST", body: JSON.stringify({ conversation_id: conversationId, text }) }),
  contacts: () => request("/contacts"),
};
