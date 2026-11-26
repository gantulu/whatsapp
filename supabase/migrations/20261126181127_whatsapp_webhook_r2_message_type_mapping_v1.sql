ALTER TABLE private.whatsapp_messages
DROP CONSTRAINT wa_messages_message_type_check;

ALTER TABLE private.whatsapp_messages
ADD CONSTRAINT wa_messages_message_type_check
CHECK (message_type = ANY (ARRAY[
  'text'::text,
  'image'::text,
  'audio'::text,
  'video'::text,
  'document'::text,
  'sticker'::text,
  'location'::text,
  'contacts'::text,
  'interactive'::text,
  'template'::text,
  'button'::text,
  'reaction'::text,
  'order'::text,
  'unsupported'::text
]));
