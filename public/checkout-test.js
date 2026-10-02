const button = document.querySelector('#pay');
const notice = document.querySelector('#notice');

function show(message, style = '') {
  notice.textContent = String(message);
  notice.className = `notice ${style}`;
}

function errorText(value) {
  if (typeof value === 'string') return value;
  try {
    return value ? JSON.stringify(value) : 'Unable to initialize payment.';
  } catch {
    return 'Unable to initialize payment.';
  }
}

function normalizeCheckoutUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Bachs returned an empty checkout URL.');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Bachs returned an invalid checkout URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Bachs returned an unsupported checkout URL.');
  }

  return url.href;
}

async function checkReturn() {
  const params = new URLSearchParams(location.search);
  const reference = params.get('reference');
  const checkoutId = params.get('checkout_id');
  if (!reference && !checkoutId) return;

  button.disabled = true;
  show('Verifying your payment securely…');
  try {
    const query = checkoutId
      ? `checkout_id=${encodeURIComponent(checkoutId)}${reference ? `&reference=${encodeURIComponent(reference)}` : ''}`
      : `reference=${encodeURIComponent(reference)}`;
    const response = await fetch(`/api/payments/checkout-test/status?${query}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(result.error || result));

    if (result.status === 'paid') {
      show('Payment verified. Redirecting to your dashboard…', 'success');
      setTimeout(() => location.replace(`/dashboard?reference=${encodeURIComponent(reference || '')}`), 600);
      return;
    }

    show(result.status === 'cancelled'
      ? 'Payment was cancelled.'
      : result.status === 'pending'
        ? 'Your payment is still pending. Refresh this page shortly.'
        : 'Payment failed. No charge was recorded.', 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  } catch (error) {
    show(error instanceof Error ? error.message : String(error), 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  button.textContent = 'Opening secure checkout…';
  show('Initializing secure Bachs checkout…');
  try {
    const response = await fetch('/api/payments/checkout-test/initialize', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorText(result.error || result));
    window.location.assign(normalizeCheckoutUrl(result.checkoutUrl));
  } catch (error) {
    show(error instanceof Error ? error.message : String(error), 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  }
});

checkReturn();
