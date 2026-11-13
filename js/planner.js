(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(require("./model.js")); }
  else { root.Planner = factory(root.Model); }
})(typeof self !== "undefined" ? self : this, function (Model) {
  "use strict";

  // Stand-in for the server. It plans a day as a tree and hands the app a plain bundle.
  // All the thinking is here: what needs what, what the weather allows, what energy allows,
  // what order makes sense. The app only walks the result.
  //
  // An option says which blocks of the day it can appear in, what must already be true
  // (needs), what it makes true (gives), and when to skip it (skipIf). The planner searches
  // every sensible order and writes one node per situation, so each pick leads somewhere
  // that already makes sense and a picked card never comes back.

  var mins = Model.mins, hhmm = Model.hhmm;
  var PERSIST = { dressed: true, fed: true };

  // Deterministic variety: the same day always plans the same way.
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  // Last night's sleep in three bands: about 5 hours, 7 or 9.
  function sleepBand(h) { return h == null ? 7 : h < 6 ? 5 : h < 8 ? 7 : 9; }

  // How much the day can take, from energy and sleep. Below zero the day is gentler (no demanding
  // options, gentle ones first, fewer cards). Above zero there is room for more. Low energy after a long
  // night comes out as an ordinary day.
  function capacity(opts) {
    var b = sleepBand(opts.sleep);
    return (opts.energy === "low" ? -1 : 0) + (b === 5 ? -1 : b === 9 ? 1 : 0);
  }

  function opt(id, text, label, x) { x.id = id; x.text = text; x.label = label; return x; }

  var OPTIONS = [
    opt("coffee_window", "Have a slow coffee by the window", "Coffee by the window", { dur: 10, goal: "g_calm", gentle: true, signal: { overwhelm: -1 }, gives: ["coffee"], skipIf: ["market"], at: { morning: { rank: 1 } } }),
    opt("eat_first", "Have some eggs and toast", "Eggs and toast", { dur: 15, goal: "g_nutrition", signal: { energy: 1 }, gives: ["fed"], skipIf: ["market"], at: { morning: { rank: 2 } } }),
    opt("shower", "Take a shower", "Showering", { dur: 15, goal: "g_body", signal: { energy: 1 }, gives: ["showered"], at: { morning: { rank: 3 } } }),
    opt("stretch", "Stretch", "Stretching", { dur: 10, goal: "g_body", gentle: true, signal: { energy: 1 }, skipIf: ["market"], at: { morning: { rank: 3.5 } } }),
    opt("get_dressed", "Get dressed", "Getting dressed", { dur: 10, gives: ["dressed"], at: { morning: { rank: 1.2, needs: ["showered"] } } }),
    opt("write_25", "Write for 25 minutes", "Writing", { dur: 25, goal: "g_writing", horizon: "medium", demanding: true, signal: { energy: 1 }, at: { morning: { rank: 5, needs: ["coffee"] }, afternoon: { rank: 1 } } }),
    opt("putoff_ten", "Spend ten minutes on something you've been putting off", "Ten minutes on something you were putting off", { kind: "variation", dur: 10, goal: "g_followthrough", horizon: "medium", demanding: true, signal: { overwhelm: 1 }, at: { morning: { rank: 6, needs: ["coffee"] } } }),
    opt("two_emails", "Answer two emails", "Two emails", { kind: "variation", dur: 15, goal: "g_admin", at: { morning: { rank: 7, needs: ["coffee"] } } }),
    opt("perfume", "Put on your good perfume", "Perfume on", { kind: "flirty", chance: 0.75, dur: 2, goal: "g_joy", signal: { mood: 1, social: 1 }, at: { morning: { rank: 8, needs: ["dressed"] } } }),
    opt("market_flowers", "Walk to the market for flowers", "Walk to the market", { kind: "wild", dur: 40, goal: "g_joy", horizon: "medium", demanding: true, signal: { energy: 1, social: 1 }, gives: ["market"], at: { morning: { rank: 1.5, needs: ["dressed"] } } }),
    opt("croissant", "Pick up a croissant and a coffee", "Croissant and coffee", { dur: 15, goal: "g_nutrition", signal: { mood: 1 }, gives: ["fed", "coffee"], skipIf: ["fed"], at: { morning: { rank: 0, needs: ["market"] } } }),
    opt("flowers_water", "Put the flowers in water", "Flowers in water", { dur: 5, goal: "g_joy", signal: { mood: 1 }, at: { morning: { rank: 2, needs: ["market"] } } }),
    opt("tidy_surface", "Put on music and clear one surface", "Clearing a surface", { kind: "wild", dur: 10, goal: "g_calm", signal: { energy: 1 }, at: { morning: { rank: 10, needs: ["coffee"] } } }),
    opt("sketch_15", "Sketch for 15 minutes", "Sketching", { kind: "variation", dur: 15, goal: "g_creative", horizon: "medium", signal: { mood: 1 }, at: { morning: { rank: 11, needs: ["coffee"] }, afternoon: { rank: 2 } } }),
    opt("read_20", "Read for 20 minutes", "Reading", { dur: 20, goal: "g_rest", gentle: true, signal: { overwhelm: -1 }, at: { morning: { rank: 12, needs: ["coffee"] }, afternoon: { rank: 7 }, evening: { rank: 10 } } }),
    opt("walk_block", "Walk around the block", "Walk around the block", { kind: "wild", dur: 15, goal: "g_body", signal: { energy: 1 }, skipIf: ["market"], at: { morning: { rank: 13, needs: ["dressed"] } } }),
    opt("park_walk", "Walk to the park", "Walk to the park", { kind: "wild", dur: 40, goal: "g_joy", horizon: "medium", demanding: true, dry: true, daylight: true, signal: { energy: 1, mood: 1 }, at: { afternoon: { rank: 3 } } }),
    opt("coffee_light", "Have coffee somewhere with good light, in something you like", "Coffee out", { kind: "flirty", chance: 0.75, dur: 45, goal: "g_joy", signal: { mood: 1, social: 1 }, at: { afternoon: { rank: 4, needs: ["dressed"] } } }),
    opt("tea_window", "Have tea by the window", "Tea by the window", { dur: 15, goal: "g_rest", gentle: true, signal: { overwhelm: -1 }, at: { afternoon: { rank: 5 }, evening: { rank: 11 } } }),
    opt("walk_ten", "Go for a short walk, no destination", "Short walk", { kind: "wild", dur: 10, goal: "g_body", gentle: true, daylight: true, at: { afternoon: { rank: 6 } } }),
    opt("lie_down_20", "Lie down for 20 minutes, no screen", "Lying down, no screen", { kind: "variation", dur: 20, goal: "g_rest", gentle: true, onlyLow: true, signal: { energy: -1, overwhelm: -1 }, at: { afternoon: { rank: 0 } } }),
    opt("prep_dinner", "Chop what you need for dinner", "Chopping for dinner", { kind: "variation", dur: 15, goal: "g_nutrition", at: { afternoon: { rank: 8 } } }),
    opt("chicken_bowl", "Have the leftover chicken bowl", "Chicken bowl", { dur: 15, goal: "g_nutrition", gives: ["dinner"], skipIf: ["dinner"], at: { evening: { rank: 1 } } }),
    opt("soup_bread", "Have soup and bread", "Soup and bread", { kind: "variation", dur: 20, goal: "g_nutrition", gives: ["dinner"], skipIf: ["dinner"], at: { evening: { rank: 2 } } }),
    opt("new_recipe", "Cook something you haven't made before", "Cooking something new", { kind: "wild", dur: 45, goal: "g_joy", horizon: "medium", demanding: true, gives: ["dinner"], skipIf: ["dinner"], at: { evening: { rank: 3 } } }),
    opt("lay_out", "Lay out tomorrow's clothes", "Laying out clothes", { dur: 10, goal: "g_admin", signal: { overwhelm: -1 }, at: { evening: { rank: 13 } } }),
    opt("evening_text", "Text someone you like. Make it a little bold.", "Texting someone you like", { kind: "flirty", chance: 0.8, dur: 5, goal: "g_joy", signal: { mood: 1, social: 1 }, at: { evening: { rank: 4 } } }),
    opt("good_thing", "Put on the thing you save for best", "Wearing the good thing", { kind: "flirty", chance: 0.8, dur: 10, goal: "g_joy", signal: { mood: 1 }, at: { evening: { rank: 6 } } }),
    opt("walk_after", "Go for a slow walk", "Walk after dinner", { kind: "wild", dur: 20, goal: "g_body", gentle: true, signal: { overwhelm: -1 }, at: { evening: { rank: 5, needs: ["dinner"] } } }),
    opt("call_friend", "Call someone you've been meaning to", "Calling a friend", { dur: 20, goal: "g_joy", signal: { social: 1 }, at: { evening: { rank: 7 } } }),
    opt("clear_up", "Clear up the kitchen", "Clearing up", { dur: 15, goal: "g_admin", at: { evening: { rank: 8, needs: ["dinner"] } } }),
    opt("bath", "Run a bath", "Having a bath", { kind: "variation", dur: 30, goal: "g_rest", gentle: true, signal: { energy: -1, overwhelm: -1 }, at: { evening: { rank: 9, needs: ["dinner"] } } }),
    opt("journal_3", "Write three lines about today", "Writing three lines", { dur: 10, goal: "g_rest", gentle: true, signal: { overwhelm: -1 }, at: { evening: { rank: 12 } } }),
    opt("bag_tomorrow", "Pack tomorrow's bag", "Packing tomorrow's bag", { dur: 10, goal: "g_admin", at: { evening: { rank: 14 } } }),
    opt("eat_before_out", "Eat something", "Eating before heading out", { dur: 10, goal: "g_nutrition", gives: ["fed"], skipIf: ["fed"], at: { before_event: { rank: 1 } } }),
    opt("bag_keys", "Gather your bag and keys", "Bag and keys", { kind: "variation", dur: 5, signal: { overwhelm: -1 }, at: { before_event: { rank: 2 } } }),
    opt("getting_ready", "Get ready", "Getting ready", { kind: "checklist", dur: 20, signal: { overwhelm: -1 }, steps: ["Dressed", "Keys", "Bag", "Phone charged"], gives: ["ready"], at: { before_event: { rank: 3 } } }),
    opt("leave_early", "Leave ten minutes early", "Leaving early by bus", { kind: "variation", dur: 10, signal: { overwhelm: -1 }, at: { before_event: { rank: 4, needs: ["ready"] } } }),
    opt("directions", "See directions to the appointment", "Heading to the appointment", { kind: "info", dur: 14, at: { during_event: { rank: 1 } } })
  ];

  // ---- the day's blocks, built from the calendar ----
  var BASE = [["morning", 450, 810], ["afternoon", 810, 1020], ["evening", 1020, 1200], ["night", 1200, 1439]];
  var BASE_TITLE = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Tonight" };

  function shortClock(m) {
    var h = Math.floor(m / 60) % 12 || 12, mm = m % 60;
    return h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function makeBlocks(ctx) {
    var specials = [], last = 0;
    (ctx.calendar || []).slice().sort(function (a, b) { return mins(a.start) - mins(b.start); }).forEach(function (e) {
      var s = mins(e.start), en = mins(e.end);
      var before = { type: "before_event", s: Math.max(450, s - 50), e: s - 10, title: "Before " + shortClock(s) };
      var during = { type: "during_event", s: s - 10, e: en, title: e.title || "Busy" };
      if (during.s < last || en <= 450 || s >= 1439 || before.e <= before.s) { return; }
      specials.push(before, during);
      last = en;
    });
    var out = specials.slice();
    BASE.forEach(function (b) {
      var cur = b[1];
      specials.forEach(function (sp) {
        if (sp.e <= cur || sp.s >= b[2]) { return; }
        if (sp.s - cur >= 25) { out.push({ type: b[0], s: cur, e: sp.s, title: BASE_TITLE[b[0]] }); }
        cur = Math.max(cur, sp.e);
      });
      if (b[2] - cur >= 25) { out.push({ type: b[0], s: cur, e: b[2], title: BASE_TITLE[b[0]] }); }
    });
    out.sort(function (a, b) { return a.s - b.s; });
    out[0].s = 450;
    for (var i = 0; i < out.length - 1; i++) { out[i].e = out[i + 1].s; }
    out[out.length - 1].e = 1439;
    return out;
  }

  function dryOk(ctx, b) {
    var segs = ctx.weather || [];
    if (!segs.length) { return true; }
    var dry = 0;
    segs.forEach(function (w) {
      if (w.sky !== "dry") { return; }
      var a = Math.max(b.s, mins(w.from)), z = Math.min(b.e, mins(w.to));
      if (z > a) { dry += z - a; }
    });
    return dry / (b.e - b.s) >= 0.6;
  }

  function lightOk(ctx, b) {
    var a = Math.max(b.s, mins(ctx.sunrise)), z = Math.min(b.e, mins(ctx.sunset));
    return (z > a ? z - a : 0) / (b.e - b.s) >= 0.5;
  }

  function pool(block, facts, opts, ctx) {
    var done = Object.keys(facts).filter(function (k) { return k.indexOf("did_") === 0; }).length;
    if (done >= (opts.maxDone || 12)) { return []; }
    var cap = capacity(opts), out = [];
    OPTIONS.forEach(function (o) {
      var at = o.at[block.type];
      if (!at || facts["did_" + o.id]) { return; }
      if ((at.needs || []).some(function (n) { return !facts[n]; })) { return; }
      if ((o.skipIf || []).some(function (n) { return facts[n]; })) { return; }
      if (o.gives && o.gives.every(function (g) { return facts[g]; })) { return; }
      if (o.dry && !dryOk(ctx, block)) { return; }
      if (o.daylight && !lightOk(ctx, block)) { return; }
      if (o.chance && hash(ctx.day + "|" + block.type + "|" + o.id) % 100 >= Math.round(o.chance * 100)) { return; }
      if (cap < 0 ? o.demanding : o.onlyLow) { return; }
      out.push({ o: o, rank: at.rank + (cap < 0 && o.gentle ? -20 : 0) + (cap > 0 && o.demanding ? -2 : 0) });
    });
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out.map(function (x) { return x.o; });
  }

  var BASE_COUNT = { morning: 3, afternoon: 4, evening: 3, before_event: 3, during_event: 1, night: 1 };

  // How many cards this screen shows: fewer when time is tight, energy is low or the night was short, or the user has already
  // done a few things in this block, and a little variety either way. Never more than four.
  function want(ctx, opts, block, done, key, avail) {
    if (!avail) { return 0; }
    var n = BASE_COUNT[block.type] || 3;
    var cap = capacity(opts);
    if (cap < 0) { n += cap; }
    if (cap > 0) { n += 1; }
    if (done >= 3) { n -= 1; }
    n += [-1, 0, 0, 1, 0][hash(ctx.day + "|" + key) % 5];
    var floor = (block.type === "during_event" || block.type === "night") ? 1 : 2;
    return Math.min(avail, 4, Math.max(floor, n));
  }

  // Take cards in rank order, at most one flirty card on a screen.
  function take(cands, n, skip) {
    var out = [], flirty = false;
    for (var i = 0; i < cands.length && out.length < n; i++) {
      var o = cands[i];
      if (skip && skip[o.id]) { continue; }
      if (o.kind === "flirty") { if (flirty) { continue; } flirty = true; }
      out.push(o);
    }
    return out;
  }

  function persist(facts) {
    var f = {};
    Object.keys(facts).forEach(function (k) { if (PERSIST[k]) { f[k] = true; } });
    return f;
  }

  var BY_ID = {};
  OPTIONS.forEach(function (o) { BY_ID[o.id] = o; });

  function factsObj(list) {
    var f = {};
    list.forEach(function (k) { f[k] = true; });
    return f;
  }

  // A session plans lazily. A node is created with its cards; its children are created when the app
  // arrives at it (ensure). So the work stays small however long the day is, and the app always has
  // the next screen for every card it could pick.
  function session(ctx, opts) {
    opts = opts || {};
    var blocks = makeBlocks(ctx), nodes = {}, cards = {};

    function useCard(o) {
      if (cards[o.id]) { return; }
      cards[o.id] = {
        id: o.id, option: o.id, text: o.text, label: o.label, duration_min: o.dur, steps: o.steps || null,
        tags: { horizon: o.horizon || "short", goal: o.goal || null, kind: o.kind || "routine", novel: o.kind === "wild" },
        signal: o.signal || {}
      };
    }

    function node(bi, facts, offset) {
      var names = Object.keys(facts).sort();
      var key = "b" + bi + "." + offset + "." + names.join("+");
      if (nodes[key]) { return key; }
      var block = blocks[bi];
      var cands = pool(block, facts, opts, ctx);
      var done = names.filter(function (k) { return k.indexOf("did_") === 0; }).length;
      var stem = "b" + bi + ".";
      var first = take(cands, want(ctx, opts, block, done, stem + "0." + names.join("+"), cands.length));
      var seen = {};
      first.forEach(function (o) { seen[o.id] = true; });
      var rest = cands.filter(function (o) { return !seen[o.id]; });
      var shown = offset === 0 ? first : take(rest, want(ctx, opts, block, done, stem + "1." + names.join("+"), rest.length));
      shown.forEach(useCard);
      nodes[key] = {
        title: block.title, type: block.type, window: [hhmm(block.s), hhmm(block.e)],
        cards: shown.map(function (o) { return o.id; }), reroll: offset === 0 && rest.length > 0,
        quiet: shown.length ? null : (block.type === "night" ? "Nothing needed tonight." : "Nothing needed right now."),
        facts: names, bi: bi, off: offset, pending: true, exp: 0, children: {}
      };
      return key;
    }

    function ensure(key) {
      var n = nodes[key];
      if (!n || !n.pending) { return; }
      var facts = factsObj(n.facts);
      n.cards.forEach(function (id) {
        var f = Object.assign({}, facts);
        f["did_" + id] = true;
        (BY_ID[id].gives || []).forEach(function (g) { f[g] = true; });
        n.children["picked:" + id] = node(n.bi, f, 0);
      });
      if (n.reroll) { n.children.reroll = node(n.bi, facts, 1); }
      n.children.expired = n.bi + 1 < blocks.length ? node(n.bi + 1, persist(facts), 0) : null;
      n.pending = false;
    }

    function expand(key, depth) {
      var n = nodes[key];
      if (!n || n.exp >= depth) { return; }
      ensure(key);
      n.exp = depth;
      if (depth <= 1) { return; }
      Object.keys(n.children).forEach(function (k) { if (n.children[k]) { expand(n.children[k], depth - 1); } });
    }

    // After a new session replaces an old one (energy changed, weather arrived), bring back the node
    // the user was on so their progress through the morning is not lost.
    function restore(key) {
      var m = /^b(\d+)\.(\d+)\.(.*)$/.exec(key || "");
      if (!m || Number(m[1]) >= blocks.length) { return null; }
      return node(Number(m[1]), factsObj(m[3].split("+").filter(Boolean)), Number(m[2]));
    }

    var root = node(0, {}, 0);
    var bundle = {
      schema: "bundle/0.2", bundle_id: "demo-" + ctx.day, root: root, cards: cards, nodes: nodes,
      assumptions: { day: ctx.day, energy: opts.energy || "normal", sleep: sleepBand(opts.sleep), blocks: blocks.map(function (b) { return b.type + " " + hhmm(b.s) + "-" + hhmm(b.e); }) }
    };
    return { bundle: bundle, ensure: ensure, expand: expand, restore: restore };
  }

  // The whole tree at once, with a cap on picks per block. For tests and for printing.
  function plan(ctx, opts) {
    var s = session(ctx, Object.assign({ maxDone: 5 }, opts || {}));
    s.expand(s.bundle.root, Infinity);
    return s.bundle;
  }

  return { plan: plan, session: session, OPTIONS: OPTIONS, makeBlocks: makeBlocks, hash: hash, sleepBand: sleepBand };
});
