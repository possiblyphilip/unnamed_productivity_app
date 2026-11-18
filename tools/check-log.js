"use strict";
// Checks js/log.js: order, views, reveal, actions, outcomes.
const Log = require("../js/log.js");
const l = Log.create();
const info = (k) => ({ key: k, node: k, slice: "weekday-morning", dow: 1, minutes: 500, lenses: { moon: { group: "new" } }, ctx: {}, source: "test",
  cards: [{ card: "a", option: "A", onScreen: true }, { card: "b", option: "B", onScreen: true }, { card: "c", option: "C", onScreen: false }] });
let bad = 0; const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log("FAIL", m, JSON.stringify(a), JSON.stringify(b)); } };

l.open(info("n1"), 1000); l.look(true, 1000); l.look(true, 1500);
l.look(false, 2000); l.look(true, 3000); l.reveal(3200, "swipe_up"); l.act("swipe_left", { card: "b", option: "B" }, 3300);
l.act("reject_reason", { card: "b", option: "B", reason: "not_feeling_it" }, 3400);
let r = l.all()[0];
eq(r.cards.map(c => c.card), ["a", "b", "c"], "order kept");
eq(l.viewCount(r), 2, "two views");
eq(l.dwellMs(r), 1000 + 400, "dwell");
eq(r.cards[2].seenAt, 3200, "revealed card seen when pushed up");
eq(r.events.map(e => e.type), ["reveal", "swipe_left", "reject_reason"], "events in order");
eq([r.outcome, r.pick], ["rejected", "B"], "outcome");
l.open(info("n2"), 4000); l.look(true, 4000); l.open(info("n3"), 9000);
eq(l.all()[1].outcome, "expired", "inaction is recorded");
l.act("tap", { card: "a", option: "A" }, 9500);
eq([l.all()[2].outcome, l.all()[2].pick], ["picked", "A"], "tap picks");
const l2 = Log.create({ list: JSON.parse(JSON.stringify([{ id: "x", t0: 5, t1: null, views: [[5, 9]], events: [], outcome: "open" }])) });
eq([l2.all()[0].outcome, l2.all()[0].t1], ["left", 9], "dangling impression closed on load");
console.log(bad ? bad + " problems" : "log ok");
process.exit(bad ? 1 : 0);
