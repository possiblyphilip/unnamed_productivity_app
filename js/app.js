(function () {
  "use strict";

  var app = document.getElementById("app");

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  // A refresh starts the day from scratch. Kept: the Google Calendar sign-in, the settings on the Integrations
  // screen, the impression log (a record of what was shown and done, which must outlive a refresh), and the
  // server link (device token and upload marks, see sync.js). Anything Sync stores under cc. must be listed here.
  var KEEP = { "cc.gcal": 1, "cc.lenses": 1, "cc.profile": 1, "cc.you": 1, "cc.log": 1, "cc.mybank": 1, "cc.sync": 1, "cc.syncmark": 1, "cc.calstatus": 1 };
  try {
    Object.keys(localStorage).forEach(function (k) { if (k.indexOf("cc.") === 0 && !KEEP[k]) { localStorage.removeItem(k); } });
  } catch (e) { /* storage blocked */ }

  // Only what works today. The rows tagged "manual" are set by the person, not read from a device.
  var INTEGRATIONS = [
    ["Schedule", [["gcal", "Google Calendar"]]],
    ["Place and sky", [["weather", "Weather and location"], ["moon", "Moon phase"]]],
    ["You, set by hand", [["energy", "Energy today"], ["sleep", "Sleep hours"], ["cycle", "Cycle days"]]],
    ["Astrology", [["birthday", "Birthday"], ["zodiac", "Moon sign and season"], ["sign", "Your sign and the moon"]]]
  ];
  var LENS_IDS = { sleep: true, moon: true, cycle: true, zodiac: true, sign: true };
  var LENS_NOTE = { sleep: "Choose last night's sleep to show it.", cycle: "Choose a day to show it.", moon: "Calculated.", zodiac: "Calculated.", sign: "Your Sun sign against today's moon sign." };
  var DAY_MODES = [["sick", "Sick"], ["travel", "Travelling"], ["big", "Big day"], ["rough", "Rough day"]];
  var DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var STOPS = [["8:10a", 490], ["11:40a", 700], ["12:40p", 760], ["2:10p", 850], ["6:10p", 1090], ["8:30p", 1230]];
  function quietCard(x) { return { id: "q_auto", option: "quiet", text: (x.view.node && x.view.node.quiet) || "Nothing needed right now.", tags: { kind: "quiet" }, signal: {} }; }

  var bundle = null;
  var sess = null;
  var sessions = {};
  var precomputed = "";
  var S = load("cc.state", {});
  var offers = load("cc.offers", []).filter(function (o) { return o.source !== "sample"; });
  // Every set of cards shown, with the order, every lens that is true, how long it was looked at, and what was done.
  var log = Log.create({ list: load("cc.log", []) });
  var logTimer = null;
  function flushLog() { clearTimeout(logTimer); logTimer = null; save("cc.log", log.all()); Sync.uploadSoon(log.all); }
  function flushLogSoon() { if (!logTimer) { logTimer = setTimeout(flushLog, 800); } }
  // A made-up history is baked in, so learned chips and ordering show from the first open.
  var baked = Sim.demoHistory();
  function history() { return baked.concat(offers); }
  var lenses = Object.assign({ sleep: { enabled: true }, moon: { enabled: true }, cycle: { enabled: true }, zodiac: { enabled: true }, sign: { enabled: false } }, load("cc.lenses", {}));
  var profile = Object.assign({ birth: "", cals: {} }, load("cc.profile", {}));
  var notes = load("cc.notes", []);
  var test = Object.assign({ on: false, minutes: null, dow: null, live: true, energy: "normal", sleep: 7, cycleDay: 0, sleepDay: "", pause: true, auto: false }, load("cc.test", {}));
  // What the person sets by hand on the Integrations screen is kept. Last night's sleep only counts for the day it was set.
  (function () {
    var you = load("cc.you", {});
    ["sleep", "cycleDay", "energy", "sleepDay"].forEach(function (k) { if (you[k] !== undefined) { test[k] = you[k]; } });
    if (test.sleepDay !== todayKey()) { test.sleep = 7; test.sleepDay = ""; }
  })();
  test.sleep = snapSleep(test.sleep);
  // Colour palettes. Each is a set of roles in css/app.css, picked from the menu and kept on this device.
  var PALETTES = [
    { id: "sand", name: "Sand and sage", note: "Richer sand, green as the accent", c: ["#E3D5BA", "#FAF6EC", "#6F8F78"] },
    { id: "sage", name: "Sage", note: "The first prototype", c: ["#667F70", "#f7f4f0", "#9DB8A6"] },
    { id: "robin", name: "Robin's egg", note: "Pastel blue-green and teal", c: ["#CFE6E4", "#FBF8F1", "#3E9A9C"] },
    { id: "eggshell", name: "Eggshell and teal", note: "Light, with teal", c: ["#F4EEE1", "#FFFDF8", "#2A8C86"] },
    { id: "brown", name: "Soft brown", note: "Warm and low-key", c: ["#7A6354", "#F6EFE6", "#C9A27E"] },
    { id: "lively", name: "Lively", note: "Sunny, for comparison", c: ["#F4C95D", "#FFF9EA", "#E4572E"] }
  ];
  function paletteById(id) { return PALETTES.filter(function (q) { return q.id === id; })[0] || PALETTES[0]; }
  var palette = paletteById(load("cc.palette", "sand")).id;
  function applyPalette() {
    document.documentElement.setAttribute("data-palette", palette);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) { meta.setAttribute("content", paletteById(palette).c[0]); }
  }
  applyPalette();

  var ui = { diag: null, sheet: null, menu: false, screen: "today", drawer: false, draft: "", noteSent: false, calMsg: "", hold: false, exiting: null, enterOnce: false, titleNew: false, reject: null };
  var holdTimer = null;
  var exitTimer = null;
  var live = { weather: [], sunrise: "07:00", sunset: "17:00", calendar: [], other: [], allDay: [], cals: [], calFailed: [], calState: "", place: null, moon: Ctx.moonFor(new Date()) };

  // ---- time and context ----
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function realMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowMin() { return Math.min(1438, (test.minutes !== null ? test.minutes : realMinutes()) + (S.skew || 0)); }
  function dowNow() { return test.dow !== null ? test.dow : new Date().getDay(); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function hm(h) { var t = Math.round(h * 60), m = t % 60; return Math.floor(t / 60) + "h" + (m ? " " + m + "m" : ""); }
  function snapSleep(h) { return h < 6 ? 5 : h < 8 ? 7 : 9; }

  // Commitments that repeat (from a personal bank), added to the day's calendar on the days they apply.
  var recurring = [], bankName = "";
  function recurringFor(day) {
    var dow = new Date(day + "T12:00:00").getDay(), type = dow === 0 || dow === 6 ? "weekend" : "weekday";
    return recurring.filter(function (e) { return e.days === "any" || e.days === type; }).map(function (e) { return { start: e.start, end: e.end, title: e.title }; });
  }

  function ctxNow() {
    if (!test.live) {
      var c = Sample.context;
      return { day: c.day, weather: c.weather, sunrise: c.sunrise, sunset: c.sunset, calendar: c.calendar.concat(recurringFor(c.day)), moon: { name: cap(c.moon.phase), group: Learner.moonGroup(c.moon.phase), sign: c.moon.sign } };
    }
    var d = new Date();
    var day = d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
    return { day: day, weather: live.weather, sunrise: live.sunrise, sunset: live.sunset, calendar: live.calendar.concat(recurringFor(day)), moon: { name: live.moon.name, group: Learner.moonGroupFromElongation(live.moon.elongation), sign: live.moon.sign } };
  }

  function sleepSet() { return test.sleepDay === todayKey(); }

  function lensStates(c) {
    var s = {};
    if (lenses.sleep.enabled && sleepSet()) { s.sleep = Learner.sleepState(test.sleep); }
    if (lenses.moon.enabled) { s.moon = c.moon.group; }
    if (lenses.cycle.enabled && test.cycleDay > 0) { s.cycle = Learner.cyclePhase(test.cycleDay); }
    if (lenses.sign.enabled && hasSign()) { s.sign = Astro.relation(sunSign(profile.birth), c.moon.sign) || undefined; }
    return s;
  }

  // Everything true right now, whether or not the lens is switched on, so any of it can be tested later.
  function lensAll(x) {
    var c = x.c, out = { enabled: {}, energy: test.energy, dayMode: (S.dayMode && S.dayMode.mode) || null };
    Object.keys(lenses).forEach(function (id) { out.enabled[id] = !!lenses[id].enabled; });
    out.moon = { group: c.moon.group, name: c.moon.name, sign: c.moon.sign || null };
    out.sleep = sleepSet() ? { hours: test.sleep, state: Learner.sleepState(test.sleep) } : null;
    out.cycle = test.cycleDay > 0 ? { day: test.cycleDay, phase: Learner.cyclePhase(test.cycleDay) } : null;
    var seg = (c.weather || []).filter(function (w) { return x.m >= Model.mins(w.from) && x.m < Model.mins(w.to); })[0];
    out.weather = seg ? seg.sky : null;
    out.daylight = x.m >= Model.mins(c.sunrise) && x.m < Model.mins(c.sunset);
    out.nextEventIn = x.live.next ? Model.mins(x.live.next.start) - x.m : null;
    out.astro = Astro.snapshot(profile.birth, c);
    return out;
  }

  // Called after every render of the cards. Opens an impression when a new set appears, and says
  // whether the set is on screen right now.
  function syncLog() {
    var now = Date.now();
    var cards = ui.screen === "today" && !ui.hold && !ui.exiting && current && current.view && current.view.node;
    if (cards) {
      var x = current, all = cardsFor(x), onScreen = {};
      shownCards(x).forEach(function (c) { onScreen[c.id] = true; });
      log.open({
        key: x.view.id, node: x.view.id, bank: bankName || "built-in", slice: x.slice, dow: dowNow(), minutes: x.m,
        lenses: lensAll(x), ctx: ctxSnap(x), source: test.minutes !== null ? "test" : "live",
        cards: all.map(function (c) { return { card: c.id, option: c.option, active: isActive(c), onScreen: !!onScreen[c.id] }; })
      }, now);
    }
    log.look(!!cards && !ui.menu && document.visibilityState === "visible", now);
    flushLogSoon();
  }

  var sunSign = Astro.sunSign;
  function hasSign() { return Astro.validBirth(profile.birth); }

  function lensText(id, c) {
    if (id === "sleep") { return "Slept " + hm(test.sleep); }
    if (id === "moon") { return c.moon.name; }
    if (id === "sign") { return "Moon in " + c.moon.sign + ", your " + sunSign(profile.birth) + " Sun"; }
    return cap(Learner.cyclePhase(test.cycleDay)) + " phase, day " + test.cycleDay;
  }

  // One plan per sleep band (about 5, 7 or 9 hours), kept for the context it was made for. Switching
  // between them is instant, and the new plan restores the node the user was on.
  function planFor(c, sleep) {
    var sig = [c.day, test.live ? 1 : 0, test.energy, sleep, live.weather.length, c.calendar.map(function (e) { return e.start + e.end; }).join(), live.sunrise, live.sunset].join("|");
    if (!sessions[sig]) { sessions[sig] = Planner.session(c, { energy: test.energy, sleep: sleep }); }
    return sessions[sig];
  }

  function precompute() {
    var c = ctxNow();
    [5, 7, 9].forEach(function (h) { var s = planFor(c, h); s.expand(s.bundle.root, 2); });
  }

  function compute() {
    var m = nowMin();
    var c = ctxNow();
    if (S.day !== todayKey()) { S = { day: todayKey() }; }
    if (S.cursor && S.cursor.setAt > m) { S = { day: S.day, dayMode: S.dayMode }; }
    sess = planFor(c, test.sleep);
    bundle = sess.bundle;
    var cursor = S.cursor || { node: bundle.root, setAt: 0 };
    if (cursor.node && !bundle.nodes[cursor.node]) { sess.restore(cursor.node); }
    var view = Model.advance(bundle, cursor, m, sess.ensure);
    return { m: m, c: c, cursor: cursor, view: view, live: Model.liveFor(c, m), states: lensStates(c), slice: Learner.sliceOf(dowNow(), m) };
  }

  function isActive(card) { return !!(card.signal && card.signal.energy > 0); }

  // Every card on the node. The first `show` are on screen; the rest wait below and fade in when the
  // cards are pushed up. The learned order only reorders within each group.
  function cardsFor(x) {
    var cards = x.view.cards.slice();
    if (!cards.length) { return [quietCard(x)]; }
    var p = Learner.tilt(history(), x.slice, x.states);
    if (p === null) { return cards; }
    var activeFirst = p >= 0.5;
    var show = x.view.node.show || cards.length;
    function order(list) {
      return list.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
        var aa = isActive(a.c) ? 1 : 0, bb = isActive(b.c) ? 1 : 0;
        if (aa !== bb) { return activeFirst ? bb - aa : aa - bb; }
        return a.i - b.i;
      }).map(function (o) { return o.c; });
    }
    return order(cards.slice(0, show)).concat(order(cards.slice(show)));
  }

  // What is on screen: the cards on show, plus the ones below once they have been pushed up into view.
  function shownCards(x) {
    var all = cardsFor(x), node = x.view.node;
    if (!node || !node.show || ui.revealFor === x.view.id) { return all; }
    return all.slice(0, node.show);
  }
  function hasMore(x) { var n = x.view.node; return !!(n && n.show && n.cards.length > n.show && ui.revealFor !== x.view.id); }

  function operational(x) {
    var out = [], m = x.m, c = x.c, next = x.live.next;
    if (next) {
      var n = Model.mins(next.start) - m;
      out.push(n <= 90 ? next.title + " in " + n + " min" : next.title + " at " + Model.clock(Model.mins(next.start)));
    }
    var segs = c.weather || [], cur = null, i;
    for (i = 0; i < segs.length; i++) { if (m >= Model.mins(segs[i].from) && m < Model.mins(segs[i].to)) { cur = segs[i]; } }
    if (cur && cur.sky === "rain") {
      var dry = segs.filter(function (s) { return s.sky === "dry" && Model.mins(s.from) >= m; })[0];
      out.push(dry ? "Rain until about " + Model.clock(Model.mins(dry.from)) : "Rain for the rest of the day");
    } else if (cur) {
      var rain = segs.filter(function (s) { return s.sky === "rain" && Model.mins(s.from) > m && Model.mins(s.from) - m <= 240; })[0];
      if (rain) { out.push("Dry until " + Model.clock(Model.mins(rain.from))); }
    }
    var toSunset = Model.mins(c.sunset) - m;
    if (toSunset > 0 && toSunset <= 180) { out.push("Sunset " + Model.clock(Model.mins(c.sunset))); }
    return out;
  }

  // Context is consolidated into a few chips. Patterns the app has learned come first. The rest are one line
  // per lens, rotating through the day, grouped: sleep, cycle, and moon with zodiac. Lenses switched off never show.
  var LENS_ORDER = ["sleep", "cycle", "moon", "zodiac", "sign"];
  var LENS_GROUPS = [["sleep"], ["cycle"], ["moon", "zodiac", "sign"]];
  function lensChips(x) {
    var hidden = {}, learned = {}, out = [];
    Object.keys(lenses).forEach(function (id) { if (!lenses[id].enabled) { hidden[id] = true; } });
    Learner.chipsFor(history(), x.slice, x.states, hidden, 3).forEach(function (f) {
      if (f.kind === "pair") {
        out.push(f.lens.map(function (id) { return lensText(id, x.c); }).join(" · "));
        f.lens.forEach(function (id) { learned[id] = "pair"; });
      } else { learned[f.lens] = true; }
    });
    var hour = Math.floor(x.m / 30);
    function rotate(id, options) { return options.length ? options[(hour + LENS_ORDER.indexOf(id)) % options.length] : null; }
    var texts = {
      sleep: sleepSet() ? "Slept " + hm(test.sleep) : null,
      cycle: test.cycleDay > 0 ? lensText("cycle", x.c) : null,
      moon: x.c.moon.name,
      zodiac: x.c.moon.sign ? rotate("zodiac", (lenses.sign.enabled && hasSign() ? [] : ["Moon in " + x.c.moon.sign]).concat([sunSign(x.c.day) + " season"])) : null,
      sign: lenses.sign.enabled && hasSign() && x.c.moon.sign ? lensText("sign", x.c) : null
    };
    var groups = [];
    LENS_GROUPS.forEach(function (ids) {
      var parts = ids.filter(function (id) { return !hidden[id] && texts[id] && learned[id] !== "pair"; });
      if (!parts.length) { return; }
      groups.push({ text: parts.map(function (id) { return texts[id]; }).join(" · "), learned: parts.some(function (id) { return learned[id] === true; }) });
    });
    groups.sort(function (p, q) { return (q.learned ? 1 : 0) - (p.learned ? 1 : 0); });
    return out.concat(groups.map(function (g) { return g.text; })).slice(0, 4);
  }

  // ---- rendering ----
  function hamburger() {
    return '<button type="button" class="hamburger" data-act="navmenu" aria-label="Menu" aria-expanded="' + (ui.menu ? "true" : "false") + '"><span></span><span></span><span></span></button>';
  }

  function topHtml(x) {
    var v = x.view, title, sub;
    if (S.dayMode) {
      title = "Quiet day";
      sub = "Day mode: " + S.dayMode.label.toLowerCase() + ". Ends at midnight.";
    } else {
      title = v.node ? v.node.title : "Today";
      var a = S.activity;
      if (a && x.m < a.until) {
        title = a.label;
        sub = (a.steps ? a.steps.join(", ") + ". " : "") + "Until " + Model.clock(a.until) + ".";
      }
      else if (a) { sub = "Last selection: " + a.label + "."; }
      else { sub = v.id === bundle.root ? "Start of day." : ""; }
    }
    return '<header class="top"><div class="row">' + hamburger() + '<h1' + (ui.titleNew ? ' class="new"' : '') + '>' + esc(title) + '</h1>' +
      '</div>' +
      '<p class="sub">' + esc(sub) + "</p></header>";
  }

  // While cards leave and the next set is on its way, the box keeps its height so nothing jumps.
  function boxStyle() { return ui.boxHeight ? ' style="min-height:' + ui.boxHeight + 'px"' : ""; }

  // A greeting above the first choices of a block. Not inside a category, and not while the cards are away.
  function greetingHtml(x) {
    var node = x.view.node;
    if (!node || node.children.back || node.type === "during_event" || !node.cards.length) { return ""; }
    var h = Math.floor(x.m / 60);
    var word = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 22 ? "Good evening" : "Hello";
    return '<h2 class="greeting">' + word + "</h2>";
  }

  function midHtml(x, cards) {
    var v = x.view;
    if (S.dayMode) { return '<div class="card still">Nothing needed today.</div><div><button class="pill" data-act="enddaymode">End day mode</button></div>'; }
    if (!v.node) { return '<div class="card still">Nothing needed.</div>'; }
    if (ui.exiting) {
      var ex = ui.exiting;
      return greetingHtml(x) + '<div class="stack"' + boxStyle() + '>' + ex.cards.map(function (c) {
        var cls = "card ghost", style = "";
        if (ex.pickedId === c.id) {
          cls += ex.how === "swipe" ? " slide-right" : " keep";
          if (ex.how === "swipe" && ex.dx) { style = ' style="--x:' + Math.round(ex.dx) + 'px"'; }
        } else if (ex.goneId === c.id) { cls += " gone"; }
        else if (ex.pickedId) { cls += " fade"; }
        return '<div class="' + cls + '"' + style + '>' + esc(c.text) + "</div>";
      }).join("") + "</div>";
    }
    if (ui.hold) { return greetingHtml(x) + '<div class="stack empty"' + boxStyle() + "></div>"; }
    var shownN = v.node.show || cards.length, fresh = ui.revealAnim && ui.revealFor === v.id;
    return greetingHtml(x) + '<div class="stack' + (ui.enterOnce ? " enter" : "") + '">' + cards.map(function (c, i) {
      if (c.tags && c.tags.kind === "quiet") { return '<div class="card still">' + esc(c.text) + "</div>"; }
      var away = ui.reject && ui.reject.id === c.id ? " away" : "";
      return '<button class="card' + away + (fresh && i >= shownN ? " fresh" : "") + '" data-act="pick" data-id="' + esc(c.id) + '">' + esc(c.text) + "</button>";
    }).join("") + "</div>";
  }

  // Pushing the cards up (swipe up, scroll, arrow down) brings in the rest. They stay until the screen changes.
  function reveal(how) {
    if (ui.hold || ui.exiting || ui.sheet || ui.screen !== "today") { return; }
    var x = compute();
    if (!hasMore(x)) { return; }
    log.reveal(Date.now(), how || "swipe_up");
    ui.revealFor = x.view.id; ui.revealAnim = true;
    render();
    ui.revealAnim = false;
  }

  // Which section of the stats screen a chip opens onto.
  function focusFor(text) {
    if (/moon|season/i.test(text)) { return "sky"; }
    if (/^All day:|rain|dry|sunset|\bin \d+ min|\bat \d/i.test(text)) { return "now"; }
    return "body";
  }

  function bottomHtml(x) {
    var ops = operational(x).slice(0, 2);
    function chip(text, cls) { return '<button type="button" class="chip' + cls + '" data-act="stats" data-focus="' + focusFor(text) + '">' + esc(text) + "</button>"; }
    var days = test.live ? live.allDay.slice(0, 2).map(allDayLabel) : [];
    var chips = (days.length ? [chip("All day: " + days.join(" \u00b7 "), "")] : [])
      .concat(ops.length ? [chip(ops.join(" \u00b7 "), "")] : [])
      .concat(lensChips(x).map(function (t) { return chip(t, " lens"); }));
    return '<footer class="bottom">' + chips.join("") + "</footer>";
  }

  // The stats screen. Everything here is invented: the day comes from the sample, the body numbers from the
  // test settings, and the goal progress is a placeholder until there is a real model behind it.
  function statRow(label, value) { return '<div class="stat-row"><span>' + esc(label) + "</span><b>" + esc(value) + "</b></div>"; }
  function goalRow(label, value, pct) {
    return '<div class="stat-row goal"><span>' + esc(label) + "</span><b>" + esc(value) + '</b><i class="bar"><i style="width:' + pct + '%"></i></i></div>';
  }

  function statsHtml(x) {
    var c = x.c, rows;
    var nowRows = operational(x).map(function (t) { return statRow("", t); });
    var calendar = (c.calendar || []).map(function (e) { return statRow(e.title, Model.clock(Model.mins(e.start)) + " to " + Model.clock(Model.mins(e.end))); });
    var body = sleepSet() ? [statRow("Sleep", hm(test.sleep))] : [];
    if (test.cycleDay > 0) { body.push(statRow("Cycle", cap(Learner.cyclePhase(test.cycleDay)) + " phase, day " + test.cycleDay)); }
    var sky = [statRow("Moon", c.moon.name)];
    if (c.moon.sign) { sky.push(statRow("Moon sign", c.moon.sign), statRow("Season", sunSign(c.day))); }
    sky.push(statRow("Sunrise and sunset", Model.clock(Model.mins(c.sunrise)) + " and " + Model.clock(Model.mins(c.sunset))));
    var goals = [goalRow("Today", "13\u00b0 closer", 28), goalRow("This week", "5 steps closer", 40), goalRow("This year", "45\u00b0 off trajectory", 55)];
    var sections = {
      now: ["Right now", nowRows.concat(calendar)],
      body: ["Body", body],
      sky: ["Sky", sky],
      goals: ["Goals", goals, "Placeholder numbers. There is no progress model behind them yet."]
    };
    var order = ["now", "body", "sky", "goals"];
    if (ui.statsFocus && sections[ui.statsFocus]) { order = [ui.statsFocus].concat(order.filter(function (k) { return k !== ui.statsFocus; })); }
    var html = order.map(function (k) {
      var sec = sections[k];
      return '<section class="stat"><h2>' + sec[0] + "</h2>" + (sec[1].length ? sec[1].join("") : '<p class="note">Nothing right now.</p>') + (sec[2] ? '<p class="note">' + sec[2] + "</p>" : "") + "</section>";
    }).join("");
    return '<header class="top"><div class="row">' + hamburger() + "<h1>Stats</h1></div>" +
      '<p class="sub"></p></header><div class="screen">' + html + "</div>";
  }

  function sheetHtml(x) {
    if (!ui.sheet) { return ""; }
    var body;
    if (ui.sheet === "note") {
      body = "<h2>Tell it something</h2>" +
        (ui.noteSent
          ? '<p style="margin:0">Got it.</p><p class="note-line" style="color:var(--hatch)">Test build: saved on this device only. No planner is connected yet.</p>'
          : '<textarea id="note" maxlength="1000" placeholder="What is off, or what you are about to do instead.">' + esc(ui.draft) + '</textarea>' +
            '<div class="actions"><button class="pill" data-act="sendnote">Send</button><span class="count" id="count">' + ui.draft.length + " / 1000</span></div>");
    } else if (ui.sheet === "reject" && ui.reject) {
      body = "<h2>\u201c" + esc(ui.reject.text) + "\u201d</h2>" +
        (ui.reject.step === "more"
          ? '<p class="ask">What about it isn\'t working?</p><textarea id="note" maxlength="1000" placeholder="Anything at all.">' + esc(ui.draft) + '</textarea>' +
            '<div class="actions"><button class="pill" data-act="rejectsend">Send</button><span class="count" id="count">' + ui.draft.length + " / 1000</span></div>"
          : '<p class="ask">Can you tell me more about that, or are you just not feeling it?</p>' +
            '<button class="row-btn" data-act="rejectmore">I can tell you more</button><button class="row-btn" data-act="rejectquiet">Just not feeling it</button>');
    } else if (ui.sheet === "palette") {
      body = "<h2>Colors</h2>" + PALETTES.map(function (q) {
        return '<button type="button" class="row-btn" data-act="palette" data-id="' + q.id + '" aria-pressed="' + (q.id === palette ? "true" : "false") + '">' +
          '<span class="swatch-row"><span class="swatch" aria-hidden="true">' + q.c.map(function (c) { return '<i style="background:' + c + '"></i>'; }).join("") + "</span>" +
          "<span>" + esc(q.name) + "<small>" + esc(q.note) + "</small></span></span></button>";
      }).join("");
    } else {
      body = "<h2>Today is off-plan</h2>" + DAY_MODES.map(function (d) {
        return '<button class="row-btn" data-act="daymode" data-mode="' + d[0] + '">' + d[1] + "</button>";
      }).join("");
    }
    return '<div class="scrim" data-act="closesheet"></div><div class="sheet">' + body + '<button class="quiet" data-act="closesheet">Close</button></div>';
  }

  // A web page cannot hide the browser's address bar by itself. Added to the home screen it opens without
  // one (see manifest.webmanifest). Where the browser allows it, this goes full screen instead.
  // The service worker does nothing but make the app installable.
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () { /* optional */ }); });
  }

  // Chrome on Android and desktop tells the page when it can be installed. The menu then offers it.
  var installEvent = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvent = e;
    window.__installReady = true;
    if (ui.menu) { render(); }
  });
  window.addEventListener("appinstalled", function () { installEvent = null; });

  function fullscreenOk() { return !!(document.documentElement.requestFullscreen && document.fullscreenEnabled !== false); }
  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) { document.exitFullscreen(); }
      else { document.documentElement.requestFullscreen({ navigationUI: "hide" }).catch(function () { /* not allowed */ }); }
    } catch (e) { /* not allowed */ }
  }

  function menuHtml() {
    if (!ui.menu) { return ""; }
    var item = function (id, label) {
      return '<button type="button" class="item" data-act="screen" data-screen="' + id + '"' + (ui.screen === id ? ' aria-current="true"' : "") + ">" + label + "</button>";
    };
    return '<button type="button" class="scrim" data-act="navmenu" aria-label="Close menu"></button>' +
      '<nav class="menu" aria-label="Menu"><button type="button" class="hamburger" data-act="navmenu" aria-label="Close menu"><span></span><span></span><span></span></button>' +
      '<p class="horizon">Unconscious</p>' + item("today", "Today") + item("stats", "Stats") + item("integrations", "Integrations") + item("install", "Install help") +
      '<button type="button" class="item" data-act="palettesheet">Colors</button>' +
      '<button type="button" class="item" data-act="notesheet">Tell it something</button>' +
      '<button type="button" class="item" data-act="daysheet">Off-plan today</button>' +
      '<button type="button" class="item" data-act="exportlog">Export my log</button>' +
      '<button type="button" class="item" data-act="bankpick">Load my option bank</button>' +
      (load("cc.mybank", null) ? '<button type="button" class="item" data-act="removebank">Remove my option bank</button>' : "") +
      (installEvent ? '<button type="button" class="item" data-act="install">Install app</button>' : "") +
      (fullscreenOk() ? '<button type="button" class="item" data-act="fullscreen">' + (document.fullscreenElement ? "Exit full screen" : "Full screen") + "</button>" : "") +
      '<button type="button" class="foot" data-act="clearall">Clear data on this device</button></nav>';
  }

  // Downloads everything the app has recorded on this device: every set of cards shown (with the lenses
  // that were true, views and actions) and the picks the learner uses. The made-up history is left out.
  function exportLog() {
    flushLog();
    var data = { exported: new Date().toISOString(), bank: bankName || "built-in", impressions: log.all(), offers: offers, notes: notes.length };
    var blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "unconscious-log-" + todayIso() + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  function todayIso() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate(); }

  function allDayLabel(e) { return e.of > 1 ? e.title + " (day " + e.day + " of " + e.of + ")" : e.title; }
  var MODE_TEXT = { plan: "Plans around its events", show: "Shown only", off: "Off" };
  var MODE_NEXT = { plan: "show", show: "off", off: "plan" };
  function calendarListHtml() {
    if (!live.cals.length) { return ""; }
    return '<div class="integ-extra cal-list"><p class="detail">Calendars. Tap one to change how it is used.</p>' + live.cals.map(function (c) {
      return '<button type="button" class="integ small" data-act="calmode" data-cal="' + esc(c.id) + '"><span class="name">' + esc(c.name) + '</span><span class="detail">' + MODE_TEXT[c.mode] + "</span></button>";
    }).join("") + "</div>";
  }

  // What the calendar gave back today, so it is clear it is being read.
  function calSummary() {
    if (live.calState && live.calState !== "ok") { return live.calState; }
    if (live.calState !== "ok") { return "Reading today."; }
    var t = live.calendar.length, o = live.other.length, a = live.allDay.length;
    var tail = live.calFailed.length ? " Could not read: " + live.calFailed.join(", ") + "." : "";
    if (!t && !a && !o) { return "Nothing on today." + tail; }
    var parts = [];
    if (t) { parts.push(t + " planned: " + live.calendar.map(function (e) { return e.title; }).join(", ")); }
    if (o) { parts.push(o + " shown only: " + live.other.map(function (e) { return e.title; }).join(", ")); }
    if (a) { parts.push(a + " all-day: " + live.allDay.map(allDayLabel).join(", ")); }
    return "Today: " + parts.join("; ") + "." + tail;
  }

  function integrationRow(id, name) {
    var on, detail, act, attrs = "", extra = "";
    if (id === "gcal") {
      on = Ctx.calendar.connected();
      detail = on ? "Connected. " + calSummary() : (/alendar|sign-in/.test(ui.calMsg) ? ui.calMsg : "Not connected.");
      act = on ? "caldisconnect" : "calconnect";
      if (on) { extra = calendarListHtml(); }
    } else if (id === "weather") {
      on = !!live.place;
      detail = live.place ? "Using " + live.place.label + "." : "Tap to use your location.";
      act = "locate";
    } else if (id === "energy") {
      return '<div class="integ"><label class="name" for="energy">Energy today</label><span class="detail">Low energy takes out demanding options and puts gentle ones first.</span>' +
        '<select id="energy" class="dateinput" data-test="energy"><option value="normal"' + (test.energy === "normal" ? " selected" : "") + '>Normal</option><option value="low"' + (test.energy === "low" ? " selected" : "") + ">Low</option></select></div>";
    } else if (id === "birthday") {
      return '<div class="integ"><label class="name" for="birth">Birthday</label><span class="detail">Used on this device for the astrology rows. Optional.</span>' +
        '<input id="birth" class="dateinput" type="date" data-profile="birth" max="' + todayIso() + '" value="' + esc(profile.birth) + '"></div>';
    } else if (LENS_IDS[id]) {
      var needsBirth = id === "sign" && !hasSign();
      on = lenses[id].enabled && !needsBirth;
      detail = needsBirth ? "Add your birthday first." : (on ? "On. " : "Off. ") + LENS_NOTE[id];
      act = needsBirth ? "" : "lens";
      attrs = ' data-lens="' + id + '"' + (needsBirth ? " disabled" : "");
      var control = "";
      if (id === "sleep") {
        control = '<label class="small-label">Last night <select class="dateinput" data-test="sleep"><option value=""' + (sleepSet() ? "" : " selected") + ' disabled>Not set today</option>' +
          [5, 7, 9].map(function (h) { return '<option value="' + h + '"' + (sleepSet() && test.sleep === h ? " selected" : "") + ">About " + h + " hours</option>"; }).join("") + "</select></label> ";
      } else if (id === "cycle") {
        control = '<label class="small-label">Cycle day <select class="dateinput" data-test="cycleDay"><option value="0"' + (test.cycleDay ? "" : " selected") + ">Off</option>" +
          Array.apply(null, Array(28)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (test.cycleDay === i + 1 ? " selected" : "") + ">Day " + (i + 1) + "</option>"; }).join("") + "</select></label> ";
      }
      if (control) { extra = '<div class="integ-extra">' + control + "</div>"; }
    } else {
      return "";
    }
    var pressed = LENS_IDS[id] ? ' aria-pressed="' + (on ? "true" : "false") + '"' : "";
    return '<button type="button" class="integ" data-act="' + act + '"' + attrs + pressed + '><span class="name">' + esc(name) + '</span><span class="detail">' + esc(detail) + "</span></button>" + extra;
  }

  // Why a phone may not offer to install the app. Checks what Chrome needs and says what is missing.
  function runDiag() {
    ui.diag = null;
    var ua = navigator.userAgent;
    var chrome = /Chrome\/(\d+)/.exec(ua);
    var other = /EdgA|SamsungBrowser|OPR\/|Firefox|DuckDuckGo/.test(ua);
    var inApp = /; wv\)|FBAN|FBAV|Instagram|Snapchat|Line\/|GSA\/|Twitter|TikTok/i.test(ua);
    var standalone = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
    var rows = [
      ["Opened in Chrome" + (chrome ? " (version " + chrome[1] + ")" : ""), !!chrome && !other, "This is not Chrome. Open the address in Chrome."],
      ["Not inside another app", !inApp, "This looks like a browser built into another app. Open the address in Chrome itself."],
      ["Secure address (https)", window.isSecureContext === true, "Use the https address."]
    ];
    var sw = ("serviceWorker" in navigator)
      ? navigator.serviceWorker.getRegistration().then(function (r) { return !!r; }).catch(function () { return false; })
      : Promise.resolve(false);
    var manifest = fetch("manifest.webmanifest").then(function (r) { return r.json(); }).then(function (m) {
      var sizes = (m.icons || []).map(function (i) { return i.sizes; }).join(" ");
      return !!(m.name && m.start_url && /standalone|fullscreen/.test(m.display) && sizes.indexOf("192x192") !== -1 && sizes.indexOf("512x512") !== -1);
    }).catch(function () { return false; });
    Promise.all([sw, manifest]).then(function (r) {
      rows.push(["Helper registered (service worker)", r[0], "Not registered yet. Reload the page once or twice, then check again."]);
      rows.push(["Install details readable (manifest)", r[1], "The manifest could not be read."]);
      rows.push(["Chrome says it can be installed", !!installEvent, "Chrome decides when to offer it. After the rows above are all Yes, reload once more, then open Chrome's menu (three dots)."]);
      rows.push(["Already running as an installed app", standalone, ""]);
      ui.diag = { rows: rows };
      if (ui.screen === "install") { render(); }
    });
  }

  function installHtml() {
    var d = ui.diag;
    var rows = !d ? '<div class="integ"><span class="name">Checking</span></div>' : d.rows.map(function (r) {
      return '<div class="integ"><span class="name">' + esc(r[0]) + ": " + (r[1] ? "Yes" : "No") + "</span>" + (!r[1] && r[2] ? '<span class="detail">' + esc(r[2]) + "</span>" : "") + "</div>";
    }).join("");
    return '<header class="top"><div class="row">' + hamburger() + "<h1>Install help</h1></div>" +
      '<p class="sub">In Chrome, open the menu (three dots), then Install app or Add to Home screen.</p></header>' +
      '<div class="screen"><section class="integ-group">' + rows + '<button type="button" class="pill only-pill" data-act="rediag">Check again</button></section></div>';
  }

  function integrationsHtml() {
    var groups = INTEGRATIONS.map(function (g) {
      return '<section class="integ-group"><h2>' + esc(g[0]) + "</h2>" + g[1].map(function (r) { return integrationRow(r[0], r[1]); }).join("") + "</section>";
    }).join("");
    return '<header class="top"><div class="row">' + hamburger() + "<h1>Integrations</h1></div>" +
      '<p class="sub">What the app can use right now. Anything switched on sits in the mix when a choice is made.' + (ui.calMsg ? " " + esc(ui.calMsg) : "") + "</p></header>" +
      '<div class="screen">' + groups + "</div>";
  }

    function testHtml() {
    if (!test.on) { return ""; }
    var stops = STOPS.map(function (s) { return '<button class="' + (test.minutes === s[1] ? "on" : "") + '" data-act="time" data-m="' + s[1] + '">' + s[0] + "</button>"; }).join("");
    stops += '<button class="' + (test.minutes === null ? "on" : "") + '" data-act="time" data-m="now">Now</button>';
    var bar = '<div class="testbar"><div class="tag">TEST ONLY</div><div class="clockread">' + Model.clock(nowMin()).replace(" am", "a").replace(" pm", "p") + '</div><div class="stops">' + stops + '</div><button class="' + (ui.drawer ? "on" : "") + '" data-act="drawer">More</button></div>';
    var drawer = "";
    if (ui.drawer) {
      var real = DOWS[new Date().getDay()];
      var dowOpts = '<option value="">Today (' + real + ")</option>" + DOWS.map(function (d, i) { return '<option value="' + i + '"' + (test.dow === i ? " selected" : "") + ">" + d + "</option>"; }).join("");
      drawer = '<div class="drawer"><h3>TEST TOOLS</h3>' +
        '<div class="ctl"><span>Day of week</span><select data-test="dow">' + dowOpts + "</select></div>" +
        '<div class="ctl"><span>Context</span><select data-test="live"><option value="0"' + (!test.live ? " selected" : "") + '>Sample day (Seattle, invented)</option><option value="1"' + (test.live ? " selected" : "") + ">Live weather and calendar</option></select></div>" +
        '<div class="ctl"><span>Energy</span><select data-test="energy"><option value="normal"' + (test.energy === "normal" ? " selected" : "") + '>Normal</option><option value="low"' + (test.energy === "low" ? " selected" : "") + ">Low</option></select></div>" +
        '<div class="ctl"><span>Sleep last night: <b id="sleepv">' + hm(test.sleep) + '</b></span><input type="range" min="5" max="9" step="2" value="' + test.sleep + '" data-test="sleep" data-out="sleepv"><div class="ticks"><span>5h</span><span>7h</span><span>9h</span></div></div>' +
        '<div class="ctl"><span>Cycle day: <b id="cyclev">' + (test.cycleDay || "off") + '</b></span><input type="range" min="0" max="28" step="1" value="' + test.cycleDay + '" data-test="cycleDay" data-out="cyclev"></div>' +
        '<div class="btns"><label class="chk"><input type="checkbox" data-test="pause"' + (test.pause ? " checked" : "") + '> Pause 3 seconds after a pick</label><label class="chk"><input type="checkbox" data-test="auto"' + (test.auto ? " checked" : "") + '> Move time on 30 minutes after every pick</label><button data-act="resetday">Replay the day (back to 8:10a, picks cleared)</button><button data-act="clearhistory">Clear picks</button><button data-act="hidetest">Hide test tools</button></div>' +
        "<p>Add #test to the address to bring these back.</p></div>";
    }
    return bar + drawer;
  }

  function render() {
    var html;
    if (ui.screen === "integrations") {
      html = integrationsHtml();
    } else if (ui.screen === "install") {
      html = installHtml();
    } else if (ui.screen === "stats") {
      var sx = compute();
      sx.shown = [];
      current = sx;
      html = statsHtml(sx) + testHtml();
    } else {
      var x = compute();
      var cards = shownCards(x);
      html = topHtml(x) + '<section class="mid">' + midHtml(x, cards) + "</section>" + bottomHtml(x) + sheetHtml(x) + testHtml();
      x.shown = cards;
      current = x;
    }
        app.innerHTML = html + menuHtml();
    ui.enterOnce = false;
    ui.titleNew = false;
    syncLog();
    if (bundle && precomputed !== sess && ui.screen === "today") { precomputed = sess; setTimeout(precompute, 30); }
  }
  var current = null;

  // ---- actions ----
  function saveAll() { save("cc.state", S); save("cc.offers", offers); save("cc.lenses", lenses); save("cc.profile", profile); save("cc.notes", notes); save("cc.test", test); flushLog(); save("cc.you", { sleep: test.sleep, cycleDay: test.cycleDay, energy: test.energy, sleepDay: test.sleepDay }); }

  // A clean run for testing: back to the first stop of the morning, nothing picked, no day mode, no sheet open.
  // Picks made today during testing are dropped so they do not feed the learner; made-up history and
  // picks from earlier days stay.
  function replayDay() {
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    offers = offers.filter(function (o) { return o.t < start.getTime(); });
    log.dropSince(start.getTime());
    S = { day: todayKey() };
    test.minutes = 490;
    ui.sheet = null; ui.noteSent = false; ui.draft = "";
    clearTimeout(holdTimer); ui.hold = false;
  }

  // Everything computable for this moment, kept with each pick. All-day events are counted, not named.
  function ctxSnap(x) {
    var o = Astro.snapshot(profile.birth, x.c);
    if (test.live) { o.allDay = live.allDay.length; o.multiDay = live.allDay.some(function (e) { return e.of > 1; }); }
    return o;
  }

  function pick(id, how, dx) {
    var x = compute();
    var cards = shownCards(x);
    var card = cardsFor(x).filter(function (c) { return c.id === id; })[0];
    if (!card || !x.view.node) { return; }
    log.act(how === "swipe" ? "swipe_right" : "tap", { card: card.id, option: card.option, dx: dx || 0 }, Date.now());
    offers.push({
      t: Date.now(), slice: x.slice, lens: Object.assign({}, x.states), ctx: ctxSnap(x),
      shown: cards.map(function (c) { return { o: c.option, a: isActive(c) }; }),
      picked: card.option, pickedActive: isActive(card), source: test.minutes !== null ? "test" : "live"
    });
    if (offers.length > 3000) { offers = offers.slice(offers.length - 3000); }
    var child = Model.childFor(x.view.node, card);
    // Opening a category is only navigation: it is not an activity and it does not move the day on.
    if (!card.opens) {
      S.activity = { label: card.label || card.text, steps: card.steps || null, at: x.m, until: x.m + (card.duration_min || 0) };
      if (test.auto) { S.advance = 30; }
    }
    S.cursor = { node: child || x.view.id, setAt: x.m };
    saveAll();
    var box = document.querySelector(".mid .stack");
    ui.boxHeight = box ? box.offsetHeight : 0;
    how = how || "tap";
    ui.exiting = { cards: cards.filter(function (c) { return !(c.tags && c.tags.kind === "quiet"); }), pickedId: card.id, how: how, dx: dx || 0 };
    ui.titleNew = !card.opens;
    clearTimeout(holdTimer);
    clearTimeout(exitTimer);
    ui.hold = !!test.pause && !card.opens;
    exitTimer = setTimeout(function () { ui.exiting = null; if (!ui.hold) { applyAdvance(); ui.enterOnce = true; } render(); }, card.opens ? 350 : how === "swipe" ? 450 : 900);
    if (ui.hold) { holdTimer = setTimeout(function () { ui.hold = false; applyAdvance(); ui.enterOnce = true; render(); }, 3000); }
    render();
  }

  // Every second pick moves the day on by the time the two things took. It lands when the next set appears,
  // so the title keeps showing what was just picked until then.
  function applyAdvance() {
    if (!S.advance) { return; }
    S.skew = (S.skew || 0) + S.advance;
    delete S.advance;
    saveAll();
  }

  // "More options" and "Back" only move the cursor to another node the planner already made.
  function goTo(which) {
    if (ui.hold || ui.exiting || ui.sheet) { return; }
    var x = compute();
    var to = x.view.node && x.view.node.children[which];
    if (!to) { return; }
    log.act(which === "back" ? "back" : "nav", { to: which }, Date.now());
    S.cursor = { node: to, setAt: x.m };
    saveAll();
    ui.enterOnce = true;
    render();
  }

  // Swipe left: a kind question first. "Not feeling it" or a few words, then the planner answers with a
  // new set that leaves the option out for the rest of the day.
  function startReject(id) {
    var x = compute();
    var card = cardsFor(x).filter(function (c) { return c.id === id; })[0];
    if (!card || (card.tags && card.tags.kind === "quiet")) { return; }
    log.act("swipe_left", { card: card.id, option: card.option }, Date.now());
    ui.reject = { id: id, text: card.text, option: card.option, step: "ask" };
    ui.sheet = "reject";
    ui.draft = "";
    render();
  }

  function doReject(reason, text) {
    var x = compute();
    var cards = shownCards(x);
    var r = ui.reject;
    var card = r && cardsFor(x).filter(function (c) { return c.id === r.id; })[0];
    if (!card || !x.view.node) { ui.sheet = null; ui.reject = null; render(); return; }
    log.act("reject_reason", { card: card.id, option: card.option, reason: reason, hasText: !!text }, Date.now());
    offers.push({
      t: Date.now(), slice: x.slice, lens: Object.assign({}, x.states), ctx: ctxSnap(x),
      shown: cards.map(function (c) { return { o: c.option, a: isActive(c) }; }),
      picked: null, rejected: card.option, reason: reason, source: test.minutes !== null ? "test" : "live"
    });
    if (text) { notes.push({ t: Date.now(), text: text, about: card.option }); }
    S.cursor = { node: sess.reject(x.view.id, card.option), setAt: x.m };
    ui.sheet = null; ui.reject = null; ui.noteSent = false; ui.draft = "";
    var gbox = document.querySelector(".mid .stack");
    ui.boxHeight = gbox ? gbox.offsetHeight : 0;
    ui.exiting = { cards: cards.filter(function (c) { return !(c.tags && c.tags.kind === "quiet"); }), goneId: card.id };
    clearTimeout(exitTimer);
    exitTimer = setTimeout(function () { ui.exiting = null; ui.enterOnce = true; render(); }, 450);
    saveAll();
    render();
  }

  // Swipe right (or tap) chooses. Swipe left rejects. Arrow keys do the same on a focused card.
  var drag = null, swallowClick = false;
  function cardEl(e) { return e.target && e.target.closest ? e.target.closest('button.card[data-act="pick"]') : null; }

  app.addEventListener("pointerdown", function (e) {
    var el = cardEl(e);
    if (!el || ui.hold || ui.exiting || ui.sheet || (e.pointerType === "mouse" && e.button !== 0)) { return; }
    drag = { el: el, id: el.getAttribute("data-id"), x: e.clientX, y: e.clientY, dx: 0, moved: false, pid: e.pointerId };
  });
  app.addEventListener("pointermove", function (e) {
    if (!drag || e.pointerId !== drag.pid) { return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = null; return; }
      if (Math.abs(dx) < 8) { return; }
      drag.moved = true;
      drag.el.classList.add("drag");
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointers cannot be captured */ }
    }
    drag.dx = dx;
    drag.el.style.transform = "translateX(" + dx + "px)";
    drag.el.classList.toggle("right", dx > 50);
    drag.el.classList.toggle("left", dx < -50);
  });
  function endDrag(e, cancelled) {
    if (!drag || e.pointerId !== drag.pid) { return; }
    var d = drag;
    drag = null;
    if (!d.moved) { return; }
    swallowClick = true;
    setTimeout(function () { swallowClick = false; }, 60);
    if (!cancelled && d.dx > 90) { pick(d.id, "swipe", d.dx); }
    else if (!cancelled && d.dx < -90) { startReject(d.id); }
    else { d.el.classList.remove("drag", "right", "left"); d.el.style.transform = ""; }
  }
  app.addEventListener("pointerup", function (e) { endDrag(e, false); });
  app.addEventListener("pointercancel", function (e) { endDrag(e, true); });
  var touchY = null;
  app.addEventListener("touchstart", function (e) { touchY = e.touches.length === 1 && e.target.closest(".mid") ? e.touches[0].clientY : null; }, { passive: true });
  app.addEventListener("touchend", function (e) {
    if (touchY === null) { return; }
    var dy = e.changedTouches[0].clientY - touchY;
    touchY = null;
    if (dy < -40) { reveal("swipe_up"); }
  }, { passive: true });
  app.addEventListener("wheel", function (e) { if (e.deltaY > 8 && e.target.closest(".mid")) { reveal("scroll"); } }, { passive: true });

  app.addEventListener("keydown", function (e) {
    if ((e.key === "ArrowDown" || e.key === "PageDown") && cardEl(e)) { reveal("key"); }
    var el = cardEl(e);
    if (!el || ui.hold || ui.exiting || ui.sheet) { return; }
    if (e.key === "ArrowRight") { e.preventDefault(); pick(el.getAttribute("data-id"), "swipe", 0); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); startReject(el.getAttribute("data-id")); }
  });

  document.addEventListener("visibilitychange", function () { if (ui.screen === "today") { syncLog(); } if (document.visibilityState === "hidden") { flushLog(); } });
  window.addEventListener("pagehide", flushLog);

  function loadLive() {
    live.moon = Ctx.moonFor(new Date());
    Ctx.locate().then(function (place) {
      live.place = place;
      return Ctx.loadWeather(place);
    }).then(function (w) {
      live.weather = w.weather; live.sunrise = w.sunrise; live.sunset = w.sunset;
      render();
    }).catch(function () { ui.calMsg = "Weather didn't answer."; render(); });
    loadCal();
  }
  function loadCal() {
    Ctx.calendar.load(profile.cals).then(function (r) {
      live.calendar = r ? r.events : []; live.other = r ? r.other : []; live.allDay = r ? r.allDay : [];
      live.cals = r ? r.calendars : []; live.calFailed = r ? r.failed : []; live.calState = r ? "ok" : "";
      if (r && r.status === "needs_reconnect") { ui.calMsg = "Calendar sign-in needs renewing. Tap Connect."; }
      render();
    }).catch(function (err) { live.calState = "Could not read it (" + (err && err.message || "error") + ")."; render(); });
  }

  app.addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; return; }
    if (ui.drawer && !e.target.closest(".drawer, .testbar")) { ui.drawer = false; render(); return; }
    var el = e.target.closest("[data-act]");
    // Nothing on the stats screen is interactive, so a tap anywhere on it (menu button aside) goes back.
    if (!el && ui.screen === "stats" && !ui.menu && !e.target.closest(".testbar, .drawer")) { ui.screen = "today"; render(); return; }
    // Inside a category, a tap on the background (off the cards) goes back.
    if (!el && ui.screen === "today" && !ui.menu && !ui.sheet && !e.target.closest(".card, .testbar, .drawer, .chip, .bottom, .top")) { goTo("back"); return; }
    if (!el || el.disabled) { return; }
    var act = el.getAttribute("data-act");
    if (act === "pick") { pick(el.getAttribute("data-id"), "tap"); return; }
    if (act === "nav") { goTo(el.getAttribute("data-to")); return; }
    if (act === "reveal") { reveal("tap"); return; }
    if (act === "rejectmore") { if (ui.reject) { ui.reject.step = "more"; render(); } return; }
    if (act === "rejectquiet") { doReject("not_feeling_it", ""); return; }
    if (act === "rejectsend") { var why = ui.draft.trim(); if (why) { doReject("more", why); } return; }
    if (act === "closesheet") { ui.sheet = null; ui.noteSent = false; ui.reject = null; }
    else if (act === "notesheet") { ui.sheet = "note"; ui.noteSent = false; ui.menu = false; ui.screen = "today"; }
    else if (act === "palettesheet") { ui.sheet = "palette"; ui.menu = false; ui.screen = "today"; }
    else if (act === "palette") { palette = paletteById(el.getAttribute("data-id")).id; save("cc.palette", palette); applyPalette(); }
    else if (act === "daysheet") { ui.sheet = "day"; ui.menu = false; ui.screen = "today"; }
    else if (act === "daymode") {
      var mode = el.getAttribute("data-mode");
      S.dayMode = { mode: mode, label: DAY_MODES.filter(function (d) { return d[0] === mode; })[0][1] };
      ui.sheet = null;
    }
    else if (act === "enddaymode") { delete S.dayMode; }
    else if (act === "sendnote") {
      var text = ui.draft.trim();
      if (!text) { return; }
      notes.push({ t: Date.now(), text: text });
      ui.draft = ""; ui.noteSent = true;
    }
    else if (act === "stats") { ui.screen = "stats"; ui.statsFocus = el.getAttribute("data-focus"); }
    else if (act === "navmenu") { ui.menu = !ui.menu; }
    else if (act === "rediag") { runDiag(); }
    else if (act === "exportlog") { exportLog(); ui.menu = false; }
    else if (act === "bankpick") { var pk = document.getElementById("bankpick"); if (pk) { pk.value = ""; pk.click(); } return; }
    else if (act === "removebank") { try { localStorage.removeItem("cc.mybank"); } catch (err) { /* storage blocked */ } applyBank(null); ui.menu = false; }
    else if (act === "fullscreen") { toggleFullscreen(); ui.menu = false; }
    else if (act === "install") { if (installEvent) { installEvent.prompt(); installEvent = null; } ui.menu = false; }
    else if (act === "screen") { ui.screen = el.getAttribute("data-screen"); ui.statsFocus = null; ui.menu = false; if (ui.screen === "install") { runDiag(); } }
    else if (act === "lens") { var lid = el.getAttribute("data-lens"); lenses[lid].enabled = !lenses[lid].enabled; }
    else if (act === "time") {
      var m = el.getAttribute("data-m");
      test.minutes = m === "now" ? null : Number(m);
      S.skew = 0; delete S.advance;
    }
    else if (act === "drawer") { ui.drawer = !ui.drawer; }
    else if (act === "resetday") { replayDay(); }
    else if (act === "clearhistory") { offers = []; log.clear(); }
    else if (act === "hidetest") { test.on = false; ui.drawer = false; }
    else if (act === "locate") { loadLive(); ui.calMsg = "Asking for your location."; }
    else if (act === "calconnect") {
      Ctx.calendar.connect(function (msg) {
        ui.calMsg = msg;
        if (!msg) { test.live = true; saveAll(); loadLive(); }
        render();
      });
      return;
    }
    else if (act === "caldisconnect") { Promise.resolve(Ctx.calendar.disconnect()).then(function () { render(); }); live.calendar = []; live.other = []; live.allDay = []; live.cals = []; live.calState = ""; ui.calMsg = ""; }
    else if (act === "calmode") {
      var cid = el.getAttribute("data-cal"), cur = live.cals.filter(function (c) { return c.id === cid; })[0];
      if (cur) { cur.mode = MODE_NEXT[cur.mode]; profile.cals[cid] = cur.mode; live.calState = ""; loadCal(); }
    }
    else if (act === "clearall") {
      if (!confirm("Clear picks, settings and notes stored in this browser?")) { return; }
      Object.keys(localStorage).filter(function (k) { return k.indexOf("cc.") === 0; }).forEach(function (k) { localStorage.removeItem(k); });
      location.reload();
      return;
    }
    saveAll();
    render();
  });

  app.addEventListener("input", function (e) {
    var t = e.target;
    if (t.id === "note") {
      ui.draft = t.value;
      var c = document.getElementById("count");
      if (c) { c.textContent = ui.draft.length + " / 1000"; }
    } else if (t.getAttribute("data-out")) {
      var out = document.getElementById(t.getAttribute("data-out"));
      var v = Number(t.value);
      if (out) { out.textContent = t.getAttribute("data-test") === "sleep" ? hm(v) : (v || "off"); }
    }
  });

  // The file input lives outside the part of the page that is redrawn, so a redraw while the file picker is
  // open cannot remove it.
  var bankInput = document.getElementById("bankpick");
  if (bankInput) {
    bankInput.addEventListener("change", function () {
      var f = bankInput.files && bankInput.files[0];
      if (!f) { return; }
      f.text().then(function (txt) {
        var b = JSON.parse(txt);
        if (!validBank(b)) { throw new Error("not an option bank"); }
        save("cc.mybank", b);
        applyBank(b);
        ui.menu = false; ui.screen = "today"; ui.enterOnce = true;
        render();
      }).catch(function () { window.alert("That file is not an option bank. Choose the bank file made by tools/convert-intake.js (unconscious-bank.json)."); });
    });
  }

  app.addEventListener("change", function (e) {
    var t = e.target;
    var key = t.getAttribute("data-test");
    if (t.getAttribute("data-profile") === "birth") {
      profile.birth = Astro.validBirth(t.value) ? t.value : "";
      if (profile.birth) { lenses.sign.enabled = true; }
    } else if (key) {
      var val = t.type === "checkbox" ? t.checked : t.value;
      if (key === "pause") { test.pause = !!val; }
      else if (key === "auto") { test.auto = !!val; delete S.advance; }
      else if (key === "dow") { test.dow = val === "" ? null : Number(val); }
      else if (key === "live") { test.live = val === "1"; if (test.live) { loadLive(); } }
      else if (key === "energy") { test.energy = val; }
      else if (key === "sleep") { test.sleep = snapSleep(Number(val)); test.sleepDay = todayKey(); }
      else { test[key] = Number(val); }
    } else { return; }
    saveAll();
    render();
  });

  // ---- start ----
  if (Sync.takeSetupLink()) { test.live = true; }
  var calResult = Sync.takeCalendarResult();
  if (calResult === "connected") { test.live = true; } else if (calResult) { ui.calMsg = "Calendar connection stopped."; }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { save("cc.log", log.all()); Sync.uploadLog(log.all(), true); }
    else if (Sync.enabled()) { loadCal(); }
  });
  var tokenMsg = Ctx.calendar.takeRedirectToken();
  if (tokenMsg === "") { test.live = true; } else if (tokenMsg) { ui.calMsg = tokenMsg; }
  if (location.hash === "#clean") { test.on = false; }
  if (location.hash === "#test") { test.on = true; }

  // A person's own option bank. It comes from the Load my option bank item in the menu (kept on this device
  // only) or, when running from a local server, from private/bank.json. Neither is ever published. Without
  // one the built-in sample bank is used. A different bank starts the day again from the top.
  function applyBank(b) {
    Planner.useBank(b ? b.options : undefined, b ? b.keep : undefined);
    sessions = {}; precomputed = "";
    recurring = (b && b.recurring) || [];
    bankName = b ? b.id : "";
    var key = b ? b.id : "built-in";
    if (load("cc.bank", "") !== key) { delete S.cursor; save("cc.bank", key); saveAll(); }
  }
  function validBank(b) {
    return !!(b && Array.isArray(b.options) && b.options.length && b.options.every(function (o) { return o && o.id && o.text && o.label; }));
  }
  function loadBank() {
    var mine = load("cc.mybank", null);
    if (validBank(mine)) { applyBank(mine); return Promise.resolve(); }
    var give = new Promise(function (res) { setTimeout(res, 2000, null); });
    var got = fetch("private/bank.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    return Promise.race([got, give]).then(function (b) { if (validBank(b)) { applyBank(b); } });
  }
  loadBank().then(function () {
    if (test.live) { loadLive(); }
    render();
  });
  setInterval(function () {
    if (test.minutes === null && !ui.sheet && !ui.menu && (ui.screen === "today" || ui.screen === "stats") && !ui.drawer) { render(); }
  }, 30000);
})();
