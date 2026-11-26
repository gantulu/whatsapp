GRANT USAGE ON SCHEMA private TO anon;
GRANT SELECT ON private.whatsapp_accounts,private.whatsapp_contacts,private.whatsapp_conversations,private.whatsapp_messages,private.whatsapp_templates,private.whatsapp_message_media TO anon;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['whatsapp_accounts','whatsapp_contacts','whatsapp_conversations','whatsapp_messages','whatsapp_templates','whatsapp_message_media'] LOOP
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='private' AND tablename=t AND policyname='whatsapp_public_read') THEN
   EXECUTE format('CREATE POLICY whatsapp_public_read ON private.%I FOR SELECT TO anon USING (true)',t);
  END IF;
 END LOOP;
END $$;