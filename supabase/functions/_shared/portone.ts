export const PORTONE_STORE_ID = 'store-4c794b21-bbaa-466c-8fa9-17f42db08940';

const API_SECRET = Deno.env.get('PORTONE_API_SECRET') || '';
const TIMEOUT_MS = 12_000;

export function portoneConfigured(): boolean {
  return !!API_SECRET;
}

export async function lookupPayment(paymentId: string): Promise<{ status: number; payment: any }> {
  if (!API_SECRET) return { status: 0, payment: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.portone.io/payments/${encodeURIComponent(paymentId)}`, {
      signal: controller.signal,
      headers: { Authorization: `PortOne ${API_SECRET}` },
    });
    return { status: res.status, payment: await res.json().catch(() => null) };
  } catch {
    return { status: 0, payment: null };
  } finally {
    clearTimeout(timeout);
  }
}
