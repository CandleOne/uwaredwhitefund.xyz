# Retired Alpaca Paper Dashboard Worker

`paperdashboard.html` now uses the `alpaca-py` Server-Sent Events service in
the repository root. Do not deploy this Worker for the current dashboard.

This Cloudflare Worker previously provided the read-only API used by `paperdashboard.html`.
It keeps Alpaca credentials in Cloudflare secrets and never sends them to a browser.

## Deploy

1. In this directory, install the Worker development dependency:

   ```powershell
   npm install
   ```

2. Authenticate the Cloudflare CLI:

   ```powershell
   npx wrangler login
   ```

3. In `wrangler.toml`, set `ALLOWED_ORIGIN` to the exact HTTPS origin serving
   the website. Do not include a trailing slash.

4. Store paper-account credentials as Cloudflare secrets. Generate these in
   Alpaca's paper-trading dashboard; do not add them to GitHub.

   ```powershell
   npx wrangler secret put ALPACA_API_KEY
   npx wrangler secret put ALPACA_API_SECRET
   ```

5. Deploy:

   ```powershell
   npm run deploy
   ```

6. In Cloudflare Workers & Pages, add `api.uwaredwhitefund.xyz` as a Custom
   Domain for this Worker. Cloudflare will show the DNS record to create at
   Porkbun. Keep the record proxied by Cloudflare.

7. If you use another API hostname, update the `alpaca-api-base` meta tag in
   `paperdashboard.html`.

The page requests `GET /v1/dashboard` every 15 seconds while open. The Worker
retrieves the latest account balances, positions, and ten recent orders from
Alpaca's paper-trading API. It is intentionally read-only: it does not expose
order placement or API credentials to visitors.
