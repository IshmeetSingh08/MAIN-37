# CENTRIX CITY connector notes

These version 1 application contracts are proposals implemented by local mocks. The runnable browser exposes received job payloads and the final unit write-back.

| Boundary | Operation | Implemented data |
|---|---|---|
| Centrix mock | Resolve context | Fictional tenant c_202, unit_4b and property snapshot |
| Centrix mock | Emit trigger | maintenance.issue_reported with schema_version 1.0, event_id, source, timestamp, unit_id, contact_id and initial_description |
| Partner mock | Discover and rank | Three fictional provider records, compatibility filtered and scored as described below |
| Partner mock | Offer job | schema_version, event_id, idempotency_key, correlation_id, request/unit/contact/provider IDs, created_at, service, property_context, and attachments |
| Partner mock | Respond | Offered job becomes accepted or rejected. A rejection carries a reason and remains in assignment history. |
| Partner mock | Book | Two Berlin-time slots, each with ID, start and end. Selection adds appointment_id, confirmed status and timezone. |
| Partner mock | Complete | Report ID, work done and scripted completion timestamp. Invoice remains pending. |
| Partner mock | Invoice | Invoice ID and number, amount, EUR, issued date, submitted status, job ID and mock document reference |
| Centrix mock | Write result | Version, unit and contact IDs, plus request, provider, job, appointment, report, invoice and write-back timestamp |

The manager's selection dispatches the offer immediately. New offers include the service address, unit, and classified repair type. Tenant contact details and free-text descriptions stay in the tenant and manager views. Each offer key includes the request ID and assignment attempt number. Stale or repeated writes return HTTP 409 and leave canonical state intact. The local process writes each transition as one SQLite statement.

## Eligibility and ranking

A heating_repair request accepts a provider with heating_repair or heating_systems. Other specialisations do not qualify on their own. Ranking weights are availability 25%, distance 35%, rating 25%, and estimated cost 15%. The demo uses seeded availability scores of 100 for the next two days and 80 for this week, distance score 100 minus 10 times kilometres, rating score 20 times stars, and cost score 200 minus the EUR estimate. The total is rounded and ties are resolved by provider ID.


