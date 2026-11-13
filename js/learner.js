(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Learner = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Thresholds. Chosen with tools/simulate-learner.js so that a lens with no real effect
  // almost never produces a chip. See MODEL.md, "Learned relevance".
  var DEFAULTS = { minN: 8, zSingle: 3.0, zPair: 3.5, minDiff: 0.2, pairEdge: 0.1 };
  var SLICES = ["weekday-morning", "weekday-afternoon", "weekday-evening", "weekend-morning", "weekend-afternoon", "weekend-evening"];

  function cfg(o) { return Object.assign({}, DEFAULTS, o || {}); }

  function sliceOf(dow, minutes) {
    var wk = (dow === 0 || dow === 6) ? "weekend" : "weekday";
    var part = minutes < 12 * 60 ? "morning" : minutes < 17 * 60 ? "afternoon" : "evening";
    return wk + "-" + part;
  }

  function sleepState(hours) { return hours < 6.5 ? "short" : "ok"; }
  function cyclePhase(day) { return day <= 5 ? "menstrual" : day <= 13 ? "follicular" : day <= 16 ? "ovulatory" : "luteal"; }
  function moonGroupFromElongation(e) { return (e < 22.5 || e >= 337.5) ? "new" : e < 157.5 ? "waxing" : e < 202.5 ? "full" : "waning"; }
  function moonGroup(name) {
    var n = String(name).toLowerCase();
    if (n.indexOf("new") === 0) { return "new"; }
    if (n.indexOf("full") === 0) { return "full"; }
    if (n.indexOf("waxing") === 0 || n.indexOf("first") === 0) { return "waxing"; }
    return "waning";
  }

  function hasBoth(r) {
    var a = false, n = false;
    r.shown.forEach(function (s) { if (s.a) { a = true; } else { n = true; } });
    return a && n;
  }

  function informative(offers, slice) {
    return offers.filter(function (r) { return (!slice || r.slice === slice) && r.picked && hasBoth(r); });
  }

  function countActive(rs) {
    var k = 0;
    rs.forEach(function (r) { if (r.pickedActive) { k++; } });
    return k;
  }

  function twoProp(a1, n1, a0, n0) {
    var p1 = a1 / n1, p0 = a0 / n0, p = (a1 + a0) / (n1 + n0);
    var se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n0));
    return { pA: p1, pB: p0, diff: p1 - p0, z: se > 0 ? (p1 - p0) / se : 0 };
  }

  function uniq(xs) {
    var seen = {}, out = [];
    xs.forEach(function (x) { if (!seen[x]) { seen[x] = true; out.push(x); } });
    return out;
  }

  // Compare how often the user picked an "active" option in each lens state against all other states,
  // within one slice. Only offers that contained both kinds of option are informative.
  function analyze(offers, slice, opts) {
    var c = cfg(opts);
    var rs = informative(offers, slice);
    var ids = uniq([].concat.apply([], rs.map(function (r) { return Object.keys(r.lens); }))).sort();
    var res = [];
    var singleDiff = {};

    ids.forEach(function (L) {
      uniq(rs.map(function (r) { return r.lens[L]; }).filter(Boolean)).forEach(function (s) {
        var A = rs.filter(function (r) { return r.lens[L] === s; });
        var B = rs.filter(function (r) { return r.lens[L] !== undefined && r.lens[L] !== s; });
        if (!A.length || !B.length) { return; }
        var st = twoProp(countActive(A), A.length, countActive(B), B.length);
        var f = { kind: "single", lens: L, state: s, slice: slice, nA: A.length, nB: B.length, pA: st.pA, pB: st.pB, diff: st.diff, z: st.z };
        f.evident = A.length >= c.minN && B.length >= c.minN && Math.abs(f.diff) >= c.minDiff && Math.abs(f.z) >= c.zSingle;
        singleDiff[L + "=" + s] = Math.abs(f.diff);
        res.push(f);
      });
    });

    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var L1 = ids[i], L2 = ids[j];
        var combos = uniq(rs.filter(function (r) { return r.lens[L1] !== undefined && r.lens[L2] !== undefined; })
          .map(function (r) { return r.lens[L1] + "|" + r.lens[L2]; }));
        combos.forEach(function (key) {
          var s1 = key.split("|")[0], s2 = key.split("|")[1];
          var both = rs.filter(function (r) { return r.lens[L1] !== undefined && r.lens[L2] !== undefined; });
          var A = both.filter(function (r) { return r.lens[L1] === s1 && r.lens[L2] === s2; });
          var B = both.filter(function (r) { return !(r.lens[L1] === s1 && r.lens[L2] === s2); });
          if (!A.length || !B.length) { return; }
          var st = twoProp(countActive(A), A.length, countActive(B), B.length);
          var edge = Math.max(singleDiff[L1 + "=" + s1] || 0, singleDiff[L2 + "=" + s2] || 0) + c.pairEdge;
          var f = { kind: "pair", lens: [L1, L2], state: [s1, s2], slice: slice, nA: A.length, nB: B.length, pA: st.pA, pB: st.pB, diff: st.diff, z: st.z };
          f.evident = A.length >= c.minN && B.length >= c.minN && Math.abs(f.diff) >= Math.max(c.minDiff, edge) && Math.abs(f.z) >= c.zPair;
          res.push(f);
        });
      }
    }
    return res;
  }

  function matches(f, states) {
    if (f.kind === "single") { return states[f.lens] === f.state; }
    return states[f.lens[0]] === f.state[0] && states[f.lens[1]] === f.state[1];
  }

  function usesLens(f, id) {
    return f.kind === "single" ? f.lens === id : f.lens.indexOf(id) !== -1;
  }

  // Findings strong enough to show for the current slice and lens states, strongest first.
  function chipsFor(offers, slice, states, hidden, max, opts) {
    hidden = hidden || {};
    return analyze(offers, slice, opts)
      .filter(function (f) {
        if (!f.evident || !matches(f, states)) { return false; }
        var ids = f.kind === "single" ? [f.lens] : f.lens;
        return !ids.some(function (id) { return hidden[id]; });
      })
      .sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z); })
      .slice(0, max || 3);
  }

  // Predicted chance of an "active" pick, or null when nothing is evident.
  function tilt(offers, slice, states, opts) {
    var hit = analyze(offers, slice, opts)
      .filter(function (f) { return f.evident && matches(f, states); })
      .sort(function (a, b) { return Math.abs(b.z) - Math.abs(a.z); })[0];
    return hit ? hit.pA : null;
  }

  function status(offers, lensId, opts) {
    var slices = [];
    SLICES.forEach(function (s) {
      var hit = analyze(offers, s, opts).some(function (f) { return f.evident && usesLens(f, lensId); });
      if (hit) { slices.push(s); }
    });
    return { slices: slices, n: informative(offers).length };
  }

  return {
    DEFAULTS: DEFAULTS, SLICES: SLICES, sliceOf: sliceOf, sleepState: sleepState, cyclePhase: cyclePhase,
    moonGroup: moonGroup, moonGroupFromElongation: moonGroupFromElongation,
    informative: informative, analyze: analyze, chipsFor: chipsFor, tilt: tilt, status: status
  };
});
