(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(require("./model.js")); }
  else { root.Planner = factory(root.Model); }
})(typeof self !== "undefined" ? self : this, function (Model) {
  "use strict";

  // Stand-in for the server. It plans a day as a tree and hands the app a plain bundle.
  // All the thinking is here: what needs what, what the weather allows, what energy allows,
  // what order makes sense. The app only walks the result.
  //
  // An option says which blocks of the day it can appear in, what must already be true
  // (needs), what it makes true (gives), and when to skip it (skipIf). The planner searches
  // every sensible order and writes one node per situation, so each pick leads somewhere
  // that already makes sense and a picked card never comes back.

  var mins = Model.mins, hhmm = Model.hhmm;
  var PERSIST = { dressed: true, fed: true };

  // Deterministic variety: the same day always plans the same way.
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return Math.abs(h);
  }

  // Last night's sleep in three bands: about 5 hours, 7 or 9.
  function sleepBand(h) { return h == null ? 7 : h < 6 ? 5 : h < 8 ? 7 : 9; }

  // How much the day can take, from energy and sleep. Below zero the day is gentler (no demanding
  // options, gentle ones first, fewer cards). Above zero there is room for more. Low energy after a long
  // night comes out as an ordinary day.
  function capacity(opts) {
    var b = sleepBand(opts.sleep);
    return (opts.energy === "low" ? -1 : 0) + (b === 5 ? -1 : b === 9 ? 1 : 0);
  }

  var ALL_BLOCKS = ["morning", "afternoon", "evening", "night", "before_event", "during_event"];
  function anywhere(rank) {
    var at = {};
    ALL_BLOCKS.forEach(function (t) { at[t] = { rank: rank }; });
    return at;
  }

  function opt(id, text, label, x) { x.id = id; x.text = text; x.label = label; return x; }

  // The bank is a tree. A top-level card is a broad category ("Move", "Eat"); picking it opens
  // a screen of narrower choices (`under`), which can open narrower ones still. An option with
  // `opens` is a category: it adds the fact in_<name> and has no activity of its own. Everything
  // else is an activity. `sticky` categories stay open after an activity so the next step of the
  // routine is right there; the others close, and the day goes back to broad choices.
  function top(id, text, label, opens, x) { x.opens = opens; return opt(id, text, label, x); }
  function sub(id, under, text, label, x) { x.under = under; x.at = anywhere(x.rank != null ? x.rank : 50); return opt(id, text, label, x); }
  function subtop(id, under, text, label, opens, x) { x.opens = opens; return sub(id, under, text, label, x); }
  function at(list, rank, extra) {
    var out = {};
    list.forEach(function (b) { out[b] = Object.assign({ rank: rank }, extra || {}); });
    return out;
  }
  function merge() { return Object.assign.apply(null, [{}].concat([].slice.call(arguments))); }

  var OPTIONS = [
    // ---- broad categories, first screen of every block ----
    top("c_routine", "Start your morning routine", "Morning routine", "routine", { sticky: true, goal: "g_body", signal: { overwhelm: -1 }, at: { morning: { rank: 1 } } }),
    top("c_move", "Move", "Movement", "move", { goal: "g_body", signal: { energy: 1 }, at: merge(at(["morning"], 2), at(["afternoon"], 2), at(["evening"], 7)) }),
    top("c_mindful", "Mindful practice", "Mindful practice", "mindful", { goal: "g_calm", gentle: true, signal: { overwhelm: -1 }, at: merge(at(["morning"], 3), at(["afternoon"], 6), at(["evening"], 8)) }),
    top("c_work", "Work", "Work", "work", { goal: "g_followthrough", signal: { energy: 1 }, at: merge(at(["morning"], 4), at(["afternoon"], 1), at(["before_event"], 4)) }),
    top("c_creative", "Creative activity", "Creative time", "creative", { goal: "g_creative", signal: { mood: 1 }, at: merge(at(["morning"], 5), at(["afternoon"], 3), at(["evening"], 8.5), at(["before_event"], 5)) }),
    top("c_errands", "Errands", "Errands", "errands", { demanding: true, goal: "g_admin", signal: { energy: 1 }, at: merge(at(["morning"], 6), at(["afternoon"], 4)) }),
    top("c_resp", "Responsibilities", "Responsibilities", "resp", { goal: "g_admin", at: merge(at(["morning"], 7), at(["afternoon"], 5), at(["evening"], 9)) }),
    top("c_eat", "Eat", "Eating", "eat", { goal: "g_nutrition", signal: { energy: 1 }, at: merge(at(["afternoon"], 1.5), at(["evening"], 1), at(["before_event"], 2, { skipIf: ["fed"] })) }),
    top("c_relax", "Relax", "Relaxing", "relax", { gentle: true, goal: "g_rest", signal: { overwhelm: -1 }, at: merge(at(["morning"], 9), at(["afternoon"], 3.5), at(["evening"], 4), at(["before_event"], 3)) }),
    top("c_connect", "Connect with someone", "Connecting", "connect", { goal: "g_joy", signal: { social: 1 }, at: merge(at(["afternoon"], 6.5), at(["evening"], 5)) }),
    top("c_playful", "Something playful", "Something playful", "playful", { kind: "flirty", chance: 0.75, goal: "g_joy", signal: { mood: 1, social: 1 }, at: merge(at(["morning"], 12), at(["afternoon"], 7), at(["evening"], 6)) }),
    top("c_tomorrow", "Prepare for tomorrow", "Preparing for tomorrow", "tomorrow", { goal: "g_admin", signal: { overwhelm: -1 }, at: merge(at(["evening"], 11), at(["night"], 3)) }),
    top("c_winddown", "Wind down", "Winding down", "winddown", { gentle: true, goal: "g_rest", signal: { overwhelm: -1 }, at: { night: { rank: 1 } } }),
    opt("bed_ready", "Get ready for bed", "Getting ready for bed", { dur: 10, goal: "g_body", gives: ["bedready"], onReject: ["bedready"], at: { night: { rank: 2 } } }),
    opt("lights_out", "Turn the lights out", "Lights out", { dur: 1, gentle: true, gives: ["asleep"], at: { night: { rank: 0.5, needs: ["bedready"] } } }),

    // ---- the appointment ----
    opt("getting_ready", "Get ready", "Getting ready", { dur: 20, signal: { overwhelm: -1 }, gives: ["ready"], onReject: ["ready"], at: { before_event: { rank: 1 } } }),
    opt("leave_early", "Head out a little early", "Heading out early", { kind: "variation", dur: 10, signal: { overwhelm: -1 }, at: { before_event: { rank: 0.5, needs: ["ready"] } } }),
    opt("leave_now", "Head there", "Heading there", { kind: "info", dur: 14, gives: ["headed"], at: { during_event: { rank: 1 } } }),

    // ---- morning routine -> breakfast ----
    sub("shower", "routine", "Shower", "Showering", { dur: 15, goal: "g_body", signal: { energy: 1 }, gives: ["showered"], onReject: ["showered"], rank: 1 }),
    sub("skincare", "routine", "Skincare and teeth", "Skincare", { dur: 10, goal: "g_body", rank: 2 }),
    sub("hydrate", "routine", "Hydrate", "Hydrating", { dur: 2, goal: "g_body", rank: 3 }),
    subtop("c_breakfast", "routine", "Make or eat breakfast", "Breakfast", "breakfast", { goal: "g_nutrition", rank: 4, at: { morning: { rank: 4, skipIf: ["fed"] } } }),
    sub("bf_quick", "breakfast", "Something quick", "Something quick", { dur: 10, gives: ["fed"], onReject: [], rank: 1 }),
    sub("bf_proper", "breakfast", "Something proper", "A proper breakfast", { dur: 25, signal: { energy: 1 }, gives: ["fed"], rank: 2 }),
    sub("bf_usual", "breakfast", "My usual", "My usual breakfast", { dur: 15, gives: ["fed"], rank: 3 }),
    sub("bf_drink", "breakfast", "Just coffee or tea", "Coffee or tea", { dur: 10, gives: ["warm"], rank: 4 }),

    // ---- move ----
    subtop("m_stretch", "move", "Stretch", "Stretching", "stretch", { gentle: true, goal: "g_body", rank: 1 }),
    subtop("m_yoga", "move", "Yoga", "Yoga", "yoga", { goal: "g_body", rank: 2 }),
    sub("m_dance", "move", "Dance", "Dancing", { dur: 20, demanding: true, goal: "g_body", signal: { energy: 1, mood: 1 }, rank: 3 }),
    sub("m_free", "move", "Move however feels right", "Moving freely", { dur: 15, gentle: true, goal: "g_body", rank: 4 }),
    sub("m_walk", "move", "Go for a walk", "Walking", { dur: 20, daylight: true, goal: "g_body", signal: { energy: 1 }, rank: 5 }),
    sub("m_strong", "move", "Something strong", "Strength work", { dur: 30, demanding: true, goal: "g_body", signal: { energy: 1 }, rank: 6 }),
    sub("st_full", "stretch", "Full body", "Full body stretch", { dur: 10, gentle: true, rank: 1 }),
    sub("st_hips", "stretch", "Hips and hamstrings", "Hip and hamstring stretch", { dur: 10, gentle: true, rank: 2 }),
    sub("st_neck", "stretch", "Neck and shoulders", "Neck and shoulder stretch", { dur: 5, gentle: true, rank: 3 }),
    sub("st_back", "stretch", "Back and spine", "Back stretch", { dur: 10, gentle: true, rank: 4 }),
    sub("y_gentle", "yoga", "Gentle", "Gentle yoga", { dur: 20, gentle: true, rank: 1 }),
    sub("y_rest", "yoga", "Restorative", "Restorative yoga", { dur: 30, gentle: true, rank: 2 }),
    sub("y_flow", "yoga", "Flow", "Yoga flow", { dur: 30, demanding: true, signal: { energy: 1 }, rank: 3 }),

    // ---- mindful practice ----
    sub("mi_breathe", "mindful", "Breathing", "Breathing practice", { dur: 10, gentle: true, signal: { overwhelm: -1 }, rank: 1 }),
    sub("mi_meditate", "mindful", "Meditation", "Meditating", { dur: 15, gentle: true, signal: { overwhelm: -1 }, rank: 2 }),
    sub("mi_grateful", "mindful", "Gratitude", "Gratitude", { dur: 5, gentle: true, rank: 3 }),
    sub("mi_affirm", "mindful", "Affirmations", "Affirmations", { dur: 5, gentle: true, rank: 4 }),
    sub("mi_still", "mindful", "Time with no screen and nothing to do", "Screen-free time", { dur: 10, gentle: true, rank: 5 }),

    // ---- work ----
    subtop("w_deep", "work", "Deep work", "Deep work", "deep", { demanding: true, goal: "g_followthrough", signal: { energy: 1 }, rank: 1 }),
    sub("w_mail", "work", "Messages and email", "Messages and email", { dur: 15, goal: "g_admin", gives: ["mailed"], rank: 2 }),
    sub("w_putoff", "work", "Something I've been putting off", "Something I was putting off", { kind: "variation", dur: 10, demanding: true, goal: "g_followthrough", horizon: "medium", signal: { overwhelm: 1 }, gives: ["started"], rank: 3 }),
    sub("dw_25", "deep", "25 minutes", "Deep work, 25 minutes", { dur: 25, demanding: true, gives: ["focused"], rank: 1 }),
    sub("dw_50", "deep", "50 minutes", "Deep work, 50 minutes", { dur: 50, demanding: true, gives: ["focused"], rank: 2 }),
    opt("break_5", "Take a break", "Taking a break", { dur: 5, goal: "g_rest", gentle: true, signal: { overwhelm: -1 }, at: at(["morning", "afternoon", "before_event"], 0.6, { needs: ["focused"] }) }),
    opt("next_step", "Note the next step", "Noting the next step", { dur: 5, goal: "g_followthrough", at: { morning: { rank: 0.5, needs: ["started"] } } }),
    opt("inbox_rest", "Clear out the inbox", "Clearing the inbox", { dur: 5, goal: "g_admin", at: { morning: { rank: 0.5, needs: ["mailed"] } } }),

    // ---- creative ----
    sub("cr_write", "creative", "Write", "Writing", { dur: 25, demanding: true, goal: "g_writing", horizon: "medium", signal: { energy: 1 }, gives: ["wrote"], rank: 1 }),
    sub("cr_draw", "creative", "Draw or sketch", "Sketching", { dur: 15, goal: "g_creative", signal: { mood: 1 }, rank: 2 }),
    sub("cr_music", "creative", "Music", "Making music", { dur: 20, goal: "g_creative", signal: { mood: 1 }, rank: 3 }),
    sub("cr_hands", "creative", "Make something with your hands", "Making something", { dur: 30, demanding: true, goal: "g_creative", rank: 4 }),
    sub("cr_play", "creative", "Play around with something", "Playing around", { kind: "wild", dur: 15, goal: "g_creative", signal: { mood: 1 }, rank: 5 }),
    opt("read_back", "Read it back", "Reading it back", { dur: 10, goal: "g_writing", at: at(["morning", "afternoon", "evening"], 0.5, { needs: ["wrote"] }) }),

    // ---- errands ----
    subtop("e_shop", "errands", "Shopping", "Shopping", "shopping", { demanding: true, rank: 1 }),
    sub("e_post", "errands", "Post or returns", "Post and returns", { dur: 20, demanding: true, rank: 2 }),
    sub("e_pickup", "errands", "Pick something up", "Picking something up", { dur: 25, demanding: true, rank: 3 }),
    sub("sh_groc", "shopping", "Groceries", "Grocery shopping", { dur: 40, demanding: true, goal: "g_nutrition", rank: 1 }),
    sub("sh_clothes", "shopping", "Clothing", "Clothes shopping", { dur: 45, demanding: true, rank: 2 }),
    sub("sh_thrift", "shopping", "Thrift store", "Thrifting", { kind: "wild", dur: 45, demanding: true, rank: 3 }),
    sub("sh_browse", "shopping", "Just browsing", "Browsing", { dur: 30, demanding: true, rank: 4 }),

    // ---- responsibilities (the tasks are stand-ins for the person's own pending list) ----
    subtop("r_work", "resp", "Work", "Work tasks", "resp_work", { goal: "g_admin", rank: 1 }),
    subtop("r_personal", "resp", "Personal", "Personal tasks", "resp_personal", { goal: "g_admin", rank: 2 }),
    subtop("r_house", "resp", "Household", "Household tasks", "resp_house", { goal: "g_admin", rank: 3 }),
    sub("rw_invoice", "resp_work", "Send the invoice", "Sending the invoice", { dur: 15, rank: 1 }),
    sub("rw_review", "resp_work", "Review the draft", "Reviewing the draft", { dur: 30, demanding: true, rank: 2 }),
    sub("rp_taxes", "resp_personal", "Taxes", "Working on taxes", { dur: 30, demanding: true, goal: "g_followthrough", horizon: "long", rank: 1 }),
    sub("rp_book", "resp_personal", "Book an appointment", "Booking an appointment", { dur: 10, rank: 2 }),
    sub("rp_paper", "resp_personal", "Paperwork", "Paperwork", { dur: 20, rank: 3 }),
    sub("rh_laundry", "resp_house", "Laundry", "Laundry", { dur: 15, rank: 1 }),
    sub("rh_room", "resp_house", "Tidy a room", "Tidying", { dur: 20, rank: 2 }),
    sub("rh_kitchen", "resp_house", "Clear up the kitchen", "Clearing up", { dur: 15, rank: 3 }),

    // ---- eat ----
    sub("ea_quick", "eat", "Something quick", "Something quick", { dur: 10, gives: ["meal"], rank: 1 }),
    sub("ea_left", "eat", "Leftovers", "Leftovers", { dur: 15, gives: ["meal"], rank: 2 }),
    subtop("ea_cook", "eat", "Cook", "Cooking", "cook", { demanding: false, rank: 3 }),
    sub("ea_out", "eat", "Order in or go out", "Eating out", { dur: 45, gives: ["meal"], rank: 4 }),
    sub("ck_simple", "cook", "Something simple", "Cooking something simple", { dur: 25, gives: ["meal"], rank: 1 }),
    subtop("ck_new", "cook", "Something I haven't made before", "Cooking something new", "recipes", { kind: "wild", demanding: true, goal: "g_joy", horizon: "medium", rank: 2 }),
    sub("rc_risotto", "recipes", "Mushroom risotto", "Mushroom risotto", { dur: 45, gives: ["meal"], rank: 1 }),
    sub("rc_curry", "recipes", "Chickpea curry", "Chickpea curry", { dur: 40, gives: ["meal"], rank: 2 }),
    sub("rc_tray", "recipes", "Roasted vegetables and halloumi", "Roasted vegetables", { dur: 40, gives: ["meal"], rank: 3 }),
    sub("rc_pasta", "recipes", "Lemon and garlic pasta", "Lemon and garlic pasta", { dur: 25, gives: ["meal"], rank: 4 }),
    sub("rc_noodles", "recipes", "Miso noodle soup", "Miso noodle soup", { dur: 20, gives: ["meal"], rank: 5 }),

    // ---- relax, connect, playful ----
    sub("rx_lie", "relax", "Lie down, no screen", "Lying down", { dur: 20, gentle: true, onlyLow: true, signal: { energy: -1, overwhelm: -1 }, rank: 0 }),
    sub("rx_read", "relax", "Read", "Reading", { dur: 20, gentle: true, goal: "g_rest", signal: { overwhelm: -1 }, rank: 1 }),
    sub("rx_listen", "relax", "Listen to something", "Listening", { dur: 20, gentle: true, rank: 2 }),
    sub("rx_watch", "relax", "Watch something", "Watching something", { dur: 30, gentle: true, rank: 3 }),
    sub("rx_bath", "relax", "Take a bath", "Having a bath", { dur: 30, gentle: true, only: ["evening", "night"], signal: { energy: -1, overwhelm: -1 }, rank: 4 }),
    sub("cn_call", "connect", "Call someone", "Calling someone", { dur: 20, signal: { social: 1 }, rank: 1 }),
    sub("cn_msg", "connect", "Message someone", "Messaging someone", { dur: 5, signal: { social: 1 }, rank: 2 }),
    sub("cn_plans", "connect", "Make plans", "Making plans", { dur: 10, signal: { social: 1 }, rank: 3 }),
    sub("pl_bold", "playful", "Send someone a bold message", "Sending a bold message", { dur: 5, signal: { mood: 1, social: 1 }, rank: 1 }),
    sub("pl_dress", "playful", "Dress up for yourself", "Dressing up", { dur: 10, signal: { mood: 1 }, rank: 2 }),
    sub("pl_out", "playful", "Go out somewhere you like", "Going out", { dur: 45, demanding: true, signal: { mood: 1, social: 1 }, rank: 3 }),

    // ---- tomorrow and winding down ----
    sub("tm_alarm", "tomorrow", "Set the alarm", "Setting the alarm", { dur: 1, rank: 1 }),
    sub("tm_look", "tomorrow", "Look at tomorrow", "Looking at tomorrow", { dur: 5, rank: 2 }),
    sub("tm_ready", "tomorrow", "Get things ready", "Getting things ready", { dur: 10, signal: { overwhelm: -1 }, rank: 3 }),
    sub("tm_list", "tomorrow", "Make a short list", "Making a list", { dur: 5, rank: 4 }),
    sub("wd_read", "winddown", "Read", "Reading in bed", { dur: 15, gentle: true, signal: { overwhelm: -1 }, rank: 1 }),
    sub("wd_breathe", "winddown", "Slow breathing", "Slow breathing", { dur: 5, gentle: true, rank: 2 }),
    sub("wd_journal", "winddown", "Write a few lines about today", "Writing a few lines", { dur: 10, gentle: true, rank: 3 }),
    sub("wd_music", "winddown", "Listen to something", "Listening", { dur: 15, gentle: true, rank: 4 }),

    // ---- small things that fit anywhere ----
    opt("breaths_3", "A few slow breaths", "Slow breaths", { dur: 2, goal: "g_calm", gentle: true, signal: { overwhelm: -1 }, at: anywhere(90) }),
    opt("water", "Water", "Water", { dur: 1, goal: "g_body", at: anywhere(91) }),
    opt("pause_min", "A minute with no screen", "A minute with no screen", { dur: 1, goal: "g_calm", gentle: true, at: anywhere(92) }),
    opt("note_mind", "Write down what's on your mind", "Writing down a thought", { dur: 2, goal: "g_calm", at: anywhere(94) }),
    opt("step_outside", "Step outside for a minute", "Stepping outside", { dur: 3, goal: "g_body", daylight: true, at: anywhere(95) })
  ];

  // Tables built from the bank. They are rebuilt when a different bank is loaded (useBank).
  var FILLERS = ["breaths_3", "water", "pause_min", "note_mind", "step_outside"];
  var OPENERS, STICKY, DEPTH, LABEL, BY_ID;
  function depthOf(fact) {
    if (DEPTH[fact] != null) { return DEPTH[fact]; }
    var d = 1;
    (OPENERS[fact] || []).forEach(function (o) { d = Math.max(d, 1 + levelOf(o)); });
    DEPTH[fact] = d;
    return d;
  }
  function levelOf(o) { return o.under ? depthOf(o.under) : 0; }

  // Depth of each category: a fact in_<name> is as deep as its deepest opener, plus one. An option's level is
  // the depth of the category it sits under (0 for the first screen). A screen only shows options at the
  // level of the deepest category that is open. Small things that only fill a screen up to its floor are
  // marked as fillers, so there is always something to choose without crowding a screen that has real options.
  function rebuild() {
    OPENERS = {}; STICKY = {}; DEPTH = {}; LABEL = {}; BY_ID = {};
    OPTIONS.forEach(function (o) { if (FILLERS.indexOf(o.id) !== -1) { o.filler = true; } });
    OPTIONS.forEach(function (o) {
      if (o.opens) {
        (OPENERS[o.opens] = OPENERS[o.opens] || []).push(o);
        if (o.sticky) { STICKY[o.opens] = true; }
        LABEL[o.opens] = LABEL[o.opens] || o.label;
      }
    });
    OPTIONS.forEach(function (o) { o.level = levelOf(o); });
    OPTIONS.forEach(function (o) { BY_ID[o.id] = o; });
  }
  rebuild();

  // Swap in another option bank (a person's own). `keep` lists ids of the built-in options to keep alongside
  // it, such as the appointment chain, the bedtime steps and the small fillers. Calling it with no list
  // restores the built-in bank.
  var BUILT_IN = OPTIONS.slice();
  function useBank(list, keep) {
    var want = {};
    (keep || []).forEach(function (id) { want[id] = true; });
    var base = list ? BUILT_IN.filter(function (o) { return want[o.id]; }) : BUILT_IN;
    var next = base.concat(list || []);
    OPTIONS.length = 0;
    next.forEach(function (o) { OPTIONS.push(o); });
    rebuild();
  }

  // Weekday or weekend, from the day being planned.
  function dayType(ctx) {
    var d = new Date(ctx.day + "T12:00:00").getDay();
    return d === 0 || d === 6 ? "weekend" : "weekday";
  }

  // ---- the day's blocks, built from the calendar ----
  var BASE = [["morning", 450, 810], ["afternoon", 810, 1020], ["evening", 1020, 1200], ["night", 1200, 1439]];
  var BASE_TITLE = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Tonight" };

  function shortClock(m) {
    var h = Math.floor(m / 60) % 12 || 12, mm = m % 60;
    return h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  function makeBlocks(ctx) {
    var specials = [], last = 0;
    (ctx.calendar || []).slice().sort(function (a, b) { return mins(a.start) - mins(b.start); }).forEach(function (e) {
      var s = mins(e.start), en = mins(e.end);
      var before = { type: "before_event", s: Math.max(450, s - 50), e: s - 10, title: "Before " + shortClock(s) };
      var during = { type: "during_event", s: s - 10, e: en, title: e.title || "Busy" };
      if (during.s < last || en <= 450 || s >= 1439 || before.e <= before.s) { return; }
      specials.push(before, during);
      last = en;
    });
    var out = specials.slice();
    BASE.forEach(function (b) {
      var cur = b[1];
      specials.forEach(function (sp) {
        if (sp.e <= cur || sp.s >= b[2]) { return; }
        if (sp.s - cur >= 25) { out.push({ type: b[0], s: cur, e: sp.s, title: BASE_TITLE[b[0]] }); }
        cur = Math.max(cur, sp.e);
      });
      if (b[2] - cur >= 25) { out.push({ type: b[0], s: cur, e: b[2], title: BASE_TITLE[b[0]] }); }
    });
    out.sort(function (a, b) { return a.s - b.s; });
    out[0].s = 450;
    for (var i = 0; i < out.length - 1; i++) { out[i].e = out[i + 1].s; }
    out[out.length - 1].e = 1439;
    return out;
  }

  function dryOk(ctx, b) {
    var segs = ctx.weather || [];
    if (!segs.length) { return true; }
    var dry = 0;
    segs.forEach(function (w) {
      if (w.sky !== "dry") { return; }
      var a = Math.max(b.s, mins(w.from)), z = Math.min(b.e, mins(w.to));
      if (z > a) { dry += z - a; }
    });
    return dry / (b.e - b.s) >= 0.6;
  }

  function lightOk(ctx, b) {
    var a = Math.max(b.s, mins(ctx.sunrise)), z = Math.min(b.e, mins(ctx.sunset));
    return (z > a ? z - a : 0) / (b.e - b.s) >= 0.5;
  }

  function deepestIn(facts) {
    var d = 0;
    Object.keys(facts).forEach(function (k) { if (k.indexOf("in_") === 0 && DEPTH[k.slice(3)] > d) { d = DEPTH[k.slice(3)]; } });
    return d;
  }

  function factAt(facts, depth) {
    var found = null;
    Object.keys(facts).forEach(function (k) { if (k.indexOf("in_") === 0 && DEPTH[k.slice(3)] === depth) { found = k.slice(3); } });
    return found;
  }

  // Everything that can be offered on a screen, best first. Only options at the level of the open
  // category are considered, and a category is offered only if something under it can be.
  function pool(block, facts, opts, ctx) {
    var done = Object.keys(facts).filter(function (k) { return k.indexOf("did_") === 0; }).length;
    var level = deepestIn(facts);
    // the cap on picks in a block applies to the first screen only, so a category is never an empty end
    if ((level === 0 && done >= (opts.maxDone || 14)) || facts.asleep) { return []; }
    var cap = capacity(opts), out = [];
    OPTIONS.forEach(function (o) {
      var slot = o.at[block.type];
      if (!slot || o.level !== level || facts["did_" + o.id] || facts["no_" + o.id]) { return; }
      if (o.under && !facts["in_" + o.under]) { return; }
      if (o.only && o.only.indexOf(block.type) === -1) { return; }
      if (o.days && o.days !== "any" && o.days !== dayType(ctx)) { return; }
      if ((slot.needs || []).some(function (n) { return !facts[n]; })) { return; }
      if ((o.skipIf || []).concat(slot.skipIf || []).some(function (n) { return facts[n]; })) { return; }
      if (o.gives && o.gives.every(function (g) { return facts[g]; })) { return; }
      if (o.dry && !dryOk(ctx, block)) { return; }
      if (o.daylight && !lightOk(ctx, block)) { return; }
      if (o.chance && hash(ctx.day + "|" + block.type + "|" + o.id) % 100 >= Math.round(o.chance * 100)) { return; }
      if (cap < 0 ? o.demanding : o.onlyLow) { return; }
      if (o.opens) {
        var inside = Object.assign({}, facts);
        inside["in_" + o.opens] = true;
        inside["did_" + o.id] = true;
        if (!pool(block, inside, opts, ctx).length) { return; }
      }
      out.push({ o: o, rank: slot.rank + (cap < 0 && o.gentle ? -20 : 0) + (cap > 0 && o.demanding ? -2 : 0) });
    });
    out.sort(function (a, b) { return a.rank - b.rank; });
    return out.map(function (x) { return x.o; });
  }

  var MORE = 4;
  var BASE_COUNT = { morning: 4, afternoon: 4, evening: 4, before_event: 4, during_event: 1, night: 3 };

  // How many cards this screen shows: fewer when time is tight, energy is low or the night was short, or the user has already
  // done a few things in this block. Three or four, with "More options" for the rest. Never more than four.
  function want(ctx, opts, block, done, key, avail, inside) {
    if (!avail) { return 0; }
    var n = BASE_COUNT[block.type] || 3;
    if (inside) { return Math.min(avail, capacity(opts) < 0 ? 3 : 4); }
    var cap = capacity(opts);
    if (cap < 0) { n += cap; }
    if (cap > 0) { n += 1; }
    if (done >= 3) { n -= 1; }
    n += [-1, 0, 0, 0, 0][hash(ctx.day + "|" + key) % 5];
    var floor = block.type === "during_event" ? 1 : 2;
    return Math.min(avail, 4, Math.max(floor, n));
  }

  // Take cards in rank order, at most one flirty card on a screen.
  function take(cands, n, skip) {
    var out = [], flirty = false;
    for (var i = 0; i < cands.length && out.length < n; i++) {
      var o = cands[i];
      if (skip && skip[o.id]) { continue; }
      if (o.kind === "flirty") { if (flirty) { continue; } flirty = true; }
      out.push(o);
    }
    return out;
  }

  // Real options first, up to n. Fillers only bring a screen up to its floor.
  function choose(cands, n, floor) {
    var real = cands.filter(function (o) { return !o.filler; });
    var fill = cands.filter(function (o) { return o.filler; });
    var out = take(real, n);
    if (out.length < floor) { out = out.concat(take(fill, floor - out.length)); }
    return out;
  }

  function persist(facts) {
    var f = {};
    Object.keys(facts).forEach(function (k) { if (PERSIST[k] || k.indexOf("no_") === 0) { f[k] = true; } });
    return f;
  }

  // Inside a category the heading is the path ("Movement · Stretching"); otherwise the block's own.
  function pathTitle(facts, base) {
    var out = [];
    for (var d = 1; d <= deepestIn(facts); d++) { var f = factAt(facts, d); if (f) { out.push(LABEL[f]); } }
    return out.length ? out.join(" \u00b7 ") : base;
  }

  // After an activity: leave the categories it was found in, except sticky ones (a morning routine
  // stays open for its next step) that still have something left.
  function settle(block, facts, opts, ctx) {
    var f = facts;
    for (var d = deepestIn(f); d > 0; d = deepestIn(f)) {
      var x = factAt(f, d);
      if (STICKY[x] && pool(block, f, opts, ctx).length) { break; }
      f = Object.assign({}, f);
      delete f["in_" + x];
    }
    return f;
  }

  function factsObj(list) {
    var f = {};
    list.forEach(function (k) { f[k] = true; });
    return f;
  }

  // A session plans lazily. A node is created with its cards; its children are created when the app
  // arrives at it (ensure). So the work stays small however long the day is, and the app always has
  // the next screen for every card it could pick.
  function session(ctx, opts) {
    opts = opts || {};
    var blocks = makeBlocks(ctx), nodes = {}, cards = {};

    function useCard(o) {
      if (cards[o.id]) { return; }
      cards[o.id] = {
        id: o.id, option: o.id, text: o.text, label: o.label, duration_min: o.dur || 0, steps: o.steps || null, opens: !!o.opens,
        tags: { horizon: o.horizon || "short", goal: o.goal || null, kind: o.kind || "routine", novel: o.kind === "wild" },
        signal: o.signal || {}
      };
    }

    function node(bi, facts) {
      var names = Object.keys(facts).sort();
      var key = "b" + bi + ".0." + names.join("+");
      if (nodes[key]) { return key; }
      var block = blocks[bi];
      var cands = pool(block, facts, opts, ctx);
      var done = names.filter(function (k) { return k.indexOf("did_") === 0 && !(BY_ID[k.slice(4)] || {}).opens; }).length;
      var stem = "b" + bi + ".";
      var inside = deepestIn(facts) > 0;
      var floor = inside || block.type === "during_event" ? 1 : 2;
      var shown = choose(cands, want(ctx, opts, block, done, stem + "0." + names.join("+"), cands.length, inside), floor);
      // Below the cards on show there can be more: pushing the cards up brings them in. Real options only.
      var seen = {};
      shown.forEach(function (o) { seen[o.id] = true; });
      var rest = cands.filter(function (o) { return !seen[o.id] && !o.filler; });
      var more = shown.length ? take(rest, MORE, seen) : [];
      var all = shown.concat(more);
      all.forEach(useCard);
      nodes[key] = {
        title: pathTitle(facts, block.title), type: block.type, window: [hhmm(block.s), hhmm(block.e)],
        cards: all.map(function (o) { return o.id; }), show: shown.length,
        quiet: shown.length ? null : (block.type === "night" ? "Nothing needed tonight." : "Nothing needed right now."),
        facts: names, bi: bi, off: 0, pending: true, exp: 0, children: {}
      };
      return key;
    }

    function ensure(key) {
      var n = nodes[key];
      if (!n || !n.pending) { return; }
      var facts = factsObj(n.facts);
      n.cards.forEach(function (id) {
        var o = BY_ID[id], f = Object.assign({}, facts);
        f["did_" + id] = true;
        (o.gives || []).forEach(function (g) { f[g] = true; });
        if (o.opens) { f["in_" + o.opens] = true; }
        else { f = settle(blocks[n.bi], f, opts, ctx); }
        n.children["picked:" + id] = node(n.bi, f);
      });
      var d = deepestIn(facts);
      if (d > 0) {
        // "Back": close the open category and let its opener be offered again
        var back = Object.assign({}, facts), x = factAt(facts, d);
        delete back["in_" + x];
        (OPENERS[x] || []).forEach(function (o) { delete back["did_" + o.id]; });
        n.children.back = node(n.bi, back);
      }
      n.children.expired = n.bi + 1 < blocks.length ? node(n.bi + 1, persist(facts)) : null;
      n.pending = false;
    }

    function expand(key, depth) {
      var n = nodes[key];
      if (!n || n.exp >= depth) { return; }
      ensure(key);
      n.exp = depth;
      if (depth <= 1) { return; }
      Object.keys(n.children).forEach(function (k) { if (n.children[k]) { expand(n.children[k], depth - 1); } });
    }

    // "Not feeling it": the server answers with a new set that leaves the option out for the rest of the day.
    // Built on demand, not part of the precomputed tree. Rejecting something that other options wait on
    // (a shower before getting dressed) assumes it is handled, so the path is not locked.
    function reject(key, optionId) {
      var n = nodes[key];
      if (!n) { return key; }
      var facts = factsObj(n.facts);
      facts["no_" + optionId] = true;
      ((BY_ID[optionId] || {}).onReject || []).forEach(function (g) { facts[g] = true; });
      // turning down the last thing in a category closes it
      for (var d = deepestIn(facts); d > 0 && !pool(blocks[n.bi], facts, opts, ctx).length; d = deepestIn(facts)) {
        delete facts["in_" + factAt(facts, d)];
      }
      return node(n.bi, facts);
    }

    // After a new session replaces an old one (energy changed, weather arrived), bring back the node
    // the user was on so their progress through the morning is not lost.
    function restore(key) {
      var m = /^b(\d+)\.(\d+)\.(.*)$/.exec(key || "");
      if (!m || Number(m[1]) >= blocks.length) { return null; }
      return node(Number(m[1]), factsObj(m[3].split("+").filter(Boolean)));
    }

    var root = node(0, {});
    var bundle = {
      schema: "bundle/0.2", bundle_id: "demo-" + ctx.day, root: root, cards: cards, nodes: nodes,
      assumptions: { day: ctx.day, energy: opts.energy || "normal", sleep: sleepBand(opts.sleep), blocks: blocks.map(function (b) { return b.type + " " + hhmm(b.s) + "-" + hhmm(b.e); }) }
    };
    return { bundle: bundle, ensure: ensure, expand: expand, restore: restore, reject: reject };
  }

  // The whole tree at once, with a cap on picks per block. For tests and for printing.
  function plan(ctx, opts) {
    var s = session(ctx, Object.assign({ maxDone: 4 }, opts || {}));
    s.expand(s.bundle.root, Infinity);
    return s.bundle;
  }

  return { plan: plan, session: session, useBank: useBank, OPTIONS: OPTIONS, makeBlocks: makeBlocks, hash: hash, sleepBand: sleepBand };
});
