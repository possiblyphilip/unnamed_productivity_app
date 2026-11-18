"use strict";
// Converts an intake record (see prompts/extract-intake.txt) into the planner's option format and writes
// private/bank.json, which the app loads on this device if it is present. The private folder is not committed.
//
//   node tools/convert-intake.js day_guide_intake_v2.json
//
// Mapping notes are written into the bank's "report" so nothing is dropped silently.
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("usage: node tools/convert-intake.js <intake.json>"); process.exit(1); }
const intake = JSON.parse(fs.readFileSync(src, "utf8"));
const list = intake.options;

// Built-in options kept alongside a personal bank: the appointment chain, the bedtime steps, small fillers.
const KEEP = ["getting_ready", "leave_early", "leave_now", "bed_ready", "lights_out", "breaths_3", "water", "pause_min", "note_mind", "step_outside"];
const BLOCKS = ["morning", "afternoon", "evening", "night"];
// Facts the planner cannot know yet. They are kept on the option as "wants" and not enforced.
const FLAGS = { dry_weather: "dry", daylight: "daylight" };
const MEAL_ONLY_MORNING = "fed";

const byId = {};
list.forEach(function (o) { byId[o.id] = o; });
const children = {};
list.forEach(function (o) { if (o.parent) { (children[o.parent] = children[o.parent] || []).push(o); } });
const pid = function (id) { return "p_" + id; };

const report = { categories_from_children: [], facts_not_enforced: {}, defaults: [], dropped: [] };

function descendants(o) {
  let out = [];
  (children[o.id] || []).forEach(function (c) { out.push(c); out = out.concat(descendants(c)); });
  return out;
}

function blocksOf(o) {
  const kids = descendants(o).filter(function (c) { return !(children[c.id] || []).length; });
  const sources = kids.length ? kids : [o];
  const at = {};
  sources.forEach(function (k) {
    BLOCKS.forEach(function (b) {
      const r = k.blocks && k.blocks[b];
      if (typeof r === "number") { at[b] = Math.min(at[b] === undefined ? 99 : at[b], r); }
    });
  });
  const out = {};
  Object.keys(at).forEach(function (b) { out[b] = { rank: at[b] }; });
  return out;
}

const out = list.map(function (o) {
  const isCat = (children[o.id] || []).length > 0;
  if (isCat && !o.category) { report.categories_from_children.push(o.id + " " + o.label); }
  const needs = [], skipIf = [], wants = [];
  const gives = [];
  const x = { id: pid(o.id), text: o.text, label: o.label, goal: o.goal || null, kind: o.kind === "quiet" ? "routine" : o.kind, horizon: "short" };
  // The app treats the kind "quiet" as an empty screen, so a rest option is an ordinary routine that is gentle.
  (o.needs || []).forEach(function (f) { if (FLAGS[f]) { x[FLAGS[f]] = true; } else { wants.push(f); } });
  (o.skip_if || []).forEach(function (f) { wants.push("not_" + f); });
  (o.gives || []).forEach(function (g) {
    if (g === "fed") { gives.push(o.blocks && Object.keys(o.blocks).length === 1 && o.blocks.morning ? MEAL_ONLY_MORNING : "meal"); }
    else { gives.push(g); }
  });
  if (gives.length) { x.gives = gives; }
  if (wants.length) { x.wants = wants; report.facts_not_enforced[x.id] = wants; }
  if (o.demanding) { x.demanding = true; }
  if (o.gentle) { x.gentle = true; }
  x.signal = {};
  if (o.demanding) { x.signal.energy = 1; }
  if (o.gentle) { x.signal.overwhelm = -1; }
  if (o.goal === "g_1" || o.goal === "g_2") { x.signal.social = 1; }
  if (!isCat) {
    x.dur = o.duration_min || 30;
    if (!o.duration_min) { report.defaults.push(x.id + " " + o.label + ": no duration, set to 30"); }
  }
  if (o.days && o.days !== "any") { x.days = o.days; }
  x.at = blocksOf(o);
  if (!Object.keys(x.at).length) { report.dropped.push(x.id + " " + o.label + ": no block, never offered"); }
  if (isCat) { x.opens = pid(o.id); }
  if (o.parent) { x.under = pid(o.parent); }
  return x;
});

const bank = {
  id: "intake-" + new Date().toISOString().slice(0, 10),
  keep: KEEP,
  options: out,
  report: report
};
const dir = path.join(__dirname, "..", "private");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "bank.json"), JSON.stringify(bank, null, 1));
console.log("wrote private/bank.json: " + out.length + " options, " + out.filter(function (o) { return o.opens; }).length + " categories");
console.log(JSON.stringify(report, null, 1));
