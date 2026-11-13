(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Model = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function mins(hhmm) {
    var p = hhmm.split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function hhmm(m) {
    m = Math.max(0, Math.min(24 * 60 - 1, Math.round(m)));
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function clock(m) {
    m = Math.round(m);
    var h = Math.floor(m / 60) % 24, mm = m % 60;
    var ap = h >= 12 ? "pm" : "am";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ":" + (mm < 10 ? "0" : "") + mm + " " + ap;
  }

  // What is true right now, as far as node conditions are concerned.
  function liveFor(ctx, m) {
    var next = null;
    (ctx.calendar || []).forEach(function (e) {
      if (mins(e.start) > m && (!next || mins(e.start) < mins(next.start))) { next = e; }
    });
    var sky = "unknown";
    (ctx.weather || []).forEach(function (w) {
      if (m >= mins(w.from) && m < mins(w.to)) { sky = w.sky; }
    });
    return {
      weather: sky,
      daylight: m >= mins(ctx.sunrise) && m < mins(ctx.sunset),
      event_in: next ? mins(next.start) - m : null,
      free_min: next ? mins(next.start) - m : 24 * 60 - m,
      next: next
    };
  }

  function validNow(valid, live) {
    if (!valid) { return true; }
    if (valid.free_min_gte !== undefined && live.free_min < valid.free_min_gte) { return false; }
    if (valid.weather && live.weather !== "unknown" && valid.weather.indexOf(live.weather) === -1) { return false; }
    if (valid.daylight !== undefined && live.daylight !== valid.daylight) { return false; }
    if (valid.event_within_min_lte !== undefined && (live.event_in === null || live.event_in > valid.event_within_min_lte)) { return false; }
    return true;
  }

  function variantFor(node, state) {
    var vs = node.variants || [];
    for (var i = 0; i < vs.length; i++) {
      var keys = Object.keys(vs[i].when);
      if (keys.every(function (k) { return state[k] === vs[i].when[k]; })) { return vs[i]; }
    }
    return null;
  }

  // Which node is current for this cursor and time. Pure: it never changes the cursor, so a test
  // clock can move forward and back. Only picks and rerolls move the cursor.
  function advance(bundle, cursor, nowMin, ctx, state) {
    var live = liveFor(ctx, nowMin);
    var id = cursor.node;
    var enterAt = cursor.enterAt || 0;
    var skipped = [];
    var swapped = {};
    var guard = 0;
    while (id && guard++ < 60) {
      var n = bundle.nodes[id];
      if (!n) { break; }
      if (nowMin >= mins(n.window[1])) { skipped.push(id); id = n.children.expired; enterAt = 0; continue; }
      if (!validNow(n.valid_if, live) && n.on_invalid && !swapped[id]) { swapped[id] = true; id = n.on_invalid; continue; }
      var start = Math.max(mins(n.window[0]), enterAt);
      var v = variantFor(n, state);
      return {
        id: id, node: n, cards: v ? v.cards : n.cards, variant: !!v, skipped: skipped, live: live,
        waiting: nowMin < start ? { until: start, inProgress: nowMin < enterAt } : null
      };
    }
    return { id: null, node: null, cards: [], variant: false, skipped: skipped, live: live, waiting: null };
  }

  function childFor(node, card) {
    var c = node.children;
    if (Object.prototype.hasOwnProperty.call(c, "picked:" + card.id)) { return c["picked:" + card.id]; }
    return c["picked:*"];
  }

  return { mins: mins, hhmm: hhmm, clock: clock, liveFor: liveFor, validNow: validNow, variantFor: variantFor, advance: advance, childFor: childFor };
});
