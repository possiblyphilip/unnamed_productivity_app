"use strict";
// Checks js/durations.js: how long things take, learned from the impression log with nothing asked of the person.
//   node tools/check-durations.js            synthetic cases
//   node tools/check-durations.js log.json bank.json   also prints estimates for a real exported log and bank
const fs = require("fs");
const path = require("path");
const D = require(path.join(__dirname, "..", "js", "durations.js"));

const problems = [];
const bad = (m) => problems.push(m);
const MIN = 60000, T0 = Date.UTC(2026, 10, 18, 15, 0, 0);

let n = 0;
const set = (t, over) => Object.assign({ id: "s" + (n++), t0: t, t1: t, outcome: "picked", pick: null, events: [], views: [], lenses: { nextEventIn: null } }, over || {});
// A pick at minute m, then the screen that opens by itself a moment later, then the person's next pick at minute m + gap.
function pickThenPick(id, m, gap, extra) {
  const t = T0 + m * MIN;
  return [set(t, Object.assign({ pick: id }, extra || {})), set(t + 3000, { outcome: "expired", t1: t + gap * MIN - 1000 }), set(T0 + (m + gap) * MIN, { pick: "x_other" })];
}
const opt = (id, dur, over) => Object.assign({ id: id, text: id, label: id, dur: dur }, over || {});
const get = (list, id) => list.find((o) => o.id === id);

// four picks that each ran about 20 minutes, stated 60
let log = [];
[0, 100, 200, 300].forEach((m) => log = log.concat(pickThenPick("a", m, 20)));
let adj = D.adjust([opt("a", 60), opt("x_other", 10)], log);
const a = get(adj, "a");
if (!(a.dur < 60 && a.dur >= 20)) { bad("evidence of 20 minutes did not pull a stated 60 down (got " + a.dur + ")"); }
if (a.dur_stated !== 60 || a.dur_basis !== "observed") { bad("the stated duration and basis were not kept"); }

// not enough evidence leaves the option untouched
const few = D.adjust([opt("a", 60)], pickThenPick("a", 0, 20).concat(pickThenPick("a", 100, 20)));
if (few[0].dur !== 60 || few[0].dur_basis) { bad("two observations changed a duration"); }

// the input is not changed
const input = [opt("a", 60)];
D.adjust(input, log);
if (input[0].dur !== 60 || input[0].dur_stated !== undefined) { bad("adjust changed its input"); }

// an immediate back undoes the pick
const t = T0;
const undone = [set(t, { pick: "a" }), set(t + 3000, { outcome: "back", t1: t + 30000 }), set(t + 20 * MIN, { pick: "x_other" })];
if (D.observe(undone, [opt("a", 60)]).a) { bad("a pick that was undone at once was counted"); }

// gaps past four hours are not about the activity
if (D.observe(pickThenPick("a", 0, 300), [opt("a", 60)]).a) { bad("a gap over four hours was counted"); }

// the next calendar event ends the activity
const capped = D.observe(pickThenPick("a", 0, 90, { lenses: { nextEventIn: 30 } }), [opt("a", 60)]);
if (!capped.a || Math.round(capped.a.obs[0].min) !== 30) { bad("the gap was not cut at the next calendar event"); }

// a glance is nothing, a long look is half a pick
const t1 = T0, base = pickThenPick("a", 0, 40);
base[1].views = [[t1 + 10 * MIN, t1 + 10 * MIN + 5000]];
if (D.observe(base, [opt("a", 60)]).a.obs.length !== 1) { bad("a five-second glance counted as evidence"); }
const long = pickThenPick("a", 0, 40);
long[1].views = [[t1 + 10 * MIN, t1 + 10 * MIN + 40000]];
const lo = D.observe(long, [opt("a", 60)]).a.obs;
if (lo.length !== 2 || lo.map((o) => o.w).sort().join() !== "0.5,1") { bad("a long look with no pick was not counted at half weight"); }

// something typed as "what I am doing now" ends the activity
const now = [set(T0, { pick: "a" }), set(T0 + 3000, { outcome: "left", t1: T0 + 50 * MIN, events: [{ type: "now", t: T0 + 25 * MIN }] })];
const nobs = D.observe(now, [opt("a", 60)]);
if (!nobs.a || Math.round(nobs.a.obs[0].min) !== 25) { bad("a typed 'what I am doing now' did not end the activity"); }

// categories and unknown options are ignored
const cats = D.observe(pickThenPick("c", 0, 20), [opt("c", null, { opens: "p_c" })]);
if (cats.c) { bad("a category was observed"); }
if (D.observe(pickThenPick("zzz", 0, 20), [opt("a", 60)]).zzz) { bad("an option that is not in the bank was observed"); }

// an option with no stated duration gets one once there is evidence
let log2 = [];
[0, 100, 200].forEach((m) => log2 = log2.concat(pickThenPick("b", m, 25)));
const nb = get(D.adjust([opt("b", null)], log2), "b");
if (nb.dur !== 25 || nb.dur_stated !== null) { bad("an unknown duration was not filled from three observations (got " + nb.dur + ")"); }

// estimates stay within reach of what the person said
let log3 = [];
for (let i = 0; i < 12; i++) { log3 = log3.concat(pickThenPick("c", i * 100, 200)); }
const far = get(D.adjust([opt("c", 10)], log3), "c");
if (far.dur > 30) { bad("an estimate went past three times the stated duration (" + far.dur + ")"); }
let log4 = [];
for (let i = 0; i < 12; i++) { log4 = log4.concat(pickThenPick("d", i * 100, 1)); }
const near = get(D.adjust([opt("d", 60)], log4), "d");
if (near.dur < 20) { bad("an estimate went below a third of the stated duration (" + near.dur + ")"); }

// rounding
if (D.round(7.4) !== 7 || D.round(23) !== 25 || D.round(0.2) !== 1) { bad("rounding is wrong"); }

console.log(problems.length ? problems.length + " problems:\n" + problems.join("\n") : "duration checks passed");

// optional: a real log and bank
if (process.argv[3]) {
  const sets = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const bank = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const seen = D.observe(sets, bank.options);
  D.adjust(bank.options, sets).forEach((o, i) => {
    const s = seen[o.id];
    if (!s) { return; }
    console.log(o.label.padEnd(26), "stated", String(bank.options[i].dur || "?").padStart(3), "| observed", s.obs.length, "(weight " + s.n + ", low quantile " + Math.round(s.q) + " min) | planning with", o.dur, o.dur_basis ? "(observed)" : "(not enough yet)");
  });
}
process.exit(problems.length ? 1 : 0);
