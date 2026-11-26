DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['whatsapp_accounts','whatsapp_contacts','whatsapp_contact_consents','whatsapp_conversations','whatsapp_messages','whatsapp_templates','whatsapp_webhook_events','whatsapp_message_media'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='private' AND tablename=t) THEN
   EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE private.%I',t);
  END IF;
 END LOOP;
END $$;