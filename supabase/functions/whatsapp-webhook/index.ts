import postgres from "npm:postgres@3.4.5";

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const db = dbUrl ? postgres(dbUrl, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false }) : null;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-hub-signature-256", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" };
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2,"0")).join("");
async function digest(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}
async function validSignature(raw: string, signature: string | null) {
  const secret = Deno.env.get("META_APP_SECRET");
  if (!secret) return true;
  if (!signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-256"}, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return hex(new Uint8Array(signed)) === signature.slice(7);
}
function messageType(type: string) {
  return ["text","image","audio","video","document","sticker","location","contacts","interactive","template"].includes(type) ? type : "interactive";
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:cors});
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN") && challenge) {
      return new Response(challenge, {status:200,headers:{...cors,"content-type":"text/plain"}});
    }
    return new Response("Verification failed",{status:403,headers:cors});
  }
  if (req.method !== "POST") return new Response("Method Not Allowed",{status:405,headers:cors});
  if (!db) return new Response("Database unavailable",{status:503,headers:cors});
  const raw = await req.text();
  if (!await validSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature",{status:401,headers:cors});
  }
  try {
    const body = JSON.parse(raw);
    for (const entry of body.entry || []) {
      const wabaId = String(entry.id || "unknown");
      for (const change of entry.changes || []) {
        if (change.field !== "messages") continue;
        const value = change.value || {};
        const metadata = value.metadata || {};
        const phoneId = String(metadata.phone_number_id || "");
        if (!phoneId) continue;
        const accountRows = await db`
          insert into private.whatsapp_accounts (waba_id,phone_number_id,display_phone_number,is_active)
          values (${wabaId},${phoneId},${metadata.display_phone_number || null},true)
          on conflict (phone_number_id) do update set waba_id=excluded.waba_id,
            display_phone_number=coalesce(excluded.display_phone_number,private.whatsapp_accounts.display_phone_number),
            updated_at=now()
          returning id
        `;
        const accountId = accountRows[0].id;
        const contacts = new Map<string,string>();
        for (const c of value.contacts || []) {
          const waId = String(c.wa_id || "");
          if (waId) contacts.set(waId, String(c.profile?.name || ""));
        }
        for (const message of value.messages || []) {
          const from = String(message.from || "");
          if (!/^\d{6,20}$/.test(from) || !message.id) continue;
          const eventKey = await digest(JSON.stringify({phoneId,message}));
          const eventRows = await db`
            insert into private.whatsapp_webhook_events (provider_event_id,event_type,payload,processing_status)
            values (${eventKey},'message',${db.json({entry_id:wabaId,change,message})},'processing')
            on conflict (provider_event_id) do nothing returning id
          `;
          if (!eventRows.length) continue;
          const contactRows = await db`
            insert into private.whatsapp_contacts (wa_id,phone_number,profile_name)
            values (${from},${from},${contacts.get(from) || null})
            on conflict (wa_id) do update set profile_name=coalesce(excluded.profile_name,private.whatsapp_contacts.profile_name),updated_at=now()
            returning id
          `;
          const contactId = contactRows[0].id;
          let conv = await db`select id from private.whatsapp_conversations where account_id=${accountId} and contact_id=${contactId} and status='open' order by updated_at desc limit 1`;
          if (!conv.length) conv = await db`
            insert into private.whatsapp_conversations (account_id,contact_id,status,last_customer_message_at,customer_service_window_expires_at)
            values (${accountId},${contactId},'open',now(),now()+interval '24 hours') returning id
          `;
          else await db`update private.whatsapp_conversations set last_customer_message_at=now(),customer_service_window_expires_at=now()+interval '24 hours',updated_at=now() where id=${conv[0].id}`;
          await db`
            insert into private.whatsapp_messages (account_id,conversation_id,contact_id,direction,message_type,content,provider_message_id,internal_status,provider_status)
            values (${accountId},${conv[0].id},${contactId},'inbound',${messageType(String(message.type || "text"))},${db.json(message)},${String(message.id)},'accepted','received')
            on conflict (account_id,provider_message_id) where provider_message_id is not null do nothing
          `;
          await db`update private.whatsapp_webhook_events set processing_status='processed',processed_at=now() where id=${eventRows[0].id}`;
        }
        for (const status of value.statuses || []) {
          const eventKey = await digest(JSON.stringify({phoneId,status}));
          const eventRows = await db`
            insert into private.whatsapp_webhook_events (provider_event_id,event_type,payload,processing_status)
            values (${eventKey},'status',${db.json({entry_id:wabaId,change,status})},'processing')
            on conflict (provider_event_id) do nothing returning id
          `;
          if (!eventRows.length) continue;
          const providerStatus = String(status.status || "unknown");
          const internal = ["sent","delivered","read","failed"].includes(providerStatus) ? providerStatus : "accepted";
          await db`
            update private.whatsapp_messages set provider_status=${providerStatus},
              internal_status=case when ${internal}='failed' then 'failed' else ${internal} end,
              updated_at=now()
            where provider_message_id=${String(status.id || "")}
          `;
          await db`update private.whatsapp_webhook_events set processing_status='processed',processed_at=now() where id=${eventRows[0].id}`;
        }
      }
    }
    return new Response(JSON.stringify({success:true}),{status:200,headers:{...cors,"content-type":"application/json"}});
  } catch (error) {
    console.error("whatsapp-webhook processing failed",error);
    return new Response(JSON.stringify({success:false,error:"Webhook processing failed"}),{status:500,headers:{...cors,"content-type":"application/json"}});
  }
});
