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
| `cards` | Up to 8 card ids, already in the order to show them (the first `show` are on screen). All conditions have been applied by the planner |
| `quiet` | Text to show when there are no cards ("Nothing needed tonight.") |
| `show` | How many of `cards` are on screen (one to four). The cards after that wait below and fade in when the person pushes the cards up (swipe up, scroll, arrow down). At most four more |
| `title` inside a category | The path, for example "Movement · Stretching" |
| `children` | Outcome key to node id. Keys: `picked:<card id>`, `expired`, and `back` inside a category. Every card has its own child, and a picked card never appears in it |
| `facts` | What is true at this node (for the planner and the checker). The app ignores it |

### Card

| Field | Meaning |
|---|---|
| `id`, `option` | Card id and the option-bank id it came from |
| `text` | What the user reads |
| `steps` | Optional ordered checklist |
| `label` | Short name used in the top band after a pick ("Coffee by the window") |
| `duration_min` | How long the activity takes. The top band reads "Now: <label>, until <time>" for that long, then "Last selection: <label>" |
| `tags` | `horizon` (short, medium, long), `goal`, `kind` (routine, variation, wild, checklist, info, quiet, flirty), `novel` |
| `duration_known` | `false` when the person has not said how long it takes. `duration_min` is then 0 and nothing is guessed. The UI should show it as unknown |
| `short_version` | Optional `{ text, duration_min }`: the least that would still count. Offered when the full version does not fit the time left |
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
- **Funnels:** the option bank is a tree, broad first. A first screen has only broad categories ("Move", "Eat", "Mindful practice", "Work", "Errands", "Relax"). A category (`opens`) adds the fact `in_<name>` and has no activity of its own; picking it opens a screen of narrower options (`under`), which may open narrower ones: Movement, then Stretching, then Hips and hamstrings; Errands, then Shopping, then Groceries; Responsibilities, then Personal, then Taxes. A screen shows only options at the level of the deepest open category. After an activity the day returns to broad choices, except in a `sticky` category (the morning routine) that stays open for its next step until it is empty. Picking a category is navigation only: it is not an activity and does not move the clock. Tapping the background off the cards (`back`) closes the open category and offers it again. A category is only offered if something under it can be, so none opens onto an empty screen, and turning down the last thing inside one closes it.
- **Options** say which blocks they can appear in, with a rank per block, what must already be true (`needs`), what they make true (`gives`), and when to skip them (`skipIf`, also per block). A flag marks options that are demanding, gentle, or only for low energy.
- **Retiring options:** an option is skipped once everything it gives is already true, and `skipIf` retires it for other reasons. A market walk retires coffee, eggs and toast, and a lap round the block, because a croissant and coffee on the way back takes their place.
- **Rejections:** a rejection is its own outcome. The planner answers it with a new set that leaves the option out for the rest of the day, built on demand rather than precomputed (on a real server this is a short request, hidden behind the question the user is answering). Rejecting something other options wait on (a shower before getting dressed, the bedtime wash) assumes it is handled, so the path is not locked. A rejection is logged, and it also counts against the option in the taste score (see "What the person takes up"), so it comes back later in future days.
- **Follow-ups:** a few activities have a next step outside the category: deep work offers "Take a break", writing offers "Read it back", putting something off offers "Note the next step". Each is an option that needs the fact its parent gives, with a rank that puts it first. Cooking something new is a category whose options are recipes.
- **Always something:** the appointment has its own chain (get ready, head out early, then head there) and the night has a bedtime routine that ends with "Turn the lights out", the one thing that ends the day. A set of small fillers (a few slow breaths, water, a minute with no screen) fit any block. They only fill a screen up to its floor, so a screen with real options never has them, and one with none never comes up empty.
- **Facts** are what the user has done. `did_<option>` stops an option repeating within a block. `fed` carries into later blocks; the rest are dropped when a block ends.
- **Conditions** are applied here, not in the app: an option that needs dry weather or daylight appears only if the block is mostly dry or light, and low energy removes demanding options and puts gentle ones first.
- **Sleep bands:** last night's sleep is bucketed to about 5, 7 or 9 hours and the planner makes a variant of the day for each, so the device can switch the moment a wearable reports (or the user sets) the night. Together with energy it gives the day a capacity. Below zero (low energy, or a short night) there are no demanding options, gentle ones come first, lying down is offered, and screens are smaller. Above zero (a long night) demanding options rank earlier and screens are larger. Low energy after a long night comes out as an ordinary day. A new variant restores the node the user was on.
- **How many cards:** one to four on screen, decided by the planner: four on the first screen of a block (three after a short night or low energy, one for the appointment itself), three or four inside a category, one fewer once three things are done in the block. Up to four more wait below. The planner never puts small fillers below.
- **Copy:** plain and short, written for someone who knows how to run their day. Broad on the first screen. No cards for obvious things (getting dressed, keys, shoes) and no incidental detail ("by the window"); detail belongs several levels down, if anywhere.
- **Flirty options** are found, not served. Each has a `chance`, applied deterministically per day, so it turns up on some days and not others. The category "Something playful" is the flirty card; what is under it is ordinary.
- **Depth:** the first screen of a block goes quiet after fourteen picks, which a normal day does not reach. (The test tree uses four, to stay small.)

The planner works lazily. A node is created with its cards, and its children are created the first time the app arrives there, so the app always has the next screen for every card it could pick and the work stays small. A new plan (energy changed, weather arrived) restores the node the user was on, so progress through the morning is kept. For tests, `plan()` builds the whole tree with a lower cap, about 1,500 nodes for the sample day.

## Option bank (server side, copied locally for fallback)

`id`, `text`, `label`, `kind`, `goal`, `horizon`, `duration_min`, `signal`, per-block `rank` and `needs`, `gives`, `skipIf`, weather and daylight conditions, energy flags, `status` (active, paused, retired), `paused_until`, `why`.

Rules the planner reads from an option (all optional, and each does nothing without its input):

| Field | Effect |
|---|---|
| `dur`, `lead_min`, `wrap_min` | The option is offered only if duration plus preparation and cleanup fit what is left of the block after what was already picked in it. `short_version` fits instead if the full one does not. An unknown `dur` is not checked. Not applied to the block that is the event itself |
| `cadence { per_week, min_gap_days }` | Dropped once `per_week` is met or inside the minimum gap, and ranked higher while below target. Needs `ctx.weekCounts` and `ctx.daysSince` (option id to number), filled from the log |
| `low_energy` | On a low-energy day: `skip` drops it, `offer` ranks it higher, `optional` ranks it lower (permitted, never pushed) |
| `phase_fit { phase: rule }` | With `ctx.phase` set to the person's own phase word: `avoid` drops it, `scheduled` and `offer` rank it higher, `optional` lower. Setting `ctx.phase` means placing today in the person's cycle from their stored cycle shape and dates (SERVER.md, `CYCLE`) and mapping that to their own phase names. That mapping is not built yet |

Fields carried on the option but not read yet: `duration_range`, `duration_basis`, `expected_min`, `smallest_piece`, `stakes`, `energy`, `variant_of`, `habit_replaces`.

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

`offer_shown`, `card_viewed` (with count and dwell), `card_picked`, `card_rejected` (with `reason`: `not_feeling_it` or `more`, and the user's words when given), `cards_revealed` (pushed up to see more), `category_back`, `offer_expired` (inaction), `app_opened`, `bundle_exhausted`, `note_sent`, `day_mode_set`, `adjustment_undone`, `branch_changed`, `lens_changed`. Each carries `node`, `cards`, `tags` as received, a context hash, a timestamp and an idempotency key.

## Impression log

Separate from the learner's counts and from the events above: a raw record of every set of cards put in front of the person, kept whether or not they did anything with it. `js/log.js` holds it, `app.js` feeds it, and it is stored on the device (`cc.log`, last 1,500 sets). Nothing in it is interpreted.

| Field | Meaning |
|---|---|
| `id`, `node` | Impression id and the node the set came from |
| `t0`, `t1` | When the set appeared and when it was left |
| `day`, `load`, `bank` | Local date, a page-load id (a reload gives a new one, so a screen seen again after a reload is not an ignored one), and the bank in use (`built-in` or the bank id) |
| `slice`, `dow`, `minutes` | Weekday or weekend by daypart, day of week, minute of the day |
| `lenses` | Every lens state that is true at that moment, **whether or not the lens is switched on** and whether or not it predicts anything: moon (group, name, sign), sleep (hours, state), cycle (day, phase), astrology (season, sun, relation, life path), weather, daylight, energy, day mode, minutes to the next event. `enabled` says which lenses were on |
| `ctx` | The context snapshot kept with picks (astrology, all-day count) |
| `cards` | Every card on the node in the planned order: `pos`, `card`, `option`, `active`, `onScreen` (on screen or waiting below) and `seenAt` (when it first came into view, so cards revealed later get a later time) |
| `views` | `[start, end]` for each stretch in which the set was actually on screen. The count is how many times it was looked at, the sum is the dwell. Leaving the app, opening the menu or another screen ends a view and coming back starts another |
| `events` | What was done, in order: `tap`, `swipe_right`, `swipe_left`, `reveal` (with `how`: `swipe_up`, `scroll`, `key`, `tap`), `back`, `nav`, `reject_reason` (`not_feeling_it` or `more`; the words themselves go to notes, not here) |
| `outcome`, `pick` | `picked`, `rejected`, `back`, `nav`, `expired` (inaction), `left` (the page was closed or reloaded) or `open` while still showing, and the option picked or turned down |

`Log.attention(r)` reads an impression as `acted`, `looked` (on screen 3 seconds or more, then expired or left) or `glanced` (barely seen, so it says little about the options). Cards below the fold that were never revealed count as not seen, not as turned down.

A set opens when it appears and closes on the first pick, rejection, back or navigation, or when the clock moves the person to the next node. A set is not opened while the cards are hidden after a pick. "More for me" is a push up (swipe up, scroll or arrow down), recorded as `reveal`.

## Privacy split

- **Device only (single-device mode):** everything below, for a person who has no server account.
- **With a server account** the server also holds names, free text, calendar titles, the person's cycle dates and cycle shape, and their own phase rules (see SERVER.md, Privacy). Cycle data is opt-in, encrypted with a KMS key, never logged, and deletable. A person can switch it to "keep on this phone only", and the server then gets derived phase bands only and cannot plan ahead by phase.
- **Always device only:** exact location, birth data, the full state estimate.
- **May go to the server:** pseudonymous id, derived bands (phase band, energy band, free minutes), card and option ids, outcomes, timestamps.

## Screen

A hamburger at the top left opens a menu: Today, Stats and Integrations. Integrations lists every app, feed and device that could be connected (calendars, messages, social, wearables and hardware, nutrition and training, cycle apps, sky and place, notes and files, focus tools). A few are live in this prototype: Google Calendar, weather and location, moon, and the sleep and cycle values. The rest are marked planned. Switching a lens on or off, and hiding its chips, happens there. The look is set by a palette (Colors in the menu: Sand and sage by default, the original Sage, Robin's egg, Eggshell and teal, Soft brown, Lively), kept on the device. Each palette is a set of roles in `css/app.css` (page, text, card, card text, accent, panel), so adding one is one block of CSS plus a line in `js/app.js`.

Three bands. A greeting ("Good morning") sits above the first choices of a block, not inside a category. Top: the node `title` plus a line about the last choice, built from the cursor history (it also reads "nothing picked since..." for inaction). Middle: 1 to 4 separate cards, centered (no joined box; a green accent edge on each), Pushing the cards up fades the rest in. Inside a category, tapping the background off the cards goes back. Bottom: context chips, each tappable (a tap opens the Stats screen on that chip's section; see Stats) (operational facts, plus lens context only where it predicts the pick for this time slice; see Lenses). The test scrubber is an overlay in test builds only and never changes the layout.

Cards are chosen by tapping or by swiping right: the other cards fade out, the pick moves up into the title, and three seconds later the next set fades in. Swiping left is an active rejection. A kind question appears ("Can you tell me more about that, or are you just not feeling it?") with two answers: a few words, or just not feeling it. Either way the card slides away and the screen is replaced by a new set. Arrow keys do the same on a focused card.

There is no separate "Not this" control: turning a card down is the swipe left above. Two app-level actions live in the left menu: Tell it something (a one-way note, typed first, voice later, capped at two minutes) and Off-plan today (sick, travelling, big day, rough day). Day modes end at midnight unless the user ends them sooner.

## Lenses

A lens is a signal the user connects or turns on: moon, horoscope, cycle, Garmin sleep, calendar load, late nights, weather. Turning one on gives permission to use the data and gives the planner a small starting assumption that it might matter. The user does not rate how much it matters. The app learns that from what they pick. A lens that is off has no effect: no chip, no card shaping, no bundle invalidation.

```json
{ "id": "sleep", "enabled": true, "hidden": false, "settings": {} }
```

| Field | Meaning |
|---|---|
| `enabled` | Permission to use the data. Sets a small starting prior |
| `hidden` | Use it in planning but never show its chips (for a screen others might see) |
| `settings` | Lens-specific. Birth data stays on the device. Cycle dates and shape go to the server only if the person opted in. Otherwise the server gets derived states such as `{ "moon": "waxing crescent" }` |

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
- **Bottom band:** operational context always appears when it applies (an appointment in 50 minutes, rain). Lens context appears only when its evidence for the current slice passes the threshold, up to three chips, strongest first. If sleep predicts coffee vs running on Saturday mornings but not Monday to Friday, the sleep chip shows on Saturday morning and not on weekdays. A pair chip ("Short night, slower phase") appears only when the pair predicts better than either alone. `hidden` lenses never show chips. Chips are consolidated so the band stays to about four: the practical facts share one chip, and lenses are grouped (sleep with the fitness tracker, moon with zodiac, cycle on its own).
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

## Stats screen

Tapping a context chip, or Stats in the menu, opens a separate page in a dark, quiet tone (the same whatever the palette). It has four sections: Right now (appointment, weather, sunset), Body (sleep, readiness, resting heart rate, HRV, steps, cycle), Sky (moon, moon sign, season, sunrise and sunset) and Goals. The tapped chip's section comes first. A tap anywhere on the page (the menu button aside) goes back to the cards; nothing on it is interactive, and the sections fill the screen so there is little bare background. All of it is invented: the day comes from `js/sample.js`, the body numbers from the test settings, and the Goals rows ("13 degrees closer today, 5 steps this week, 45 degrees off the yearly trajectory") are placeholders from Kyra's notes, labelled as such. There is no progress model behind them yet, and the wording is neutral on purpose (no praise).

## How long things take (learned, nothing asked)

`js/durations.js` estimates an option's real duration from the impression log. The end of a pick is the person's next pick or typed "what I am doing now" note; a long look at the phone (20 seconds or more) with nothing picked counts at half weight. Undone picks (back within two minutes), gaps over four hours and anything past the next calendar event are cut or dropped. An option's number is the 30th percentile of its observations, blended with the interview's stated duration (which counts as three observations) and limited to a third of or three times the stated one. Nothing changes until there is at least three observations' worth of evidence. `adjust()` returns copies of the options with `dur` replaced, `dur_stated` keeping the interview's number, `dur_basis: "observed"` and `dur_obs` the evidence weight. The app applies it whenever a bank is applied. `node tools/check-durations.js [log.json bank.json]` tests it and prints estimates for a real log.

## What the person takes up (learned, nothing asked)

`js/taste.js` turns the impression log into a rank shift for each option (negative is earlier, positive later), and `Planner.session(ctx, { learned })` adds it to the authored rank. Without `learned` (a new person, fewer than 12 sets) the authored order stands. The app reads the log again whenever a set closes with a pick, a turn-down, back or navigation, or a lens changes. That makes a new revision, planned in the background (see "Replanning after a pick").

| Part | What it does |
|---|---|
| Pick lift | Picks against what chance would give. Each card on screen is owed 1 / (cards on screen) of a pick, which corrects for screen size and position. A new option starts from the lift of the category it sits under. Per slice (weekday or weekend by daypart) it starts from its own overall lift. Shift is minus 2.5 times the log of the lift, capped at 5 |
| Rejections | Swiping left costs up to 4 more, scaled by how often it was turned down when shown. Explaining why ("more") weighs 1.4 times as much |
| Staleness | Shown three or more times in a row and never picked: steps back 0.4 per extra time, up to 2 |
| Unseen | Seen fewer than 3 times: an exploration bonus up to 1.5 on a dice roll seeded by day, block and option |
| Wobble | Every option moves up to 0.4 either way from day to day, seeded by day |
| Mood of the day | Reads the last ten hours as a lean toward kinds of option (gentle, demanding, active, restful, social, calm), not particular ones. Picks of a kind against what was on screen move every option of that kind earlier, turning one down moves them later, and options never offered move too. Fades with a three-hour half-life, starts after the first pick and needs no history. Up to 4 per kind |
| Lenses | In a slice and a lens state, was a kind of option (gentle, demanding, active, social, calm) picked more or less often than in other states, among screens that offered both? It uses the learner's own test (`Learner.analyze`) with a stricter bar (3.5 standard errors, at least 8 picks each side, at least 0.2 difference), because many traits and states are tried. Only a pattern that passes moves anything, only in the slice it was found in, and only while the lens is in that state now. Up to 3 per kind. Pure noise moved cards in 0 of 40 simulated runs |
| Recency | A set's weight halves every 21 days, plus a bonus that counts today's sets up to four times over and fades in hours. A glance (on screen under 3 seconds, nothing done) is ignored |

`Taste.counts` fills `ctx.weekCounts` and `ctx.daysSince` from the log, so `cadence` works. `node tools/check-taste.js --verbose` runs unit cases and a 40-day simulated user with fixed likes and dislikes, with and without learning, and checks that learning puts more of what they like on screen without narrowing what is ever shown, and that a day of gentle picks puts more gentle and fewer demanding options on screen later the same day.

Not done: the server does not call it yet (SERVER.md, "Plan on the server": compute `learned` with `LEARNED` and pass it to `Planner.session`), lenses do not feed it, and the weights are set by hand against the simulation, not by real use.

### Replanning after a pick

`js/staging.js` holds a plan that can be replaced while it is in use. The planner builds two levels ahead, so the screen after any pick is already there and is shown at once. A new plan for the new revision (the pick, a turn-down, a lens change) is built in the background, two levels ahead of where the person now is, and swapped in only when no set of cards is on screen: while the cards are hidden after a pick, or when the person moves to a node not yet shown. If it is late, the screen uses the old plan and the new one takes over from the next screen. Cards on screen never change. Asking for a newer revision drops an older one still on its way, and a plan that has arrived but is not allowed yet waits.

Today "in the background" is the local planner run on the next tick (`replanDelay` in `app.js`). The server version replaces the `build` function with a request that sends the pick and lens states and returns a bundle already expanded two levels; nothing else changes. The three seconds the cards stay hidden after a pick is the deadline for the next screen, and the one after it has the activity's own duration. `node tools/check-staging.js` tests the swap rules.
