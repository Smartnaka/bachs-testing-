const button = document.querySelector('#pay');
const notice = document.querySelector('#notice');

function show(message, style = '') {
  notice.textContent = message;
  notice.className = `notice ${style}`;
}

function errorText(value) {\n  if (typeof value === 'string') return value;\n  try { return value ? JSON.stringify(value) : 'Unable to initialize payment.'; } catch { return 'Unable to initialize payment.'; }\n}\n\nfunction normalizeCheckoutUrl(value) {
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
  const reference = new URLSearchParams(location.search).get('reference');
  if (!reference) return;

  button.disabled = true;
  show('Verifying your payment securely…');

  try {
    const response = await fetch(`/api/payments/checkout-test/status?reference=${encodeURIComponent(reference)}`);
    const result = await response.json();

    if (result.status === 'paid') {
      show('Payment verified. Redirecting to your dashboard…', 'success');
      setTimeout(() => location.replace(`/dashboard?reference=${encodeURIComponent(reference)}`), 600);
      return;
    }

    if (result.status === 'pending') {
      show('Your payment is still pending. Please wait a moment and refresh this page.');
      return;
    }

    show(result.status === 'cancelled' ? 'Payment was cancelled.' : 'Payment failed. No charge was recorded.', 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  } catch {
    show('We could not verify this payment. Please try again shortly.', 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  }
}

button.addEventListener('click', async () => {
  button.disabled = true;
  button.textContent = 'Pay ₦5,000';
  show('Initializing secure Bachs checkout…');

  try {
    const response = await fetch('/api/payments/checkout-test/initialize', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(errorText(result.error) || `Unable to initialize payment (HTTP ${response.status}).`);
    }

    const checkoutUrl = normalizeCheckoutUrl(result.checkoutUrl);

    // Use the parsed absolute URL rather than passing an unchecked string
    // directly to the browser navigation API.
    window.location.href = checkoutUrl;
  } catch (error) {
    show(error instanceof Error ? error.message : 'Unable to open Bachs checkout.', 'error');
    button.textContent = 'Try again';
    button.disabled = false;
  }
});

checkReturn();
