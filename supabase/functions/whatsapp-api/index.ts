import postgres from "npm:postgres@3.4.5";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_API_VERSION") || "v27.0";
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const db = dbUrl ? postgres(dbUrl, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false }) : null;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});
const fail = (message: string, status = 400) => json({ success: false, error: { message } }, status);
const getBody = async (req: Request) => {
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > 2_000_000) throw new Error("Payload too large");
  return raw ? JSON.parse(raw) : {};
};
const metaRequest = async (phoneId: string, payload: Record<string, unknown>) => {
  const token = Deno.env.get("META_WHATSAPP_ACCESS_TOKEN");
  if (!token) throw new Error("META_WHATSAPP_ACCESS_TOKEN is not configured");
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((result as any)?.error?.message || `Meta API error ${response.status}`);
  return result as Record<string, any>;
};
const activeAccount = async () => {
  if (!db) throw new Error("SUPABASE_DB_URL is not configured");
  const rows = await db`select * from private.whatsapp_accounts where is_active = true order by created_at limit 1`;
  if (!rows[0]) throw new Error("No active WhatsApp account. Add the phone number account before sending.");
  return rows[0];
};
const send = async (conversationId: string, type: string, payload: Record<string, unknown>) => {
  if (!db) throw new Error("SUPABASE_DB_URL is not configured");
  const rows = await db`
    select c.id as conversation_id, c.contact_id, c.account_id, c.customer_service_window_expires_at,
           ct.wa_id, a.phone_number_id
    from private.whatsapp_conversations c
    join private.whatsapp_contacts ct on ct.id = c.contact_id
    join private.whatsapp_accounts a on a.id = c.account_id
    where c.id = ${conversationId}
    limit 1
  `;
  const row = rows[0];
  if (!row) throw new Error("Conversation not found");
  if (type === "text" && (!row.customer_service_window_expires_at || new Date(row.customer_service_window_expires_at) <= new Date())) {
    throw new Error("Customer service window is closed. Use an approved template.");
  }
  const content = { to: row.wa_id, type, ...payload };
  const inserted = await db`
    insert into private.whatsapp_messages
      (account_id, conversation_id, contact_id, direction, message_type, content, internal_status)
    values
      (${row.account_id}, ${row.conversation_id}, ${row.contact_id}, 'outbound', ${type}, ${db.json(content)}, 'processing')
    returning id
  `;
  try {
    const provider = await metaRequest(row.phone_number_id, { to: row.wa_id, type, ...payload });
    const providerId = provider.messages?.[0]?.id || null;
    await db`
      update private.whatsapp_messages
      set internal_status = 'accepted', provider_status = 'accepted',
          provider_message_id = ${providerId}, accepted_at = now(), updated_at = now()
      where id = ${inserted[0].id}
    `;
    return { message_id: inserted[0].id, provider_message_id: providerId, status: "accepted" };
  } catch (error) {
    await db`
      update private.whatsapp_messages set internal_status = 'failed',
        error_message = ${String(error).slice(0, 500)}, updated_at = now()
      where id = ${inserted[0].id}
    `;
    throw error;
  }
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!db) return fail("Database connection is not configured", 503);
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/whatsapp-api/, "").replace(/\/$/, "") || "/";
  const parts = path.split("/").filter(Boolean);
  try {
    if (req.method === "GET" && path === "/contacts") {
      const rows = await db`select * from private.whatsapp_contacts order by updated_at desc nulls last, created_at desc`;
      return json({ data: rows });
    }
    if (req.method === "POST" && path === "/contacts") {
      const b = await getBody(req);
      if (!/^\d{6,20}$/.test(String(b.phone_number || b.wa_id || ""))) return fail("phone_number/wa_id must contain 6–20 digits");
      const waId = String(b.wa_id || b.phone_number);
      const rows = await db`
        insert into private.whatsapp_contacts (wa_id, phone_number, profile_name)
        values (${waId}, ${String(b.phone_number || waId)}, ${b.profile_name || null})
        on conflict (wa_id) do update set phone_number=excluded.phone_number,
          profile_name=coalesce(excluded.profile_name, private.whatsapp_contacts.profile_name), updated_at=now()
        returning *
      `;
      return json({ data: rows[0] }, 201);
    }
    if (parts[0] === "contacts" && parts[1] && req.method === "GET") {
      const rows = await db`select * from private.whatsapp_contacts where id=${parts[1]}::uuid`;
      return rows[0] ? json({ data: rows[0] }) : fail("Contact not found", 404);
    }
    if (parts[0] === "contacts" && parts[1] && req.method === "PATCH") {
      const b = await getBody(req);
      const rows = await db`update private.whatsapp_contacts set
        profile_name=coalesce(${b.profile_name ?? null},profile_name),
        phone_number=coalesce(${b.phone_number ?? null},phone_number), updated_at=now()
        where id=${parts[1]}::uuid returning * `;
      return rows[0] ? json({ data: rows[0] }) : fail("Contact not found", 404);
    }
    if (parts[0] === "contacts" && parts[1] && req.method === "DELETE") {
      const rows = await db`delete from private.whatsapp_contacts where id=${parts[1]}::uuid returning id`;
      return rows[0] ? json({ success: true }) : fail("Contact not found or referenced by history", 409);
    }
    if (req.method === "GET" && path === "/conversations") {
      const rows = await db`
        select c.*, ct.wa_id, ct.phone_number, ct.profile_name,
          m.content->>'text' as last_message,
          (select jsonb_extract_path_text(mm.content,'text','body') from private.whatsapp_messages mm
           where mm.conversation_id=c.id order by mm.created_at desc limit 1) as last_message_text
        from private.whatsapp_conversations c
        join private.whatsapp_contacts ct on ct.id=c.contact_id
        left join lateral (select content from private.whatsapp_messages x where x.conversation_id=c.id order by created_at desc limit 1) m on true
        order by c.updated_at desc
      `;
      return json({ data: rows.map((r: any) => ({ ...r, last_message: r.last_message_text || r.last_message || "" })) });
    }
    if (parts[0] === "conversations" && parts[1] && parts.length === 1 && req.method === "GET") {
      const rows = await db`select c.*, ct.wa_id, ct.phone_number, ct.profile_name from private.whatsapp_conversations c join private.whatsapp_contacts ct on ct.id=c.contact_id where c.id=${parts[1]}::uuid`;
      return rows[0] ? json({ data: rows[0] }) : fail("Conversation not found", 404);
    }
    if (parts[0] === "conversations" && parts[1] && parts.length === 1 && req.method === "PATCH") {
      const b = await getBody(req);
      const rows = await db`update private.whatsapp_conversations set status=coalesce(${b.status ?? null},status),updated_at=now() where id=${parts[1]}::uuid returning *`;
      return rows[0] ? json({ data: rows[0] }) : fail("Conversation not found", 404);
    }
    if (parts[0] === "conversations" && parts[1] && parts[2] === "messages" && req.method === "GET") {
      const rows = await db`select * from private.whatsapp_messages where conversation_id=${parts[1]}::uuid order by created_at asc limit 500`;
      return json({ data: rows });
    }
    if (req.method === "GET" && path === "/templates") {
      const rows = await db`select * from private.whatsapp_templates order by name,language`;
      return json({ data: rows });
    }
    if (req.method === "POST" && path === "/send/text") {
      const b = await getBody(req);
      if (!b.conversation_id || !String(b.text || "").trim()) return fail("conversation_id and text are required");
      const result = await send(String(b.conversation_id), "text", { text: { body: String(b.text).slice(0,4096), preview_url: b.preview_url === true } });
      return json({ success: true, ...result }, 201);
    }
    if (req.method === "POST" && path === "/send/template") {
      const b = await getBody(req);
      if (!b.conversation_id || !b.name || !b.language) return fail("conversation_id, name and language are required");
      const components = Array.isArray(b.components) ? b.components : [];
      const result = await send(String(b.conversation_id), "template", { template: { name: b.name, language: { code: b.language }, components } });
      return json({ success: true, ...result }, 201);
    }
    if (req.method === "POST" && path === "/send/media") {
      const b = await getBody(req);
      if (!b.conversation_id || !b.media_id || !["image","audio","video","document"].includes(b.type)) return fail("conversation_id, media_id and valid type are required");
      const rows = await db`select * from private.whatsapp_message_media where id=${String(b.media_id)}::uuid`;
      if (!rows[0]) return fail("Media not found", 404);
      const base = Deno.env.get("SUPABASE_URL") || "https://zyiavfljweavoxyyplxj.supabase.co";
      const link = `${base}/storage/v1/object/public/wa-media/${String(rows[0].storage_path).split("/").map(encodeURIComponent).join("/")}`;
      const media = { link, ...(b.caption ? { caption: String(b.caption) } : {}), ...(b.filename ? { filename: String(b.filename) } : {}) };
      const result = await send(String(b.conversation_id), String(b.type), { [String(b.type)]: media });
      return json({ success: true, ...result }, 201);
    }
    if (req.method === "POST" && path === "/media") {
      const b = await getBody(req);
      if (!b.conversation_id || !b.filename || !b.mime_type || !b.base64) return fail("conversation_id, filename, mime_type and base64 are required");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const base = Deno.env.get("SUPABASE_URL") || "https://zyiavfljweavoxyyplxj.supabase.co";
      if (!serviceKey) return fail("Storage service key is not configured", 503);
      const bytes = Uint8Array.from(atob(String(b.base64)), c => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 50 * 1024 * 1024) return fail("File must be between 1 byte and 50 MB", 413);
      const ext = String(b.filename).split(".").pop()?.replace(/[^a-zA-Z0-9]/g,"") || "bin";
      const storagePath = `${crypto.randomUUID()}.${ext}`;
      const upload = await fetch(`${base}/storage/v1/object/wa-media/${storagePath}`, {
        method: "POST", headers: { authorization: `Bearer ${serviceKey}`, apikey: serviceKey, "content-type": String(b.mime_type), "x-upsert": "false" }, body: bytes
      });
      if (!upload.ok) return fail(`Storage upload failed: ${(await upload.text()).slice(0,300)}`, 502);
      const conv = await db`select c.id,c.account_id,c.contact_id from private.whatsapp_conversations c where c.id=${String(b.conversation_id)}::uuid`;
      if (!conv[0]) return fail("Conversation not found", 404);
      const type = ["image","audio","video"].includes(String(b.type)) ? String(b.type) : "document";
      const msg = await db`insert into private.whatsapp_messages (account_id,conversation_id,contact_id,direction,message_type,content,internal_status)
        values (${conv[0].account_id},${conv[0].id},${conv[0].contact_id},'outbound',${type},${db.json({filename:b.filename,mime_type:b.mime_type})},'queued') returning id`;
      const mediaRows = await db`insert into private.whatsapp_message_media (message_id,storage_bucket,storage_path,mime_type,size_bytes)
        values (${msg[0].id},'wa-media',${storagePath},${String(b.mime_type)},${bytes.length}) returning *`;
      const publicUrl = `${base}/storage/v1/object/public/wa-media/${storagePath}`;
      return json({ data: mediaRows[0], public_url: publicUrl }, 201);
    }
    if (parts[0] === "media" && parts[1] && req.method === "GET") {
      const rows = await db`select * from private.whatsapp_message_media where id=${parts[1]}::uuid`;
      if (!rows[0]) return fail("Media not found", 404);
      const base = Deno.env.get("SUPABASE_URL") || "https://zyiavfljweavoxyyplxj.supabase.co";
      return json({ data: rows[0], public_url: `${base}/storage/v1/object/public/wa-media/${rows[0].storage_path}` });
    }
    return fail("Route not found", 404);
  } catch (error) {
    console.error("whatsapp-api", error);
    return fail(error instanceof Error ? error.message : "Internal error", 500);
  }
});
