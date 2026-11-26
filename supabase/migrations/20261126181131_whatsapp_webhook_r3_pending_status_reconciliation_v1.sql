ALTER TABLE private.whatsapp_messages
ADD COLUMN provider_status_timestamp timestamptz;

COMMENT ON COLUMN private.whatsapp_messages.provider_status_timestamp
IS 'Latest provider status event timestamp applied from Meta WhatsApp Cloud API.';

CREATE TABLE private.whatsapp_pending_message_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES private.whatsapp_accounts(id) ON DELETE RESTRICT,
  provider_message_id text NOT NULL CHECK (length(btrim(provider_message_id)) > 0),
  provider_status text NOT NULL CHECK (length(btrim(provider_status)) > 0),
  provider_timestamp timestamptz,
  status_event_key text NOT NULL CHECK (length(btrim(status_event_key)) > 0),
  raw_payload jsonb NOT NULL CHECK (jsonb_typeof(raw_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  processing_error text,
  CONSTRAINT wa_pending_statuses_account_event_uidx UNIQUE (account_id, status_event_key)
);

CREATE INDEX wa_pending_statuses_message_order_idx
ON private.whatsapp_pending_message_statuses
(account_id, provider_message_id, provider_timestamp, created_at);

CREATE INDEX wa_pending_statuses_unprocessed_idx
ON private.whatsapp_pending_message_statuses (created_at)
WHERE processed_at IS NULL;

ALTER TABLE private.whatsapp_pending_message_statuses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE private.whatsapp_pending_message_statuses FROM PUBLIC, anon, authenticated;
