# Architecture V1

- One WhatsApp Cloud API number; manual Meta setup.
- Vanilla JavaScript frontend.
- Supabase PostgreSQL private schema, Edge Functions, Realtime and Storage.
- Public app endpoints: no user login, Supabase Auth, role checks, or end-user API-key.
- Server-side secrets (Meta token and database URL) stay in Edge Function environment.
- Prefixes: tables/functions `whatsapp_`; Edge Functions `whatsapp-`.
- `wa-api` is replaced by deploying `whatsapp-api`, validating it, then retiring the old function.
