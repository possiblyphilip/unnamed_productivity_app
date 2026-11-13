"use strict";
// Simulates months of picks with known effects and checks what the learner finds.
// Truth (see js/sim.js): sleep matters on weekend mornings, cycle phase on weekday afternoons, the moon nowhere.
//   node tools/simulate-learner.js            sweep thresholds, then check the demo history
//   node tools/simulate-learner.js demo       only check the demo history
const path = require("path");
const Learner = require(path.join(__dirname, "..", "js", "learner.js"));
const Sim = require(path.join(__dirname, "..", "js", "sim.js"));

const RUNS = 300;
const WEEKS = [2, 4, 6, 8, 10, 12, 16];

function evidentFindings(offers, opts) {
  let all = [];
  Learner.SLICES.forEach(function (s) {
    all = all.concat(Learner.analyze(offers, s, opts).filter(function (f) { return f.evident; }));
  });
  return all;
}

function classify(f) {
  if (f.kind === "pair") { return "pair"; }
  if (f.slice === "weekend-morning" && f.lens === "sleep") { return f.state === "short" && f.pA < f.pB ? "sleep" : f.state === "ok" && f.pA > f.pB ? "sleep" : "wrong-way"; }
  if (f.slice === "weekday-afternoon" && f.lens === "cycle") { return f.state === "luteal" ? (f.pA < f.pB ? "cycle" : "wrong-way") : "cycle-related"; }
  return "false";
}

function pct(x) { return String(Math.round(x * 100)).padStart(3) + "%"; }

function sweep(configs) {
  configs.forEach(function (cfg) {
    const z = cfg.z;
    const genOpts = cfg.gen || {};
    const opts = { zSingle: z, zPair: z + 0.5 };
    const rows = WEEKS.map(function () { return { sleep: 0, cycle: 0, falseRun: 0, pairRun: 0 }; });
    const firstSleep = [], firstCycle = [];
    for (let seed = 1; seed <= RUNS; seed++) {
      const all = Sim.generate(Object.assign({ weeks: 16, seed: seed, startDow: seed % 7 }, genOpts));
      let fs = null, fc = null;
      for (let w = 1; w <= 16; w++) {
        const found = evidentFindings(all.filter(function (r) { return r.t < w * 7; }), opts).map(classify);
        if (fs === null && found.indexOf("sleep") !== -1) { fs = w; }
        if (fc === null && found.indexOf("cycle") !== -1) { fc = w; }
        const i = WEEKS.indexOf(w);
        if (i !== -1) {
          if (found.indexOf("sleep") !== -1) { rows[i].sleep++; }
          if (found.indexOf("cycle") !== -1) { rows[i].cycle++; }
          if (found.indexOf("false") !== -1 || found.indexOf("wrong-way") !== -1) { rows[i].falseRun++; }
          if (found.indexOf("pair") !== -1) { rows[i].pairRun++; }
        }
      }
      if (fs !== null) { firstSleep.push(fs); }
      if (fc !== null) { firstCycle.push(fc); }
    }
    const med = function (xs) { xs.sort(function (a, b) { return a - b; }); return xs.length ? xs[Math.floor(xs.length / 2)] : "none"; };
    console.log("\nzSingle " + z + ", zPair " + (z + 0.5) + ", " + cfg.label + "   (" + RUNS + " simulated users)");
    console.log("weeks   sleep found   cycle found   any false finding   any pair chip");
    WEEKS.forEach(function (w, i) {
      console.log(String(w).padStart(5) + "   " + pct(rows[i].sleep / RUNS).padStart(11) + "   " + pct(rows[i].cycle / RUNS).padStart(11) + "   " + pct(rows[i].falseRun / RUNS).padStart(17) + "   " + pct(rows[i].pairRun / RUNS).padStart(13));
    });
    console.log("median week of first sleep finding: " + med(firstSleep) + " (" + firstSleep.length + "/" + RUNS + " found one by week 16)");
    console.log("median week of first cycle finding: " + med(firstCycle) + " (" + firstCycle.length + "/" + RUNS + " found one by week 16)");
  });
}

function demo() {
  const offers = Sim.demoHistory();
  const problems = [];
  const names = function (found) { return found.map(function (f) { return (f.kind === "single" ? f.lens + "=" + f.state : f.lens.join("+") + "=" + f.state.join("+")); }); };
  console.log("\ndemo history: " + offers.length + " picks over 20 weeks (seed " + Sim.DEMO_SEED + ")");
  const cases = [
    { name: "weekend morning, short sleep", slice: "weekend-morning", states: { sleep: "short", moon: "waxing", cycle: "luteal" }, want: ["sleep=short"], dont: ["moon"] },
    { name: "weekend morning, normal sleep", slice: "weekend-morning", states: { sleep: "ok", moon: "waxing", cycle: "luteal" }, want: ["sleep=ok"], dont: ["moon"] },
    { name: "weekday morning, short sleep", slice: "weekday-morning", states: { sleep: "short", moon: "waxing", cycle: "luteal" }, want: [], dont: ["sleep", "moon", "cycle"] },
    { name: "weekday afternoon, luteal", slice: "weekday-afternoon", states: { sleep: "short", moon: "waxing", cycle: "luteal" }, want: ["cycle=luteal"], dont: ["moon", "sleep"] }
  ];
  cases.forEach(function (c) {
    const got = names(Learner.chipsFor(offers, c.slice, c.states, {}, 3));
    const okWant = c.want.every(function (w) { return got.indexOf(w) !== -1; });
    const okDont = c.dont.every(function (d) { return !got.some(function (g) { return g.indexOf(d) === 0 || g.indexOf("+" + d) !== -1; }); });
    console.log((okWant && okDont ? "ok   " : "FAIL ") + c.name + "  ->  [" + got.join(", ") + "]");
    if (!okWant || !okDont) { problems.push(c.name); }
  });
  ["sleep", "moon", "cycle"].forEach(function (id) {
    const s = Learner.status(offers, id);
    console.log("status " + id + ": " + (s.slices.length ? s.slices.join(", ") : "no clear pattern yet") + " (" + s.n + " usable picks)");
    if (id === "moon" && s.slices.length) { problems.push("moon shows a pattern"); }
  });
  if (problems.length) { console.log("\nproblems: " + problems.join("; ")); process.exit(1); }
  console.log("demo history behaves as intended");
}

const HEAVY = { perDaypart: { morning: 3, afternoon: 3, evening: 2 } };
if (process.argv[2] !== "demo") {
  sweep([
    { z: 2.5, label: "typical use (5 offers a day)" },
    { z: 3.0, label: "typical use (5 offers a day)" },
    { z: 3.5, label: "typical use (5 offers a day)" },
    { z: 3.0, label: "heavy use (8 offers a day)", gen: HEAVY },
    { z: 3.5, label: "heavy use (8 offers a day)", gen: HEAVY }
  ]);
}
demo();
