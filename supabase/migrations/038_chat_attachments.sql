-- Chat attachments
--
-- Add an `attachments` JSONB column to project chat + direct messages so users
-- can attach files (images, PDFs, etc.). The column stores a small array of
-- {fileName, fileUrl, fileType, fileSize} so we never have to JOIN to the
-- `files` table just to render a chat message.

alter table public.project_chat_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.direct_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Allow blank body when at least one attachment is present. The original
-- schema used `body text not null`; we relax it to allow file-only messages.
alter table public.project_chat_messages
  alter column body drop not null;

alter table public.direct_messages
  alter column body drop not null;
