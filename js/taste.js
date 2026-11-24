(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(require("./learner.js")); }
  else { root.Taste = factory(root.Learner); }
})(typeof self !== "undefined" ? self : this, function (Learner) {
  "use strict";

  // What this person actually takes up, turned into a nudge on each option's rank. The planner adds the nudge
  // to the authored rank (lower is earlier), so the authored order is the starting point and the person's own
  // behaviour moves it. Everything comes from the impression log (js/log.js); nothing is asked.
  //
  //   pick lift   Picks of the option against what chance would give: each time a card is on screen in a set that
  //               matters, it is "owed" 1 / (cards on screen) of a pick. Dividing by that corrects for screen size
  //               and for position, so an option is not rewarded for having been shown first. A new option starts
  //               from the lift of the category it sits in, so a person who always walks in "Move" starts the
  //               next movement option ahead. Per slice (weekday or weekend by daypart) it starts from its own
  //               overall lift.
  //   rejections  Swiping it away costs more than being passed over, and explaining why costs a little more.
  //   staleness   Seen several times in a row and never picked: it steps back until it is picked or a day goes by.
  //   unseen      Options seen fewer than SEEN_FULL times get an exploration bonus on a seeded dice roll, so the
  //               planner is not only learning from what it already chose to show (MODEL.md, "Learned relevance", rule 2).
  //
  // Older sets count less (half-life below). A glance (on screen under 3 seconds, nothing done) says nothing.
  // The long view waits for MIN_SETS sets, so a new person gets the authored order. The mood of the day (see mood())
  // does not wait.
  var DEFAULTS = {
    halfLifeDays: 21, minSets: 12, glanceMs: 3000, k: 4,
    pickScale: 2.5, pickMax: 5, rejectScale: 5, rejectMax: 4, moreWeight: 1.4,
    staleAfter: 3, staleStep: 0.4, staleMax: 2,
    seenFull: 3, exploreMax: 1.5, jitter: 0.4,
    lensZ: 3.5, lensScale: 2, lensMax: 3, lensTraits: ["gentle", "demanding", "active", "social", "calm"],
    todayBoost: 3, todayHalfLifeH: 3, moodHours: 10, moodK: 1.5, moodScale: 2.5, moodMax: 4
  };
  var DAY = 86400000;
  var SLICES = ["weekday-morning", "weekday-afternoon", "weekday-evening", "weekend-morning", "weekend-afternoon", "weekend-evening"];

  function cfg(o) { return Object.assign({}, DEFAULTS, o || {}); }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function dwell(r) { return (r.views || []).reduce(function (s, v) { return s + (v[1] - v[0]); }, 0); }

  function acted(r) { return r.outcome === "picked" || r.outcome === "rejected" || r.outcome === "back" || r.outcome === "nav"; }

  function reasonWeight(r, c) {
    var w = 1;
    (r.events || []).forEach(function (e) { if (e.type === "reject_reason" && e.reason === "more") { w = c.moreWeight; } });
    return w;
  }

  // A set's weight: a slow fade over weeks, plus a much bigger one that fades over hours, so what the person did
  // this morning counts several times over by the afternoon.
  function weight(r, now, c) {
    var age = Math.max(0, now - r.t0);
    var w = Math.pow(0.5, age / (c.halfLifeDays * DAY));
    if (age < c.moodHours * 3600000) { w += c.todayBoost * Math.pow(0.5, age / (c.todayHalfLifeH * 3600000)); }
    return w;
  }

  // What an option is like, in terms that carry across options: tired and gentle, or ready for something hard.
  function traits(o) {
    var t = [], s = o.signal || {};
    if (o.gentle) { t.push("gentle"); }
    if (o.demanding) { t.push("demanding"); }
    if (s.energy > 0) { t.push("active"); }
    if (s.energy < 0) { t.push("restful"); }
    if (s.social > 0) { t.push("social"); }
    if (s.overwhelm < 0) { t.push("calm"); }
    return t;
  }

  // How the last few hours have gone, as a lean toward kinds of option rather than particular ones. If the person
  // keeps taking gentle things and turning down demanding ones, every gentle option moves earlier and every
  // demanding one later, including ones they have never been offered, and it starts after the first pick. It is
  // fast on purpose (a small prior, an hours-long fade) and it is gone by tomorrow. Returns { id: shift }.
  function mood(sets, options, now, c) {
    var byId = {}, st = {};
    (options || []).forEach(function (o) { byId[o.id] = o; });
    sets.forEach(function (r) {
      var age = now - r.t0;
      if (age < 0 || age > c.moodHours * 3600000) { return; }
      if (!acted(r) && dwell(r) < c.glanceMs) { return; }
      var shown = (r.cards || []).filter(function (x) { return x.onScreen && byId[x.option]; });
      if (!shown.length) { return; }
      var w = Math.pow(0.5, age / (c.todayHalfLifeH * 3600000));
      var seenT = {};
      shown.forEach(function (x) { traits(byId[x.option]).forEach(function (T) { seenT[T] = (seenT[T] || 0) + 1; }); });
      Object.keys(seenT).forEach(function (T) { var a = st[T] = st[T] || { p: 0, e: 0, r: 0 }; a.e += w * seenT[T] / shown.length; });
      var chosen = byId[r.pick];
      if (!chosen) { return; }
      traits(chosen).forEach(function (T) {
        var a = st[T] = st[T] || { p: 0, e: 0, r: 0 };
        if (r.outcome === "picked") { a.p += w; }
        if (r.outcome === "rejected") { a.r += w * reasonWeight(r, c); }
      });
    });
    var lean = {};
    Object.keys(st).forEach(function (T) {
      var a = st[T];
      lean[T] = clamp(-c.moodScale * Math.log((a.p + c.moodK) / (a.e + 0.5 * a.r + c.moodK)), -c.moodMax, c.moodMax);
    });
    var out = {}, any = false;
    (options || []).forEach(function (o) {
      var x = 0;
      traits(o).forEach(function (T) { x += lean[T] || 0; });
      x = Math.round(clamp(x, -1.5 * c.moodMax, 1.5 * c.moodMax) * 100) / 100;
      if (x) { out[o.id] = x; any = true; }
    });
    return any ? out : null;
  }


  // The lens states a set was seen in, for the lenses that were switched on then (the same ones the learner uses).
  function lensStatesOf(r) {
    var L = r.lenses, s = {}, any = false;
    if (!L || !L.enabled) { return null; }
    if (L.enabled.sleep && L.sleep && L.sleep.state) { s.sleep = L.sleep.state; any = true; }
    if (L.enabled.moon && L.moon && L.moon.group) { s.moon = L.moon.group; any = true; }
    if (L.enabled.cycle && L.cycle && L.cycle.phase) { s.cycle = L.cycle.phase; any = true; }
    return any ? s : null;
  }

  // What a lens state predicts about the kind of thing the person takes. For each trait, the learner's own test
  // asks: in this lens state, was a trait option picked more or less often than in other states, among screens
  // that offered both kinds? Only a pattern that passes its evidence bar (a stricter one than the chips use, since
  // many traits and states are tried) moves anything, and only in the slice it was found in and only while
  // the lens is in that state now. A lens that does nothing should leave the order alone. Returns
  // { slice: { id: shift } } or null.
  function lensShifts(sets, options, states, c) {
    if (!Learner || !states || !Object.keys(states).length) { return null; }
    var byId = {}, tr = {};
    (options || []).forEach(function (o) { byId[o.id] = o; tr[o.id] = traits(o); });
    var offers = [];
    sets.forEach(function (r) {
      if (r.outcome !== "picked" || !byId[r.pick]) { return; }
      var lens = lensStatesOf(r);
      if (!lens) { return; }
      var shown = (r.cards || []).filter(function (x) { return x.onScreen && byId[x.option]; });
      if (shown.length < 2) { return; }
      offers.push({ slice: r.slice, lens: lens, shown: shown, picked: r.pick });
    });
    if (!offers.length) { return null; }
    var out = null;
    SLICES.forEach(function (slice) {
      var lean = {}, here = offers.filter(function (r) { return r.slice === slice; });
      if (here.length < 2 * 8) { return; }
      c.lensTraits.forEach(function (T) {
        var pseudo = here.map(function (r) {
          return { slice: r.slice, lens: r.lens, picked: r.picked, pickedActive: tr[r.picked].indexOf(T) !== -1, shown: r.shown.map(function (x) { return { o: x.option, a: tr[x.option].indexOf(T) !== -1 }; }) };
        });
        var hit = Learner.analyze(pseudo, slice, { zSingle: c.lensZ })
          .filter(function (f) { return f.kind === "single" && f.evident && states[f.lens] === f.state; })
          .sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z); })[0];
        if (hit) { lean[T] = clamp(-c.lensScale * Math.log((hit.pA + 0.05) / (hit.pB + 0.05)), -c.lensMax, c.lensMax); }
      });
      if (!Object.keys(lean).length) { return; }
      var tbl = {};
      (options || []).forEach(function (o) {
        var x = 0;
        tr[o.id].forEach(function (T) { x += lean[T] || 0; });
        if (x) { tbl[o.id] = Math.round(clamp(x, -1.5 * c.lensMax, 1.5 * c.lensMax) * 100) / 100; }
      });
      if (Object.keys(tbl).length) { out = out || {}; out[slice] = tbl; }
    });
    return out;
  }

  function blank() { return { p: 0, e: 0, n: 0, j: 0 }; }

  // Read the log. Returns, per option, totals overall and per slice, how often it was on screen, and how many
  // times in a row it was passed over.
  function tally(sets, now, c) {
    var all = {}, bySlice = {}, seen = {}, streak = {};
    sets.slice().sort(function (a, b) { return a.t0 - b.t0; }).forEach(function (r) {
      if (!acted(r) && dwell(r) < c.glanceMs) { return; }
      var shown = (r.cards || []).filter(function (x) { return x.onScreen; });
      if (!shown.length) { return; }
      var w = weight(r, now, c);
      var each = w / shown.length;
      var rw = r.outcome === "rejected" ? reasonWeight(r, c) : 1;
      shown.forEach(function (x) {
        var id = x.option, chosen = r.pick === id;
        var a = all[id] = all[id] || blank();
        var s = bySlice[r.slice] = bySlice[r.slice] || {};
        var b = s[id] = s[id] || blank();
        [a, b].forEach(function (t) {
          t.e += each; t.n += w;
          if (chosen && r.outcome === "picked") { t.p += w; }
          if (chosen && r.outcome === "rejected") { t.j += w * rw; }
        });
        seen[id] = (seen[id] || 0) + 1;
        streak[id] = chosen && r.outcome === "picked" ? 0 : (streak[id] || 0) + 1;
      });
    });
    return { all: all, bySlice: bySlice, seen: seen, streak: streak };
  }

  function lift(t, prior, k) { return ((t ? t.p : 0) + k * prior) / ((t ? t.e : 0) + k); }

  // sets: the impression log, any order. options: the bank's options (id, under, opens). now: ms.
  // opts.states: the lens states that are true now, for the lenses switched on ({ sleep: "short", moon: "waxing" }).
  // Returns null when there is too little to go on, else
  //   { n, mood: { id: shift }, lens: { slice: { id: shift } }, any: { id: shift }, slices: { slice: { id: shift } }, seen: { id: count }, lift: { id: lift }, seenFull, exploreMax, jitter }
  // A shift is added to the option's rank: negative moves it earlier, positive later.
  function build(sets, options, now, opts) {
    var c = cfg(opts);
    var usable = (sets || []).filter(function (r) { return r && r.cards && r.cards.length; });
    var m = mood(usable, options, now, c);
    var out = { n: usable.length, any: {}, slices: {}, seen: {}, lift: {}, mood: m || {}, lens: {}, seenFull: c.seenFull, exploreMax: c.exploreMax, jitter: c.jitter };
    // The long view needs enough history to mean anything; the mood does not.
    if (usable.length < c.minSets) { return m ? out : null; }
    var t = tally(usable, now, c);
    var ids = {}, parent = {};
    var opener = {};
    (options || []).forEach(function (o) { ids[o.id] = o; if (o.opens && !opener[o.opens]) { opener[o.opens] = o.id; } });
    (options || []).forEach(function (o) { parent[o.id] = o.under ? opener[o.under] || null : null; });

    // Overall lift, parents before children so a child can start from its parent's.
    var lifts = {};
    function liftOf(id) {
      if (lifts[id] != null) { return lifts[id]; }
      lifts[id] = 1; // guards a loop in a malformed bank
      var prior = parent[id] ? liftOf(parent[id]) : 1;
      lifts[id] = lift(t.all[id], prior, c.k);
      return lifts[id];
    }
    Object.keys(ids).forEach(liftOf);

    function shift(id, tt, base) {
      var L = tt ? lift(tt, base, c.k) : base;
      var pick = clamp(-c.pickScale * Math.log(L), -c.pickMax, c.pickMax);
      var a = t.all[id];
      var rej = a ? clamp(c.rejectScale * a.j / (a.n + 3), 0, c.rejectMax) : 0;
      var stale = t.streak[id] >= c.staleAfter ? Math.min(c.staleMax, c.staleStep * (t.streak[id] - c.staleAfter + 1)) : 0;
      return Math.round((pick + rej + stale) * 100) / 100;
    }

    Object.keys(lifts).forEach(function (id) { out.any[id] = shift(id, null, lifts[id]); });
    SLICES.forEach(function (s) {
      var tbl = out.slices[s] = {};
      Object.keys(lifts).forEach(function (id) { tbl[id] = shift(id, (t.bySlice[s] || {})[id], lifts[id]); });
    });
    Object.keys(t.seen).forEach(function (id) { if (ids[id]) { out.seen[id] = t.seen[id]; } });
    out.lift = lifts;
    out.lens = lensShifts(usable, options, c.states, c) || {};
    return out;
  }

  // Cadence inputs for the planner (MODEL.md, `cadence`): times each option was picked in the last seven days and
  // whole days since it was last picked.
  function counts(sets, now) {
    var weekCounts = {}, last = {};
    (sets || []).forEach(function (r) {
      if (r.outcome !== "picked" || !r.pick) { return; }
      if (now - r.t0 < 7 * DAY) { weekCounts[r.pick] = (weekCounts[r.pick] || 0) + 1; }
      last[r.pick] = Math.max(last[r.pick] || 0, r.t0);
    });
    var daysSince = {};
    Object.keys(last).forEach(function (id) { daysSince[id] = Math.floor((now - last[id]) / DAY); });
    return { weekCounts: weekCounts, daysSince: daysSince };
  }

  return { DEFAULTS: DEFAULTS, SLICES: SLICES, build: build, counts: counts };
});
