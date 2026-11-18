# Unconscious

A card-based day guide. A throwaway prototype for working out the idea, not a product.

**Live:** https://possiblyphilip.github.io/unnamed_productivity_app/

Open it on a phone. On iPhone: Share, then Add to Home Screen. On Android: the browser menu, then Install app or Add to Home Screen. Opened from the home screen it has no address bar. The menu shows an Install app item when Chrome says the app can be installed. If neither appears, check you are in Chrome itself and not a link opened inside another app (messages, email, social). In a browser tab a page cannot hide the bar by itself; on Android and desktop the menu has a Full screen item.

## What it does

- Swipe a card right (or tap it) to choose it; swipe left to turn it down, which asks kindly whether you want to say more or just aren't feeling it.
- Starts every block with three or four broad cards (Move, Eat, Mindful practice, Work, Errands, Relax), and each pick narrows: Movement, then Stretching, then Hips and hamstrings. Push the cards up to fade in more; Back steps out of a category. Shows one to four option cards for right now. Ignoring them is a valid choice, and the cards change as the day moves. A picked card disappears, the next cards follow from what you did (a shower comes before getting dressed, which comes before perfume), and what you picked shows in the top band ("Now: Coffee by the window, until 8:20 am").
- Learns from what is picked, not from ratings. Context chips at the bottom show a signal (sleep, moon, cycle) only where it has predicted the user's picks for that time slice.
- The left menu has Tell it something (a typed note) and Off-plan today (sick, travelling, a big day, a rough one). Turning a single card down is the swipe left.
- The menu at the top left opens an Integrations screen with only what works now: Google Calendar, weather and location, moon, sleep hours and cycle days (set by hand), and astrology (a birthday, moon sign and season, and your sign against the moon). Its settings are kept across refreshes. Every pick also logs the astrology signals whether or not the lens is on, so they can be tested against picks later. The app never shows what it has learned, the branches, or the picks; that stays in the model.

A refresh starts the day from scratch (only the Google Calendar sign-in is kept). A made-up 20-week pick history is built in, so learned chips and ordering show from the first open. Sleep is a three-way selector (5, 7 or 9 hours) and each setting is a different plan of the day.

Time is the real clock. In test mode (`#test`) every pick can move the time forward 30 minutes, and the test strip shows and sets the time. The bottom band shows the lenses that are switched on under Integrations (sleep and cycle day as you set them, moon, and the astrology rows).

The red cross-hatched strip on the right is a test-only time scrubber, hidden by default. Add `#test` to the address to bring it back. Sleep, cycle day and energy are set on the Integrations screen and kept across refreshes.

## Files

- `MODEL.md`: the data model.
- `js/`: `planner.js` (stands in for the server and plans the day as a tree), `model.js` (walks the tree), `sample.js` (one invented day), `learner.js` (what predicts picks), `sim.js` (made-up history), `context.js` (moon, weather, calendar), `log.js` (the impression log: what was shown, which lenses were true, views and actions), `astro.js` (sun sign, moon-sign relation, life path from a birthday), `app.js` (screen).
- `tools/check-log.js` checks the impression log. `tools/check-sample-day.js` plans the sample day and checks the tree. `tools/print-tree.js` prints the planned tree as an outline. `tools/simulate-learner.js` measures the learner on simulated users (about 30 seconds).

## Run locally

```
python3 -m http.server 8765
```

Then open http://localhost:8765. The scripts in `tools/` need Node 12 or newer.

`SPEC.md` describes the first prototype and is out of date.
