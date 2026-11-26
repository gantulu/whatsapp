# Database Schema

The existing nine tables remain in PostgreSQL schema `private` and are renamed:

- whatsapp_accounts
- whatsapp_contacts
- whatsapp_contact_consents
- whatsapp_conversations
- whatsapp_api_keys (retained for legacy compatibility, not used for app-user authentication)
- whatsapp_messages
- whatsapp_templates
- whatsapp_webhook_events
- whatsapp_message_media

Existing columns, constraints, indexes, foreign keys and RLS state are preserved during table renames.
