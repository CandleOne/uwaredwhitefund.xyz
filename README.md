# uwaredwhitefund.xyz

## Alpaca paper portfolio widget

`alpaca_portfolio_stream.py` is the read-only backend for the Paper Dashboard.
It uses `alpaca-py` to retrieve paper-account balances, positions, and the ten
most recent orders. It also subscribes to Alpaca trade updates so the widget
refreshes immediately after an account event. The browser receives snapshots
over Server-Sent Events; Alpaca credentials never reach the browser.

1. Install the Python dependency:

   ```powershell
   python -m pip install -r requirements.txt
   ```

2. Copy `.env.example` to `.env` for local development, then add the paper
   credentials and deployment values. The service loads that file
   automatically. In production, configure the same values in the hosting
   platform's secret store. Do not commit an `.env` file or use live-trading
   keys.

3. Set `PORTFOLIO_ALLOWED_ORIGIN` to the exact HTTPS origin hosting this site,
   and set the `alpaca-api-base` meta tag in `paperdashboard.html` to the
   service's public HTTPS URL.

4. Start the service:

   ```powershell
   python alpaca_portfolio_stream.py
   ```

The service only permits browser requests from `PORTFOLIO_ALLOWED_ORIGIN`, but
CORS is not access control. If the dashboard is not intended to be public,
place the service behind authentication at the hosting or reverse-proxy layer.

The old Cloudflare Worker is not used by the page after this change.

For a local widget preview, run the stream with
`PORTFOLIO_ALLOWED_ORIGIN=http://127.0.0.1:8000` and open
`paperdashboard.html?apiBaseUrl=http://127.0.0.1:8788` from a local static
server. The query parameter only overrides the API address for that preview;
it does not change the production endpoint.