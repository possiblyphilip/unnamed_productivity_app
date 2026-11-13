"use strict";
// Stand-in for the server planner: builds one sample day (a bundle) and writes
// fixtures/sample-day.json. The web app only ever sees the JSON.
const fs = require("fs");
const path = require("path");

const bank = {};
function option(id, o) {
  bank[id] = Object.assign({
    id: id,
    kind: "routine",
    goal: null,
    horizon: "short",
    duration_min: 10,
    requires: {},
    signal: {},
    cooldown_days: 1,
    daily_cap_group: null,
    status: "active",
    paused_until: null,
    why: null
  }, o);
}

option("coffee_window", { text: "Slow coffee by the window, ten minutes", goal: "g_calm", duration_min: 10, signal: { overwhelm: -1 }, why: "A slow start keeps the first decision of the day small." });
option("stretch_shower", { text: "Stretch, then shower first", kind: "variation", goal: "g_body", duration_min: 25, signal: { energy: 1 } });
option("market_flowers", { text: "Walk to the market for flowers. Bring an umbrella.", kind: "wild", goal: "g_joy", horizon: "medium", duration_min: 40, signal: { energy: 1, social: 1 }, cooldown_days: 7 });
option("perfume", { text: "Put on the good perfume.", kind: "flirty", goal: "g_joy", duration_min: 2, signal: { mood: 1, social: 1 }, daily_cap_group: "flirty", cooldown_days: 3 });
option("eat_first", { text: "Eggs and toast before anything else", goal: "g_nutrition", duration_min: 15, signal: { energy: 1 } });
option("putoff_ten", { text: "Ten minutes on the thing you keep putting off", kind: "variation", goal: "g_followthrough", horizon: "medium", duration_min: 10, signal: { overwhelm: 1 } });
option("tidy_surface", { text: "Put a playlist on and clear one surface", kind: "wild", goal: "g_calm", duration_min: 10, signal: { energy: 1 }, cooldown_days: 5 });
option("write_25", { text: "Write for twenty-five minutes", goal: "g_writing", horizon: "medium", duration_min: 25, signal: { energy: 1 } });
option("two_emails", { text: "Answer the two emails that are waiting", kind: "variation", goal: "g_admin", duration_min: 15, signal: { overwhelm: 0 } });
option("walk_block", { text: "Walk around the block before the rain picks up", kind: "wild", goal: "g_body", duration_min: 15, signal: { energy: 1 } });
option("eat_before_out", { text: "Eat something before you head out", goal: "g_nutrition", duration_min: 10 });
option("bag_keys", { text: "Get your bag and keys together", kind: "variation", duration_min: 5, signal: { overwhelm: -1 } });
option("getting_ready", { text: "Getting ready", kind: "checklist", duration_min: 20, signal: { overwhelm: -1 }, requires: { event_within_min_lte: 60 } });
option("leave_early", { text: "Leave ten minutes early and take the bus to the door", kind: "variation", duration_min: 10, signal: { overwhelm: -1 }, requires: { event_within_min_lte: 60 } });
option("directions", { text: "Directions to the appointment, 14 minutes", kind: "info", duration_min: 14, requires: { event_within_min_lte: 70 } });
option("sketch_15", { text: "Sketch for fifteen minutes, any subject", kind: "variation", goal: "g_creative", horizon: "medium", duration_min: 15, signal: { mood: 1 } });
option("park_walk", { text: "Walk to the nearest park. 12 minutes, good light right now.", kind: "wild", goal: "g_joy", horizon: "medium", duration_min: 40, requires: { weather: ["dry"], daylight: true }, signal: { energy: 1, mood: 1 }, cooldown_days: 7 });
option("coffee_light", { text: "Coffee somewhere with nice lighting. Wear something you like.", kind: "flirty", goal: "g_joy", duration_min: 45, signal: { mood: 1, social: 1 }, daily_cap_group: "flirty", cooldown_days: 5 });
option("lie_down_20", { text: "Lie down for twenty minutes, no screen", kind: "variation", goal: "g_rest", duration_min: 20, signal: { energy: -1, overwhelm: -1 } });
option("tea_window", { text: "Tea by the window", goal: "g_rest", duration_min: 15, signal: { overwhelm: -1 } });
option("walk_ten", { text: "Ten-minute walk, no destination", kind: "wild", goal: "g_body", duration_min: 10, requires: { daylight: true } });
option("read_20", { text: "Read something for twenty minutes", goal: "g_rest", duration_min: 20, signal: { overwhelm: -1 } });
option("prep_dinner", { text: "Chop what you need for dinner now", kind: "variation", goal: "g_nutrition", duration_min: 15 });
option("chicken_bowl", { text: "Leftover chicken bowl, fifteen minutes", goal: "g_nutrition", duration_min: 15 });
option("soup_bread", { text: "Something warm and light: soup and bread", kind: "variation", goal: "g_nutrition", duration_min: 20 });
option("new_recipe", { text: "Cook something you haven't made before", kind: "wild", goal: "g_joy", horizon: "medium", duration_min: 45, cooldown_days: 10 });
option("quiet_now", { text: "Nothing needed right now.", kind: "quiet", duration_min: 0 });
option("quiet_night", { text: "Nothing needed tonight.", kind: "quiet", duration_min: 0 });

const cards = {};
// Cards are built from the bank so text and tags stay in one place.
function card(cardId, optionId, extra) {
  const o = bank[optionId];
  if (!o) { throw new Error("unknown option " + optionId); }
  const c = {
    id: cardId,
    option: optionId,
    text: o.text,
    duration_min: o.duration_min,
    tags: { horizon: o.horizon, goal: o.goal, kind: o.kind, novel: o.kind === "wild" },
    signal: o.signal
  };
  if (o.why) { c.why = o.why; }
  if (cards[cardId]) { throw new Error("duplicate card id " + cardId); }
  cards[cardId] = true;
  return Object.assign(c, extra || {});
}

const nodes = {};
function node(id, window, cardList, rest) {
  nodes[id] = Object.assign({ window: window, cards: cardList, reroll: false, children: {} }, rest || {});
}

node("n_morning", ["07:30", "10:00"], [
  card("m1", "coffee_window"),
  card("m2", "stretch_shower"),
  card("m3", "market_flowers"),
  card("m4", "perfume")
], { reroll: true, children: { "picked:*": "n_midmorning", expired: "n_catchup", reroll: "n_morning_b" } });

node("n_morning_b", ["07:30", "10:00"], [
  card("mb1", "eat_first"),
  card("mb2", "putoff_ten"),
  card("mb3", "tidy_surface")
], { reroll: true, children: { "picked:*": "n_midmorning", expired: "n_catchup", reroll: "n_quiet_am" } });

node("n_quiet_am", ["07:30", "10:00"], [card("qa1", "quiet_now")], { children: { "picked:*": "n_catchup", expired: "n_catchup" } });

node("n_midmorning", ["07:45", "11:30"], [
  card("mm1", "write_25"),
  card("mm2", "two_emails"),
  card("mm3", "walk_block")
], { children: { "picked:*": "n_getready", expired: "n_getready" } });

node("n_catchup", ["10:00", "11:30"], [
  card("c1", "eat_before_out"),
  card("c2", "bag_keys")
], { children: { "picked:*": "n_getready", expired: "n_getready" } });

node("n_getready", ["11:30", "12:20"], [
  card("g1", "getting_ready", { steps: ["Dressed", "Keys", "Bag", "Phone charged"] }),
  card("g2", "leave_early")
], { valid_if: { event_within_min_lte: 60 }, on_invalid: "n_afternoon", children: { "picked:*": "n_appointment", expired: "n_appointment" } });

node("n_appointment", ["12:20", "13:30"], [card("a1", "directions")], { children: { "picked:*": "n_afternoon", expired: "n_afternoon" } });

node("n_afternoon", ["13:30", "17:00"], [
  card("p1", "write_25"),
  card("p2", "sketch_15"),
  card("p3", "park_walk"),
  card("p4", "coffee_light")
], {
  valid_if: { free_min_gte: 45, weather: ["dry"], daylight: true },
  on_invalid: "n_afternoon_wet",
  reroll: true,
  variants: [{
    when: { energy: "low" },
    cards: [card("pl1", "lie_down_20"), card("pl2", "tea_window"), card("pl3", "walk_ten")]
  }],
  children: { "picked:*": "n_evening", expired: "n_evening", reroll: "n_afternoon_wet" }
});

node("n_afternoon_wet", ["13:30", "17:00"], [
  card("pw1", "sketch_15"),
  card("pw2", "read_20"),
  card("pw3", "prep_dinner")
], { reroll: true, children: { "picked:*": "n_evening", expired: "n_evening", reroll: "n_quiet_pm" } });

node("n_quiet_pm", ["13:30", "17:00"], [card("qp1", "quiet_now")], { children: { "picked:*": "n_evening", expired: "n_evening" } });

node("n_evening", ["17:00", "20:00"], [
  card("e1", "chicken_bowl"),
  card("e2", "soup_bread"),
  card("e3", "new_recipe")
], { children: { "picked:*": "n_night", expired: "n_night" } });

node("n_night", ["20:00", "23:59"], [card("q1", "quiet_night")], { children: { "picked:*": null, expired: null } });

const titles = {
  n_morning: "Morning", n_morning_b: "Morning", n_quiet_am: "Morning",
  n_midmorning: "Late morning", n_catchup: "Late morning",
  n_getready: "Before 12:30", n_appointment: "Appointment",
  n_afternoon: "Afternoon", n_afternoon_wet: "Afternoon", n_quiet_pm: "Afternoon",
  n_evening: "Evening", n_night: "Tonight"
};
Object.keys(nodes).forEach(function (id) {
  if (!titles[id]) { throw new Error("no title for " + id); }
  nodes[id].title = titles[id];
});

const day = {
  schema: "bundle/0.1",
  note: "Sample data for the demo. Weather, moon and calendar are invented for one Seattle day.",
  bundle_id: "demo-2026-11-13",
  generated_at: "2026-11-13T06:30",
  valid_until: "2026-11-14T00:00",
  root: "n_morning",
  assumptions: { day: "2026-11-13", place: "Seattle, WA", calendar: "one appointment" },
  nodes: nodes,
  options: bank,
  context: {
    day: "2026-11-13",
    place: { band: "Seattle, WA", lat: 47.6, lon: -122.3 },
    sunrise: "07:05",
    sunset: "16:46",
    moon: { phase: "waxing crescent", illumination: 0.2 },
    weather: [
      { from: "00:00", to: "13:40", sky: "rain" },
      { from: "13:40", to: "16:30", sky: "dry" },
      { from: "16:30", to: "23:59", sky: "rain" }
    ],
    calendar: [
      { start: "12:30", end: "13:30", title: "Appointment", travel_min: 14 }
    ]
  },
  scenarios: [
    { name: "morning, free until 10", now: "08:10", state: {}, expect: "n_morning" },
    { name: "appointment in 50 minutes", now: "11:40", state: {}, expect: "n_getready" },
    { name: "dry free afternoon", now: "14:10", state: {}, expect: "n_afternoon" },
    { name: "same moment, wet", now: "14:10", state: {}, weather_override: "rain", expect: "n_afternoon_wet" },
    { name: "low energy, dry afternoon", now: "14:10", state: { energy: "low" }, expect: "n_afternoon", expect_first_card: "pl1" },
    { name: "evening", now: "20:30", state: {}, expect: "n_night" }
  ]
};

const out = path.join(__dirname, "..", "fixtures", "sample-day.json");
fs.writeFileSync(out, JSON.stringify(day, null, 2) + "\n");
console.log("wrote " + out);
