# uwaredwhitefund.xyz

The HTML/CSS/JS site can stay on its current static host. Login, member
management, encrypted portfolio credentials, and portfolio streams require
`member_portfolio_service.py` on a Python host. Static hosting cannot run these
endpoints. The separate `alpaca_portfolio_stream.py` and old Cloudflare Worker
are not needed for this deployment: the member service also serves the shared
paper dashboard at `/v1/dashboard/stream`.

## Deploy the API to Fly.io

Requirements: a Fly.io account with billing enabled, the `fly` CLI, and access
to DNS for `uwaredwhitefund.xyz`. Run these commands from this repository.
The configured app name must be globally available; if necessary, choose a
different name in `fly.toml` before creating the app.

1. Sign in, create the app, and create its persistent SQLite volume:

   ```sh
   fly auth login
   fly apps create uwaredwhitefund-api
   fly volumes create portfolio_data --region sjc --size 1 --app uwaredwhitefund-api
   ```

2. Copy `.env.example` to `.env` locally and fill in the session secret and
   credential-encryption key. Generate values in your own terminal:

   ```sh
   python -m pip install -r requirements.txt
   python -c 'import secrets; print(secrets.token_hex(32))'
   python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
   ```

   Use the first value for `APP_SESSION_SECRET` and the second for
   `ALPACA_CREDENTIAL_ENCRYPTION_KEY`. Optional `ALPACA_API_KEY` and
   `ALPACA_API_SECRET` are **paper-trading** credentials for the public shared
   Client portfolio. Without them, login and member-linked portfolios still
   work, but the shared dashboard returns 503. Never share or commit secrets.
   Import them into Fly and deploy a single machine:

   ```sh
   fly secrets import --app uwaredwhitefund-api < .env
   fly deploy --ha=false
   fly checks list --app uwaredwhitefund-api
   ```

   Only import the variables in the template; do not override the production
   database path or enable public manager setup. Keep the encryption key stable
   across deployments or stored Alpaca credentials cannot be decrypted. If
   migrating an existing database, preserve its encryption key and copy the
   database into `/data/portfolio.db` with the service stopped first.

3. Provision the first manager through the private server console:

   ```sh
   fly ssh console --app uwaredwhitefund-api
   cd /app
   python -m flask --app 'member_portfolio_service:create_app()' create-manager
   exit
   ```

   Enter the email and a password of at least 12 characters when prompted.
   The password prompt is hidden. This command refuses to run if any account
   already exists. Public first-account setup is disabled on Fly.

4. Attach the API hostname and follow Fly's DNS instructions:

   ```sh
   fly certs add api.uwaredwhitefund.xyz --app uwaredwhitefund-api
   fly certs setup api.uwaredwhitefund.xyz --app uwaredwhitefund-api
   ```

   Remove the existing `api` redirect/parking record and replace it with the
   records Fly specifies. Leave the main website's DNS unchanged. Wait for
   certificate issuance and verify:

   ```sh
   fly certs check api.uwaredwhitefund.xyz --app uwaredwhitefund-api
   curl --fail https://api.uwaredwhitefund.xyz/healthz
   curl --fail -i -H 'Origin: https://uwaredwhitefund.xyz' https://api.uwaredwhitefund.xyz/v1/auth/status
   ```

   Health must return `{"status":"ok"}`. Auth status must return JSON, not a
   redirect or HTML, and include `Access-Control-Allow-Origin` matching the
   website and `Access-Control-Allow-Credentials: true`.

5. Open `https://uwaredwhitefund.xyz/login.html`, sign in with the provisioned
   manager, create a member account, and link a paper portfolio. Verify that
   its dashboard updates and logout ends the session. Existing pages already
   use `https://api.uwaredwhitefund.xyz`, so no frontend URL changes are needed.

### Deployment constraints

Use the API subdomain, not the `*.fly.dev` hostname, in the production pages.
The site's credentialed requests use Secure, HttpOnly, SameSite=Lax cookies;
the website and API must remain on the same HTTPS site. The allowed origin is
exactly `https://uwaredwhitefund.xyz`; redirect `www` traffic to that origin if
you serve both. CORS is not access control: the shared Client portfolio is
public, while member operations require a session and mutations require CSRF.

The image contains only the backend and dependencies, not local secrets or
databases. Gunicorn binds to `0.0.0.0:8080` and uses threads for long-lived
Server-Sent Events. Fly keeps the machine running, checks `/healthz`, and mounts
the database at `/data/portfolio.db` so redeploys do not erase accounts. Keep
one machine: SQLite volumes are not shared between machines. Arrange volume
backups and monitor connection usage; the current configuration caps concurrent
connections at 30, and each portfolio stream consumes a connection/thread.

## Local development

Install `requirements.txt` and fill in `.env` as described above. Start the API:

```sh
PORTFOLIO_ALLOWED_ORIGIN=http://127.0.0.1:8000 PORTFOLIO_PORT=8789 python member_portfolio_service.py
```

In a second terminal, serve the static site:

```sh
python -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/login.html`. Local pages automatically use port
8789. Local first-manager setup is enabled by default; production disables it.
The Flask development server is only for local use.

## Tests

```sh
python -m unittest test_member_portfolio_service -v
```

Tests cover health, HTTPS cookie settings, persistent login accounts, logout,
CORS/CSRF, private manager provisioning, portfolio linking, and authenticated
and shared streams. Alpaca responses are mocked; tests need no live keys.