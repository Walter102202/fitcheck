# Deploying Fitcheck on Render

Fitcheck runs as one Node web service (API, PayPal webhooks and the built web app in one process)
and one Postgres database, both described in [`render.yaml`](../render.yaml). A commit on `main`
deploys only after its CI run passes (`autoDeployTrigger: checksPass`).

## Step 1: first deploy, no keys

`render.yaml` starts the service in a mode that needs no secret:

| Variable        | Value      | What visitors get                                                         |
|-----------------|------------|---------------------------------------------------------------------------|
| `PAYPAL_MODE`   | `sandbox`  | Without a client id and secret, each session runs on simulated PayPal, and the site says "PayPal is simulated on this site." |
| `LLM_PROVIDER`  | `mock`     | The four demo requests are read from recorded intents (`apps/backend/src/review/recordings`). |
| `CHANNEL3_MODE` | `recorded` | Product records come from the copy recorded on 2026-11-10 (`fixtures/channel3`). |

1. In the Render dashboard: **New → Blueprint**, pick this repository, apply. Render creates the
   web service `fitcheck` and the database `fitcheck-db`, and generates `SESSION_SECRET`.
   Leave the `sync: false` secrets empty for now.
2. `APP_URL` stays unset: the backend uses Render's `RENDER_EXTERNAL_URL` (https, no trailing
   slash) for PayPal return URLs and the cookie's Secure flag.
3. Smoke test on the service URL:
   - `GET /healthz` answers `{"ok":true}`;
   - `GET /api/config` reports `paypalMode: simulated`, `channel3Mode: recorded`;
   - the four purchases on the home page end as described in the README.

## Step 2: real services

1. **PayPal sandbox.** Create a REST app in the PayPal developer dashboard (sandbox). Paste
   `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in the service's environment. Paste the sandbox
   personal (buyer) account in `SANDBOX_BUYER_EMAIL` and `SANDBOX_BUYER_PASSWORD`: the cap screen
   shows it so judges can approve the cap.
2. **Webhook.** On the same REST app, add a webhook for
   `https://<service>.onrender.com/api/webhooks/paypal` with the events the backend handles:
   `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`,
   `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DECLINED`,
   `PAYMENT.CAPTURE.DENIED`. Paste its id into `PAYPAL_WEBHOOK_ID`.
3. **Anthropic.** Paste `ANTHROPIC_API_KEY` (a key with a spending cap). Then set
   `LLM_PROVIDER: anthropic` in `render.yaml`.
4. **Channel3.** Paste `CHANNEL3_API_KEY`. Then set `CHANNEL3_MODE: live` in `render.yaml`.
   Without a key, live mode fails at boot on purpose, and Render keeps the previous deploy running.
5. Commit and push the `render.yaml` change. The Blueprint syncs and the service redeploys.

## Smoke test with real services

- `GET /api/config` reports `sandbox`, `live` and `claude-sonnet-5-5`.
- Approve the cap on PayPal's sandbox page with the buyer account; the four purchases end as in
  the README. The sandbox dashboard shows one authorization of $3,000.00 and a partial capture
  per paid purchase. The PayPal panel shows the real capture ids.
- The service log shows `webhook.processed` for the captures, and `caps.voided` after
  **Start over**.
- Fallbacks, checked on a preview with a broken setting and then restored:
  - an invalid `CHANNEL3_API_KEY` shows "Channel3 did not answer. Showing the copy recorded on
    Nov 10, 2026." and the log shows `channel3 live failed, using the recording`;
  - an invalid `REVIEW_MODEL` fails closed: "Fitcheck could not check this listing." and
    nothing is captured.

## Operations

- **Sessions.** Each visitor gets an anonymous session cookie and their own cap. A cap left idle
  is voided by the sweep; **Start over** voids it at once.
- **Redeploys.** Sessions live in Postgres and survive a redeploy. A pending simulated cap that a
  restart forgot is expired, and the visitor is asked to approve a new one.
- **Rollback.** Render dashboard → the service → Events → pick the previous deploy → Rollback.
- **Logs.** Render dashboard → the service → Logs. Lines are JSON. Secrets are redacted by key
  name: token, secret, password and api key.
- **Keep alive.** The hosted demo must stay up and free to use until 2026-12-15.
