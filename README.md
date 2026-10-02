# Bachs checkout test

This application exposes a real, server-side Bachs checkout test at `/checkout-test`.

## Configure and run

1. Copy `.env.example` to `.env` and supply the Bachs secret, API host, and endpoint paths from your Bachs account/documentation. The secret is read only by `server.js`.
2. Set the Bachs dashboard webhook URL to `https://YOUR_HOST/api/webhooks/bachs` and configure its signing secret as `BACHS_WEBHOOK_SECRET`.
3. Run `npm start` (Node 18+), then open `http://localhost:3000/checkout-test`.

The fixed server-side order is **Test Cake Order**, **NGN 5,000**, and **Payment test**. The browser never sends an amount, currency, or successful status. Redirect callbacks and signed webhooks both call Bachs verification before a local payment can become `paid`.
