-- Billing Phase 2: a tokenized public view of an invoice (hosted page + email link).
-- Re-runnable.

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS public_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

-- Backfill any pre-existing rows that somehow lack a token (defensive; the
-- DEFAULT covers new rows and the ADD COLUMN populates existing ones).
UPDATE public.invoices SET public_token = gen_random_uuid() WHERE public_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_public_token ON public.invoices (public_token);

-- Public, unauthenticated, read-only view of a single non-void invoice by token.
-- SECURITY DEFINER so it bypasses RLS, but it ONLY returns the fields needed to
-- render the hosted page and ONLY for non-void invoices.
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_token uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'invoice_number', i.invoice_number,
    'status', i.status,
    'currency', i.currency,
    'subtotal', i.subtotal,
    'tax_rate', i.tax_rate,
    'tax_amount', i.tax_amount,
    'discount', i.discount,
    'total', i.total,
    'amount_paid', i.amount_paid,
    'line_items', i.line_items,
    'notes', i.notes,
    'terms', i.terms,
    'issued_at', i.issued_at,
    'due_at', i.due_at,
    'org_name', o.name,
    'client_name', c.name
  )
  FROM public.invoices i
  JOIN public.organizations o ON o.organization_id = i.organization_id
  LEFT JOIN public.clients c ON c.client_id = i.client_id
  WHERE i.public_token = p_token
    AND i.status <> 'void'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_invoice(uuid) TO anon, authenticated;
