# Cloudflare foundation

This directory contains the Cloudflare implementation for STEP invoices.
Invoice list/save/edit/payment/delete, partners, settings, billing adjustments, migration runs and delivery-job state use D1 directly. Apps Script remains only as a temporary compatibility mirror, shared student-master lookup and the existing mail-provider bridge until the protected D1 outbox consumer is approved. PDF files never use Google Drive.

## Production storage and download service

- `PRODUCTION_SEND_APPROVED=false`
- `TEST_SEND_APPROVED=false`
- `/api/send` refuses every request unless both flags are explicitly `true`.
- No email provider SDK, endpoint, API key, sender, or DNS setting is configured.
- PDF objects are written and read only through the private `PDFS` R2 binding.
- Parent URLs contain only a random token. D1 stores its SHA-256 hash.
- Apps Script calls the protected admin API to upload PDFs, issue and rotate links, revoke links, and read delivery status.
- The admin API requires `ADMIN_API_KEY`. The same value is stored only in Apps Script Script Properties.

## Cloudflare bindings

Bindings are added in the Cloudflare dashboard so private resource IDs are not committed.

| Binding | Type | Development resource |
|---|---|---|
| `DB` | D1 | `step-invoice-db` |
| `PDFS` | R2 | `step-invoice-pdfs` |

Required Worker secrets:

- `ADMIN_API_KEY`
- `TOKEN_PEPPER`

`BREVO_API_KEY` is not exposed to the browser or committed. Production delivery remains blocked until the separate administrator approval step; D1 owns delivery job and event state.

## D1 direct invoice workspace

- The browser calls `/api/app/dashboard` and `/api/app/invoices` directly.
- The browser sends the existing staff-app session token; it never receives `ADMIN_API_KEY`.
- The Worker accepts the fixed GitHub Pages origin only and verifies the staff session before every staff operation (verification is cached for 120 seconds).
- Invoice writes use prepared statements and `DB.batch()`. Item unit prices and amounts may be negative for discounts.
- Deletion is a soft delete and also revokes active delivery links.
- Email/PDF actions still mirror the selected invoice to Apps Script immediately before the existing send flow.

### Safe production switch order

Run from the repository root. Do not publish the new frontend until steps 1-4 have succeeded.

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
npx.cmd wrangler d1 export step-invoice-db --remote --output backups\step-invoice-before-workspace.sql --config cloudflare/wrangler.jsonc
npx.cmd wrangler d1 migrations apply step-invoice-db --remote --config cloudflare/wrangler.jsonc
npx.cmd wrangler deploy --config cloudflare/wrangler.jsonc
```

Then replace and redeploy `apps-script/Code.gs`, and manually run `migrateInvoiceDataToCloudflare` once in the Apps Script editor. The function is idempotent and may be run again if a batch is interrupted. Confirm that its return value reports the same `imported` and `total` count, then publish the GitHub Pages frontend.

After the switch, newly saved invoices are authoritative in D1. The spreadsheet remains a compatibility mirror for email/PDF operations and is no longer used for the invoice list or ordinary saves.

## Environments

- Production: `step-invoice-api` on workers.dev, `APP_ENV=production`
- The existing D1 `step-invoice-db` and private R2 bucket `step-invoice-pdfs` must remain bound as `DB` and `PDFS`.

The custom domain `invoice.step-edu.net` is connected only after a separate approval.

## STEP shared-cloud evolution

Migration `0002_step_common_foundation.sql` adds module-neutral file, token, and audit tables. Shared response security and opaque-token hashing live under `src/core/`. See `docs/step-common-cloud-foundation.md` for the recommended expansion path.

R2 usage is checked in **Cloudflare Dashboard > R2 Object Storage > Overview > Usage**. This shows total storage, Class A operations, Class B operations, and current billable usage. Free-tier proximity is reported to an administrator; the application does not change configuration or stop services automatically.

## Abuse and cost controls

- Parent guide page: 30 requests/minute per IP hash and 10/minute per token hash.
- Parent PDF: 10 requests/minute per IP hash and 5/minute per token hash.
- Cloudflare Rate Limiting rejects traffic before D1/R2. A fixed-row, one-minute D1 aggregate counter additionally gives exact limits only after a token is proven valid; invalid tokens never create counter rows and repeated requests do not create per-request logs.
- Parent PDF limit: 20 total and 10 per UTC day, configurable through protected settings.
- Invalid, expired, revoked, and unknown tokens return the same public response and never read R2.
- `PUBLIC_DOWNLOAD_ENABLED`, `PDF_UPLOAD_ENABLED`, `ADMIN_API_ENABLED`, and `EMERGENCY_STOP` are independent operational gates.
- Budget alerts are informational only and do not stop Cloudflare usage.
