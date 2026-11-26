import { api } from "./api.js";
import { subscribeToInbox } from "./realtime.js";

const $ = (selector) => document.querySelector(selector);
const state = { conversations: [], active: null, messages: [] };
const list = $("#conversation-list");
const messageList = $("#message-list");
const input = $("#message-input");
const send = $("#send-button");

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function initials(value = "?") { return value.trim().slice(0, 1).toUpperCase() || "?"; }

function renderConversations() {
  const query = $("#search-input").value.toLowerCase();
  const rows = state.conversations.filter((c) => (c.profile_name || c.phone_number || "").toLowerCase().includes(query));
  list.innerHTML = rows.map((c) => `
    <button class="conversation ${state.active?.id === c.id ? "active" : ""}" data-id="${escapeHtml(c.id)}">
      <span class="avatar">${escapeHtml(initials(c.profile_name || c.phone_number))}</span>
      <span class="conversation-copy"><strong>${escapeHtml(c.profile_name || c.phone_number)}</strong><small>${escapeHtml(c.last_message || "Belum ada pesan")}</small></span>
      <time>${c.updated_at ? new Date(c.updated_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : ""}</time>
    </button>`).join("") || '<p class="empty-note">Belum ada percakapan.</p>';
}
function renderMessages() {
  $("#chat-header").innerHTML = state.active ? `
    <span class="avatar large">${escapeHtml(initials(state.active.profile_name || state.active.phone_number))}</span>
    <div><strong>${escapeHtml(state.active.profile_name || state.active.phone_number)}</strong><small>${escapeHtml(state.active.phone_number || "")}</small></div>` : '<div><strong>Pilih percakapan</strong><small>WhatsApp Cloud API</small></div>';
  messageList.innerHTML = state.messages.map((m) => {
    const content = m.content?.text?.body || m.content?.body || m.content?.caption || JSON.stringify(m.content || {});
    return `<article class="message ${m.direction === "outbound" ? "outbound" : "inbound"}"><p>${escapeHtml(content)}</p><time>${m.created_at ? new Date(m.created_at).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}) : ""} · ${escapeHtml(m.provider_status || m.internal_status || "")}</time></article>`;
  }).join("") || '<div class="welcome"><p>Belum ada pesan pada percakapan ini.</p></div>';
  messageList.scrollTop = messageList.scrollHeight;
  input.disabled = !state.active;
  send.disabled = !state.active;
  $("#contact-details").innerHTML = state.active ? `<div class="profile-avatar">${escapeHtml(initials(state.active.profile_name || state.active.phone_number))}</div><h3>${escapeHtml(state.active.profile_name || "WhatsApp Contact")}</h3><p>${escapeHtml(state.active.phone_number || "")}</p>` : "<p>Pilih percakapan untuk melihat detail kontak.</p>";
}
async function loadConversations() {
  try {
    const data = await api.conversations();
    state.conversations = data.data || data.conversations || [];
    renderConversations();
    $("#connection-status").textContent = "Terhubung";
  } catch (error) { $("#connection-status").textContent = error.message; }
}
async function openConversation(id) {
  state.active = state.conversations.find((c) => c.id === id) || null;
  renderConversations();
  renderMessages();
  if (!state.active) return;
  try { const data = await api.messages(id); state.messages = data.data || data.messages || []; renderMessages(); }
  catch (error) { messageList.innerHTML = `<p class="empty-note">${escapeHtml(error.message)}</p>`; }
}
list.addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (button) openConversation(button.dataset.id);
});
$("#search-input").addEventListener("input", renderConversations);
$("#refresh-button").addEventListener("click", loadConversations);
$("#composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || !state.active) return;
  send.disabled = true;
  try { await api.sendText(state.active.id, text); input.value = ""; await openConversation(state.active.id); }
  catch (error) { alert(error.message); }
  finally { send.disabled = !state.active; }
});
$("#attach-button").addEventListener("click", () => $("#media-input").click());
loadConversations();
subscribeToInbox(async () => { await loadConversations(); if (state.active) await openConversation(state.active.id); });
setInterval(loadConversations, 30000);
