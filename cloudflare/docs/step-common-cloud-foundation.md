# STEP common cloud foundation

The invoice service is the first module of a future STEP-wide Cloudflare platform.

## Shared layers

- Edge API: route modules by `/api/{module}` while keeping authentication, authorization, rate limiting, and response security shared.
- Identity and authorization: shared users and roles, with module-scoped permissions added in later migrations.
- Token service: opaque random tokens only; D1 stores hashes and lifecycle metadata.
- Private storage: Workers bindings hide R2 bucket URLs and object keys from end users.
- Notifications: a provider-neutral queue and policy gate; email remains disabled until separately approved.
- Audit: append-only shared events for administrator actions and protected-resource access.

## Module boundaries

Invoice-specific tables remain isolated for accounting rules. Generic resources use `system_modules`, `managed_files`, `access_tokens`, and `audit_events`. Future modules such as grades, learning progress, attendance QR, and STEP distribution can register a module without changing invoice records.

## Storage evolution

`step-invoice-pdfs` remains invoice-only and private. A future shared `step-files` bucket should use namespaced object keys such as `{module}/{year}/{opaque-id}` and separate bindings per environment. Public bucket access and direct R2 URLs remain prohibited.

## Cost and abuse controls

- Public download, administration, upload, and email routes have independent feature gates.
- `EMERGENCY_STOP` blocks all mutable and public delivery routes without changing application code.
- Cloudflare Rate Limiting bindings reject abusive page/PDF traffic before D1 or R2 access. Because the binding is eventually consistent, valid deliveries also reuse fixed D1 counter rows for exact one-minute thresholds; invalid tokens never create those rows and never reach R2.
- PDF downloads are capped per token and per UTC day; administrator retrieval uses a separately authenticated route and ignores parent limits.
- Invalid tokens are not persisted per request and never reach R2. Aggregated counters and security alerts are available for later monitoring jobs.
- Budget alerts are informational warnings, never described as an automatic billing cap.
