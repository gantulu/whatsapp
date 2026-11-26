# Deployment

1. Apply migrations in lexical order to Supabase project `zyiavfljweavoxyyplxj`.
2. Configure Edge Function secrets: `META_WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `SUPABASE_DB_URL`, and `META_APP_SECRET` when webhook signature verification is enabled.
3. Deploy `whatsapp-api`, `whatsapp-webhook`, and `whatsapp-send-messages` with JWT verification disabled per the public API decision.
4. Verify webhook handshake and inbound/outbound persistence.
5. Verify Realtime and public media upload/read.
6. Switch frontend to `whatsapp-api`; only then retire `wa-api`.

Never commit secrets or place the database connection string in browser assets.
