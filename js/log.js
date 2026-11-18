(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Log = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // The impression log. One record per set of cards put in front of the person, kept whether or not
  // they did anything with it. It is raw material, separate from the learner's `offers`: nothing here
  // is interpreted. See MODEL.md, "Impression log".
  //
  // An impression holds:
  //   id, node, t0, t1        when the set appeared and when it was left
  //   slice, dow, minutes     weekday or weekend by daypart, day of week, minute of the day
  //   lenses                  every lens state that is true now, enabled or not, with raw values
  //   cards                   every card on the node in the order planned, with position, whether it
  //                           was on screen or below, and when it first came into view
  //   views                   [start, end] intervals in which the set was actually on screen
  //   events                  what the person did, in order (see EVENT_TYPES)
  //   outcome                 picked, rejected, back, nav, expired, or open while still showing
  //   pick                    option id picked or rejected, when there was one

  var EVENT_TYPES = ["tap", "swipe_right", "swipe_left", "reveal", "back", "nav", "reject_reason"];
  var OUTCOMES = { tap: "picked", swipe_right: "picked", back: "back", nav: "nav" };

  function create(opts) {
    var o = Object.assign({ max: 1500 }, opts || {});
    var list = (o.list || []).slice();
    var cur = null, seq = 0, viewing = false;

    function id(now) { seq += 1; return now.toString(36) + "-" + seq; }
    function trim() { if (list.length > o.max) { list = list.slice(list.length - o.max); } }

    // Start a new impression if the node is not the one already open. Closes the old one as expired.
    // info: { node, key, slice, dow, minutes, lenses, ctx, source, cards: [{ option, card, active, onScreen }] }
    function open(info, now) {
      if (cur && cur.key === info.key) { return cur; }
      close(now, "expired");
      cur = {
        id: id(now), key: info.key, node: info.node, t0: now, t1: null,
        slice: info.slice, dow: info.dow, minutes: info.minutes,
        lenses: info.lenses, ctx: info.ctx, source: info.source,
        cards: info.cards.map(function (c, i) {
          return { card: c.card, option: c.option, pos: i, active: !!c.active, onScreen: !!c.onScreen, seenAt: null };
        }),
        views: [], events: [], outcome: "open", pick: null
      };
      list.push(cur);
      trim();
      viewing = false;
      return cur;
    }

    // Tell the log whether the set is on screen right now. Each stretch of looking is one view.
    function look(visible, now) {
      if (!cur) { return; }
      if (visible && !viewing) {
        cur.views.push([now, now]);
        viewing = true;
        cur.cards.forEach(function (c) { if (c.onScreen && c.seenAt === null) { c.seenAt = now; } });
      } else if (!visible && viewing) {
        cur.views[cur.views.length - 1][1] = now;
        viewing = false;
      } else if (visible && viewing) {
        cur.views[cur.views.length - 1][1] = now;
      }
    }

    // The cards below the fold came into view.
    function reveal(now, how) {
      if (!cur) { return; }
      cur.cards.forEach(function (c) { if (!c.onScreen) { c.onScreen = true; c.seenAt = viewing ? now : null; } });
      act("reveal", { how: how || null }, now);
    }

    // Record something the person did. Picks, backs and navigation also end the impression.
    // The caller passes: card (card id), option (option id), how, dx, reason, text-free detail only.
    function act(type, detail, now) {
      if (!cur) { return; }
      var e = Object.assign({ t: now, type: type }, detail || {});
      cur.events.push(e);
      if (type === "swipe_left") { return; }
      if (type === "reject_reason") { close(now, "rejected", detail && detail.option); return; }
      if (OUTCOMES[type]) { close(now, OUTCOMES[type], detail && detail.option); }
    }

    function close(now, outcome, pick) {
      if (!cur) { return; }
      look(false, now);
      cur.t1 = now;
      cur.outcome = outcome || cur.outcome;
      if (pick) { cur.pick = pick; }
      cur = null;
      viewing = false;
    }

    function current() { return cur; }
    function all() { return list; }
    function clear() { list = []; cur = null; viewing = false; }
    // Drop impressions from `since` on (a replayed day in testing).
    function dropSince(since) { list = list.filter(function (r) { return r.t0 < since; }); if (cur && cur.t0 >= since) { cur = null; viewing = false; } }
    function viewCount(r) { return r.views.length; }
    function dwellMs(r) { return r.views.reduce(function (s, v) { return s + (v[1] - v[0]); }, 0); }

    return { open: open, look: look, reveal: reveal, act: act, close: close, current: current, all: all, clear: clear, dropSince: dropSince, viewCount: viewCount, dwellMs: dwellMs };
  }

  return { create: create, EVENT_TYPES: EVENT_TYPES };
});
