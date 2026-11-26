# WhatsApp Custom

Single-number WhatsApp Cloud API inbox built with Vanilla JavaScript and Supabase.

## Architecture
- Frontend: static HTML, CSS, Vanilla JavaScript modules.
- Runtime: Supabase Edge Functions.
- Database: PostgreSQL schema `private`, tables prefixed `whatsapp_`.
- Live updates: Supabase Realtime.
- Media: public Supabase Storage bucket `wa-media`.
- Meta connection: manual configuration of Edge Function secrets and webhook settings.

## Local development
Serve the repository root with any static HTTP server. Copy `.env.example` to your local configuration and fill the public Supabase URL and publishable key. Never put the Meta access token or database connection string in browser code.

## Deployment
Deploy the three Edge Functions from `supabase/functions`. Apply migrations in filename order. See `docs/deployment.md`.

## Access model
The application API is intentionally public and has no user login, Supabase Auth, roles, or end-user API key. This is an explicit product decision. The Meta webhook verification token is only for Meta's webhook handshake.
