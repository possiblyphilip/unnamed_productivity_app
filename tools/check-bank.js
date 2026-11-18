"use strict";
// Plans a weekday and a weekend day against a personal bank (private/bank.json) and prints what the first
// screens would show, with a few structural checks.
const path = require("path");
const fs = require("fs");
const Model = require(path.join(__dirname, "..", "js", "model.js"));
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));
const bankPath = path.join(__dirname, "..", "private", "bank.json");
if (!fs.existsSync(bankPath)) { console.error("no private/bank.json: run tools/convert-intake.js first"); process.exit(1); }
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
Planner.useBank(bank.options, bank.keep);

const problems = [];
const bad = (m) => problems.push(m);
function day(label, date, over) {
  const ctx = Object.assign({}, Sample.context, { day: date, calendar: [] }, over || {});
  const s = Planner.session(ctx, { energy: "normal", sleep: 7 });
  const b = s.bundle;
  const blocks = b.assumptions.blocks;
  console.log("\n" + label + " (" + date + ")  blocks: " + blocks.join(", "));
  // first screen of each block: follow `expired` from the root
  let key = b.root, guard = 0;
  while (key && guard++ < 10) {
    s.ensure(key);
    const n = b.nodes[key];
    const on = n.cards.slice(0, n.show).map((id) => b.cards[id].label);
    const below = n.cards.slice(n.show).map((id) => b.cards[id].label);
    console.log("  " + n.title.padEnd(12) + " " + n.window.join("-") + "  " + (on.join(" | ") || "(" + n.quiet + ")") + (below.length ? "   [below: " + below.join(", ") + "]" : ""));
    if (n.show > 4) { bad(label + ": more than 4 on show at " + n.title); }
    if (!n.cards.length && !n.quiet) { bad(label + ": empty node " + key); }
    key = n.children.expired;
  }
  // open each category on the morning screen and show what is inside
  s.ensure(b.root);
  const root = b.nodes[b.root];
  root.cards.forEach((id) => {
    const c = b.cards[id];
    if (!c.opens) { return; }
    const k = root.children["picked:" + id];
    s.ensure(k);
    const n = b.nodes[k];
    const inside = n.cards.map((cid) => b.cards[cid].label);
    console.log("    " + c.label + " > " + inside.join(", "));
    if (!inside.length) { bad(label + ": category " + c.label + " opens onto nothing"); }
  });
}
day("Weekday", "2026-11-17");
day("Weekend", "2026-11-21");
day("Weekday, appointment", "2026-11-17", { calendar: [{ start: "12:30", end: "13:30", title: "Appointment" }] });
console.log("\n" + (problems.length ? problems.length + " problems:\n" + problems.join("\n") : "bank checks passed"));
process.exit(problems.length ? 1 : 0);
