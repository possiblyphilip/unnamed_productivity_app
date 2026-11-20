"use strict";
// Checks that options the person added come back as first-screen cards in the right part of the day.
const Planner = require("../js/planner.js");
let bad = 0; const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) { bad++; console.log("FAIL", m, JSON.stringify(a), JSON.stringify(b)); } };
const ctx = { day: "2026-11-19", calendar: [], weather: [], sunrise: "07:00", sunset: "17:00" };
const rootCards = () => { const b = Planner.plan(ctx, {}); return b.nodes[b.root].cards.map((id) => b.cards[id].text); };
const at = (h) => new Date(2026, 10, 18, h, 0).getTime(); // a Wednesday
const none = rootCards();
Planner.setAdded([{ id: "added:messaging-someone", text: "Messaging someone", times: [at(9), at(10)] }]);
const withIt = Planner.plan(ctx, {}); const root = withIt.nodes[withIt.root];
eq(root.cards.some((id) => withIt.cards[id].text === "Messaging someone"), true, "added option is a card on the first morning screen");
eq(Planner.OPTIONS.filter((o) => o.id === "added:messaging-someone").length, 1, "present once");
Planner.setAdded([{ id: "added:messaging-someone", text: "Messaging someone", times: [at(21)] }]);
eq(Object.keys(Planner.OPTIONS.filter((o) => o.id === "added:messaging-someone")[0].at), ["night"], "re-set replaces the old times");
eq(Planner.OPTIONS.filter((o) => o.id === "added:messaging-someone").length, 1, "re-set does not duplicate");
Planner.setAdded([]);
eq(rootCards(), none, "removing added options restores the plan");
console.log(bad ? bad + " problems" : "added ok");
process.exit(bad ? 1 : 0);
