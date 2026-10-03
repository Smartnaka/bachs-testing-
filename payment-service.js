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
  if (['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED', 'SUCCEEDED'].includes(value)) return 'paid';
  if (['FAILED', 'FAILURE', 'DECLINED'].includes(value)) return 'failed';
  if (['CANCELLED', 'CANCELED', 'ABANDONED', 'EXPIRED'].includes(value)) return 'cancelled';
  return 'pending';
}

export function isValidPaidTransaction(transaction) {
  const amount = Number(transaction.amount ?? transaction.data?.amount);
  const currency = String(transaction.currency ?? transaction.data?.currency ?? '').toUpperCase();
  const paymentStatus = String(transaction.payment_status ?? transaction.data?.payment_status ?? '').toLowerCase();
  const status = normalizeStatus(transaction.status ?? transaction.data?.status);
  return (status === 'paid' || paymentStatus === 'succeeded')
    && amount === TEST_ORDER.amount
    && currency === TEST_ORDER.currency;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

export function extractCheckoutUrl(payload) {
  return firstString(
    payload.checkout_url,
    payload.checkoutUrl,
    payload.data?.checkout_url,
    payload.data?.checkoutUrl,
    payload.url,
    payload.data?.url,
  );
}

export function extractReference(payload) {
  return firstString(
    payload.reference,
    payload.transaction_reference,
    payload.data?.reference,
    payload.data?.transaction_reference,
    payload.data?.id,
  );
}

function normalizeCheckoutUrl(value) {
  if (!value) throw new Error('Bachs did not return a hosted checkout URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('Bachs returned an invalid checkout URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Bachs returned an unsupported checkout URL.');
  return url.toString();
}

function bachsUrl(path, id) {
  const base = process.env.BACHS_API_BASE_URL;
  if (!base) throw new Error('BACHS_API_BASE_URL is not configured.');

  const resolvedPath = path
    .replace('{id}', encodeURIComponent(id ?? ''))
    .replace(/^\/+/, '');

  const baseUrl = base.endsWith('/') ? base : base + '/';
  return new URL(resolvedPath, baseUrl).toString();
}

function errorMessage(body, fallback) {
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.message === 'string') return body.message;
  if (typeof body?.error === 'string') return body.error;
  if (Array.isArray(body?.errors)) {
    return body.errors.map((item) => typeof item === 'string' ? item : item?.message || JSON.stringify(item)).join('; ');
  }
  if (body?.error_code) return String(body.error_code);
  try {
    if (body && typeof body === 'object' && Object.keys(body).length) return JSON.stringify(body);
  } catch {}
  
  return fallback;
}

async function bachsRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const parsedUrl = new URL(url);
    const method = options.method || 'GET';
    throw new Error(
      `Bachs ${method} ${parsedUrl.host}${parsedUrl.pathname} -> HTTP ${response.status}: ${errorMessage(body, 'no message')}`,
    );
  }

  return body;
}

export async function initializeBachsPayment(reference, callbackUrl) {
  const apiKey = process.env.BACHS_API_KEY || process.env.BACHS_SECRET_KEY;
  if (!apiKey) throw new Error('BACHS_API_KEY is not configured.');
  if (!process.env.BACHS_PRODUCT_ID) throw new Error('BACHS_PRODUCT_ID is not configured.');

  const payload = {
    product_cart: [{ product_id: process.env.BACHS_PRODUCT_ID, quantity: 1 }],
    customer: {
      email: 'test@example.com',
    },
    return_url: callbackUrl,
    cancel_url: callbackUrl,
  };

  const result = await bachsRequest(
    bachsUrl(process.env.BACHS_INITIALIZE_PATH || '/v1/checkout-sessions'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.BACHS_SECRET_KEY}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': reference,
      },
      body: JSON.stringify(payload),
    },
  );

  const checkoutUrl = normalizeCheckoutUrl(extractCheckoutUrl(result));
  return {
    reference: extractReference(result) || reference,
    checkoutId: result.checkout_id || result.id || result.data?.checkout_id || result.data?.id,
    checkoutUrl,
  };
}

export async function verifyBachsPayment(checkoutId) {
  const apiKey = process.env.BACHS_API_KEY || process.env.BACHS_SECRET_KEY;
  if (!apiKey) throw new Error('BACHS_API_KEY is not configured.');
  if (!checkoutId) throw new Error('Bachs checkout ID is missing.');

  const response = await bachsRequest(
    bachsUrl(process.env.BACHS_VERIFY_PATH || '/v1/checkout-sessions/{id}', checkoutId),
    {
      headers: {
        Authorization: `Bearer ${process.env.BACHS_SECRET_KEY}`,
        Accept: 'application/json',
      },
    },
  );

  const transaction = response.data || response;
  const amount = Number(
    transaction.amount
    ?? transaction.pricing?.amount
    ?? transaction.data?.amount
    ?? transaction.data?.pricing?.amount,
  );
  const currency = String(
    transaction.currency
    ?? transaction.pricing?.currency
    ?? transaction.data?.currency
    ?? transaction.data?.pricing?.currency
    ?? '',
  ).toUpperCase();
  const status = normalizeStatus(transaction.payment_status || transaction.status || transaction.data?.payment_status || transaction.data?.status);
  const amountMatches = amount === TEST_ORDER.amount;
  const currencyMatches = currency === TEST_ORDER.currency;
  const verifiedStatus = status === 'paid' && amountMatches && currencyMatches ? 'paid' : status === 'paid' ? 'failed' : status;

  return {
    raw: transaction,
    providerReference: transaction.checkout_id || checkoutId,
    status: verifiedStatus,
    amountMatches,
    currencyMatches,
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
