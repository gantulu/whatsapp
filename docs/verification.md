# Verification Status

## Verified from Supabase management/database state

- [x] Project is `ACTIVE_HEALTHY` on PostgreSQL 17.
- [x] Nine WhatsApp tables renamed to `whatsapp_*` in schema `private`; RLS remains enabled.
- [x] Three legacy database functions renamed to `whatsapp_api_*` and their bodies reference renamed tables.
- [x] All nine applied WhatsApp migrations appear in Supabase migration history.
- [x] Eight WhatsApp tables are in `supabase_realtime` publication.
- [x] Public read grants/policies exist for accounts, contacts, conversations, messages, templates and message media.
- [x] Public `wa-media` Storage bucket and four public object policies exist.
- [x] `whatsapp-api` v2, `whatsapp-webhook` v4 and `whatsapp-send-messages` v3 are ACTIVE with `verify_jwt=false`.
- [x] Frontend is configured for the project publishable key, API endpoint and Realtime subscription.

## Not yet verified end-to-end

- [ ] Live HTTP request to `/conversations` and CRUD routes.
- [ ] Meta webhook verification handshake and real inbound message delivery.
- [ ] Outbound text/template/media send against the configured Meta number.
- [ ] Realtime event delivery from a browser session.
- [ ] Storage upload/read from the browser.

No WhatsApp account/contact/message rows existed at implementation start. A Meta inbound event is expected to provision the account/contact/conversation records. Required Edge Function secret values and Meta dashboard callback configuration were not read or changed during this run.

The legacy `wa-api` function remains active temporarily as rollback until end-to-end verification passes.
