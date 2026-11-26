const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
};
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers:{...cors,"content-type":"application/json"}});
  const base = Deno.env.get("SUPABASE_URL");
  if (!base) return new Response(JSON.stringify({error:"SUPABASE_URL is not configured"}),{status:503,headers:{...cors,"content-type":"application/json"}});
  const body = await req.text();
  const response = await fetch(`${base}/functions/v1/whatsapp-api/send/text`, {
    method:"POST", headers:{"content-type":"application/json"}, body
  });
  return new Response(await response.text(), { status:response.status, headers:{...cors,"content-type":response.headers.get("content-type") || "application/json"} });
});
