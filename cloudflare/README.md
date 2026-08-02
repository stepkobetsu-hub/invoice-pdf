# Cloudflare foundation

This directory contains the isolated Cloudflare implementation for STEP invoices.
It does not use Google Drive, Google Apps Script, Google Sheets, or Brevo.

## Phase 1 safety defaults

- `PRODUCTION_SEND_APPROVED=false`
- `TEST_SEND_APPROVED=false`
- `/api/send` refuses every request unless both flags are explicitly `true`.
- No email provider SDK, endpoint, API key, sender, or DNS setting is configured.
- PDF objects are only read through the private `PDFS` R2 binding.
- Parent URLs contain only a random token. D1 stores its SHA-256 hash.

## Cloudflare bindings

Bindings are added in the Cloudflare dashboard so private resource IDs are not committed.

| Binding | Type | Development resource |
|---|---|---|
| `DB` | D1 | `step-invoice-db` |
| `PDFS` | R2 | `step-invoice-pdfs` |

Secret slots reserved for later phases:

- `ADMIN_API_KEY`
- `TOKEN_PEPPER`

`BREVO_API_KEY` is intentionally not registered in Phase 1.

## Environments

- Development: workers.dev, `APP_ENV=development`
- Production: disabled configuration named `step-invoice-api-production`; no custom domain and no deployment in Phase 1

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
