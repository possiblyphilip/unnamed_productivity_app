(function (root) {
  "use strict";
  // Live signals: moon (calculated), weather and daylight (Open-Meteo, no key), location, Google Calendar.
  // Calendar sign-in code is carried over from the first demo.
  var CLIENT_ID = "1053539375179-51f5cla0fu2rivktfhttg7vf5htlmv24.apps.googleusercontent.com";
  var SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
  var TOKEN_KEY = "cc.gcal";
  var FALLBACK = { latitude: 47.6062, longitude: -122.3321, label: "Seattle (default until location is allowed)" };

  function hhmm(m) {
    m = Math.max(0, Math.min(24 * 60 - 1, m));
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  // ---- moon ----
  var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  function norm(x) { return ((x % 360) + 360) % 360; }

  function moonFor(date) {
    var d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
    var rad = Math.PI / 180;
    var L = norm(218.3164477 + 13.17639648 * d);
    var M = norm(134.9633964 + 13.06499295 * d);
    var F = norm(93.2720950 + 13.22935024 * d);
    var D = norm(297.8501921 + 12.19074877 * d);
    var lon = norm(L + 6.289 * Math.sin(M * rad) - 1.274 * Math.sin((2 * D - M) * rad) + 0.658 * Math.sin(2 * D * rad) - 0.214 * Math.sin(2 * F * rad) - 0.186 * Math.sin(D * rad));
    var g = norm(357.529 + 0.98560028 * d);
    var sun = norm(280.459 + 0.98564736 * d + 1.915 * Math.sin(g * rad) + 0.020 * Math.sin(2 * g * rad));
    var e = norm(lon - sun);
    var name = e < 22.5 || e >= 337.5 ? "New moon" : e < 67.5 ? "Waxing crescent" : e < 112.5 ? "First quarter" : e < 157.5 ? "Waxing gibbous" : e < 202.5 ? "Full moon" : e < 247.5 ? "Waning gibbous" : e < 292.5 ? "Last quarter" : "Waning crescent";
    return { name: name, sign: SIGNS[Math.floor(lon / 30)], elongation: e };
  }

  // ---- location and weather ----
  function locate() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) { resolve(FALLBACK); return; }
      var settled = false;
      var timer = setTimeout(function () { if (!settled) { settled = true; resolve(FALLBACK); } }, 4000);
      navigator.geolocation.getCurrentPosition(function (p) {
        if (settled) { return; }
        settled = true; clearTimeout(timer);
        resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, label: "your location" });
      }, function () {
        if (settled) { return; }
        settled = true; clearTimeout(timer);
        resolve(FALLBACK);
      }, { enableHighAccuracy: false, maximumAge: 600000, timeout: 3500 });
    });
  }

  function skyFor(precip, code) {
    return (precip >= 0.1 || (code >= 51 && code <= 99)) ? "rain" : "dry";
  }

  function loadWeather(place) {
    var url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("hourly", "precipitation,weather_code");
    url.searchParams.set("daily", "sunrise,sunset");
    url.searchParams.set("forecast_days", "1");
    url.searchParams.set("timezone", "auto");
    return fetch(url).then(function (r) {
      if (!r.ok) { throw new Error("weather " + r.status); }
      return r.json();
    }).then(function (data) {
      var h = data.hourly;
      var segs = [];
      for (var i = 0; i < h.time.length; i++) {
        var sky = skyFor(h.precipitation[i], h.weather_code[i]);
        var from = i * 60;
        var last = segs[segs.length - 1];
        if (last && last.sky === sky) { last.toM = from + 60; }
        else { segs.push({ sky: sky, fromM: from, toM: from + 60 }); }
      }
      return {
        weather: segs.map(function (s) { return { from: hhmm(s.fromM), to: s.toM >= 1440 ? "23:59" : hhmm(s.toM), sky: s.sky }; }),
        sunrise: data.daily.sunrise[0].slice(11, 16),
        sunset: data.daily.sunset[0].slice(11, 16)
      };
    });
  }

  // ---- Google Calendar ----
  function allowedOrigin() {
    return location.hostname === "localhost" || location.hostname === "127.0.0.1" || location.protocol === "https:";
  }
  function phoneSignIn() {
    return window.matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  }
  function redirectUri() {
    var url = new URL(location.href);
    url.hash = ""; url.search = "";
    if (!url.pathname.endsWith("/")) { url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1) || "/"; }
    return url.origin + url.pathname;
  }
  function tokenRecord() {
    try {
      var raw = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (!raw || !raw.access_token || raw.expires_at < Date.now() + 60000) { return null; }
      return raw;
    } catch (e) { return null; }
  }
  function storeToken(token, expiresIn) {
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({ access_token: token, expires_at: Date.now() + (Number(expiresIn) || 3600) * 1000 }));
    } catch (e) { /* storage blocked */ }
  }
  function takeRedirectToken() {
    if (location.hash.indexOf("access_token") === -1 && location.hash.indexOf("error=") === -1) { return null; }
    var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
    history.replaceState(null, "", location.pathname + location.search);
    if (hash.get("error") || !hash.get("access_token")) { return "Calendar connection stopped."; }
    storeToken(hash.get("access_token"), hash.get("expires_in"));
    return "";
  }

  function minutesOf(iso) {
    var d = new Date(iso);
    return d.getHours() * 60 + d.getMinutes();
  }

  function loadCalendar() {
    var token = tokenRecord();
    if (!token) { return Promise.resolve(null); }
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var end = new Date(); end.setHours(23, 59, 59, 999);
    var url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", start.toISOString());
    url.searchParams.set("timeMax", end.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "20");
    return fetch(url, { headers: { Authorization: "Bearer " + token.access_token } }).then(function (r) {
      if (r.status === 401) { disconnect(); throw new Error("expired"); }
      if (!r.ok) { throw new Error("calendar " + r.status); }
      return r.json();
    }).then(function (data) {
      return (data.items || []).filter(function (e) { return e.start && e.start.dateTime && e.end && e.end.dateTime; }).map(function (e) {
        return { start: hhmm(minutesOf(e.start.dateTime)), end: hhmm(minutesOf(e.end.dateTime)), title: e.summary || "Busy", travel_min: 0 };
      });
    });
  }

  function connect(done) {
    if (!allowedOrigin()) { done("Calendar sign-in needs https or localhost."); return; }
    if (phoneSignIn()) {
      var params = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: redirectUri(), response_type: "token", scope: SCOPE, include_granted_scopes: "true", prompt: "select_account" });
      location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + params.toString());
      return;
    }
    var oauth = window.google && google.accounts && google.accounts.oauth2;
    if (!oauth) { done("Google sign-in is still loading. Try again."); return; }
    oauth.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE,
      callback: function (resp) {
        if (!resp || resp.error) { done("Calendar connection stopped."); return; }
        storeToken(resp.access_token, resp.expires_in);
        done("");
      }
    }).requestAccessToken();
  }

  function disconnect() {
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ }
  }

  root.Ctx = {
    moonFor: moonFor, locate: locate, loadWeather: loadWeather, FALLBACK: FALLBACK,
    calendar: { connected: function () { return !!tokenRecord(); }, connect: connect, load: loadCalendar, disconnect: disconnect, takeRedirectToken: takeRedirectToken }
  };
})(window);
