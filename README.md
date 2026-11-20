# CENTRIX CITY

A local Reltix hackathon demo for one fictional heating repair. The island illustrates the three roles on the demo sign-in page. Each account opens its own dashboard, and all dashboards share the same case. Centrix, the partner, provider data and AI intake are simulated.

## Run

Use Node.js 24 or later. The app uses the built-in HTTP and SQLite modules and needs no dependency installation, API key or network access.

```powershell
node server.cjs
```

Open [CENTRIX CITY](http://127.0.0.1:3000). The server binds only to loopback. If Node is not on PATH in Codex, use the Node executable returned by the app's workspace-dependency loader.

Cases, portfolio data, accounts and sessions persist in demo.sqlite next to the server. **Reset demo** resets the sample repair and preserves accounts and approvals. Set DEMO_DB to a different filename or :memory: to use a separate database, and PORT to change the local port.

## Accounts and action alerts

- Demo sign-in creates an expiring server-side session for a seeded account. Email and password sign-in uses a salted password hash. Logout revokes the session.
- Tenants may register and sign in. New tenant accounts have no unit assignment and cannot access Lena's demo case. Use **Continue as Demo Tenant** for the full repair walkthrough.
- For manager email-and-password sign-in, set CENTRIX_MANAGER_EMAIL and CENTRIX_MANAGER_PASSWORD before the first startup with that email. The app provisions the account with the seeded portfolio. The manager demo button works without this configuration.
- A craftsman registers with an email and password. Manager approval is required before first sign-in. Demo provider buttons are limited to seeded identities.
- The notification panel shows current actions across the signed-in account's cases and checks for updates every five seconds while the dashboard is visible. Each demo tenant can report multiple heating issues. Older example tasks are read-only.
- Choose **More demo tenants** to sign in as Maya Keller (Lindenhof) or Jonas Weber (Parkblick). Each account sees its own reports.
- Choose **More demo craftsmen** to sign in as Müller Heiztechnik, WärmeFix GmbH, or ThermoService. The selected provider sees the job after the manager assigns it.

## Four-minute walkthrough

Use **Switch account** between dashboards. It signs you out and returns you to the account choices with the case intact.

1. Choose **Tenant** and continue as **Lena Hoffmann**. Reset the demo, then type “There is no heating in my apartment.” Describe what you observed in the follow-up, generate the summary, then confirm and submit.
2. Choose **Property Manager** and continue as **Demo Property Manager**. Open the request from the **Requests requiring attention** list or from **Requests**, then select **Müller Heiztechnik**.
3. Switch to the selected craftsman. The job is available as soon as the manager assigns it.
4. Sign in as **Müller Heiztechnik**, expand the property and contact details, accept the job, and enter two Berlin-time appointment starts at least one hour apart.
5. Sign in as **Lena Hoffmann** and confirm the morning slot.
6. Sign in as **Müller Heiztechnik**, submit the completion report, and pause on **Task completed — invoice pending**. Upload a PDF, PNG or JPEG up to 2 MB, then submit the separate invoice. The manager and tenant can download it after submission.
7. Sign in as **Lena Hoffmann** and expand the simulated Unit 4B write-back. Show the linked job, appointment, report and invoice.

For a rejection walkthrough, choose the replacement under **More demo craftsmen** once the manager assigns the replacement.

To demonstrate onboarding, choose **Craftsman → Register** and submit a fictional name, email and password. Switch to the manager to approve the registration. The approved provider signs in with those credentials and appears separately from ranked providers when choosing a heating specialist.

## Checks

Run `node --test workflow.test.cjs` for state and consent checks. With the server running, `node browser-smoke.cjs` runs the complete journey and resets the shared demo state. The optional browser check requires Playwright available on NODE_PATH or installed locally. Set DEMO_BROWSER to a local Chromium executable if needed.

See [CONNECTOR_SPEC.md](CONNECTOR_SPEC.md) for the simulated integration contract.


