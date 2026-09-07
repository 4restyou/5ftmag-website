-- Preserve entitlement history and let automatic grants follow the external
-- payment/order lifecycle. Active rows grant access; revoked rows remain as an
-- audit trail and can be reactivated by a later valid purchase.

ALTER TABLE public.ebook_entitlements
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_status text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoke_reason text NOT NULL DEFAULT '';

ALTER TABLE public.ebook_entitlements
  DROP CONSTRAINT IF EXISTS ebook_entitlements_status_check;
ALTER TABLE public.ebook_entitlements
  ADD CONSTRAINT ebook_entitlements_status_check
  CHECK (status IN ('active', 'revoked'));

CREATE INDEX IF NOT EXISTS idx_ebook_entitlements_active_user
  ON public.ebook_entitlements(user_id, product_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ebook_entitlements_auto_verify
  ON public.ebook_entitlements(last_verified_at)
  WHERE status = 'active' AND source IN ('portone', 'smartstore');

ALTER TABLE public.ebook_redeem_attempts
  ADD COLUMN IF NOT EXISTS ip_hash text;

CREATE INDEX IF NOT EXISTS ebook_redeem_attempts_ip_hash_idx
  ON public.ebook_redeem_attempts (ip_hash, created_at DESC);

-- Raw IPs were only used for throttling. Remove legacy values and stale attempts;
-- new writes store a keyed hash and are kept for at most 48 hours.
UPDATE public.ebook_redeem_attempts SET ip = NULL WHERE ip IS NOT NULL;
DELETE FROM public.ebook_redeem_attempts
  WHERE created_at < now() - interval '48 hours';
DROP INDEX IF EXISTS public.ebook_redeem_attempts_ip_idx;

-- A repurchase reactivates the existing user/product row, so treat that update
-- as a new sale for editor notifications without notifying on verification writes.
CREATE OR REPLACE FUNCTION public.notify_editors_ebook_sold()
RETURNS TRIGGER AS $$
DECLARE
  ed        RECORD;
  v_title   text;
  v_price   integer;
  v_channel text;
BEGIN
  IF NEW.source NOT IN ('portone', 'smartstore') OR NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NOT (OLD.status = 'revoked' AND NEW.status = 'active') THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT title, price INTO v_title, v_price
    FROM public.ebook_products WHERE id = NEW.product_id;
  v_channel := CASE NEW.source
                 WHEN 'portone' THEN '카카오페이'
                 WHEN 'smartstore' THEN '스마트스토어'
                 ELSE NEW.source
               END;

  FOR ed IN SELECT user_id FROM public.profiles WHERE is_editor = TRUE
  LOOP
    INSERT INTO public.user_notifications(user_id, type, related_id, title, body, link)
    VALUES (
      ed.user_id,
      'ebook_sold',
      NEW.product_id,
      '이북이 판매됐어요',
      COALESCE(v_title, '이북') || ' · ' || v_channel
        || COALESCE(' · ₩' || to_char(v_price, 'FM999,999,999'), ''),
      '/admin/analytics.html'
    );
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS notify_editors_ebook_sold ON public.ebook_entitlements;
CREATE TRIGGER notify_editors_ebook_sold
  AFTER INSERT OR UPDATE OF status ON public.ebook_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.notify_editors_ebook_sold();

REVOKE ALL ON FUNCTION public.notify_editors_ebook_sold() FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
