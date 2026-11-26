# Migration Plan V1

Applied to Supabase project `zyiavfljweavoxyyplxj` in this exact order. The nine migrations are tracked in Supabase migration history and the matching timestamped SQL files are committed under `supabase/migrations/`.

1. `20261126160956_whatsapp_rename_tables_v1`
2. `20261126161017_whatsapp_rename_functions_v1`
3. `20261126161043_whatsapp_public_api_v1`
4. `20261126161046_whatsapp_realtime_v1`
5. `20261126161048_whatsapp_storage_v1`
6. `20261126161051_whatsapp_webhook_persistence_v1`
7. `20261126161054_whatsapp_message_status_v1`
8. `20261126161056_whatsapp_api_compatibility_v1`
9. `20261126161625_whatsapp_realtime_public_read_v1`

Scope is limited to WhatsApp objects in schema `private` and bucket `wa-media`. Existing non-WhatsApp schemas and buckets are not modified.
