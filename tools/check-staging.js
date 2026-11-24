"use strict";
// Checks js/staging.js: a plan that is replaced in the background and only swapped in when no cards are on screen.
const path = require("path");
const Staging = require(path.join(__dirname, "..", "js", "staging.js"));

const problems = [];
const bad = (m) => problems.push(m);

function make() {
  const pending = [];
  let readyCalls = 0;
  const slot = Staging.create({
    first: (rev) => ({ rev, made: "now" }),
    build: (rev, done) => { pending.push({ rev, done }); },
    ready: () => { readyCalls++; }
  });
  return { slot, pending, ready: () => readyCalls };
}

// first use builds at once and keeps serving it
let t = make();
if (t.slot.get(1, true).rev !== 1) { bad("the first plan was not built at once"); }
if (t.slot.get(1, false).rev !== 1 || t.pending.length) { bad("an unchanged revision asked for a new plan"); }

// a new revision is asked for once, and the old plan stays until the new one arrives
if (t.slot.get(2, true).rev !== 1) { bad("the old plan was dropped before the new one arrived"); }
t.slot.get(2, true); t.slot.get(2, true);
if (t.pending.length !== 1) { bad("the same revision was asked for " + t.pending.length + " times"); }

// it arrives while cards are on screen: not taken
t.pending[0].done({ rev: 2, made: "later" });
if (t.ready() !== 1) { bad("the app was not told a plan had arrived"); }
if (t.slot.get(2, false).rev !== 1) { bad("a new plan replaced the plan while cards were on screen"); }
if (t.slot.staged() !== 2) { bad("the arrived plan was not kept for later"); }

// the cards are gone: taken
if (t.slot.get(2, true).rev !== 2) { bad("the new plan was not taken once it was allowed"); }
if (t.slot.staged() !== null || t.slot.rev() !== 2) { bad("state is wrong after the swap"); }

// a late plan: the person moves on, the old one served the screen, the new one is taken at the next safe point
t = make();
t.slot.get(1, true);
t.slot.get(2, false);
t.slot.get(2, false); // still showing the screen, nothing has arrived
if (t.slot.get(2, false).rev !== 1) { bad("a late plan changed the screen"); }
t.pending[0].done({ rev: 2 });
if (t.slot.get(2, true).rev !== 2) { bad("a late plan was not used from the next screen"); }

// a newer revision drops an older one still on its way
t = make();
t.slot.get(1, true);
t.slot.get(2, true);
t.slot.get(3, true);
t.pending[0].done({ rev: 2 });
if (t.slot.staged() !== null) { bad("a plan for an old revision was kept after a newer one was asked for"); }
t.pending[1].done({ rev: 3 });
if (t.slot.get(3, true).rev !== 3) { bad("the newest plan was not used"); }
if (t.ready() !== 1) { bad("the app was told about a plan it should not use"); }

if (problems.length) { console.log("PROBLEMS:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("staging checks passed");
