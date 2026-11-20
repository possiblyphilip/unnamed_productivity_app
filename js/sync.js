(function (root) {
  "use strict";
  // The link to the server (see SERVER.md). A setup link (#setup=<device token>&api=<function url>) stores the
  // token on this device. After that the impression log is uploaded and the calendar comes from the server.
  // Without a token none of this runs and the app works as it always has.
  var KEY = "cc.sync", MARK = "cc.syncmark";
  var CALKEY = "cc.calstatus";
  // The last status the server gave, so a fresh page load (or a failed request) does not look like a sign-out.
  var cal = { status: "", last: 0 };
  var timer = null, busy = false;

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  function setStatus(s) { cal.status = s; save(CALKEY, s); }
  function cfg() { var c = load(KEY, null); return c && c.token && c.api ? c : null; }
  function enabled() { return !!cfg(); }

  // Returns true if the hash was a setup link. The token is removed from the address bar straight away.
  function takeSetupLink() {
    if (location.hash.indexOf("setup=") === -1) { return false; }
    var h = new URLSearchParams(location.hash.replace(/^#/, ""));
    var token = h.get("setup"), api = h.get("api");
    history.replaceState(null, "", location.pathname + location.search);
    if (!token || !api || !/^https:\/\/[^/]+\.on\.aws\/?$/.test(api)) { return false; }
    save(KEY, { token: token, api: api.replace(/\/$/, "") });
    return true;
  }
  // Returns "connected", "denied" or "error" after the Google round trip, else "".
  function takeCalendarResult() {
    var m = /^#cal=(connected|denied|error)$/.exec(location.hash);
    if (!m) { return ""; }
    history.replaceState(null, "", location.pathname + location.search);
    return m[1];
  }

  function call(method, path, body, keepalive) {
    var c = cfg();
    if (!c) { return Promise.reject(new Error("not set up")); }
    return fetch(c.api + path, {
      method: method, keepalive: !!keepalive,
      headers: { Authorization: "Bearer " + c.token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) { var e = new Error("server " + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  // ---- log ----
  // An impression changes while it is open, so it is sent again whenever its fingerprint changes.
  function fingerprint(r) { return [r.outcome, r.t1, r.events.length, r.views.length].join("|"); }
  function uploadLog(list, keepalive) {
    if (!enabled() || busy) { return Promise.resolve(0); }
    var mark = load(MARK, {}), next = {}, todo = [];
    list.forEach(function (r) {
      var f = fingerprint(r);
      next[r.id] = f;
      if (mark[r.id] !== f) { todo.push(r); }
    });
    if (!todo.length) { return Promise.resolve(0); }
    busy = true;
    var sent = {}, chain = Promise.resolve();
    for (var i = 0; i < todo.length; i += 50) {
      (function (batch) {
        chain = chain.then(function () {
          return call("POST", "/v1/log", { impressions: batch }, keepalive).then(function () { batch.forEach(function (r) { sent[r.id] = next[r.id]; }); });
        });
      })(todo.slice(i, i + 50));
    }
    return chain.then(function () { return todo.length; }, function () { return 0; }).then(function (n) {
      // Keep the marks of what went through; drop marks for records that have left the list.
      var keep = {};
      Object.keys(next).forEach(function (id) { if (sent[id]) { keep[id] = sent[id]; } else if (mark[id]) { keep[id] = mark[id]; } });
      save(MARK, keep); busy = false; return n;
    });
  }
  function uploadSoon(list) {
    if (!enabled() || timer) { return; }
    timer = setTimeout(function () { timer = null; uploadLog(list()); }, 5000);
  }

  // ---- added options ----
  // What the person typed after a long press. Queued on the device until the server has it, so a dropped
  // connection loses nothing; each use is sent with its time and the server counts it once.
  var AQ = "cc.addedq";
  function addedFlush(keepalive) {
    var q = load(AQ, []);
    if (!enabled() || !q.length || addedBusy) { return Promise.resolve(0); }
    addedBusy = true;
    var batch = q.slice(0, 50);
    return call("POST", "/v1/added", { items: batch }, keepalive).then(function () {
      var now = load(AQ, []).filter(function (a) { return !batch.some(function (b) { return b.id === a.id && b.t === a.t; }); });
      save(AQ, now); addedBusy = false; return batch.length;
    }, function () { addedBusy = false; return 0; });
  }
  var addedBusy = false;
  // The server's list of added options, with the times each was used.
  function addedList() { return call("GET", "/v1/added").then(function (r) { return r.items || []; }, function () { return null; }); }
  function addedSend(item) {
    var q = load(AQ, []); q.push(item); save(AQ, q.slice(-200));
    return addedFlush();
  }

  // ---- calendar ----
  function loadCalendar() {
    return call("GET", "/v1/calendar").then(function (r) { setStatus(r.status); cal.last = r.last_sync; return r; });
  }
  function connectCalendar() {
    return call("POST", "/v1/auth/google/start").then(function (r) { location.assign(r.url); });
  }
  function disconnectCalendar() {
    return call("POST", "/v1/auth/google/disconnect").then(function () { setStatus("none"); });
  }
  function profileVersion() { return call("GET", "/v1/me").then(function (r) { setStatus(r.calendar); return r.profile_version; }); }

  cal.status = load(CALKEY, "") || "";

  root.Sync = {
    enabled: enabled, takeSetupLink: takeSetupLink, takeCalendarResult: takeCalendarResult,
    uploadLog: uploadLog, uploadSoon: uploadSoon, addedSend: addedSend, addedFlush: addedFlush, addedList: addedList,
    calendar: { load: loadCalendar, connect: connectCalendar, disconnect: disconnectCalendar, status: function () { return cal.status; } },
    profileVersion: profileVersion
  };
})(window);
