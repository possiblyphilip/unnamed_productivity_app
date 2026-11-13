"use strict";
// For every option, show what comes next after picking it, from the first situation where it is offered.
//   node tools/audit-paths.js [low] [sleep]
const path = require("path");
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));

const energy = process.argv.indexOf("low") !== -1 ? "low" : "normal";
const sleep = Number(process.argv.filter(function (a) { return /^[579]$/.test(a); })[0]) || 7;
const b = Planner.plan(Sample.context, { energy: energy, sleep: sleep });
const text = function (id) { return b.cards[id].label; };
const seen = {};
// breadth first, so each option is shown from the earliest situation it appears in
const queue = [b.root], visited = {};
while (queue.length) {
  const id = queue.shift();
  if (visited[id]) { continue; }
  visited[id] = true;
  const n = b.nodes[id];
  n.cards.forEach(function (c) {
    const key = n.type + ":" + c;
    if (!seen[key]) {
      seen[key] = true;
      const next = b.nodes[n.children["picked:" + c]];
      const more = next.reroll ? "   (more: " + b.nodes[next.children.reroll].cards.map(text).join(" | ") + ")" : "";
      console.log(n.type.padEnd(13) + text(c).padEnd(40) + "->  " + (next.cards.map(text).join(" | ") || "(" + next.quiet + ")") + more);
    }
  });
  Object.keys(n.children).forEach(function (k) { if (n.children[k]) { queue.push(n.children[k]); } });
}
