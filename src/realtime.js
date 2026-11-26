import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { config } from "./config.js";

const client = createClient(config.supabaseUrl, config.publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
export function subscribeToInbox(onChange) {
  const channel = client.channel("whatsapp-inbox-public")
    .on("postgres_changes", { event: "*", schema: "private", table: "whatsapp_messages" }, onChange)
    .on("postgres_changes", { event: "*", schema: "private", table: "whatsapp_conversations" }, onChange)
    .on("postgres_changes", { event: "*", schema: "private", table: "whatsapp_contacts" }, onChange)
    .subscribe();
  return () => client.removeChannel(channel);
}
