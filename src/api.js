import { config } from "./config.js";

async function request(path, options = {}) {
  const headers = { "content-type": "application/json", ...(options.headers || {}) };
  if (config.publishableKey) headers.apikey = config.publishableKey;
  const response = await fetch(config.apiBase + path, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Request failed (${response.status})`);
  return payload;
}
async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export const api = {
  conversations: () => request("/conversations"),
  messages: (id) => request("/conversations/" + encodeURIComponent(id) + "/messages"),
  sendText: (conversationId, text) => request("/send/text", { method: "POST", body: JSON.stringify({ conversation_id: conversationId, text }) }),
  sendMedia: (conversationId, mediaId, type, filename) => request("/send/media", { method: "POST", body: JSON.stringify({ conversation_id: conversationId, media_id: mediaId, type, filename }) }),
  uploadMedia: async (conversationId, file, type) => request("/media", { method: "POST", body: JSON.stringify({ conversation_id: conversationId, filename: file.name, mime_type: file.type || "application/octet-stream", type, base64: await fileToBase64(file) }) }),
  contacts: () => request("/contacts"),
};
