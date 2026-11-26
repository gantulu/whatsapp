ALTER TABLE private.whatsapp_webhook_events
  DROP CONSTRAINT wa_webhook_events_processing_status_check;

ALTER TABLE private.whatsapp_webhook_events
  ADD CONSTRAINT wa_webhook_events_processing_status_check
  CHECK (
    processing_status = ANY (
      ARRAY[
        'received'::text,
        'queued'::text,
        'processing'::text,
        'processed'::text,
        'failed'::text,
        'dead_letter'::text,
        'unsupported'::text
      ]
    )
  );
