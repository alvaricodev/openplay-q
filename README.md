# Open Play Queue (`openplay-q`)

A responsive organizer and player app for managing pickleball open play sessions. Built with React, Express, tRPC, Drizzle ORM, and MySQL.

## Features

- Create and manage sessions with scheduled start times, durations, court counts, and queue strategies.
- Add players manually or import participants by CSV or pasted lists. Reclub and DUPR integrations are not assumed to be connected.
- Generate skill-based or fair-rotation queues, track player ratings and sources, and assign players to courts.
- Use server-backed session timers, including expiry warnings and settlement for matches still active when time runs out.
- Record scores, audited corrections and cancellations, match history, cross-session rankings, CSV exports, and printable reports.
- Let players sign in for their history and rankings, or view a read-only session board through an invite link.

## Sign-in, privacy, and costs

Sign-in uses the Manus account flow. The app does not add a player subscription or a separate password database, and it never asks for Reclub or DUPR passwords. Organizer actions are protected by server-side ownership checks. Public session views do not expose private account details or organizer controls.

There is no in-app player fee. The project owner may still incur hosting, database, storage, or network charges under the chosen provider’s terms. Check that provider’s current pricing and usage dashboard; this project does not promise that infrastructure is free.

## Development

- `pnpm install` — install dependencies.
- `pnpm dev` — run the development server (default port 3000; honors `PORT`).
- `pnpm build` / `pnpm start` — build and serve the production app.
- `pnpm db:migrate` — apply checked-in database migrations.
- `pnpm check` / `pnpm test` — run TypeScript checks and the test suite.

Configure required database and authentication values as runtime environment variables for the chosen hosting provider. Do not commit `.env` files, credentials, or tokens.
