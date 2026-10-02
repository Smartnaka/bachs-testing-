import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ORDER, canTransition, extractReference, initializeBachsPayment, normalizeStatus, validWebhookSignature, verifyBachsPayment } from './payment-service.js';
import { createPayment, getPayment, updatePayment } from './payment-store.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const port = Number(process.env.PORT || 3000);

// Keep local development configuration server-side without adding a client-side env loader.
try {
  const envFile = await fs.readFile(path.join(root, '.env'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

function send(res, status, value, type = 'application/json') { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(value) : value); }
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return Buffer.concat(chunks); }
function safeReference(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value) ? value : null; }
function baseUrl(req) { return process.env.APP_BASE_URL || `http://${req.headers.host}`; }
async function serve(res, filename) { send(res, 200, await fs.readFile(path.join(publicDir, filename), 'utf8'), filename.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8'); }

async function verifyAndPersist(reference) {
  const payment = await getPayment(reference);
  if (payment?.status === 'paid') return payment;
  const verified = await verifyBachsPayment(reference);
  const status = verified.status;
  // A provider success with an unexpected amount/currency is never accepted as paid.
  const acceptable = status === 'paid' && verified.amountMatches && verified.currencyMatches;
  const nextStatus = acceptable ? 'paid' : status;
  if (payment && !canTransition(payment.status, nextStatus)) return payment;
  const persisted = payment
    ? await updatePayment(reference, { status: nextStatus, providerReference: verified.providerReference, verifiedAt: new Date().toISOString() })
    : null;
  return persisted || { reference, ...TEST_ORDER, status: nextStatus, providerReference: verified.providerReference, verifiedAt: new Date().toISOString() };
}

const handler = async (req, res) => {
  const url = new URL(req.url, baseUrl(req));
  try {
    if (req.method === 'GET' && url.pathname === '/checkout-test') return serve(res, 'checkout-test.html');
    if (req.method === 'GET' && url.pathname === '/dashboard') return serve(res, 'dashboard.html');
    if (req.method === 'GET' && url.pathname === '/checkout-test/callback') {
      const reference = safeReference(url.searchParams.get('reference') || url.searchParams.get('tx_ref'));
      if (!reference) return send(res, 400, '<h1>Invalid payment callback</h1>', 'text/html; charset=utf-8');
      res.writeHead(302, { Location: `/checkout-test?reference=${encodeURIComponent(reference)}`, 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/checkout-test.js') return serve(res, 'checkout-test.js');
    if (req.method === 'GET' && url.pathname === '/dashboard.js') return serve(res, 'dashboard.js');
    if (req.method === 'POST' && url.pathname === '/api/payments/checkout-test/initialize') {
      const reference = `cake_test_${crypto.randomUUID().replaceAll('-', '')}`;
      try { await createPayment({ reference, ...TEST_ORDER, status: 'pending', createdAt: new Date().toISOString() }); } catch (error) { console.warn('Payment store unavailable; continuing with provider verification.', error.message); }
      try {
        const initialized = await initializeBachsPayment(reference, `${baseUrl(req)}/checkout-test/callback?reference=${reference}`);
        try { await updatePayment(reference, { providerReference: initialized.reference, checkoutUrl: initialized.checkoutUrl }); } catch (error) { console.warn('Payment store unavailable after initialization.', error.message); }
        return send(res, 201, { reference, checkoutUrl: initialized.checkoutUrl });
      } catch (error) { await updatePayment(reference, { status: 'failed', failureReason: error.message }); return send(res, 502, { error: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/api/payments/checkout-test/status') {
      const reference = safeReference(url.searchParams.get('reference'));
      const payment = reference && await verifyAndPersist(reference);
      return payment ? send(res, 200, { reference: payment.reference, status: payment.status }) : send(res, 404, { error: 'Payment not found.' });
    }
    if (req.method === 'GET' && url.pathname === '/api/payments/checkout-test/receipt') {
      const reference = safeReference(url.searchParams.get('reference')); const payment = reference && await verifyAndPersist(reference);
      return payment && payment.status === 'paid' ? send(res, 200, { reference: payment.reference, name: payment.name, amount: payment.amount, currency: payment.currency, status: payment.status }) : send(res, 404, { error: 'Verified payment not found.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/webhooks/bachs') {
      const raw = await body(req); const signature = req.headers['x-bachs-signature'] || req.headers['x-webhook-signature'];
      if (!validWebhookSignature(raw, signature)) return send(res, 401, { error: 'Invalid webhook signature.' });
      const event = JSON.parse(raw.toString('utf8')); const reference = safeReference(extractReference(event));
      if (!reference) return send(res, 200, { received: true });
      await verifyAndPersist(reference); // verification makes webhook updates idempotent and authoritative
      return send(res, 200, { received: true });
    }
    send(res, 404, { error: 'Not found.' });
  } catch (error) { console.error(error); send(res, 500, { error: 'Unexpected server error.' }); }
};

export { handler };

if (process.env.VERCEL !== '1') {
  http.createServer(handler).listen(port, () => console.log(`Checkout test listening on http://localhost:${port}/checkout-test`));
}
