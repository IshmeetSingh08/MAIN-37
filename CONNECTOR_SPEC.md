# CENTRIX CITY connector specification

Version 1 is an application-level contract for the hackathon mocks. Centrix resolves the portal tenant and unit, publishes the maintenance event, and receives the outcome. The maintenance adapter discovers compatible providers and sends offers. The Node app runs both interfaces locally.

## Provider discovery

A provider supplies a stable ID, name, supported repair specialties, availability, distance, and estimated cost. The manager sees eligible providers ranked by availability (25%), distance (35%), rating (25%), and estimated cost (15%). Specialty determines eligibility first. The rating blends the fictional baseline with observed tenant ratings. The manager selects a provider.

## Job offer and acknowledgement

Required offer fields are schema_version, event_id, idempotency_key, correlation_id, request_id, unit_id, partner_provider_id, created_at, service, property_context, and attachments. Timestamps use ISO 8601. Example offer payload from the local mock:

```json
{
  "schema_version": "1.0",
  "event_id": "evt_offer_req_001_1",
  "idempotency_key": "req_001:offer:1:v1",
  "correlation_id": "corr_req_001",
  "request_id": "req_001",
  "unit_id": "unit_4b",
  "partner_provider_id": "craft_001",
  "created_at": "2026-11-21T08:00:00Z",
  "service": { "category": "heating", "summary": "Heating not warming the home" },
  "property_context": { "address": "Musterstraße 12, 52062 Aachen", "unit_label": "Unit 4B" },
  "attachments": []
}
```

The mock returns a job object with an ID, status "offered", and the original payload. The partner receives the service location and classified issue. Tenant contact identifiers, name, phone, and original complaint stay with Centrix.

Voice reports use the existing tenant portal trigger with an optional input method. The offer may include a confirmed room in the service details and a preferred start time in the scheduling details, expressed as HH:mm in Europe/Berlin. Transcripts stay inside the resident and manager workflow.

## Partner updates and Centrix write-back

- Example partner response after accepting: `{"id":"job_501","status":"accepted"}`. The job object retains the original offer. A rejection sets status to rejected and adds a reason.
- Acceptance enables two future one-hour slot proposals in Berlin time. The tenant confirms one or asks for another pair. A completion report closes the repair with invoice_status pending. After document upload, separate invoice submission updates the unit result to invoice_status submitted and exposes the downloadable file to the tenant and manager.
- The Centrix trigger includes the event, unit and contact IDs. The mock write-back retains those IDs and links the case, provider, appointment, completion report, and invoice.

## Retries and rejection

The local app rejects stale or repeated state transitions with HTTP 409 and retains the existing job. A rejected offer stays in the case history. A replacement offer uses a new attempt number and key under the same request ID. An external adapter should deduplicate offers using idempotency_key, return the existing job on retry, and correlate updates using the job and request IDs.
