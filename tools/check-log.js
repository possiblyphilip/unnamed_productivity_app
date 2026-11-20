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
eq(["day","load"].every(k => l.all()[0][k]), true, "day and load stamped");
eq(l.all()[0].load, l.all()[1].load, "same load within a page");
eq(l.all().map(l.attention), ["acted", "looked", "acted"].map((a, i) => l.all()[i] && a), "attention");
const l3 = Log.create(); l3.open(Object.assign(info("q"), { bank: "b1" }), 100); l3.look(true, 100); l3.look(false, 200); l3.open(info("r"), 9000);
eq([l3.all()[0].bank, l3.attention(l3.all()[0])], ["b1", "glanced"], "short view is a glance");
const l4 = Log.create(); l4.open(info("e"), 100); l4.look(true, 100);
l4.act("long_press", { card: "a", option: "A" }, 200); l4.act("add_cancel", { card: "a", option: "A" }, 300);
eq(l4.current() !== null, true, "long press and cancel keep the set open");
l4.act("long_press", { card: "a", option: "A" }, 400); l4.act("add_pick", { card: "a", from: "A", option: "added:messaging-someone", text: "messaging someone" }, 500);
eq([l4.all()[0].events.map(e => e.type), l4.all()[0].outcome, l4.all()[0].pick], [["long_press", "add_cancel", "long_press", "add_pick"], "picked", "added:messaging-someone"], "added pick is logged and picks");
console.log(bad ? bad + " problems" : "log ok");
process.exit(bad ? 1 : 0);
