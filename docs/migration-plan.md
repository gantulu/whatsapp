# Migration Plan V1

Apply in order. All changes are scoped to WhatsApp objects in schema `private` and bucket `wa-media`; do not touch unrelated application schemas or buckets.

1. `whatsapp_rename_tables_v1`
2. `whatsapp_rename_functions_v1`
3. `whatsapp_public_api_v1`
4. `whatsapp_realtime_v1`
5. `whatsapp_storage_v1`
6. `whatsapp_webhook_persistence_v1`
7. `whatsapp_message_status_v1`
8. `whatsapp_api_compatibility_v1`

Each database migration is verified before proceeding to the next.
