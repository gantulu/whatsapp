# Deployment

## Supabase

Project: `zyiavfljweavoxyyplxj` (`ap-southeast-2`). Edge Functions:
- `whatsapp-api` v3 — public application API (`verify_jwt=false`)
- `whatsapp-webhook` — Meta callback (`verify_jwt=false`, verifies Meta handshake token)
- `whatsapp-send-messages` — public compatibility proxy (`verify_jwt=false`)

Required Edge Function environment values:
- `SUPABASE_DB_URL`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-side Storage upload)
- `META_WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET` (optional webhook signature validation)

Never put the database URL, service role key, Meta token, or webhook verification token in browser code or GitHub.

## Meta manual setup

Set the callback URL to:
`https://zyiavfljweavoxyyplxj.supabase.co/functions/v1/whatsapp-webhook`

Use the exact `WHATSAPP_VERIFY_TOKEN` value configured in Edge Function secrets as the Meta verification token, then subscribe the WhatsApp webhook to the `messages` field. An inbound webhook creates/updates the WhatsApp account, contact, conversation and message records.

## Frontend

The frontend is static Vanilla JavaScript. The public Supabase publishable key is configured in `src/config.js`; it identifies the project but does not create an application user session. Serve the repository root with a static HTTP server or a static hosting provider.

## Cutover

`whatsapp-api` and the updated frontend are deployed. The old `wa-api` endpoint remains active temporarily as a rollback path until a live API request and Meta webhook test are completed. Retire it only after those checks pass.
