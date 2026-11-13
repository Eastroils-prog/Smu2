# VentureTrack

A platform for one administrator to manage the individual participants of an
entrepreneurship programme: private messaging, tasks, verified progress tracking
and follow-ups.

**Status**

- Step 1 — click-through sample with made-up people: **done**.
- Step 2a — real sign-in (username + password), invitations by e-mail, forgot
  password, saved profiles: **built and tested against a local Supabase stack**.
  Not yet deployed to a hosted project.
- Steps 2b–2d (dashboard, messaging, tasks and progress): not started. Those
  screens exist only in the sample.

Docs: [plan in plain words](docs/PRD.md) · [architecture](docs/ARCHITECTURE.md) ·
[database design reference](docs/schema.sql)

## The sample version (no back end)

```
npm install
npm run build:demo && npm run test:e2e   # clicks through every sample screen
npm run build:single                     # packs the sample into one HTML file
```

## The real app (local)

Needs Docker.

```
npx supabase start                # database, auth, mail catcher (http://127.0.0.1:54324)
npx supabase functions serve      # in a second terminal
cp .env.example .env.local && cp .env.example .env.production.local
                                  # fill both in with the URL and anon key that `supabase status` prints
npm run dev
```

The live website reads its two public settings from `.env.production`.

Create the one administrator (once):

1. Create a user with a confirmed e-mail (Supabase dashboard → Authentication → Add user).
2. As the database owner run `select private.provision_admin('you@example.com', 'yourusername');`

Tests:

```
npm run test:db                   # 34 database-level checks (pgTAP)
npm run build && npm run test:real  # 31 end-to-end checks; WIPES local accounts
```
