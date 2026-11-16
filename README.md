# VentureTrack

A platform for one administrator to manage the individual participants of an
entrepreneurship programme: private messaging, tasks, verified progress tracking
and follow-ups.

**Status**

- Step 1 — click-through sample with made-up people: **done**.
- Step 2a — real sign-in (username + password), invitation and password-reset
  links, saved profiles: **live**.
- Tasks (give, start, hand in with pictures and files, approve or ask for
  changes), verified progress, and private messages between any two people:
  **built and tested against a local Supabase stack; database part applied to
  the hosted project**.
- Money tracking (each participant's monthly money in and out, private to
  them and the owner) and shared spreadsheets (visible to everyone once the
  owner approves): **built and tested locally; database part applied to the
  hosted project**.
- Polls (owner asks, 2–10 choices, one or several picks, anonymous votes):
  **built and tested locally; database part applied to the hosted project**.
- Owner dashboard, milestones, "ask for help", and blocking or deleting a
  participant: **built and tested locally; database part and the
  `manage-account` function applied to the hosted project**.
- Calendar and reminders for everyone: task deadlines remind by themselves
  (the owner for every task, each participant for their own), plus private
  one-off, weekly or monthly reminders anyone can add: **built and tested locally;
  database part applied to the hosted project**.
- Phone app: installable to the home screen (Android and iPhone) with
  notifications for messages, tasks and feedback, help requests, polls,
  shared files, and a morning summary of reminders and deadlines.
- Not built yet: private notes, analytics. Messages
  refresh every few seconds rather than instantly.

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

Phone notifications on the local stack: run `node scripts/local-push-setup.mjs`
once after `supabase start` (and after every `supabase db reset`), then restart
`supabase functions serve`. App icons are drawn by `node scripts/make-icons.cjs`.

Create the one administrator (once):

1. Create a user with a confirmed e-mail (Supabase dashboard → Authentication → Add user).
2. As the database owner run `select private.provision_admin('you@example.com', 'yourusername');`

Tests:

```
npm run test:db                   # 196 database-level checks (pgTAP)
npm run build && npm run test:real  # 94 end-to-end checks; WIPES local accounts
```
