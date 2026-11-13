(function () {
  "use strict";

  var app = document.getElementById("app");

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }

  // A refresh starts from scratch. Only the Google Calendar sign-in is kept.
  try {
    Object.keys(localStorage).forEach(function (k) { if (k.indexOf("cc.") === 0 && k !== "cc.gcal") { localStorage.removeItem(k); } });
  } catch (e) { /* storage blocked */ }

  var INTEGRATIONS = [
    ["Schedule", [["gcal", "Google Calendar"], ["outlook", "Outlook"], ["acal", "Apple Calendar"]]],
    ["Messages", [["messages", "Messages"], ["gmail", "Gmail"], ["whatsapp", "WhatsApp"]]],
    ["Social and inspiration", [["instagram", "Instagram"], ["pinterest", "Pinterest boards"]]],
    ["Wearables and hardware", [["sleep", "Sleep hours"], ["fitness", "Fitness tracker"], ["oura", "Oura"], ["garmin", "Garmin"], ["whoop", "Whoop"], ["fitbit", "Fitbit"], ["applehealth", "Apple Health"], ["healthconnect", "Health Connect"], ["withings", "Withings scale"], ["eightsleep", "Eight Sleep"], ["dexcom", "Dexcom glucose"]]],
    ["Nutrition and training", [["mfp", "MyFitnessPal"], ["cronometer", "Cronometer"], ["strava", "Strava"]]],
    ["Cycle", [["cycle", "Cycle days"], ["flo", "Flo"], ["clue", "Clue"], ["naturalcycles", "Natural Cycles"]]],
    ["Sky and place", [["weather", "Weather and location"], ["moon", "Moon"], ["zodiac", "Zodiac"], ["transit", "Transit"]]],
    ["Notes and files", [["drive", "Google Drive"], ["notion", "Notion"], ["applenotes", "Apple Notes"]]],
    ["Focus", [["screentime", "Screen Time"], ["focusmodes", "Focus modes"], ["wellbeing", "Digital Wellbeing"]]]
  ];
  var LENS_IDS = { sleep: true, moon: true, cycle: true, zodiac: true, fitness: true };
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
  // A made-up history is baked in, so learned chips and ordering show from the first open.
  var baked = Sim.demoHistory();
  function history() { return baked.concat(offers); }
  var lenses = Object.assign({ sleep: { enabled: true, hidden: false }, moon: { enabled: true, hidden: false }, cycle: { enabled: true, hidden: false }, zodiac: { enabled: true, hidden: false }, fitness: { enabled: true, hidden: false } }, load("cc.lenses", {}));
  var notes = load("cc.notes", []);
  var test = Object.assign({ on: true, minutes: null, dow: null, live: false, energy: "normal", sleep: 7, cycleDay: 21, pause: true, auto: true }, load("cc.test", {}));
  test.sleep = snapSleep(test.sleep);
  var ui = { sheet: null, menu: false, screen: "today", drawer: false, draft: "", noteSent: false, calMsg: "", hold: false, exiting: null, enterOnce: false, titleNew: false, reject: null };
  var holdTimer = null;
  var exitTimer = null;
  var live = { weather: [], sunrise: "07:00", sunset: "17:00", calendar: [], place: null, moon: Ctx.moonFor(new Date()) };

  // ---- time and context ----
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function realMinutes() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
  function nowMin() { return Math.min(1438, (test.minutes !== null ? test.minutes : realMinutes()) + (S.skew || 0)); }
  function dowNow() { return test.dow !== null ? test.dow : new Date().getDay(); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function hm(h) { var t = Math.round(h * 60), m = t % 60; return Math.floor(t / 60) + "h" + (m ? " " + m + "m" : ""); }
  function snapSleep(h) { return h < 6 ? 5 : h < 8 ? 7 : 9; }

  function ctxNow() {
    if (!test.live) {
      var c = Sample.context;
      return { day: c.day, weather: c.weather, sunrise: c.sunrise, sunset: c.sunset, calendar: c.calendar, moon: { name: cap(c.moon.phase), group: Learner.moonGroup(c.moon.phase), sign: c.moon.sign } };
    }
    var d = new Date();
    var day = d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
    return { day: day, weather: live.weather, sunrise: live.sunrise, sunset: live.sunset, calendar: live.calendar, moon: { name: live.moon.name, group: Learner.moonGroupFromElongation(live.moon.elongation), sign: live.moon.sign } };
  }

  function lensStates(c) {
    var s = {};
    if (lenses.sleep.enabled) { s.sleep = Learner.sleepState(test.sleep); }
    if (lenses.moon.enabled) { s.moon = c.moon.group; }
    if (lenses.cycle.enabled && test.cycleDay > 0) { s.cycle = Learner.cyclePhase(test.cycleDay); }
    return s;
  }

  var SUN_SIGNS = [["Capricorn", 1, 19], ["Aquarius", 2, 18], ["Pisces", 3, 20], ["Aries", 4, 19], ["Taurus", 5, 20], ["Gemini", 6, 20], ["Cancer", 7, 22], ["Leo", 8, 22], ["Virgo", 9, 22], ["Libra", 10, 22], ["Scorpio", 11, 21], ["Sagittarius", 12, 21], ["Capricorn", 12, 31]];
  function sunSign(day) {
    var p = String(day).split("-"), mo = Number(p[1]), d = Number(p[2]);
    for (var i = 0; i < SUN_SIGNS.length; i++) { if (mo < SUN_SIGNS[i][1] || (mo === SUN_SIGNS[i][1] && d <= SUN_SIGNS[i][2])) { return SUN_SIGNS[i][0]; } }
    return "Capricorn";
  }

  function lensText(id, c) {
    if (id === "sleep") { return "Slept " + hm(test.sleep); }
    if (id === "moon") { return c.moon.name; }
    return cap(Learner.cyclePhase(test.cycleDay)) + " phase, day " + test.cycleDay;
  }

  // Invented tracker readings that move with the sleep setting and the time of day.
  function fitnessLines(x) {
    var band = Planner.sleepBand(test.sleep);
    var lines = ["Readiness " + { 5: 61, 7: 78, 9: 89 }[band], "Resting heart rate 58", "HRV " + { 5: 41, 7: 54, 9: 63 }[band]];
    var steps = Math.round(Math.max(0, x.m - 420) * 0.75) * 10;
    if (steps >= 200) { lines.push(steps.toLocaleString("en-US") + " steps so far"); }
    return lines;
  }

  // One plan per sleep band (about 5, 7 or 9 hours), kept for the context it was made for. Switching
  // between them is instant, and the new plan restores the node the user was on.
  function planFor(c, sleep) {
    var sig = [c.day, test.live ? 1 : 0, test.energy, sleep, live.weather.length, live.calendar.map(function (e) { return e.start + e.end; }).join(), live.sunrise, live.sunset].join("|");
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

  function cardsFor(x) {
    var cards = x.view.cards.slice();
    if (!cards.length) { return [quietCard(x)]; }
    var p = Learner.tilt(history(), x.slice, x.states);
    if (p === null) { return cards; }
    var activeFirst = p >= 0.5;
    return cards.map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
      var aa = isActive(a.c) ? 1 : 0, bb = isActive(b.c) ? 1 : 0;
      if (aa !== bb) { return activeFirst ? bb - aa : aa - bb; }
      return a.i - b.i;
    }).map(function (o) { return o.c; });
  }

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

  // One short chip per lens, to hint at what could sit here. Patterns the app has learned come first; the
  // rest are ambient, one line per lens, rotating through the day. Lenses switched off or hidden never show.
  var LENS_ORDER = ["sleep", "cycle", "moon", "zodiac", "fitness"];
  function lensChips(x) {
    var hidden = {}, taken = {}, out = [];
    Object.keys(lenses).forEach(function (id) { if (lenses[id].hidden || !lenses[id].enabled) { hidden[id] = true; } });
    Learner.chipsFor(history(), x.slice, x.states, hidden, 3).forEach(function (f) {
      var ids = f.kind === "single" ? [f.lens] : f.lens;
      ids.forEach(function (id) { taken[id] = true; });
      out.push(ids.map(function (id) { return lensText(id, x.c); }).join(" · "));
    });
    var hour = Math.floor(x.m / 30);
    function add(id, options) {
      if (hidden[id] || taken[id] || !options.length) { return; }
      taken[id] = true;
      out.push(options[(hour + LENS_ORDER.indexOf(id)) % options.length]);
    }
    add("sleep", ["Slept " + hm(test.sleep)]);
    add("cycle", test.cycleDay > 0 ? [lensText("cycle", x.c)] : []);
    add("moon", [x.c.moon.name]);
    add("zodiac", x.c.moon.sign ? ["Moon in " + x.c.moon.sign, sunSign(x.c.day) + " season"] : []);
    add("fitness", fitnessLines(x));
    return out.slice(0, 5);
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
      else if (a) { sub = "Last: " + a.label + "."; }
      else { sub = v.id === bundle.root ? "Start of day." : ""; }
    }
    return '<header class="top"><div class="row">' + hamburger() + '<h1' + (ui.titleNew ? ' class="new"' : '') + '>' + esc(title) + '</h1>' +
      '<button class="quiet" data-act="menu">Not this</button></div>' +
      '<p class="sub">' + esc(sub) + "</p></header>";
  }

  // While cards leave and the next set is on its way, the box keeps its height so nothing jumps.
  function boxStyle() { return ui.boxHeight ? ' style="min-height:' + ui.boxHeight + 'px"' : ""; }

  function midHtml(x, cards) {
    var v = x.view;
    if (S.dayMode) { return '<div class="card still">Nothing needed today.</div><div><button class="pill" data-act="enddaymode">End day mode</button></div>'; }
    if (!v.node) { return '<div class="card still">Nothing needed.</div>'; }
    if (ui.exiting) {
      var ex = ui.exiting;
      return '<div class="stack"' + boxStyle() + '>' + ex.cards.map(function (c) {
        var cls = "card ghost", style = "";
        if (ex.pickedId === c.id) {
          cls += ex.how === "swipe" ? " slide-right" : " keep";
          if (ex.how === "swipe" && ex.dx) { style = ' style="--x:' + Math.round(ex.dx) + 'px;--r:' + (ex.dx / 50).toFixed(1) + 'deg"'; }
        } else if (ex.goneId === c.id) { cls += " gone"; }
        else if (ex.pickedId) { cls += " fade"; }
        return '<div class="' + cls + '"' + style + '>' + esc(c.text) + "</div>";
      }).join("") + "</div>";
    }
    if (ui.hold) { return '<div class="stack empty"' + boxStyle() + "></div>"; }
    return '<div class="stack' + (ui.enterOnce ? " enter" : "") + '">' + cards.map(function (c) {
      if (c.tags && c.tags.kind === "quiet") { return '<div class="card still">' + esc(c.text) + "</div>"; }
      var away = ui.reject && ui.reject.id === c.id ? " away" : "";
      return '<button class="card' + away + '" data-act="pick" data-id="' + esc(c.id) + '">' + esc(c.text) + "</button>";
    }).join("") + "</div>";
  }

  function bottomHtml(x) {
    var chips = operational(x).slice(0, 2).map(function (t) { return '<span class="chip">' + esc(t) + "</span>"; })
      .concat(lensChips(x).map(function (t) { return '<span class="chip lens">' + esc(t) + "</span>"; }));
    return '<footer class="bottom">' + chips.join("") + "</footer>";
  }

  function rerollState(x) {
    var n = x.view.node;
    if (!n || !n.reroll || S.dayMode) { return "Not available on this screen"; }
    if ((S.rerolls || {})[x.view.id] >= 1) { return "Already used on this screen"; }
    if ((S.rerollsToday || 0) >= 3) { return "That's three today. Tell it what you're after instead."; }
    return "";
  }

  function sheetHtml(x) {
    if (!ui.sheet) { return ""; }
    var body;
    if (ui.sheet === "menu") {
      var why = rerollState(x);
      body = "<h2>Not this</h2>" +
        '<button class="row-btn" data-act="reroll"' + (why ? " disabled" : "") + ">Show different options<small>" + esc(why || "One per screen") + "</small></button>" +
        '<button class="row-btn" data-act="notesheet">Tell it something<small>Typed, one way, up to 1,000 characters</small></button>' +
        '<button class="row-btn" data-act="daysheet">Today is off-plan<small>Sick, travelling, a big day, a rough one</small></button>';
    } else if (ui.sheet === "note") {
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
    } else {
      body = "<h2>Today is off-plan</h2>" + DAY_MODES.map(function (d) {
        return '<button class="row-btn" data-act="daymode" data-mode="' + d[0] + '">' + d[1] + "</button>";
      }).join("");
    }
    return '<div class="scrim" data-act="closesheet"></div><div class="sheet">' + body + '<button class="quiet" data-act="closesheet">Close</button></div>';
  }

  function menuHtml() {
    if (!ui.menu) { return ""; }
    var item = function (id, label) {
      return '<button type="button" class="item" data-act="screen" data-screen="' + id + '"' + (ui.screen === id ? ' aria-current="true"' : "") + ">" + label + "</button>";
    };
    return '<button type="button" class="scrim" data-act="navmenu" aria-label="Close menu"></button>' +
      '<nav class="menu" aria-label="Menu"><button type="button" class="hamburger" data-act="navmenu" aria-label="Close menu"><span></span><span></span><span></span></button>' +
      '<p class="horizon">Menu</p>' + item("today", "Today") + item("integrations", "Integrations") +
      '<button type="button" class="foot" data-act="clearall">Clear data on this device</button></nav>';
  }

  function integrationRow(id, name) {
    var on, detail, act, attrs = "", extra = "";
    if (id === "gcal") {
      on = Ctx.calendar.connected();
      detail = on ? "Connected." : "Not connected.";
      act = on ? "caldisconnect" : "calconnect";
    } else if (id === "weather") {
      on = !!live.place;
      detail = live.place ? "Using " + live.place.label + "." : "Tap to use your location.";
      act = "locate";
    } else if (LENS_IDS[id]) {
      on = lenses[id].enabled;
      detail = on ? "On." : "Off.";
      act = "lens";
      attrs = ' data-lens="' + id + '"';
      if (on) { extra = '<div class="integ-extra"><button type="button" class="quiet" data-act="lenshide" data-lens="' + id + '">' + (lenses[id].hidden ? "Show on screen" : "Hide on screen") + "</button></div>"; }
    } else {
      return '<button type="button" class="integ" disabled><span class="name">' + esc(name) + '</span><span class="detail">Planned.</span></button>';
    }
    var pressed = LENS_IDS[id] ? ' aria-pressed="' + (on ? "true" : "false") + '"' : "";
    return '<button type="button" class="integ" data-act="' + act + '"' + attrs + pressed + '><span class="name">' + esc(name) + '</span><span class="detail">' + esc(detail) + "</span></button>" + extra;
  }

  function integrationsHtml() {
    var groups = INTEGRATIONS.map(function (g) {
      return '<section class="integ-group"><h2>' + esc(g[0]) + "</h2>" + g[1].map(function (r) { return integrationRow(r[0], r[1]); }).join("") + "</section>";
    }).join("");
    return '<header class="top"><div class="row">' + hamburger() + "<h1>Integrations</h1></div>" +
      '<p class="sub">Apps, feeds and devices. Most are planned.' + (ui.calMsg ? " " + esc(ui.calMsg) : "") + "</p></header>" +
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
    } else {
      var x = compute();
      var cards = cardsFor(x);
      html = topHtml(x) + '<section class="mid">' + midHtml(x, cards) + "</section>" + bottomHtml(x) + sheetHtml(x) + testHtml();
      x.shown = cards;
      current = x;
    }
    app.innerHTML = html + menuHtml();
    ui.enterOnce = false;
    ui.titleNew = false;
    if (bundle && precomputed !== sess && ui.screen === "today") { precomputed = sess; setTimeout(precompute, 30); }
  }
  var current = null;

  // ---- actions ----
  function saveAll() { save("cc.state", S); save("cc.offers", offers); save("cc.lenses", lenses); save("cc.notes", notes); save("cc.test", test); }

  // A clean run for testing: back to the first stop of the morning, nothing picked, no day mode, no sheet open.
  // Picks made today during testing are dropped so they do not feed the learner; made-up history and
  // picks from earlier days stay.
  function replayDay() {
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    offers = offers.filter(function (o) { return o.t < start.getTime(); });
    S = { day: todayKey() };
    test.minutes = 490;
    ui.sheet = null; ui.noteSent = false; ui.draft = "";
    clearTimeout(holdTimer); ui.hold = false;
  }

  function pick(id, how, dx) {
    var x = compute();
    var cards = cardsFor(x);
    var card = cards.filter(function (c) { return c.id === id; })[0];
    if (!card || !x.view.node) { return; }
    offers.push({
      t: Date.now(), slice: x.slice, lens: Object.assign({}, x.states),
      shown: cards.map(function (c) { return { o: c.option, a: isActive(c) }; }),
      picked: card.option, pickedActive: isActive(card), source: test.minutes !== null ? "test" : "live"
    });
    if (offers.length > 3000) { offers = offers.slice(offers.length - 3000); }
    var child = Model.childFor(x.view.node, card);
    S.activity = { label: card.label || card.text, steps: card.steps || null, at: x.m, until: x.m + (card.duration_min || 0) };
    if (test.auto) { S.advance = 30; }
    S.cursor = { node: child || x.view.id, setAt: x.m };
    saveAll();
    var box = document.querySelector(".mid .stack");
    ui.boxHeight = box ? box.offsetHeight : 0;
    how = how || "tap";
    ui.exiting = { cards: cards.filter(function (c) { return !(c.tags && c.tags.kind === "quiet"); }), pickedId: card.id, how: how, dx: dx || 0 };
    ui.titleNew = true;
    clearTimeout(holdTimer);
    clearTimeout(exitTimer);
    ui.hold = !!test.pause;
    exitTimer = setTimeout(function () { ui.exiting = null; if (!ui.hold) { applyAdvance(); ui.enterOnce = true; } render(); }, how === "swipe" ? 450 : 900);
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

  // Swipe left: a kind question first. "Not feeling it" or a few words, then the planner answers with a
  // new set that leaves the option out for the rest of the day.
  function startReject(id) {
    var x = compute();
    var card = cardsFor(x).filter(function (c) { return c.id === id; })[0];
    if (!card || (card.tags && card.tags.kind === "quiet")) { return; }
    ui.reject = { id: id, text: card.text, option: card.option, step: "ask" };
    ui.sheet = "reject";
    ui.draft = "";
    render();
  }

  function doReject(reason, text) {
    var x = compute();
    var cards = cardsFor(x);
    var r = ui.reject;
    var card = r && cards.filter(function (c) { return c.id === r.id; })[0];
    if (!card || !x.view.node) { ui.sheet = null; ui.reject = null; render(); return; }
    offers.push({
      t: Date.now(), slice: x.slice, lens: Object.assign({}, x.states),
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
    drag.el.style.transform = "translateX(" + dx + "px) rotate(" + (dx / 50) + "deg)";
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
  app.addEventListener("keydown", function (e) {
    var el = cardEl(e);
    if (!el || ui.hold || ui.exiting || ui.sheet) { return; }
    if (e.key === "ArrowRight") { e.preventDefault(); pick(el.getAttribute("data-id"), "swipe", 0); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); startReject(el.getAttribute("data-id")); }
  });

  function reroll() {
    var x = compute();
    if (rerollState(x)) { return; }
    S.rerolls = S.rerolls || {};
    S.rerolls[x.view.id] = (S.rerolls[x.view.id] || 0) + 1;
    S.rerollsToday = (S.rerollsToday || 0) + 1;
    S.cursor = { node: x.view.node.children.reroll, setAt: x.m };
    ui.sheet = null;
    saveAll();
    render();
  }

  function loadLive() {
    live.moon = Ctx.moonFor(new Date());
    Ctx.locate().then(function (place) {
      live.place = place;
      return Ctx.loadWeather(place);
    }).then(function (w) {
      live.weather = w.weather; live.sunrise = w.sunrise; live.sunset = w.sunset;
      render();
    }).catch(function () { ui.calMsg = "Weather didn't answer."; render(); });
    Ctx.calendar.load().then(function (ev) { live.calendar = ev || []; render(); }).catch(function () { /* stays empty */ });
  }

  app.addEventListener("click", function (e) {
    if (swallowClick) { swallowClick = false; return; }
    if (ui.drawer && !e.target.closest(".drawer, .testbar")) { ui.drawer = false; render(); return; }
    var el = e.target.closest("[data-act]");
    if (!el || el.disabled) { return; }
    var act = el.getAttribute("data-act");
    if (act === "pick") { pick(el.getAttribute("data-id"), "tap"); return; }
    if (act === "reroll") { reroll(); return; }
    if (act === "rejectmore") { if (ui.reject) { ui.reject.step = "more"; render(); } return; }
    if (act === "rejectquiet") { doReject("not_feeling_it", ""); return; }
    if (act === "rejectsend") { var why = ui.draft.trim(); if (why) { doReject("more", why); } return; }
    if (act === "menu") { ui.sheet = "menu"; }
    else if (act === "closesheet") { ui.sheet = null; ui.noteSent = false; ui.reject = null; }
    else if (act === "notesheet") { ui.sheet = "note"; ui.noteSent = false; }
    else if (act === "daysheet") { ui.sheet = "day"; }
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
    else if (act === "navmenu") { ui.menu = !ui.menu; }
    else if (act === "screen") { ui.screen = el.getAttribute("data-screen"); ui.menu = false; }
    else if (act === "lens") { var lid = el.getAttribute("data-lens"); lenses[lid].enabled = !lenses[lid].enabled; }
    else if (act === "lenshide") { var hid = el.getAttribute("data-lens"); lenses[hid].hidden = !lenses[hid].hidden; }
    else if (act === "time") {
      var m = el.getAttribute("data-m");
      test.minutes = m === "now" ? null : Number(m);
      S.skew = 0; delete S.advance;
    }
    else if (act === "drawer") { ui.drawer = !ui.drawer; }
    else if (act === "resetday") { replayDay(); }
    else if (act === "clearhistory") { offers = []; }
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
    else if (act === "caldisconnect") { Ctx.calendar.disconnect(); live.calendar = []; ui.calMsg = ""; }
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

  app.addEventListener("change", function (e) {
    var t = e.target;
    var key = t.getAttribute("data-test");
    if (key) {
      var val = t.type === "checkbox" ? t.checked : t.value;
      if (key === "pause") { test.pause = !!val; }
      else if (key === "auto") { test.auto = !!val; delete S.advance; }
      else if (key === "dow") { test.dow = val === "" ? null : Number(val); }
      else if (key === "live") { test.live = val === "1"; if (test.live) { loadLive(); } }
      else if (key === "energy") { test.energy = val; }
      else { test[key] = Number(val); }
    } else { return; }
    saveAll();
    render();
  });

  // ---- start ----
  var tokenMsg = Ctx.calendar.takeRedirectToken();
  if (tokenMsg === "") { test.live = true; } else if (tokenMsg) { ui.calMsg = tokenMsg; }
  if (location.hash === "#clean") { test.on = false; }
  if (location.hash === "#test") { test.on = true; }

  if (test.live) { loadLive(); }
  render();
  setInterval(function () {
    if (test.minutes === null && !ui.sheet && !ui.menu && ui.screen === "today" && !ui.drawer) { render(); }
  }, 30000);
})();
