# Today

A card-based day guide. A throwaway prototype for working out the idea, not a product.

**Live:** https://possiblyphilip.github.io/unnamed_productivity_app/

Open it on a phone. On iPhone: Share, then Add to Home Screen.

## What it does

- Swipe a card right (or tap it) to choose it; swipe left to turn it down, which asks kindly whether you want to say more or just aren't feeling it.
- Shows one to four option cards for right now. Ignoring them is a valid choice, and the cards change as the day moves. A picked card disappears, the next cards follow from what you did (a shower comes before getting dressed, which comes before perfume), and what you picked shows in the top band ("Now: Coffee by the window, until 8:20 am").
- Learns from what is picked, not from ratings. Context chips at the bottom show a signal (sleep, moon, cycle) only where it has predicted the user's picks for that time slice.
- "Not this" is a quiet control with three tiers: a reroll, a typed note, and day modes.
- The menu at the top left opens an Integrations list of every app, feed and device that could be connected. A few are live (Google Calendar, weather and location, moon). The app never shows what it has learned, the branches, or the picks; that stays in the model.

A refresh starts the day from scratch (only the Google Calendar sign-in is kept). A made-up 20-week pick history is built in, so learned chips and ordering show from the first open. Sleep is a three-way selector (5, 7 or 9 hours) and each setting is a different plan of the day.

The red cross-hatched strip on the right is a test-only time scrubber. Add `#clean` to the address to hide it, `#test` to bring it back.

## Files

- `MODEL.md`: the data model.
- `js/`: `planner.js` (stands in for the server and plans the day as a tree), `model.js` (walks the tree), `sample.js` (one invented day), `learner.js` (what predicts picks), `sim.js` (made-up history), `context.js` (moon, weather, calendar), `app.js` (screen).
- `tools/check-sample-day.js` plans the sample day and checks the tree. `tools/print-tree.js` prints the planned tree as an outline. `tools/simulate-learner.js` measures the learner on simulated users (about 30 seconds).

## Run locally

```
python3 -m http.server 8765
```

Then open http://localhost:8765. The scripts in `tools/` need Node 12 or newer.

`SPEC.md` describes the first prototype and is out of date.
