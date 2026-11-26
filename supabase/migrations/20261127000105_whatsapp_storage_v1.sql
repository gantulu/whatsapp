INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
VALUES ('wa-media','wa-media',true,52428800,ARRAY['image/jpeg','image/png','image/webp','image/gif','audio/aac','audio/mp4','audio/mpeg','audio/ogg','video/mp4','application/pdf','text/plain'])
ON CONFLICT (id) DO UPDATE SET public=true,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='whatsapp_media_public_read') THEN CREATE POLICY whatsapp_media_public_read ON storage.objects FOR SELECT TO public USING (bucket_id='wa-media'); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='whatsapp_media_public_insert') THEN CREATE POLICY whatsapp_media_public_insert ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id='wa-media'); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='whatsapp_media_public_update') THEN CREATE POLICY whatsapp_media_public_update ON storage.objects FOR UPDATE TO public USING (bucket_id='wa-media') WITH CHECK (bucket_id='wa-media'); END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='whatsapp_media_public_delete') THEN CREATE POLICY whatsapp_media_public_delete ON storage.objects FOR DELETE TO public USING (bucket_id='wa-media'); END IF;
END $$;