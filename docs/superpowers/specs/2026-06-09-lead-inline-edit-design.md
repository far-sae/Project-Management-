# Lead detail: inline edit + per-lead custom properties (+ remove Contacts tab)

**Date:** 2026-06-09
**Status:** Approved (design)
**Branch:** `lead-inline-edit` (off `main`)

## Context

The lead detail panel (`LeadDetailDrawer`) is read-only; editing means opening a separate modal. The user wants modern, in-place editing right in the panel, plus the ability to add per-lead custom properties (the `leads.custom_fields` jsonb already exists but has no UI). They also want the standalone **Contacts** tab removed from the CRM.

## A. Inline-edit field component — `src/components/leads/InlineField.tsx` (new)

A reusable click-to-edit field:
- Props: `{ label, value, type?: 'text'|'number'|'textarea'|'date', editable: boolean, onSave: (next: string|number|null) => Promise<void> | void, render?: (v) => ReactNode, placeholder? }`.
- Read mode: renders the value (or a muted "—"/placeholder) with a subtle hover affordance (pencil) when `editable`.
- Edit mode (on click, only when `editable`): shows the matching input (`Input`/`Textarea`/`type=date`). **Enter** (or blur) saves, **Esc** cancels, a tiny spinner while saving; errors toast and revert. Number type coerces to number|null; empty → null.
- When `!editable`, it's plain read-only (viewers/members-without-edit are unaffected).

## B. Custom properties — helper + editor

- New pure util `src/lib/customFields.ts`: `setCustomField(fields, key, value)`, `removeCustomField(fields, key)`, `renameCustomField(fields, oldKey, newKey)` — all return a NEW object; `renameCustomField` is a no-op if `newKey` already exists or is blank. Unit-tested in `tests/unit/customFields.test.ts`.
- New `src/components/leads/CustomPropertiesEditor.tsx`:
  - Props: `{ fields: Record<string, unknown>, editable: boolean, onChange: (next: Record<string, unknown>) => Promise<void> | void }`.
  - Renders each entry as a row: property name (label) + value via an `InlineField` (saving a value calls `onChange(setCustomField(...))`), plus a remove (trash) button → `onChange(removeCustomField(...))`.
  - **"+ Add property"** (when `editable`): inline form with **name** input, a small **type** select (text / number / date — drives the value input + how it's stored: number→Number, date→ISO 'YYYY-MM-DD' string, text→string), and a **value** input. Add → `onChange(setCustomField(fields, name, value))`; blocks duplicate/blank names with a toast.
  - Empty state: a muted "No custom properties yet" + the Add button.

## C. Wire into `LeadDetailDrawer.tsx`

- Add `canEdit` (compute via `useOrganization().canEditModule('leads')`) and an `onUpdate(leadId, patch): Promise<Lead>` prop.
- Replace the read-only `<Field>` displays for editable lead fields with `<InlineField ... editable={canEdit} onSave={(v) => onUpdate(lead.leadId, { <field>: v })} />`. Map each field to its input type (annualRevenue/noOfEmployees → number; description → textarea; the rest → text). Keep the **status** dropdown and **owner** as-is (not InlineField for v1).
- Add a **"Custom properties"** section (near the details block) rendering `<CustomPropertiesEditor fields={lead.customFields} editable={canEdit} onChange={(next) => onUpdate(lead.leadId, { customFields: next })} />`.
- Keep the existing "Edit" modal button (full edit / create still useful).

## D. `src/pages/Clients.tsx` wiring + remove Contacts tab

- Pass `canEdit` + `onUpdate={(id, patch) => updateLead(...)}` (via `useLeads().update`) to `LeadDetailDrawer`; after a successful update, refresh the leads list and the currently-open lead object so the panel reflects saved values.
- **Remove the standalone Contacts tab:** delete its `TabsTrigger`, its tab `TabsContent`/panel (the `ContactsTable` + contacts landing), and the contacts-only state/handlers/imports that become unused (`selectedContact`, contacts list load, the contact `ContactDetailDrawer` mount, the contacts `onSendEmail` wiring). Remove `'contacts'` from the CRM tab type/union and any default-tab logic.
  - **Keep:** per-account contacts (contacts shown/created INSIDE an account drawer), the `contacts` service + `ContactDetailDrawer`/`ContactsTable` components in the codebase (may be reused by the account view), and the lead→client+contact conversion path. Only the top-level CRM **Contacts tab** is removed.
  - Clean up any now-unused imports so `tsc` stays clean.

## Non-goals
- No org-wide custom-field definitions (per-lead only). No changes to Accounts/Contacts detail editing (the same InlineField pattern can extend there later). No DB migration (`leads.custom_fields` already exists).

## Testing / verification
- `npm run test` — `customFields.test.ts` (set/remove/rename) green; full suite green.
- `npm run build` clean (no unused-symbol errors after the Contacts-tab removal).
- Manual: open a lead → click email/phone/company/etc. → edit inline → it saves and persists; add a custom property (text/number/date), edit its value, remove it — all persist; a viewer/member-without-edit sees read-only; the CRM no longer shows a Contacts tab, but opening an account still shows its contacts and lead conversion still creates a contact.

## Self-review
Inline editing reuses one small `InlineField` unit; custom properties are pure-helper-backed and tested; saves go through the existing `updateLead` (per-field patch / whole-customFields replace). The Contacts-tab removal is surgical (tab UI only) and explicitly preserves the contact data model + per-account usage so conversion and account records don't break.
