# Data model

Working draft. The server plans a day as a small tree of offers (a bundle). The web app walks the tree using the clock and what the user does. The app never needs to know why a branch exists.

## Rules the model is built around

1. **The UI is a tree walker.** It shows the current node, follows an outcome to a child, and reports events. Goals, habits and horizon balance stay on the server.
2. **Inaction is an outcome.** Not choosing is recorded and has its own child.
3. **Time is an input.** Nothing reads the system clock directly. Everything takes `now`, so the test scrubber can move it.
4. **Opaque tags.** `tags` and `signal` are carried and echoed back in events. The UI does not interpret them.
5. **Copy is plain.** No praise and no explanations on the card face. An optional `why` is shown only if the user asks.

## Bundle

| Field | Meaning |
|---|---|
| `bundle_id`, `schema` | Identity and format version |
| `generated_at`, `valid_until` | When to ask the server for more |
| `root` | First node id |
| `assumptions` | The context the bundle was planned against: day, location band, calendar hash, `profile_version`, and the state of each lens that currently matters for the day (enabled, with non-trivial learned relevance for the slice). Other lenses are left out, so a changing moon never invalidates the bundle of someone whose picks don't follow it |
| `nodes` | Map of node id to node |

## Node (one offer)

| Field | Meaning |
|---|---|
| `title` | Short heading for the top band, written by the server ("Before 12:30") |
| `window` | `[start, end]` local times the node is on screen |
| `valid_if` | Conditions checked against live context: `free_min_gte`, `weather` (list), `daylight`, `event_within_min_lte` |
| `on_invalid` | Node to show instead when `valid_if` fails |
| `cards` | 1 to 4 cards |
| `variants` | Optional alternates chosen by local state, each with `when` and `cards` |
| `reroll` | Whether "Something else" is shown |
| `children` | Outcome key to node id. Keys: `picked:<card id>`, `expired`, `reroll`. A `*` key is a default for `picked:*` |

### Card

| Field | Meaning |
|---|---|
| `id`, `option` | Card id and the option-bank id it came from |
| `text` | What the user reads |
| `steps` | Optional ordered checklist |
| `duration_min` | How long the activity takes. After a pick, the child enters at the later of `window[0]` and pick time plus duration |
| `tags` | `horizon` (short, medium, long), `goal`, `kind` (routine, variation, wild, checklist, info, quiet, flirty), `novel` |
| `signal` | Weights toward the state estimate, for example `{"energy": 1, "social": -1}` |
| `why` | Optional. Hidden unless the user asks |

## Which node is current

1. Start at `root`, or at the node reached by the last outcome.
2. If `now` is past `window[1]`, follow `expired` (and keep following while the next window has also ended). This is how the scrubber and a closed app both move through the day.
3. If `valid_if` fails against live context, jump to `on_invalid`.
4. If the node has `variants` and the local state matches one, use its cards.
5. If there is no next node, use the local fallback set and ask for a new bundle.

## Option bank (server side, copied locally for fallback)

`id`, `text`, `kind`, `goal`, `horizon`, `duration_min`, `requires` (same predicates as `valid_if`), `signal`, `cooldown_days`, `daily_cap_group`, `status` (active, paused, retired), `paused_until`, `why`.

## Local state

| Item | Contents |
|---|---|
| Context snapshot | `now`, calendar free blocks and next event, weather, daylight, moon, coarse location. Optional cycle phase, device-only by default |
| State estimate | `energy`, `mood`, `social`, `overwhelm`, each with a decay. Updated from the `signal` of picked cards |
| Cursor | Current node, bundle id, path taken, time entered |
| View counters | Per card per node: views and dwell time |
| Guardrails | `last_shown` per option, daily caps (flirty at most 1 per node and 2 per day), paused options, trimmed branches, never-show list |
| Outbox | Pending events with idempotency keys |
| Sync | Last synced, acknowledged event ids, pseudonymous user id, device id |

## Events (device to server)

`offer_shown`, `card_viewed` (with count and dwell), `card_picked`, `reroll`, `offer_expired` (inaction), `app_opened`, `bundle_exhausted`, `note_sent`, `day_mode_set`, `adjustment_undone`, `branch_changed`, `lens_changed`. Each carries `node`, `cards`, `tags` as received, a context hash, a timestamp and an idempotency key.

## Privacy split

- **Device only:** names, free text, calendar titles, exact location, raw cycle dates, the full state estimate.
- **May go to the server:** pseudonymous id, derived bands (phase band, energy band, free minutes), card and option ids, outcomes, timestamps.

## Screen

Three bands. Top: the node `title` plus a line about the last choice, built from the cursor history (it also reads "nothing picked since..." for inaction). Middle: 1 to 4 cards, centered. Bottom: context chips (operational facts, plus lens context only where it predicts the pick for this time slice; see Lenses). The test scrubber is an overlay in test builds only and never changes the layout.

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
- **Lens settings screen:** one plain status line per lens, such as "Seems to matter on Saturday mornings" or "No clear pattern yet". This is where a user sees what the app has learned, and where they turn a lens on or off. It is not on the daily screen.
- **`why`** (shown only if asked) states the pattern as a fact: "Short nights tend to go with slower picks on weekend mornings."

Guardrails: astronomy comes from a calculation library, never from a model. Interpretation text comes from authored packs. Lenses shape the flavor and pace of everyday cards. They are not used to steer large decisions (money, health treatment, ending a relationship or job).

## Adjustments

One record covers notes, day modes, check-ins and configuration:

`{ scope: day | week | standing, target: option | branch | state | mode, action: pause | prefer | avoid | retire, until, source: note | day_mode | config | check_in }`

Any adjustment bumps `profile_version`. The client drops bundles planned against an older version and asks for a new one. After a note the screen shows what changed, with an undo, and never asks a follow-up question.

## Branches (the life-goals screen)

| Field | Meaning |
|---|---|
| `id`, `parent`, `level` | Trunk, bough, branch or twig |
| `status` | active, resting, retired, needs_review |
| `resting_until` | Optional date |
| `depends_on` | Tags: place, job, household, schedule, body_state |
| `goal` | Linked goal id |

Options carry the same `depends_on` tags. A life-event template (moved, new job, divorce, new baby, illness, loss) marks every branch and option with a matching tag as `needs_review`, then shows them in neutral wording to keep, change or drop. Nothing is deleted automatically.
