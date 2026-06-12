# Freeform custom items, rail edit/delete, remove hub card + category filters

**Date:** 2026-06-12
**Status:** Approved
**Branch:** `crm-custom-fields-cleanup` (off `main`)

No migration — `deals.customFields` jsonb + `deleteDeal` already exist; rest is UI removal.

## A — Custom item dialog = truly freeform — img 1
`src/components/deals/CustomItemDialog.tsx`:
- **Remove the Stage `<Select>`.** Custom items are not bound to pipeline stages. The stored deal still needs a stage value for the table — default it internally to the first stage (e.g. `'lead'`) WITHOUT showing the field. Keep Title (required) + Value + Currency.
- **Richer custom fields:** replace the plain CustomPropertiesEditor here with an enhanced builder (`src/components/deals/CustomFieldsBuilder.tsx`, new) where each field the user adds has: a **label**, a **type** — `text | number | date | dropdown | checkbox` — for **dropdown** the user enters their **own options** (comma-separated or add-option rows) and picks a value; and a **value** input matching the type. Persist as `customFields._fields = [{ id, label, type, options?, value }]` (self-contained; other code that reads `deal.customFields` is unaffected). On edit, rebuild the builder from `_fields`. So users define whatever fields + dropdowns they want.

## B — Pipeline deals: edit + delete from the rail
In the right-rail pipeline of `ClientDetailDrawer` + `LeadDetailDrawer`, each deal row gets, alongside the stage control: an **Edit** action (standard deal → `DealFormDialog`; `dealType==='custom'` → `CustomItemDialog` in edit mode) and a **Delete** action (`deleteDeal` via `useDeals().remove`, with a confirm). Refresh the rail after edit/delete. (Stage dropdown stays for standard deals; for custom items, no stage control — just Edit/Delete + value.)

## C — Remove the Accounts hub card — img 2
In `src/pages/Clients.tsx` Accounts tab, remove the `<AccountsHubCard>` ("Choose what you want to do next" / Add one account / Import / Track sales / Follow up) entirely + its now-unused import/props. Keep the Accounts list + "Add account"/header actions.

## D — Remove category filter + group-by-category — img 3
In the Accounts list toolbar (`Clients.tsx` / the accounts list/table component), remove the **"All categories"** filter `<Select>` and the **"Group by category"** toggle button (+ their state/handlers). Keep search + type/status/score filters + the view toggle. (Categories/leads-by-category were removed earlier, so these are vestigial.) Clean unused symbols.

## Testing / verification
- `npm run build` + `npm run test` green.
- Manual: custom item dialog has no Stage, and Add property lets you make a dropdown with your own options (+ text/number/date/checkbox); a created custom item still shows in the pipeline with its value + Custom badge and re-opens with its fields. Standard deals can be edited + deleted from the rail. The "Choose what you want to do next" card is gone; the Accounts list has no category filter or Group-by-category.

## Self-review
A keeps custom items as deals (default stage hidden) but makes the fields fully user-defined incl. dropdowns, persisted under `customFields._fields` so nothing else breaks. B reuses DealFormDialog/CustomItemDialog/deleteDeal. C/D are removals with unused-symbol cleanup. No new tables.
