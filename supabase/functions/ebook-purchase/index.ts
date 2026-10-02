// Authenticated order creation and PortOne verification. Buyer identity always
// comes from getUser(token), never from browser/customer/customData fields.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';
import { createPaymentHandler } from './handler.ts';
import { lookupPayment, portoneConfigured, PORTONE_STORE_ID } from '../_shared/portone.ts';

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(createPaymentHandler({
  admin, lookupPayment, configured: portoneConfigured, storeId: PORTONE_STORE_ID,
  randomUUID: () => crypto.randomUUID(),
}));
