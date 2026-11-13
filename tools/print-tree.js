"use strict";
// Prints the planned tree as an outline, so it can be read.
//   node tools/print-tree.js [depth] [low]     depth is how many picks to follow (default 2)
const path = require("path");
const Planner = require(path.join(__dirname, "..", "js", "planner.js"));
const Sample = require(path.join(__dirname, "..", "js", "sample.js"));

const depth = Number(process.argv[2]) || 2;
const energy = process.argv.indexOf("low") !== -1 ? "low" : "normal";
const b = Planner.plan(Sample.context, { energy: energy });
const label = function (id) { return b.cards[id].label; };

console.log("blocks: " + b.assumptions.blocks.join(" | "));
console.log("energy: " + energy + ", " + Object.keys(b.nodes).length + " nodes\n");

function show(id, level, via) {
  const n = b.nodes[id];
  const pad = "  ".repeat(level);
  console.log(pad + (via ? "[" + via + "] " : "") + n.title + " " + n.window.join("-") + ":  " + (n.cards.map(label).join("  |  ") || "(" + n.quiet + ")") + (n.reroll ? "   (reroll: " + b.nodes[n.children.reroll].cards.map(label).join("  |  ") + ")" : ""));
  if (level >= depth) { return; }
  n.cards.forEach(function (c) { show(n.children["picked:" + c], level + 1, label(c)); });
}
show(b.root, 0, null);
