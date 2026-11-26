import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const db = dbUrl ? postgres(dbUrl, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false }) : null;
const encoder = new TextEncoder();
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MESSAGE_TYPES = new Set(["text", "image", "audio", "video", "document", "sticker", "location", "contacts", "interactive", "template", "button", "reaction", "order", "unsupported"]);

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" } });
}
function textResponse(value: string, status: number): Response {
  return new Response(value, { status, headers: { ...corsHeaders, "content-type": "text/plain; charset=utf-8" } });
}
function obj(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
function messageType(value: unknown): string {
  const type = typeof value === "string" ? value : "unsupported";
  return MESSAGE_TYPES.has(type) ? type : "unsupported";
}
function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret) throw new Error("META_APP_SECRET_MISSING");
  const match = header?.match(/^sha256=([a-f0-9]{64})$/i);
  if (!match) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return await crypto.subtle.verify("HMAC", key, hexBytes(match[1]), encoder.encode(raw));
}
async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function claimEvent(key: string, type: string, payload: Record<string, unknown>): Promise<string | null> {
  const rows = await db!.unsafe(
    "INSERT INTO private.whatsapp_webhook_events (provider_event_id,event_type,payload,processing_status,received_at) " +
    "VALUES ($1,$2,$3::jsonb,'processing',now()) " +
    "ON CONFLICT (provider_event_id) DO UPDATE SET processing_status='processing',received_at=now(),processed_at=NULL,error_code=NULL " +
    "WHERE private.whatsapp_webhook_events.processing_status IN ('received','queued','failed') " +
    "OR (private.whatsapp_webhook_events.processing_status='processing' AND private.whatsapp_webhook_events.received_at < now()-interval '5 minutes') " +
    "RETURNING id",
    [key, type, JSON.stringify(payload)],
  );
  return rows.length ? String(rows[0].id) : null;
}
async function markProcessed(id: string): Promise<void> {
  await db!.unsafe("UPDATE private.whatsapp_webhook_events SET processing_status='processed',processed_at=now(),error_code=NULL WHERE id=$1::uuid", [id]);
}
async function markUnsupported(id: string): Promise<void> {
  await db!.unsafe("UPDATE private.whatsapp_webhook_events SET processing_status='unsupported',processed_at=now(),error_code=NULL WHERE id=$1::uuid", [id]);
}
async function markFailed(id: string, code: string): Promise<void> {
  await db!.unsafe("UPDATE private.whatsapp_webhook_events SET processing_status='failed',error_code=$2 WHERE id=$1::uuid AND processing_status<>'processed'", [id, code.slice(0, 120)]);
}
async function accountIdFor(wabaId: string, phoneId: string, displayPhone: string | null): Promise<string> {
  const rows = await db!.unsafe(
    "INSERT INTO private.whatsapp_accounts (waba_id,phone_number_id,display_phone_number,is_active) VALUES ($1,$2,$3,true) " +
    "ON CONFLICT (phone_number_id) DO UPDATE SET waba_id=EXCLUDED.waba_id,display_phone_number=COALESCE(EXCLUDED.display_phone_number,private.whatsapp_accounts.display_phone_number),updated_at=now() RETURNING id",
    [wabaId, phoneId, displayPhone],
  );
  if (!rows.length) throw new Error("ACCOUNT_UPSERT_FAILED");
  return String(rows[0].id);
}
async function contactIdFor(waId: string, profileName: string | null): Promise<string> {
  const rows = await db!.unsafe(
    "INSERT INTO private.whatsapp_contacts (wa_id,phone_number,profile_name) VALUES ($1,$1,$2) " +
    "ON CONFLICT (wa_id) DO UPDATE SET profile_name=COALESCE(EXCLUDED.profile_name,private.whatsapp_contacts.profile_name),updated_at=now() RETURNING id",
    [waId, profileName],
  );
  if (!rows.length) throw new Error("CONTACT_UPSERT_FAILED");
  return String(rows[0].id);
}
async function conversationIdFor(accountId: string, contactId: string): Promise<string> {
  const rows = await db!.unsafe(
    "INSERT INTO private.whatsapp_conversations (account_id,contact_id,status,last_customer_message_at,customer_service_window_expires_at) " +
    "VALUES ($1::uuid,$2::uuid,'open',now(),now()+interval '24 hours') " +
    "ON CONFLICT (account_id,contact_id) WHERE status='open' DO UPDATE SET " +
    "last_customer_message_at=now(),customer_service_window_expires_at=now()+interval '24 hours',updated_at=now() RETURNING id",
    [accountId, contactId],
  );
  if (!rows.length) throw new Error("CONVERSATION_RESOLVE_FAILED");
  return String(rows[0].id);
}
async function inboundMessage(accountId: string, message: Record<string, any>, profileName: string | null): Promise<void> {
  const from = String(message.from ?? "");
  const providerId = String(message.id ?? "");
  if (!/^\d{6,20}$/.test(from) || !providerId) throw new Error("INVALID_INBOUND_MESSAGE");
  const contactId = await contactIdFor(from, profileName);
  const conversationId = await conversationIdFor(accountId, contactId);
  await db!.unsafe(
    "INSERT INTO private.whatsapp_messages (account_id,conversation_id,contact_id,direction,message_type,content,provider_message_id,internal_status,provider_status) " +
    "VALUES ($1::uuid,$2::uuid,$3::uuid,'inbound',$4,$5::jsonb,$6,'accepted','received') " +
    "ON CONFLICT (account_id,provider_message_id) WHERE provider_message_id IS NOT NULL DO NOTHING",
    [accountId, conversationId, contactId, messageType(message.type), JSON.stringify(message), providerId],
  );
  await reconcilePendingStatuses(accountId, providerId);
}
async function reconcilePendingStatuses(accountId: string, providerId: string): Promise<void> {
  const pending = await db!.unsafe(
    "SELECT id,provider_status,provider_timestamp,raw_payload FROM private.whatsapp_pending_message_statuses " +
    "WHERE account_id=$1::uuid AND provider_message_id=$2 AND processed_at IS NULL " +
    "ORDER BY provider_timestamp ASC NULLS FIRST,created_at ASC",
    [accountId, providerId],
  );
  for (const item of pending) {
    const found = await db!.unsafe(
      "SELECT id FROM private.whatsapp_messages WHERE account_id=$1::uuid AND provider_message_id=$2 LIMIT 1",
      [accountId, providerId],
    );
    if (!found.length) continue;
    const name = String(item.provider_status).toLowerCase();
    if (!["sent", "delivered", "read", "failed"].includes(name)) {
      await db!.unsafe(
        "UPDATE private.whatsapp_pending_message_statuses SET processed_at=now(),processing_error='UNSUPPORTED_PROVIDER_STATUS' WHERE id=$1::uuid",
        [String(item.id)],
      );
      continue;
    }
    const rank = name === "sent" ? 1 : name === "delivered" ? 2 : name === "read" ? 3 : 0;
    const payload = obj(item.raw_payload);
    const errors = Array.isArray(payload.errors) ? payload.errors : [];
    const errorCode = errors.length ? String(obj(errors[0]).code ?? "META_DELIVERY_FAILED") : null;
    const providerTimestamp = item.provider_timestamp ? new Date(item.provider_timestamp).toISOString() : new Date().toISOString();
    await db!.unsafe(
      "UPDATE private.whatsapp_messages SET " +
      "provider_status=CASE WHEN internal_status IN ('failed','cancelled') THEN provider_status WHEN $3='failed' THEN CASE WHEN internal_status IN ('delivered','read') THEN provider_status ELSE 'failed' END " +
      "WHEN (CASE provider_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)<$4 THEN $3 ELSE provider_status END, " +
      "internal_status=CASE WHEN internal_status IN ('failed','cancelled') THEN internal_status WHEN $3='failed' AND internal_status NOT IN ('delivered','read') THEN 'failed' " +
      "WHEN $3<>'failed' AND (CASE internal_status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)<$4 THEN $3 ELSE internal_status END, " +
      "error_code=CASE WHEN $3='failed' THEN COALESCE($5,error_code) ELSE error_code END, " +
      "provider_status_timestamp=$6::timestamptz,updated_at=now() " +
      "WHERE account_id=$1::uuid AND provider_message_id=$2 " +
      "AND (provider_status_timestamp IS NULL OR provider_status_timestamp <= $6::timestamptz)",
      [accountId, providerId, name, rank, errorCode, providerTimestamp],
    );
    await db!.unsafe(
      "UPDATE private.whatsapp_pending_message_statuses SET processed_at=now(),processing_error=NULL WHERE id=$1::uuid",
      [String(item.id)],
    );
  }
}
async function updateStatus(accountId: string, status: Record<string, any>, eventKey: string): Promise<void> {
  const providerId = String(status.id ?? "");
  const name = String(status.status ?? "").toLowerCase();
  if (!providerId || !["sent", "delivered", "read", "failed"].includes(name)) return;
  const seconds = Number(status.timestamp);
  const providerTimestamp = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000).toISOString()
    : new Date().toISOString();
  await db!.unsafe(
    "INSERT INTO private.whatsapp_pending_message_statuses " +
    "(account_id,provider_message_id,provider_status,provider_timestamp,status_event_key,raw_payload) " +
    "VALUES ($1::uuid,$2,$3,$4::timestamptz,$5,$6::jsonb) " +
    "ON CONFLICT (account_id,status_event_key) DO NOTHING",
    [accountId, providerId, name, providerTimestamp, eventKey, JSON.stringify(status)],
  );
  await reconcilePendingStatuses(accountId, providerId);
}
async function handleChange(wabaId: string, change: Record<string, any>): Promise<void> {
  if (change.field !== "messages") {
    const field = String(change.field ?? "unknown");
    const key = await sha256("unsupported|" + wabaId + "|" + field + "|" + JSON.stringify(change));
    const eventId = await claimEvent(key, "unsupported:" + field, { waba_id: wabaId, field, change });
    if (eventId) await markUnsupported(eventId);
    return;
  }
  const value = obj(change.value);
  const metadata = obj(value.metadata);
  const phoneId = String(metadata.phone_number_id ?? "");
  if (!phoneId) throw new Error("PHONE_NUMBER_ID_MISSING");
  const accountId = await accountIdFor(wabaId, phoneId, metadata.display_phone_number ? String(metadata.display_phone_number) : null);
  const names = new Map<string, string>();
  for (const raw of Array.isArray(value.contacts) ? value.contacts : []) {
    const contact = obj(raw);
    const waId = String(contact.wa_id ?? "");
    const name = obj(contact.profile).name;
    if (/^\d{6,20}$/.test(waId) && typeof name === "string" && name.trim()) names.set(waId, name.trim().slice(0, 255));
  }
  for (const raw of Array.isArray(value.messages) ? value.messages : []) {
    const message = obj(raw);
    const providerId = String(message.id ?? "");
    if (!providerId) throw new Error("INBOUND_MESSAGE_ID_MISSING");
    const key = await sha256("message|" + phoneId + "|" + providerId);
    const eventId = await claimEvent(key, "message", { waba_id: wabaId, phone_number_id: phoneId, message });
    if (!eventId) continue;
    try {
      await inboundMessage(accountId, message, names.get(String(message.from ?? "")) ?? null);
      await markProcessed(eventId);
    } catch (error) {
      await markFailed(eventId, error instanceof Error ? error.message : "INBOUND_PROCESSING_FAILED");
      throw error;
    }
  }
  for (const raw of Array.isArray(value.statuses) ? value.statuses : []) {
    const status = obj(raw);
    const providerId = String(status.id ?? "");
    const statusName = String(status.status ?? "unknown");
    const timestamp = String(status.timestamp ?? "");
    const recipient = String(status.recipient_id ?? "");
    const key = await sha256("status|" + phoneId + "|" + providerId + "|" + statusName + "|" + timestamp + "|" + recipient);
    const eventId = await claimEvent(key, "status", { waba_id: wabaId, phone_number_id: phoneId, status });
    if (!eventId) continue;
    try {
      await updateStatus(accountId, status, key);
      await markProcessed(eventId);
    } catch (error) {
      await markFailed(eventId, error instanceof Error ? error.message : "STATUS_PROCESSING_FAILED");
      throw error;
    }
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

  if (req.method === "GET") {
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    if (!expected) return textResponse("Webhook verification is not configured", 503);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === expected && challenge !== null) return textResponse(challenge, 200);
    return textResponse("Verification failed", 403);
  }

  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);
  if (!db) return json({ success: false, error: "Database unavailable" }, 503);

  try {
    const raw = await req.text();
    if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) return json({ success: false, error: "Payload too large" }, 413);

    let signatureOk: boolean;
    try {
      signatureOk = await validSignature(raw, req.headers.get("x-hub-signature-256"));
    } catch (error) {
      if (error instanceof Error && error.message === "META_APP_SECRET_MISSING") {
        console.error("whatsapp-webhook configuration error: META_APP_SECRET is missing");
        return json({ success: false, error: "Webhook signature validation is not configured" }, 503);
      }
      throw error;
    }
    if (!signatureOk) return json({ success: false, error: "Invalid webhook signature" }, 401);

    let body: Record<string, any>;
    try { body = JSON.parse(raw); } catch { return json({ success: false, error: "Invalid JSON payload" }, 400); }
    if (body.object !== "whatsapp_business_account" || !Array.isArray(body.entry)) {
      return json({ success: false, error: "Unsupported webhook payload" }, 400);
    }

    for (const rawEntry of body.entry) {
      const entry = obj(rawEntry);
      const wabaId = String(entry.id ?? "");
      if (!wabaId) continue;
      for (const rawChange of Array.isArray(entry.changes) ? entry.changes : []) {
        await handleChange(wabaId, obj(rawChange));
      }
    }
    return json({ success: true, received: true }, 200);
  } catch (error) {
    console.error("whatsapp-webhook processing failed", error instanceof Error ? error.message : "UNKNOWN_ERROR");
    return json({ success: false, error: "Webhook processing failed" }, 500);
  }
});
