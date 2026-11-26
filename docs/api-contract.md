# Public API Contract V1

Base URL: `/functions/v1/whatsapp-api`

| Resource | Method | Path |
|---|---|---|
| Contacts | GET, POST | `/contacts` |
| Contact | GET, PATCH, DELETE | `/contacts/:id` |
| Conversations | GET | `/conversations` |
| Conversation | GET, PATCH | `/conversations/:id` |
| Messages | GET | `/conversations/:id/messages` |
| Send text | POST | `/send/text` |
| Send template | POST | `/send/template` |
| Send media | POST | `/send/media` |
| Templates | GET | `/templates` |
| Media | POST | `/media` |
| Media record | GET | `/media/:id` |

All app routes are callable without user login or user API key. Meta webhook handshake uses its dedicated verification token and is not user authentication.
