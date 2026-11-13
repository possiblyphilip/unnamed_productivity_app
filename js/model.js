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

  // Which node is current for this cursor and time. Pure: it never changes the cursor, so a test
  // clock can move forward and back. Only picks and rerolls move the cursor. The app does no
  // planning: when a node's window has ended it follows the node's `expired` child.
  function advance(bundle, cursor, nowMin, ensure) {
    var id = cursor.node && bundle.nodes[cursor.node] ? cursor.node : bundle.root;
    var skipped = [];
    var guard = 0;
    while (id && guard++ < 80) {
      var n = bundle.nodes[id];
      if (!n) { break; }
      if (ensure) { ensure(id); }
      if (nowMin >= mins(n.window[1])) { skipped.push(id); id = n.children.expired; continue; }
      return { id: id, node: n, cards: n.cards.map(function (c) { return bundle.cards[c]; }), skipped: skipped };
    }
    return { id: null, node: null, cards: [], skipped: skipped };
  }

  function childFor(node, card) {
    var c = node.children;
    return c["picked:" + card.id];
  }

  return { mins: mins, hhmm: hhmm, clock: clock, liveFor: liveFor, advance: advance, childFor: childFor };
});
