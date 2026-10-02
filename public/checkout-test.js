const button = document.querySelector('#pay'); const notice = document.querySelector('#notice');
function show(message, style = '') { notice.textContent = message; notice.className = `notice ${style}`; }
async function checkReturn() {
  const reference = new URLSearchParams(location.search).get('reference'); if (!reference) return;
  button.disabled = true; show('Verifying your payment securely…');
  try { const response = await fetch(`/api/payments/checkout-test/status?reference=${encodeURIComponent(reference)}`); const result = await response.json();
    if (result.status === 'paid') { show('Payment verified. Redirecting to your dashboard…', 'success'); setTimeout(() => location.replace(`/dashboard?reference=${encodeURIComponent(reference)}`), 600); return; }
    if (result.status === 'pending') { show('Your payment is still pending. Please wait a moment and refresh this page.'); return; }
    show(result.status === 'cancelled' ? 'Payment was cancelled.' : 'Payment failed. No charge was recorded.', 'error'); button.textContent = 'Try again'; button.disabled = false;
  } catch { show('We could not verify this payment. Please try again shortly.', 'error'); button.textContent = 'Try again'; button.disabled = false; }
}
button.addEventListener('click', async () => { button.disabled = true; button.textContent = 'Pay ₦5,000'; show('Initializing secure Bachs checkout…');
  try { const response = await fetch('/api/payments/checkout-test/initialize', { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to initialize payment.'); location.assign(result.checkoutUrl); }
  catch (error) { show(error.message, 'error'); button.textContent = 'Try again'; button.disabled = false; }
});
checkReturn();
