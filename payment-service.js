import crypto from 'node:crypto';

export const TEST_ORDER = Object.freeze({
  name: 'Test Cake Order',
  description: 'Payment test',
  amount: 5000,
  currency: 'NGN',
});

const terminalStates = new Set(['paid', 'failed', 'cancelled']);

export function normalizeStatus(status) {
  const value = String(status || '').toUpperCase();
  if (['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED'].includes(value)) return 'paid';
  if (['FAILED', 'FAILURE', 'DECLINED'].includes(value)) return 'failed';
  if (['CANCELLED', 'CANCELED', 'ABANDONED'].includes(value)) return 'cancelled';
  return 'pending';
}

export function isValidPaidTransaction(transaction) {
  const amount = Number(transaction.amount ?? transaction.data?.amount);
  const currency = String(transaction.currency ?? transaction.data?.currency ?? '').toUpperCase();
  return normalizeStatus(transaction.status ?? transaction.data?.status) === 'paid'
    && amount === TEST_ORDER.amount
    && currency === TEST_ORDER.currency;
}

export function extractCheckoutUrl(payload) {
  return payload.checkout_url || payload.checkoutUrl || payload.authorization_url
    || payload.data?.checkout_url || payload.data?.checkoutUrl || payload.data?.authorization_url;
}

export function extractReference(payload) {
  return payload.reference || payload.transaction_reference || payload.data?.reference
    || payload.data?.transaction_reference || payload.data?.id;
}

function bachsUrl(path, reference) {
  const base = process.env.BACHS_API_BASE_URL;
  if (!base) throw new Error('BACHS_API_BASE_URL is not configured.');
  const configured = path.replace('{reference}', encodeURIComponent(reference));
  return new URL(configured, base).toString();
}

async function bachsRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.message || body.error || `Bachs API returned HTTP ${response.status}.`);
  }
  return body;
}

export async function initializeBachsPayment(reference, callbackUrl) {
  if (!process.env.BACHS_SECRET_KEY) throw new Error('BACHS_SECRET_KEY is not configured.');
  const payload = {
    amount: TEST_ORDER.amount,
    currency: TEST_ORDER.currency,
    reference,
    callback_url: callbackUrl,
    metadata: { order_name: TEST_ORDER.name, description: TEST_ORDER.description, test_checkout: true },
  };
  const result = await bachsRequest(bachsUrl(process.env.BACHS_INITIALIZE_PATH || '/v1/transactions/initialize'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.BACHS_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const checkoutUrl = extractCheckoutUrl(result);
  if (!checkoutUrl) throw new Error('Bachs did not return a hosted checkout URL.');
  return { reference: extractReference(result) || reference, checkoutUrl };
}

export async function verifyBachsPayment(reference) {
  if (!process.env.BACHS_SECRET_KEY) throw new Error('BACHS_SECRET_KEY is not configured.');
  const response = await bachsRequest(bachsUrl(process.env.BACHS_VERIFY_PATH || '/v1/transactions/verify/{reference}', reference), {
    headers: { Authorization: `Bearer ${process.env.BACHS_SECRET_KEY}`, Accept: 'application/json' },
  });
  const transaction = response.data || response;
  return {
    raw: transaction,
    providerReference: extractReference(response) || reference,
    status: isValidPaidTransaction(transaction) ? 'paid' : normalizeStatus(transaction.status),
    amountMatches: Number(transaction.amount) === TEST_ORDER.amount,
    currencyMatches: String(transaction.currency || '').toUpperCase() === TEST_ORDER.currency,
  };
}

export function validWebhookSignature(rawBody, signature) {
  const secret = process.env.BACHS_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return typeof signature === 'string' && signature.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function canTransition(current, next) {
  return !terminalStates.has(current) || current === next;
}
