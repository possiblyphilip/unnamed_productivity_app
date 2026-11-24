(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Staging = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // One plan that can be replaced while it is in use. The screen after a pick is always ready (the planner builds
  // two levels ahead), so the app shows it at once. What the pick, the lenses and the server now know is planned in
  // the background and swapped in only when no set of cards is on screen: while the cards are hidden after a pick,
  // or when the person moves to a node that has not been shown yet. If the new plan is late, the screen shows the
  // old one and the new plan is used from the next screen on. Cards on screen never change.
  //
  //   first(rev)        builds the plan for a revision now (the first time, nothing to show yet)
  //   build(rev, done)  builds it later and calls done(plan). Local planning today, a request to the server later
  //   ready()           called when a staged plan has arrived, so the app can render and take it if it is allowed
  //
  // `rev` is anything that compares with ===. Asking for a newer one drops an older one that is still on its way.
  function create(opts) {
    var cur = null, staged = null, asked = null;

    function get(rev, canSwap) {
      if (!cur) { cur = { rev: rev, plan: opts.first(rev) }; return cur.plan; }
      if (cur.rev === rev) { return cur.plan; }
      if (staged && staged.rev === rev) {
        if (canSwap) { cur = staged; staged = null; }
        return cur.plan;
      }
      if (asked !== rev) {
        asked = rev;
        opts.build(rev, function (plan) {
          if (asked !== rev) { return; }
          asked = null;
          staged = { rev: rev, plan: plan };
          if (opts.ready) { opts.ready(); }
        });
      }
      return cur.plan;
    }

    return { get: get, rev: function () { return cur ? cur.rev : null; }, waiting: function () { return asked !== null; }, staged: function () { return staged ? staged.rev : null; } };
  }

  return { create: create };
});
