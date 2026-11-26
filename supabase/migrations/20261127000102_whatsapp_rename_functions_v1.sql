ALTER FUNCTION private.wa_api_authenticate(text, bytea) RENAME TO whatsapp_api_authenticate;
ALTER FUNCTION private.wa_api_prepare_text_send(uuid, text, text, text, text, text, text, text) RENAME TO whatsapp_api_prepare_text_send;
ALTER FUNCTION private.wa_api_finalize_text_send(uuid, text, text, text, text) RENAME TO whatsapp_api_finalize_text_send;

-- Function bodies were updated in-place to reference whatsapp_* tables.