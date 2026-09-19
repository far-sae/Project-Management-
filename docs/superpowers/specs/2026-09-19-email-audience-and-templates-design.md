# Email phase 5: prospects, groups, templates, the editor and the chart

**Date:** 2026-09-19
**Status:** Approved, ready for implementation plan
**Builds on:** phases 1–4
**Reference:** `far-sae/outreach-pilot-dash`, re-read for this phase

## Problem

Phases 1–4 built the sending half of an outreach tool and nothing of the
writing half. Compared with the reference implementation, five things are
missing, and they are the five a user touches every day:

| Reference | TaskCalendar today |
|---|---|
| **Prospects** — a managed list of people to write to | recipients pulled from `crm_contacts` or pasted as CSV, with no screen to see or fix them |
| **Groups** — named segments, each with a messaging *angle* | nothing |
| **Templates** — reusable subject + body, with per-template stats | every campaign is written from scratch |
| **Rich text editor** | a `<textarea>` in which the user types raw HTML |
| **Campaign chart** | numbers in a row |

The last one is the most telling. The product asks somebody doing cold
outreach to hand-write `<p>` tags.

## Goal

The writing half: manage who you are writing to, reuse what works, and write
it in an editor rather than in markup.

## Decisions taken

| Question | Decision |
|---|---|
| Where prospects live | `crm_contacts`, which already exists. **No second contact table.** |
| Who owns "do not mail" | `email_suppressions`, as today. Not duplicated onto the contact. |
| Groups | A new `email_groups` table; a contact belongs to at most one. |
| Templates | A new `email_templates` table; campaigns record which one they came from. |
| Editor | `contentEditable` with a toolbar, as the reference does. No new dependency. |
| Chart | The app's existing `recharts` dashboard components. Nothing new. |
| Prospect status | Derived from the suppression list, never stored on the contact. |

### Prospects are the contacts that are already there

`crm_contacts` carries `organization_id`, `first_name`, `last_name`, `email`,
`phone`, `job_title`, `company_id`, `source`, `notes` and
`last_contacted_at` — a superset of the reference's `prospects` table bar two
fields. `email_messages.contact_id` already points at it, and
`RecipientPicker` already reads it.

It also has no screen. The CRM hub was removed in migration 143 and took the
contact management UI with it, leaving the rows in place and unreachable. So
the Prospects screen is not a new store; it is the screen those rows lost.

Building a second table would mean two places to fix somebody's email address
and two answers to "who did we write to", which is the kind of split that
quietly ruins a list.

Two columns are added: `pain_point` (the reference has it, and it is the
merge field that makes a cold email land) and `group_id`.

**Status is not one of them.** The reference stores `active | unsubscribed` on
the prospect. Here, `email_suppressions` already decides who may be mailed,
the claim enforces it, the unsubscribe endpoint writes it and a bounce adds to
it. A second flag on the contact would disagree with it within a week. The
Prospects screen shows suppression state by reading that table, and says which
of the three reasons it was.

### Groups carry an angle, not just a name

`email_groups`: `name`, plus `angle` — a sentence describing how this segment
is approached. The reference has this and it is the more useful half: a group
called "Agencies" says nothing, "Agencies — lead with the white-label
workflow" is the thing a person needs in front of them while writing.

The angle is available as `{{angle}}` in a template, so a single template can
serve several groups.

A contact belongs to at most one group (`crm_contacts.group_id`, nullable,
`on delete set null`). Many-to-many was considered and dropped: it doubles the
UI and nobody sending cold email needs a prospect in two segments with two
conflicting angles.

### Templates, and stats that mean something

`email_templates`: `name`, `subject`, `body_html`.

`email_campaigns` gains `template_id` (nullable, `on delete set null`) — so a
campaign remembers where its wording came from after the template is edited or
deleted, and a template's stats are the sum over the campaigns that used it.

Stats per template: campaigns sent, messages sent, opened (with the automatic
count kept separate, as phase 4 established), replied, bounced. All of them
sum columns that already exist on `email_campaigns`, so there is no new
counting path to get wrong — and nothing is attributed to a template
retroactively, because `template_id` is stamped when the campaign is created.

Editing a template does **not** change any campaign already created from it.
A campaign carries its own subject and body; the template is where it came
from, not where it lives.

### The editor

`contentEditable` with a toolbar: bold, italic, underline, ordered and
unordered lists, link, image by URL, clear formatting, undo and redo. That is
the reference's set and it is the right set — an email body that needs more
than this is one that will render badly in Outlook anyway.

Three things it must get right, none of which are about the toolbar:

1. **`{{placeholder}}` text survives editing.** The substitution in
   `src/lib/email/substitute.ts` matches on the literal braces, and a browser
   that splits `{{first_name}}` across two spans with a stray `<b>` in the
   middle breaks it silently — the recipient gets `{{first_name}}` in their
   inbox. The editor inserts placeholders as plain text and the toolbar never
   wraps a partial placeholder.
2. **The output is the stored `body_html`.** No separate document model, no
   serialisation step that can drift from what was typed.
3. **Pasting is plain text by default.** Pasting from Word carries a kilobyte
   of `mso-` styles that some filters score as spam and every client renders
   differently.

The Compose screen keeps a way to see and edit the raw HTML, for the user who
wants it and for debugging what a template actually contains.

### The chart

On the Campaigns tab: sent, opened, replied and bounced for the last ten
campaigns, as the app's existing dashboard components draw everything else.
Opens keep phase 4's separation — the automatic ones are their own series and
are not folded into the opened line.

No new dependency: `recharts` is already in the project, and
`src/components/dashboards/` already holds the wrappers the rest of the app
uses.

## State

```
email_groups     (id, organization_id, workspace_id, name, angle, created_at)
email_templates  (id, organization_id, workspace_id, created_by, name,
                  subject, body_html, created_at, updated_at)
crm_contacts     + pain_point text, + group_id uuid -> email_groups
email_campaigns  + template_id uuid -> email_templates
```

RLS on both new tables follows the email tables exactly: read and write for
organization members.

## Testing

Pure, no network:

1. `templateStats(campaigns)` — summing across campaigns, a template with
   none, and the automatic opens staying separate.
2. `sanitizePastedHtml(html)` — Word markup stripped to text, a plain paste
   unchanged, and a `{{placeholder}}` surviving both.
3. `placeholdersIntact(html)` — a whole placeholder passes; one split by a
   tag is reported, which is what the editor guards against.

Against a stubbed database:

4. A prospect saved with a group and a pain point reads back with both.
5. A suppressed prospect shows as suppressed with its reason, and nothing
   writes a status onto the contact.
6. A campaign created from a template records `template_id`; editing that
   template afterwards leaves the campaign's own wording untouched.

## Out of scope

- Many-to-many groups.
- Template folders, sharing between organizations, or version history.
- Importing prospects from anywhere but CSV, which Compose already does.
- Re-creating the rest of the CRM hub removed in migration 143. This is the
  contact list an outreach tool needs, not the CRM coming back.
