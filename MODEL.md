# Data model

Working draft. The server plans a day as a tree of offers (a bundle). The web app only walks the tree, using the clock and what the user does. The app never needs to know why a branch exists, what needs what, or what the weather allows. In this prototype `js/planner.js` plays the server.

## Rules the model is built around

1. **The UI is a tree walker.** It shows the current node, follows an outcome to a child, and reports events. Goals, habits, order, weather, energy and horizon balance are all decided when the tree is planned.
2. **Inaction is an outcome.** Not choosing is recorded and has its own child.
3. **Time is an input.** Nothing reads the system clock directly. Everything takes `now`, so the test scrubber can move it. In this prototype the day also moves on by itself: every pick moves the clock forward 30 minutes, applied when the next set appears. On a real device time just passes.
4. **Opaque tags.** `tags` and `signal` are carried and echoed back in events. The UI does not interpret them.
5. **Copy is plain.** No praise and no explanations on the card face. An optional `why` is shown only if the user asks.

## Bundle

| Field | Meaning |
|---|---|
| `bundle_id`, `schema` | Identity and format version |
| `generated_at`, `valid_until` | When to ask the server for more |
| `root` | First node id |
| `cards` | Map of card id to card, so a card used in many nodes is stored once |
| `nodes` | Map of node id to node |
| `assumptions` | The context the bundle was planned against: day, energy, the day's blocks, `profile_version`, and the state of each lens that currently matters for the day. When one of these changes, the app asks for a new bundle. Other lenses are left out, so a changing moon never invalidates the bundle of someone whose picks don't follow it |

## Node (one offer)

| Field | Meaning |
|---|---|
| `title` | Short heading for the top band, written by the server ("Before 12:30") |
| `window` | `[start, end]` local times of the block the node belongs to |
| `cards` | Up to 4 card ids, already in the order to show them. All conditions have been applied by the planner |
| `quiet` | Text to show when there are no cards ("Nothing needed tonight.") |
| `reroll` | Whether "Show different options" is available |
| `children` | Outcome key to node id. Keys: `picked:<card id>`, `expired`, `reroll`. Every card has its own child, and a picked card never appears in it |
| `facts` | What is true at this node (for the planner and the checker). The app ignores it |

### Card

| Field | Meaning |
|---|---|
| `id`, `option` | Card id and the option-bank id it came from |
| `text` | What the user reads |
| `steps` | Optional ordered checklist |
| `label` | Short name used in the top band after a pick ("Coffee by the window") |
| `duration_min` | How long the activity takes. The top band reads "Now: <label>, until <time>" for that long, then "Last: <label>" |
| `tags` | `horizon` (short, medium, long), `goal`, `kind` (routine, variation, wild, checklist, info, quiet, flirty), `novel` |
| `signal` | Weights toward the state estimate, for example `{"energy": 1, "social": -1}` |
| `why` | Optional. Hidden unless the user asks |

## Which node is current

1. Start at the cursor's node, or at `root`.
2. If `now` is past `window[1]`, follow `expired` (and keep following while the next window has also ended). This is how the scrubber and a closed app both move through the day.
3. Show the node's cards. If it has none, show its `quiet` text.

That is all the app does. After a pick the cursor moves to the pick's child. The title becomes what was just picked ("Showering"), with its steps and end time underneath, the cards are hidden for three seconds, and then the next set appears. When the activity ends the title goes back to the block's title. Because each card has its own child, the screen always has something to choose, the picked card is gone, and the next cards follow from what was done.

## Planner (the server's job)

The planner searches the day and writes one node per situation.

- **Blocks:** the day is cut into blocks (morning, afternoon, evening, night) and the calendar adds a "before" and a "during" block around each event.
- **Options** say which blocks they can appear in, with a rank per block, what must already be true (`needs`), what they make true (`gives`), and when to skip them (`skipIf`). A flag marks options that are demanding, gentle, or only for low energy.
- **Retiring options:** an option is skipped once everything it gives is already true, and `skipIf` retires it for other reasons. A market walk retires coffee, eggs and toast, and a lap round the block, because a croissant and coffee on the way back takes their place.
- **Rejections:** a rejection is its own outcome. The planner answers it with a new set that leaves the option out for the rest of the day, built on demand rather than precomputed (on a real server this is a short request, hidden behind the question the user is answering). Rejecting something other options wait on (a shower before getting dressed, the bedtime wash) assumes it is handled, so the path is not locked. A rejection is logged but is not yet used by the learner.
- **Follow-ups:** an option can open a path of its own. Writing offers "Read it back" and "Take a break" first, a park walk offers a bench, a bath offers getting comfortable, and "Cook something new" is followed only by recipes (the planner marks them `exclusive`, so they take over the screen until one is chosen). Each follow-up is just an option that needs the fact its parent gives, with a rank that puts it first.
- **Always something:** the appointment has its own chain (leave, phone on silent, then small things) and the night has a bedtime routine that ends with "Turn the lights out", the one thing that ends the day. A set of small fillers (three slow breaths, a glass of water, a minute at the window) fit any block. They only fill a screen up to its floor, so a screen with real options never has them, and one with none never comes up empty.
- **Facts** are what the user has done. `did_<option>` stops an option repeating within a block. `dressed` and `fed` carry into later blocks; the rest are dropped when a block ends.
- **Conditions** are applied here, not in the app: an option that needs dry weather or daylight appears only if the block is mostly dry or light, and low energy removes demanding options and puts gentle ones first.
- **Sleep bands:** last night's sleep is bucketed to about 5, 7 or 9 hours and the planner makes a variant of the day for each, so the device can switch the moment a wearable reports (or the user sets) the night. Together with energy it gives the day a capacity. Below zero (low energy, or a short night) there are no demanding options, gentle ones come first, lying down is offered, and screens are smaller. Above zero (a long night) demanding options rank earlier and screens are larger. Low energy after a long night comes out as an ordinary day. A new variant restores the node the user was on.
- **How many cards:** one to four, decided by the planner. A block has a base count (a free afternoon four, the morning and evening three, the time before an appointment three, the appointment itself one). Low capacity takes one or two off, a long night adds one, so does having already done three things in the block, and a deterministic bit of variety nudges it either way. Never fewer than two unless there is only one real option or it is the appointment or the night.
- **Paging:** a node shows the top candidates by rank. If more remain, `reroll` leads to a node with the next set.
- **Flirty options** are found, not served. Each has a `chance`, applied deterministically per day, so it turns up on some days and not others. At most one flirty card is on a screen.
- **Depth:** a block goes quiet after twelve picks, which a normal day does not reach.

The planner works lazily. A node is created with its cards, and its children are created the first time the app arrives there, so the app always has the next screen for every card it could pick and the work stays small. A new plan (energy changed, weather arrived) restores the node the user was on, so progress through the morning is kept. For tests, `plan()` builds the whole tree with a lower cap, about 1,500 nodes for the sample day.

## Option bank (server side, copied locally for fallback)

`id`, `text`, `label`, `kind`, `goal`, `horizon`, `duration_min`, `signal`, per-block `rank` and `needs`, `gives`, `skipIf`, weather and daylight conditions, energy flags, `status` (active, paused, retired), `paused_until`, `why`.

## Local state

| Item | Contents |
|---|---|
| Context snapshot | `now`, calendar free blocks and next event, weather, daylight, moon, coarse location. Optional cycle phase, device-only by default |
| State estimate | `energy`, `mood`, `social`, `overwhelm`, each with a decay. Updated from the `signal` of picked cards |
| Cursor | Current node and the time it was set. If a new bundle no longer contains the node, the app starts again from `root` and follows `expired` |
| Activity | The last pick (label, steps, end time) for the top band |
| View counters | Per card per node: views and dwell time |
| Guardrails | `last_shown` per option, daily caps (flirty at most 1 per node and 2 per day), paused options, trimmed branches, never-show list |
| Outbox | Pending events with idempotency keys |
| Sync | Last synced, acknowledged event ids, pseudonymous user id, device id |

## Events (device to server)

`offer_shown`, `card_viewed` (with count and dwell), `card_picked`, `card_rejected` (with `reason`: `not_feeling_it` or `more`, and the user's words when given), `reroll`, `offer_expired` (inaction), `app_opened`, `bundle_exhausted`, `note_sent`, `day_mode_set`, `adjustment_undone`, `branch_changed`, `lens_changed`. Each carries `node`, `cards`, `tags` as received, a context hash, a timestamp and an idempotency key.

## Privacy split

- **Device only:** names, free text, calendar titles, exact location, raw cycle dates, the full state estimate.
- **May go to the server:** pseudonymous id, derived bands (phase band, energy band, free minutes), card and option ids, outcomes, timestamps.

## Screen

A hamburger at the top left opens a menu: Today and Integrations. Integrations lists every app, feed and device that could be connected (calendars, messages, social, wearables and hardware, nutrition and training, cycle apps, sky and place, notes and files, focus tools). A few are live in this prototype: Google Calendar, weather and location, moon, and the sleep and cycle values. The rest are marked planned. Switching a lens on or off, and hiding its chips, happens there. The look follows the first demo: sage background, blush panel, paper cards.

Three bands. Top: the node `title` plus a line about the last choice, built from the cursor history (it also reads "nothing picked since..." for inaction). Middle: 1 to 4 cards, centered. Bottom: context chips (operational facts, plus lens context only where it predicts the pick for this time slice; see Lenses). The test scrubber is an overlay in test builds only and never changes the layout.

Cards are chosen by tapping or by swiping right: the other cards fade out, the pick moves up into the title, and three seconds later the next set fades in. Swiping left is an active rejection. A kind question appears ("Can you tell me more about that, or are you just not feeling it?") with two answers: a few words, or just not feeling it. Either way the card slides away and the screen is replaced by a new set. Arrow keys do the same on a focused card.

"Not this" is one quiet control in the top band. It opens a sheet with three tiers: show different options (one reroll per node, a daily cap, and a third reroll in a day goes to the note sheet), tell it something (a one-way note, typed first, voice later, capped at two minutes), and today is off-plan (sick, travelling, big day, rough day). Day modes end at midnight unless the user ends them sooner.

## Lenses

A lens is a signal the user connects or turns on: moon, horoscope, cycle, Garmin sleep, calendar load, late nights, weather. Turning one on gives permission to use the data and gives the planner a small starting assumption that it might matter. The user does not rate how much it matters. The app learns that from what they pick. A lens that is off has no effect: no chip, no card shaping, no bundle invalidation.

```json
{ "id": "sleep", "enabled": true, "hidden": false, "settings": {} }
```

| Field | Meaning |
|---|---|
| `enabled` | Permission to use the data. Sets a small starting prior |
| `hidden` | Use it in planning but never show its chips (for a screen others might see) |
| `settings` | Lens-specific. Birth data and raw cycle dates stay on the device. The server gets derived states such as `{ "moon": "waxing crescent" }` |

### Learned relevance

The device keeps counts, per lens and per pair of lenses, per slice, per option or option kind:

| Item | Meaning |
|---|---|
| `slice` | Weekday or weekend, crossed with daypart. Node kind once there is enough data |
| `shown`, `picked` | How often options were offered and chosen in each lens state (for example short sleep vs normal sleep) |
| `lift` | How much the lens state changes the pick rate, with an interval |
| `evidence` | Whether the lift is believable (minimum counts on both sides, interval excludes no effect). Pairs need stronger evidence than single lenses |

Rules:
1. Learn only from what the user was actually offered. Picks are compared against what was shown, so every `offer_shown` must be logged with its cards.
2. Keep exploring (wild cards, rotated positions) so the planner does not only learn from its own earlier choices.
3. Newer data counts more, so a lens that stops predicting fades.
4. Cold start: an enabled lens begins with a small prior. The server can ship population-level priors built from aggregated, pseudonymous events, and the user's own evidence overrides them.
5. This is prediction, not cause. Nothing in the interface claims a lens makes anything happen.

### Measured behavior

The thresholds in `js/learner.js` (3.0 standard errors for one lens, 3.5 for a pair, at least 8 picks on each side, at least a 0.2 difference in pick rate) come from `tools/simulate-learner.js`. It simulates users with a real sleep effect on weekend mornings, a real cycle effect on weekday afternoons, and a moon lens that does nothing.

| Use | Sleep found by week 16 | Cycle found by week 16 | Runs with a false finding by week 16 |
|---|---|---|---|
| Typical (about 5 offers a day), 3.0 | 51% | 47% | 23% |
| Typical, 3.5 | 30% | 26% | 5% |
| Heavy (about 8 offers a day), 3.0 | 80% | 68% | 30% |
| Heavy, 3.5 | 59% | 42% | 11% |

No setting gives both fast detection and a low false-finding rate. Narrow slices are data-hungry, and testing many lens and slice combinations produces chance findings. Ways to improve it, not built yet: pool across slices (for example weekday against weekend for all dayparts first), shrink small slices toward the pooled estimate, ship population priors, and require a pattern to hold in two separate periods before showing a chip.

### Using relevance

- **Planner:** option score is goal fit + state fit + novelty + cooldown + the sum of learned lift for this slice, per lens and per qualifying pair. A lens with no evidence contributes about nothing. `fits` on an option (a map of lens to the states it suits, for example `{ "moon": { "new": 1 } }`) is an authored hint used only until learned lift exists.
- **Bottom band:** operational context always appears when it applies (an appointment in 50 minutes, rain). Lens context appears only when its evidence for the current slice passes the threshold, up to three chips, strongest first. If sleep predicts coffee vs running on Saturday mornings but not Monday to Friday, the sleep chip shows on Saturday morning and not on weekdays. A pair chip ("Short night, slower phase") appears only when the pair predicts better than either alone. `hidden` lenses never show chips.
- **Wording:** plain facts ("Slept 5h 40m", "Waxing crescent"). No "your lens", no interpretation, no promise.
- **Nothing learned is listed.** The app never shows what it has noticed about the user, the branches, or the picks. A chip is the only place a learned pattern surfaces, and only where it applies. Lenses are switched on or off, and hidden or shown, from the Integrations list.
- **`why`** (shown only if asked) states the pattern as a fact: "Short nights tend to go with slower picks on weekend mornings."

Guardrails: astronomy comes from a calculation library, never from a model. Interpretation text comes from authored packs. Lenses shape the flavor and pace of everyday cards. They are not used to steer large decisions (money, health treatment, ending a relationship or job).

## Adjustments

One record covers notes, day modes, check-ins and configuration:

`{ scope: day | week | standing, target: option | branch | state | mode, action: pause | prefer | avoid | retire, until, source: note | day_mode | config | check_in }`

Any adjustment bumps `profile_version`. The client drops bundles planned against an older version and asks for a new one. After a note the screen shows what changed, with an undo, and never asks a follow-up question.

## Branches (invisible)

| Field | Meaning |
|---|---|
| `id`, `parent`, `level` | Trunk, bough, branch or twig |
| `status` | active, resting, retired, needs_review |
| `resting_until` | Optional date |
| `depends_on` | Tags: place, job, household, schedule, body_state |
| `goal` | Linked goal id |

Branches and their statuses are never shown in the interface. They live in the model and change through adjustments: a typed note now, and a short chat or two-minute message later. A life event described in a note marks the matching branches and options `needs_review`, and the planner resolves them, asking the user at most one short question. Options carry the same `depends_on` tags. Nothing is deleted automatically: a branch is rested or retired, and can come back.
