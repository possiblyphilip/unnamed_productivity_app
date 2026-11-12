/* A short morning, told like a choice book.
   The intake interview is not in this demo.
   Choices are offered, not ranked. After a choice, the note says
   which horizon it touches. Nothing here is an alarm or a correction.
   The end of the run is a report she can reopen whenever she wants. */

const PROMPT_KEY = "report-prompts";

/* A reading shows up only while the choice it belongs to is on screen. */
const OURA = { who: "Oura", text: "Only 6 hours of sleep." };
const STORIES = { who: "Instagram", text: "A few new stories." };
const CYCLE = { who: "Cycle", text: "Ovulatory phase." };
const CLINIC = { who: "Google Calendar", text: "Clinic at 10:30." };
const LUNCH = { who: "Google Calendar", text: "Lunch with Caitie at 12:30." };
const WEATHER = { who: "Weather", text: "48° and clear." };
const GARMIN = { who: "Garmin", text: "An easy walk yesterday." };
const MOON = { who: "Astrology", text: "The moon is in Cancer." };
const SAMPLE = {
  clinic: CLINIC.text,
  lunch: LUNCH.text
};
const CLIENT_ID = "1053539375179-51f5cla0fu2rivktfhttg7vf5htlmv24.apps.googleusercontent.com";
const CLIENT_KEY = "gcal-client-id";
const TOKEN_KEY = "gcal-token";
const GCAL_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const PORTLAND = { latitude: 45.5152, longitude: -122.6765 };
let weatherWhere = "";
let calendarEvents = null;
let calendarMessage = "";

const fresh = () => ({
  slept: false,
  social: false,
  ate: false,
  showered: false,
  dressed: false,
  snack: null,
  ateSnack: false,
  walked: false,
  shopped: false,
  pleasure: false,
  flirted: false
});

let state = fresh();
let node = "morning";
let note = null;
let screen = "morning";
let menuOpen = false;
const disconnected = new Set();

const CHAT = [
  ["her", "I want to be more free socially."],
  ["guide", "I'll leave more of the day unplanned, so saying yes is easy."],
  ["her", "Flirting, too. I want to find connections."],
  ["guide", "It stays a choice. Socially free is on the longer plan now, for this month and past it."]
];

const GOALS = ["Socially free.", "Open afternoons.", "Flirting stays a choice."];

const INTEGRATIONS = [
  ["Schedule", [
    ["gcal", "Google Calendar", "Clinic at 10:30. Lunch with Caitie at 12:30."],
    ["outlook", "Outlook", "Connected. Nothing else this morning."]
  ]],
  ["Messages", [
    ["messages", "Messages", "Connected."],
    ["gmail", "Gmail", "Connected. Held for later."],
    ["whatsapp", "WhatsApp", "Connected."]
  ]],
  ["Social", [
    ["instagram", "Instagram", "A few new stories."]
  ]],
  ["Wellness", [
    ["oura", "Oura", "Only 6 hours of sleep."],
    ["garmin", "Garmin", "An easy walk yesterday."],
    ["fitbit", "Fitbit", "Connected."],
    ["whoop", "Whoop", "Connected."],
    ["cycle", "Cycle", "Ovulatory phase."],
    ["weather", "Weather", "48° and clear."],
    ["sky", "Astrology", "The moon is in Cancer."]
  ]]
];
let speechToken = 0;
let heldUtterances = [];

const app = document.querySelector("#app");

function promptsOn() {
  return localStorage.getItem(PROMPT_KEY) === "on";
}

function scene() {
  switch (node) {
    case "morning":
      return {
        text: "Good morning.",
        choices: [
          { label: "Sleep", go: "afterSleep", set: { slept: true }, context: OURA, note: { today: "Rest for this morning.", week: "A softer start leaves more of you for the week." } },
          { label: "Socialize digitally", go: "afterSocial", set: { social: true }, context: STORIES, note: { today: "A little contact today.", week: "Small contact is how this week stays connected." } },
          { label: "Eat", go: "ready", set: { ate: true }, context: CYCLE, note: { today: "Breakfast is steadiness for today.", month: "Even mornings are the month you're building." } }
        ]
      };
    case "afterSleep":
      return {
        text: "A little more time in bed.",
        choices: [
          { label: "Eat", go: "ready", set: { ate: true }, context: CYCLE, note: { today: "Food before the day gets going.", month: "Breakfast is the even month, one morning at a time." } },
          { label: "Have a shower", go: "hungry", set: { showered: true }, note: { today: "Getting ready, at your pace." } }
        ]
      };
    case "afterSocial":
      return {
        text: "Whenever you're ready.",
        choices: [
          { label: "Eat", go: "ready", set: { ate: true }, context: CYCLE, note: { today: "Food before the day gets going.", month: "Breakfast is the even month, one morning at a time." } },
          { label: "Have a shower", go: "hungry", set: { showered: true }, note: { today: "Getting ready, at your pace." } }
        ]
      };
    case "hungry":
      return {
        text: "Breakfast, here or with you.",
        choices: [
          { label: "Eat here", go: "ready", set: { ate: true }, context: CYCLE, note: { today: "Breakfast before you head out.", month: "Mornings with food in them are the longer pattern." } },
          { label: "Take breakfast with you", go: "ready", set: { ate: true }, context: CLINIC, note: { today: "Breakfast comes along.", month: "Mornings with food in them are the longer pattern." } }
        ]
      };
    case "ready":
      return {
        text: "Get ready.",
        choices: [
          { label: "Have a shower", go: "pack", set: { showered: true }, note: { today: "A shower, then the rest of the morning." } },
          { label: "Get dressed", go: "pack", set: { dressed: true }, context: WEATHER, note: { today: "Dressed, and the morning can move." } }
        ]
      };
    case "pack":
      return {
        text: "A snack for later, if you want it along.",
        choices: [
          { label: "Put a protein bar in your bag", go: "drive", set: { snack: "protein" }, context: LUNCH, note: { today: "Food for the gap before lunch.", month: "Having something with you is how the month stays even." } },
          { label: "Pack some apple slices", go: "drive", set: { snack: "apple" }, context: LUNCH, note: { today: "Fruit for the gap before lunch.", month: "Having something with you is how the month stays even." } }
        ]
      };
    case "drive":
      return {
        text: "Time to drive to your appointment.",
        choices: [
          { label: "Directions", go: "route", context: CLINIC, note: { today: "Getting there is this hour." } }
        ]
      };
    case "route":
      return {
        text: "This way.",
        map: true,
        choices: [
          { label: "Head in", go: "afterAppt" }
        ]
      };
    case "afterAppt":
      return {
        text: "A little time before lunch.",
        choices: [
          { label: "Eat your snack", go: "afterSnack", set: { ateSnack: true }, context: LUNCH, note: { today: "Food in the gap before lunch.", month: "This is the steady month, one gap at a time." } },
          { label: "Walk around the block", go: "afterWalk", set: { walked: true }, context: GARMIN, note: { today: "Movement in this hour.", week: "One easy walk can be the week.", beyond: "Short walks are how a body stays in a longer life." } },
          { label: "Visit a second hand shop nearby", go: "afterShop", set: { shopped: true }, context: MOON, note: { today: "Something pleasing in this hour.", week: "Pleasure is in the week on purpose." } }
        ]
      };
    case "afterSnack":
      return {
        text: "The snack is done.",
        choices: followUps([
          { label: "Get a croissant", go: "landed", set: { pleasure: true }, context: MOON, note: { today: "Pleasure today, beside the food you already had.", month: "Care and pleasure together are the balance." } }
        ])
      };
    case "afterWalk":
      return {
        text: "Around the block.",
        choices: followUps([])
      };
    case "afterShop":
      return {
        text: "A second hand shop.",
        choices: followUps([])
      };
    default:
      return {
        text: "Here's the day.",
        report: reportLines(),
        choices: [
          { label: "A note this evening", prompts: true },
          { label: "I'll open this when I want", prompts: false },
          { label: "Play the morning again", go: "morning", reset: true }
        ]
      };
  }
}

function followUps(extra) {
  const choices = extra.slice();
  const has = (label) => choices.some((choice) => choice.label === label);
  if (!state.ateSnack && !has("Eat your snack")) {
    choices.push({ label: "Eat your snack", go: "afterSnack", set: { ateSnack: true }, context: LUNCH, note: { today: "Food in the gap before lunch.", month: "This is the steady month, one gap at a time." } });
  }
  if (!state.walked && node !== "afterWalk" && !has("Walk around the block")) {
    choices.push({ label: "Walk around the block", go: "afterWalk", set: { walked: true }, context: GARMIN, note: { today: "Movement in this hour.", week: "One easy walk can be the week.", beyond: "Short walks are how a body stays in a longer life." } });
  }
  if (!state.pleasure && state.ate && state.snack && !has("Get a croissant")) {
    choices.push({ label: "Get a croissant", go: "landed", set: { pleasure: true }, context: MOON, note: { today: "Pleasure today, beside the food you already had.", month: "Care and pleasure together are the balance." } });
  }
  if (!state.flirted && !has("Flirt with a friend")) {
    choices.push({ label: "Flirt with a friend", go: "landed", set: { flirted: true }, context: CYCLE, note: { today: "A little flirt, today.", week: "Warmth in this week.", beyond: "Attraction has a place in a longer life." } });
  }
  if (!choices.length) choices.push({ label: "That's the morning", go: "landed" });
  return choices.slice(0, 4);
}

function joinList(items) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

function reportLines() {
  const today = [];
  if (state.slept) today.push("rested");
  if (state.social) today.push("spent a little time online");
  if (state.ate) today.push("ate breakfast");
  if (state.showered || state.dressed) today.push("got ready");
  if (state.snack && !state.ateSnack) today.push("packed a snack");
  if (state.ateSnack) today.push("ate your snack");
  if (state.walked) today.push("walked");
  if (state.shopped) today.push("stopped in a shop");
  if (state.pleasure) today.push("had something just because");
  if (state.flirted) today.push("flirted with a friend");

  const lines = [{
    horizon: "Today",
    text: today.length ? "You " + joinList(today) + "." : "A quiet morning."
  }];

  if (state.walked) lines.push({ horizon: "This week", text: "The walk is one easy movement day. It can be the whole of it." });
  else if (state.flirted || state.social) lines.push({ horizon: "This week", text: "People showed up this week, in a small way." });
  else if (state.slept) lines.push({ horizon: "This week", text: "Rest this morning belongs to a week that isn't only tasks." });
  else if (state.shopped || state.pleasure) lines.push({ horizon: "This week", text: "Pleasure is in the week on purpose." });

  if ((state.ate || state.ateSnack || state.snack) && state.pleasure) {
    lines.push({ horizon: "This month", text: "Food you planned, and something just because, is the month in balance." });
  } else if (state.ate || state.ateSnack || state.snack) {
    lines.push({ horizon: "This month", text: "Breakfast and something for later are the steady month, one day at a time." });
  }

  if (state.flirted) lines.push({ horizon: "Beyond", text: "Attraction has a place in a longer life, in small moments." });
  else if (state.walked) lines.push({ horizon: "Beyond", text: "Short walks are how a body stays in a longer life." });

  return lines;
}

function promptLine() {
  return promptsOn()
    ? "A quiet note this evening, if you want to read this again. You can turn that off."
    : "No prompt. This report stays here for whenever you open it.";
}

function enter(id, set, reset, nextNote) {
  if (reset) {
    state = fresh();
    note = null;
  } else {
    if (set) Object.assign(state, set);
    note = nextNote || null;
  }
  node = id;
  if (node === "ready" && state.ate && (state.showered || state.dressed)) node = "pack";
  if (node === "hungry" && state.ate) node = "ready";
  render();
}

function noteHtml() {
  if (!note) return "";
  const bits = [];
  if (note.today) bits.push(["Today", note.today]);
  if (note.week) bits.push(["This week", note.week]);
  if (note.month) bits.push(["This month", note.month]);
  if (note.beyond) bits.push(["Beyond", note.beyond]);
  return `<div class="note">${bits.map(([horizon, text]) => `<p><span class="horizon">${horizon}</span> ${escapeHtml(text)}</p>`).join("")}</div>`;
}

function contextsFor(choices) {
  const seen = new Set();
  const lines = [];
  choices.forEach((choice) => {
    const item = [].concat(choice.context || [])[0];
    if (!item) return;
    const source = { "Google Calendar": "gcal", "Weather": "weather", "Astrology": "sky" }[item.who];
    if (source && disconnected.has(source)) return;
    const key = item.who + "\n" + item.text;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(item);
  });
  if (lines.length <= 2) return lines;
  const phase = lines.find((item) => item === CYCLE);
  const rest = lines.filter((item) => item !== phase);
  const kept = new Set(phase ? [rest[0], phase] : rest.slice(0, 2));
  return lines.filter((item) => kept.has(item));
}

function couple(lines) {
  if (lines.length <= 2) return lines;
  return [lines[0], lines[lines.length - 1]];
}

function mapHtml() {
  return `<figure class="map"><img src="map.png" alt="Map to the clinic"><figcaption>© OpenStreetMap</figcaption></figure>`;
}

function readingsHtml(lines) {
  if (!lines.length) return "";
  return `<div class="readings">${lines.map((item) => `<p class="source"><span class="horizon">${escapeHtml(item.who)}</span> ${escapeHtml(item.text)}</p>`).join("")}</div>`;
}

function reportHtml(lines) {
  return `<div class="report">${lines.map((line) => `<p class="report-line"><span class="horizon">${escapeHtml(line.horizon)}</span> ${escapeHtml(line.text)}</p>`).join("")}<p class="prompt">${escapeHtml(promptLine())}</p></div>`;
}

function topbarHtml() {
  return `<header class="topbar"><button type="button" class="hamburger" data-menu aria-label="Menu" aria-expanded="${menuOpen ? "true" : "false"}"><span></span><span></span><span></span></button></header>`;
}

function menuHtml() {
  const item = (id, label) => `<button type="button" data-view="${id}"${screen === id ? " aria-current=\"true\"" : ""}>${label}</button>`;
  return `
    <button type="button" class="scrim" data-menu aria-label="Close menu"></button>
    <nav class="menu" aria-label="Menu">
      <p class="horizon">Menu</p>
      ${item("morning", "This morning")}
      ${item("plan", "Plan ahead")}
      ${item("integrations", "Integrations")}
    </nav>
  `;
}

function planHtml() {
  const bubbles = CHAT.map(([who, text]) => `<p class="bubble ${who}"><span class="who">${who === "her" ? "Her" : "Guide"}</span>${escapeHtml(text)}</p>`).join("");
  const goals = GOALS.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
  return `
    <section class="card"><h1 class="step">Plan ahead.</h1></section>
    <div class="thread">${bubbles}</div>
    <div class="context">
      <p class="source"><span class="horizon">Longer plan</span> Updated in the background.</p>
      ${goals}
    </div>
  `;
}

function integrationsHtml() {
  const groups = INTEGRATIONS.map(([group, items]) => {
    const rows = items.map(([id, name, detail]) => {
      const on = !disconnected.has(id);
      const shown = on ? integrationDetail(id, detail) : "Off";
      const hint = id === "gcal" && on && !tokenRecord() ? calendarHint() : "";
      const setup = hint ? `<p class="integ-hint">${escapeHtml(hint)}</p>` : "";
      return `<div class="integ-row"><button type="button" class="integ" data-integration="${id}" aria-pressed="${on ? "true" : "false"}"><span class="integ-name">${escapeHtml(name)}</span><span class="integ-detail">${escapeHtml(shown)}</span></button>${setup}</div>`;
    }).join("");
    return `<section class="integ-group"><h2 class="horizon">${escapeHtml(group)}</h2>${rows}</section>`;
  }).join("");
  return `
    <section class="card"><h1 class="step">Integrations.</h1></section>
    <div class="sheet">${groups}</div>
  `;
}

function morningHtml() {
  const current = scene();
  const choices = current.choices.map((choice, i) => {
    const selected = choice.prompts === true && promptsOn() || choice.prompts === false && !promptsOn();
    return `<button type="button" data-i="${i}" aria-pressed="${selected ? "true" : "false"}">${escapeHtml(choice.label)}</button>`;
  }).join("");
  const bottom = current.report ? reportHtml(couple(current.report)) : readingsHtml(contextsFor(current.choices));
  return `
    <section class="card" aria-live="polite">
      <h1 class="step">${escapeHtml(current.text)}</h1>
      ${current.report ? "" : noteHtml()}
    </section>
    <div class="choices">${current.map ? mapHtml() : ""}<div class="choice-stack">${choices}</div></div>
    <div class="context">${bottom}</div>
  `;
}

function clientId() {
  return (localStorage.getItem(CLIENT_KEY) || CLIENT_ID).trim();
}

function allowedOrigin() {
  return location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "https:";
}

function phoneSignIn() {
  return window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

function redirectUri() {
  const url = new URL(location.href);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) || "/";
  return url.origin + url.pathname;
}

function calendarHint() {
  if (allowedOrigin()) return "";
  return "On the phone, open https://possiblyphilip.github.io/unnamed_productivity_app/ and connect from there.";
}

function tokenRecord() {
  try {
    const raw = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    if (!raw || !raw.access_token || raw.expires_at < Date.now() + 60000) return null;
    return raw;
  } catch (err) {
    return null;
  }
}

function integrationDetail(id, fallback) {
  if (id === "weather") return weatherWhere ? `${WEATHER.text} ${weatherWhere}` : WEATHER.text;
  if (id === "sky") return MOON.text;
  if (id === "gcal") return calendarDetail();
  return fallback;
}

function calendarDetail() {
  if (calendarMessage) return calendarMessage;
  if (calendarEvents) {
    if (!calendarEvents.length) return "Nothing else on the calendar today.";
    return calendarEvents.slice(0, 2).map(eventLine).join(" ");
  }
  if (!clientId()) return "Paste a Google client ID, then tap to connect.";
  return "Tap to connect today's events.";
}

function eventLine(event) {
  const summary = event.summary || "Busy";
  if (!event.start || !event.start.dateTime) return `${summary}, all day.`;
  const time = new Date(event.start.dateTime).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `${summary} at ${time}.`;
}

function applyCalendar(events) {
  calendarEvents = events;
  calendarMessage = "";
  if (!events.length) {
    CLINIC.text = "Nothing else on the calendar today.";
    LUNCH.text = "Nothing else on the calendar today.";
  } else {
    CLINIC.text = eventLine(events[0]);
    LUNCH.text = events[1] ? eventLine(events[1]) : "Nothing else on the calendar today.";
  }
}

function restoreCalendar() {
  calendarEvents = null;
  calendarMessage = "";
  CLINIC.text = SAMPLE.clinic;
  LUNCH.text = SAMPLE.lunch;
  localStorage.removeItem(TOKEN_KEY);
}

function moonLine(date) {
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
  const rad = Math.PI / 180;
  const norm = (x) => ((x % 360) + 360) % 360;
  const L = norm(218.3164477 + 13.17639648 * d);
  const M = norm(134.9633964 + 13.06499295 * d);
  const F = norm(93.2720950 + 13.22935024 * d);
  const D = norm(297.8501921 + 12.19074877 * d);
  const lon = norm(L
    + 6.289 * Math.sin(M * rad)
    - 1.274 * Math.sin((2 * D - M) * rad)
    + 0.658 * Math.sin(2 * D * rad)
    - 0.214 * Math.sin(2 * F * rad)
    - 0.186 * Math.sin(D * rad));
  const signs = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  const g = norm(357.529 + 0.98560028 * d);
  const sun = norm(280.459 + 0.98564736 * d + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad));
  const phase = norm(lon - sun);
  const growing = phase < 180 ? "waxing" : "waning";
  return `The moon is ${growing} in ${signs[Math.floor(lon / 30)]}.`;
}

function weatherPhrase(code) {
  if (code === 0) return "clear";
  if (code <= 3) return "cloudy";
  if (code === 45 || code === 48) return "foggy";
  if (code >= 71 && code <= 77) return "snowy";
  if (code >= 95) return "stormy";
  if (code >= 51) return "rainy";
  return "cloudy";
}

function applyWeather(data, where) {
  const current = data && data.current;
  if (!current || typeof current.temperature_2m !== "number") return;
  WEATHER.text = `${Math.round(current.temperature_2m)}° and ${weatherPhrase(current.weather_code)}.`;
  weatherWhere = where;
}

async function loadWeather(coords, where) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.latitude));
  url.searchParams.set("longitude", String(coords.longitude));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url);
  if (!response.ok) return;
  applyWeather(await response.json(), where);
  render();
}

function locateWeather() {
  const fallback = () => loadWeather(PORTLAND, "Portland, until location is allowed.");
  if (!navigator.geolocation) {
    fallback();
    return;
  }
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    fallback();
  }, 4000);
  navigator.geolocation.getCurrentPosition((position) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    loadWeather(position.coords, "");
  }, () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    fallback();
  }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 3500 });
}

async function loadCalendar() {
  const token = tokenRecord();
  if (!token) return;
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
  url.searchParams.set("timeMin", new Date().toISOString());
  url.searchParams.set("timeMax", end.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "5");
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (response.status === 401) {
    restoreCalendar();
    render();
    return;
  }
  if (!response.ok) {
    calendarMessage = "Calendar didn't answer. Tap to try again.";
    render();
    return;
  }
  const data = await response.json();
  applyCalendar(data.items || []);
  render();
}

function storeToken(accessToken, expiresIn) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify({
    access_token: accessToken,
    expires_at: Date.now() + (Number(expiresIn) || 3600) * 1000
  }));
  disconnected.delete("gcal");
}

function takeRedirectToken() {
  if (!location.hash.includes("access_token") && !location.hash.includes("error=")) return;
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  history.replaceState(null, "", location.pathname + location.search);
  if (hash.get("error") || !hash.get("access_token")) {
    calendarMessage = "Calendar connection stopped.";
    return;
  }
  storeToken(hash.get("access_token"), hash.get("expires_in"));
}

function startCalendarAuth() {
  const id = clientId();
  if (!id.endsWith(".apps.googleusercontent.com")) {
    calendarMessage = "That value isn't a client ID. Use the one ending in .apps.googleusercontent.com.";
    render();
    return;
  }
  if (!allowedOrigin()) {
    calendarMessage = calendarHint();
    render();
    return;
  }
  if (phoneSignIn()) {
    const params = new URLSearchParams({
      client_id: id,
      redirect_uri: redirectUri(),
      response_type: "token",
      scope: GCAL_SCOPE,
      include_granted_scopes: "true",
      prompt: "select_account"
    });
    location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
    return;
  }
  const oauth = window.google && google.accounts && google.accounts.oauth2;
  if (!oauth) {
    calendarMessage = "Google sign-in is still loading. Tap again.";
    render();
    return;
  }
  calendarMessage = "";
  oauth.initTokenClient({
    client_id: id,
    scope: GCAL_SCOPE,
    callback: (resp) => {
      if (!resp || resp.error) {
        calendarMessage = "Calendar connection stopped.";
        render();
        return;
      }
      storeToken(resp.access_token, resp.expires_in);
      loadCalendar();
    }
  }).requestAccessToken();
}

function render() {
  const body = screen === "plan" ? planHtml() : screen === "integrations" ? integrationsHtml() : morningHtml();
  app.innerHTML = `${topbarHtml()}${menuOpen ? menuHtml() : ""}${body}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]));
}

function chooseVoice(voices) {
  const english = (voices || []).filter((voice) => /^en/i.test(voice.lang || ""));
  english.sort((a, b) => (voiceScore(b) - voiceScore(a)));
  return english[0] || null;
}

function voiceScore(voice) {
  let score = 0;
  if (/en-US/i.test(voice.lang)) score += 4;
  if (voice.localService) score += 2;
  if (/google/i.test(voice.name || "")) score += 3;
  return score;
}

function speak(text) {
  const synth = window.speechSynthesis;
  if (!synth || !text) return;
  const token = ++speechToken;
  const start = () => {
    if (token !== speechToken) return;
    const engine = window.speechSynthesis;
    const voice = chooseVoice(engine.getVoices());
    heldUtterances = [];
    engine.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.92;
    if (voice) utterance.voice = voice;
    heldUtterances.push(utterance);
    engine.speak(utterance);
    engine.resume();
  };
  if (synth.speaking || synth.pending) {
    synth.cancel();
    setTimeout(start, 80);
  } else start();
}

app.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]");
  if (view) {
    screen = view.dataset.view;
    menuOpen = false;
    render();
    return;
  }
  if (event.target.closest("[data-client-id]")) return;
  const integration = event.target.closest("[data-integration]");
  if (integration) {
    const id = integration.dataset.integration;
    if (id === "gcal" && !disconnected.has(id)) {
      if (tokenRecord() || calendarEvents) restoreCalendar();
      else startCalendarAuth();
      render();
      return;
    }
    if (disconnected.has(id)) disconnected.delete(id);
    else disconnected.add(id);
    render();
    return;
  }
  if (event.target.closest("[data-menu]")) {
    menuOpen = !menuOpen;
    render();
    return;
  }
  if (screen !== "morning") return;
  const el = event.target.closest("[data-i]");
  if (!el) return;
  const choice = scene().choices[Number(el.dataset.i)];
  if (!choice) return;
  if (choice.prompts === true || choice.prompts === false) {
    localStorage.setItem(PROMPT_KEY, choice.prompts ? "on" : "off");
    render();
    return;
  }
  enter(choice.go, choice.set, choice.reset, choice.note);
  speak(scene().text);
});

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => window.speechSynthesis.getVoices());
}

app.addEventListener("input", (event) => {
  const field = event.target.closest("[data-client-id]");
  if (!field) return;
  localStorage.setItem(CLIENT_KEY, field.value.trim());
});

MOON.text = moonLine(new Date());
takeRedirectToken();
locateWeather();
loadCalendar();
render();
