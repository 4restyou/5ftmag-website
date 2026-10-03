-- R03: server-issued payment IDs are permanently bound before opening PortOne.
-- Do not backfill unused legacy IDs: no trusted buyer evidence exists for them.
CREATE TABLE IF NOT EXISTS public.ebook_checkout_orders (
  payment_id text PRIMARY KEY CHECK (payment_id ~ '^eb_[0-9a-f-]{36}$'),
  buyer_id uuid NOT NULL REFERENCES auth.users(id),
  product_id uuid NOT NULL REFERENCES public.ebook_products(id),
  slug text NOT NULL CHECK (slug <> ''),
  title text NOT NULL,
  price integer NOT NULL CHECK (price > 0),
  currency text NOT NULL CHECK (currency = 'KRW'),
  store_id text NOT NULL CHECK (store_id <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ebook_checkout_orders ENABLE ROW LEVEL SECURITY;
-- No public/editor policies: even editors cannot bind a receipt via PostgREST.
REVOKE ALL ON public.ebook_checkout_orders FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.ebook_checkout_orders TO service_role;

CREATE OR REPLACE FUNCTION public.ebook_checkout_orders_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'checkout orders are immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS ebook_checkout_orders_immutable ON public.ebook_checkout_orders;
CREATE TRIGGER ebook_checkout_orders_immutable
  BEFORE UPDATE OR DELETE ON public.ebook_checkout_orders
  FOR EACH ROW EXECUTE FUNCTION public.ebook_checkout_orders_immutable();
REVOKE ALL ON FUNCTION public.ebook_checkout_orders_immutable() FROM PUBLIC, anon, authenticated;

-- Only the authenticated Edge Function, after a fresh PAID lookup, may call this.
-- The order ledger retains ownership even when a revoked entitlement is replaced
-- by a later purchase and no longer refers to the earlier payment ID.
CREATE OR REPLACE FUNCTION public.grant_ebook_checkout_order(p_payment_id text, p_buyer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  checkout public.ebook_checkout_orders%ROWTYPE;
  granted uuid;
BEGIN
  SELECT * INTO checkout FROM public.ebook_checkout_orders WHERE payment_id = p_payment_id;
  IF NOT FOUND OR checkout.buyer_id IS DISTINCT FROM p_buyer_id THEN
    RAISE EXCEPTION 'checkout owner mismatch' USING ERRCODE = '42501';
  END IF;

  -- Serialize retries and different orders for this buyer/product. The unique
  -- constraint and conditional upsert also protect concurrent non-RPC grants.
  PERFORM pg_advisory_xact_lock(hashtextextended(checkout.buyer_id::text || ':' || checkout.product_id::text, 0));
  IF EXISTS (
    SELECT 1 FROM public.ebook_entitlements
    WHERE order_ref = p_payment_id AND source IN ('portone', 'smartstore')
      AND (user_id <> checkout.buyer_id OR product_id <> checkout.product_id)
  ) THEN
    RAISE EXCEPTION 'payment already used' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.ebook_entitlements AS entitlement
    (user_id, product_id, source, order_ref, status, last_verified_at, external_status, revoked_at, revoke_reason)
  VALUES
    (checkout.buyer_id, checkout.product_id, 'portone', checkout.payment_id, 'active', now(), 'PAID', NULL, '')
  ON CONFLICT (user_id, product_id) DO UPDATE SET
    source = EXCLUDED.source, order_ref = EXCLUDED.order_ref, status = 'active',
    last_verified_at = EXCLUDED.last_verified_at, external_status = EXCLUDED.external_status,
    revoked_at = NULL, revoke_reason = ''
  WHERE entitlement.status = 'revoked'
  RETURNING id INTO granted;

  RETURN jsonb_build_object('ok', true, 'already', granted IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.grant_ebook_checkout_order(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_ebook_checkout_order(text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
