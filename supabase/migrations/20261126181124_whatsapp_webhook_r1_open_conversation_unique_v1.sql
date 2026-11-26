CREATE UNIQUE INDEX wa_conversations_one_open_per_contact_uidx
ON private.whatsapp_conversations (account_id, contact_id)
WHERE status = 'open';
