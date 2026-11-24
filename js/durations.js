(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Durations = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // How long things really take, learned from what the person already does. Nothing is asked and nothing is
  // tracked on purpose: the impression log (js/log.js) already holds when each pick was made and when the phone
  // was next used.
  //
  // For each pick of an option, the end is the next moment the person was free enough to act again: their next
  // pick, or something typed as "what I am doing now". That is a ceiling, since there is idle time after finishing.
  // A long look at the phone before that, with nothing picked, counts at half weight. A pick that was undone at once
  // (back within two minutes) is dropped, and so is a gap past four hours (sleep, a day away). The gap is cut at the
  // next calendar event, which ended the activity. Because gaps run high, an option's number is a low quantile of
  // its observations, blended with the duration the person gave in the interview until there is enough evidence.
  var MIN_LOOK_S = 20;          // a look shorter than this is a glance and says nothing
  var LOOK_WEIGHT = 0.5;        // a long look with no pick is weaker evidence than a pick
  var MAX_GAP_MIN = 240;        // longer than this and the gap is not about the activity
  var UNDO_MS = 2 * 60000;      // a back within this long of a pick means it was not really chosen
  var QUANTILE = 0.3;           // gaps run high, so take a low quantile
  var PRIOR = 3;                // the stated duration counts as this many observations
  var MIN_EVIDENCE = 3;         // total weight needed before the estimate changes anything
  var LOOSE = 3;                // never go below 1/LOOSE or above LOOSE times the stated duration

  function round(m) { return m < 10 ? Math.max(1, Math.round(m)) : Math.round(m / 5) * 5; }

  // Weighted quantile of [{ min, w }].
  function wquantile(obs, q) {
    var s = obs.slice().sort(function (a, b) { return a.min - b.min; });
    var total = s.reduce(function (t, o) { return t + o.w; }, 0), run = 0;
    for (var i = 0; i < s.length; i++) { run += s[i].w; if (run >= q * total) { return s[i].min; } }
    return s.length ? s[s.length - 1].min : null;
  }

  // sets: the impression log, any order. options: the bank's options (id, dur, opens). Returns { id: { obs, n, q } }.
  // Only options that can be picked as an activity are included: categories (opens) and added ones are not.
  function observe(sets, options) {
    var byId = {};
    (options || []).forEach(function (o) { byId[o.id] = o; });
    var list = (sets || []).filter(function (s) { return s && typeof s.t0 === "number"; }).sort(function (a, b) { return a.t0 - b.t0; });
    var out = {};
    list.forEach(function (p, i) {
      var o = byId[p.pick];
      if (p.outcome !== "picked" || !p.pick || !o || o.opens || o.category) { return; }
      var tp = p.t1 || p.t0, later = list.slice(i + 1);
      // The next screen opens by itself a moment after a pick, so it is not a look. An immediate back undoes the pick.
      for (var u = 0; u < later.length; u++) {
        if (later[u].t0 - tp > UNDO_MS) { break; }
        if (later[u].outcome === "back") { return; }
      }
      // Next time the person acted: their next pick, or something typed as what they are doing now.
      var act = null;
      later.forEach(function (n) {
        var cand = [];
        if (n.outcome === "picked" && n.t1 && n.t1 - tp > 5000) { cand.push(n.t1); }
        (n.events || []).forEach(function (e) { if (e && e.type === "now" && typeof e.t === "number" && e.t - tp > 5000) { cand.push(e.t); } });
        cand.forEach(function (t) { if (act === null || t < act) { act = t; } });
      });
      // First long look with no pick before then.
      var look = null;
      later.forEach(function (n) {
        (n.views || []).forEach(function (v) {
          if (!v || v.length < 2 || v[0] - tp <= 5000 || (v[1] - v[0]) / 1000 < MIN_LOOK_S) { return; }
          if (act !== null && v[0] >= act) { return; }
          if (look === null || v[0] < look) { look = v[0]; }
        });
      });
      var ev = p.lenses && typeof p.lenses.nextEventIn === "number" && p.lenses.nextEventIn > 0 ? p.lenses.nextEventIn : null;
      var add = function (t, w) {
        if (t === null) { return; }
        var m = (t - tp) / 60000;
        if (ev !== null && m > ev) { m = ev; }
        if (m < 0.5 || m > MAX_GAP_MIN) { return; }
        (out[p.pick] = out[p.pick] || []).push({ min: m, w: w });
      };
      add(act, 1);
      add(look, LOOK_WEIGHT);
    });
    var res = {};
    Object.keys(out).forEach(function (id) {
      var obs = out[id];
      res[id] = { obs: obs, n: obs.reduce(function (t, o) { return t + o.w; }, 0), q: wquantile(obs, QUANTILE) };
    });
    return res;
  }

  // The number to plan with for one option, or null when there is not enough evidence to change anything.
  function blend(stated, ob) {
    if (!ob || ob.n < MIN_EVIDENCE) { return null; }
    if (!stated) { return round(ob.q); }
    var est = (PRIOR * stated + ob.n * ob.q) / (PRIOR + ob.n);
    return round(Math.min(stated * LOOSE, Math.max(stated / LOOSE, est)));
  }

  // Copies of the options with `dur` replaced where there is evidence. The interview's number is kept as
  // `dur_stated`, and `dur_basis` says where the working number came from, so nothing is lost or hidden.
  function adjust(options, sets) {
    var seen = observe(sets, options);
    return (options || []).map(function (o) {
      var est = o.opens ? null : blend(o.dur || null, seen[o.id]);
      if (est === null) { return o; }
      var c = Object.assign({}, o);
      c.dur_stated = o.dur || null;
      c.dur = est;
      c.dur_basis = "observed";
      c.dur_obs = Math.round(seen[o.id].n * 10) / 10;
      return c;
    });
  }

  return { observe: observe, blend: blend, adjust: adjust, round: round, constants: { MIN_LOOK_S: MIN_LOOK_S, LOOK_WEIGHT: LOOK_WEIGHT, MAX_GAP_MIN: MAX_GAP_MIN, QUANTILE: QUANTILE, PRIOR: PRIOR, MIN_EVIDENCE: MIN_EVIDENCE } };
});
