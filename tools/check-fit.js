"use strict";
// Checks the planner's rules for a person's own options: time that fits (with preparation and cleanup and a
// shorter version), unknown durations, weekly cadence, low-energy rules and phase rules.
//   node tools/check-fit.js
const path = require("path");
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));

const problems = [];
const bad = (m) => problems.push(m);
const o = (id, over) => Object.assign({ id: id, text: id, label: id, kind: "routine", dur: 20, at: { morning: { rank: 1 } }, signal: {} }, over || {});

// A 40-minute window before an appointment, so time is tight. The morning block is the first block of the day.
function offered(list, ctx, opts) {
  Planner.useBank(list, []);
  const s = Planner.session(Object.assign({}, Sample.context, { day: "2026-11-17", calendar: [] }, ctx || {}), Object.assign({ energy: "normal", sleep: 7 }, opts || {}));
  const b = s.bundle;
  s.ensure(b.root);
  const n = b.nodes[b.root];
  return { ids: n.cards, cards: b.cards };
}
const has = (r, id) => r.ids.indexOf(id) !== -1;

// time
let r = offered([o("long", { dur: 400 }), o("ok"), o("shortable", { dur: 400, short_version: { text: "a little", duration_min: 20 } }), o("unknown", { dur: null })]);
if (has(r, "long")) { bad("an option longer than the whole block was offered"); }
if (!has(r, "ok")) { bad("an option that fits was dropped"); }
if (!has(r, "shortable")) { bad("an option whose short version fits was dropped"); }
if (!has(r, "unknown")) { bad("an option with an unknown duration was dropped"); }
if (has(r, "unknown") && r.cards.unknown.duration_known !== false) { bad("an unknown duration is not marked unknown on the card"); }
if (has(r, "shortable") && !r.cards.shortable.short_version) { bad("the short version is not passed to the card"); }

// preparation and cleanup count
r = offered([o("tight", { dur: 340, lead_min: 15, wrap_min: 10 }), o("snug", { dur: 330, lead_min: 15, wrap_min: 10 })]);
if (has(r, "tight")) { bad("preparation and cleanup were not counted"); }
if (!has(r, "snug")) { bad("an option that fits with its buffers was dropped"); }

// cadence
const cad = o("run", { cadence: { per_week: 2, min_gap_days: 1 } });
if (!has(offered([cad], { weekCounts: { run: 1 } }), "run")) { bad("cadence blocked an option below its weekly target"); }
if (has(offered([cad], { weekCounts: { run: 2 } }), "run")) { bad("cadence did not stop an option that met its weekly target"); }
if (has(offered([cad], { daysSince: { run: 0 } }), "run")) { bad("cadence did not honour the minimum gap"); }
if (!has(offered([cad], {}), "run")) { bad("cadence changed anything without a log"); }

// low energy
const lowSkip = o("hard", { low_energy: "skip" });
if (has(offered([lowSkip], {}, { energy: "low" }), "hard")) { bad("low_energy skip was offered on a low day"); }
if (!has(offered([lowSkip], {}, { energy: "normal" }), "hard")) { bad("low_energy skip removed the option on a normal day"); }
r = offered([o("a", { at: { morning: { rank: 1 } } }), o("b", { low_energy: "offer", at: { morning: { rank: 2 } } })], {}, { energy: "low" });
if (r.ids.indexOf("b") > r.ids.indexOf("a")) { bad("low_energy offer did not move the option up on a low day"); }
r = offered([o("a", { at: { morning: { rank: 3 } } }), o("b", { low_energy: "optional", at: { morning: { rank: 1 } } })], {}, { energy: "low" });
if (r.ids.indexOf("b") < r.ids.indexOf("a")) { bad("low_energy optional did not move the option down on a low day"); }

// phase
const ph = o("train", { phase_fit: { "Follicular": "scheduled", "Late luteal": "avoid" } });
if (has(offered([ph], { phase: "late luteal" }), "train")) { bad("an avoided phase still offered the option"); }
if (!has(offered([ph], { phase: "follicular" }), "train")) { bad("a scheduled phase dropped the option"); }
if (!has(offered([ph], {}), "train")) { bad("phase rules changed anything without a phase"); }
r = offered([o("a", { at: { morning: { rank: 3 } } }), o("b", { phase_fit: { "x": "scheduled" }, at: { morning: { rank: 4 } } })], { phase: "X" });
if (r.ids.indexOf("b") > r.ids.indexOf("a")) { bad("a scheduled phase did not move the option up"); }

Planner.useBank(null);
console.log(problems.length ? problems.length + " problems:\n" + problems.join("\n") : "fit checks passed");
process.exit(problems.length ? 1 : 0);
