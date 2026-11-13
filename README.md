# VentureTrack

A platform for one administrator to manage the individual participants of an
entrepreneurship programme: private messaging, tasks, verified progress tracking
and follow-ups.

**Status: Step 1 of the plan is built — a click-through sample version.**
It shows the real screens with made-up people. Nothing is saved, there is no
login and no database yet. Those come in Step 2.

- [The plan in plain words (PRD)](docs/PRD.md)
- [Architecture & implementation plan](docs/ARCHITECTURE.md)
- [Database schema (design reference)](docs/schema.sql)

## Run the sample version

```
npm install
npm run dev          # open the address it prints
```

## Check it

```
npm run build        # type-check and build
npm run test:e2e     # clicks through every screen on phone and desktop sizes
```

`npm run build:single` packs the sample into one HTML file for sharing.
