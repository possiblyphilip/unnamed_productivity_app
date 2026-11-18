(function (root) {
  "use strict";
  // Birthday and date astrology. Everything here is calculated on the device from the birth date and today's date.
  // No birth time or place, so no rising sign or houses. Not a claim that any of it predicts anything: the learner
  // only shows a signal when it has predicted this person's picks.
  var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  var ELEMENTS = ["fire", "earth", "air", "water"];
  var SUN_SIGNS = [["Capricorn", 1, 19], ["Aquarius", 2, 18], ["Pisces", 3, 20], ["Aries", 4, 19], ["Taurus", 5, 20], ["Gemini", 6, 20], ["Cancer", 7, 22], ["Leo", 8, 22], ["Virgo", 9, 22], ["Libra", 10, 22], ["Scorpio", 11, 21], ["Sagittarius", 12, 21], ["Capricorn", 12, 31]];

  function parts(day) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(day || ""));
    return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
  }
  function validBirth(day) {
    var p = parts(day);
    if (!p || p.m < 1 || p.m > 12 || p.d < 1 || p.d > 31 || p.y < 1900) { return false; }
    var t = new Date(p.y, p.m - 1, p.d);
    return t.getFullYear() === p.y && t.getMonth() === p.m - 1 && t.getDate() === p.d && t.getTime() <= Date.now();
  }
  function sunSign(day) {
    var p = parts(day);
    if (!p) { return null; }
    for (var i = 0; i < SUN_SIGNS.length; i++) {
      if (p.m < SUN_SIGNS[i][1] || (p.m === SUN_SIGNS[i][1] && p.d <= SUN_SIGNS[i][2])) { return SUN_SIGNS[i][0]; }
    }
    return "Capricorn";
  }
  function element(sign) { var i = SIGNS.indexOf(sign); return i < 0 ? null : ELEMENTS[i % 4]; }
  // Same element, friendly (fire and air, earth and water) or tense (the rest).
  function relation(signA, signB) {
    var a = element(signA), b = element(signB);
    if (!a || !b) { return null; }
    if (a === b) { return "same"; }
    var pair = [a, b].sort().join("+");
    return pair === "air+fire" || pair === "earth+water" ? "friendly" : "tense";
  }
  // Numerology: digits of the birth date added down to one digit, keeping 11, 22 and 33.
  function lifePath(day) {
    var p = parts(day);
    if (!p) { return null; }
    function sum(n) { return String(n).split("").reduce(function (a, c) { return a + Number(c); }, 0); }
    function reduce(n) { while (n > 9 && n !== 11 && n !== 22 && n !== 33) { n = sum(n); } return n; }
    return reduce(reduce(p.y) + reduce(p.m) + reduce(p.d));
  }

  // Everything computable for this moment, kept with each pick so it can be tested later against what was picked,
  // whether or not the person has the lens switched on.
  function snapshot(birth, c) {
    var out = { season: sunSign(c.day), moonSign: c.moon.sign || null };
    if (validBirth(birth)) {
      out.sun = sunSign(birth);
      out.relation = relation(out.sun, out.moonSign);
      out.lifePath = lifePath(birth);
    }
    return out;
  }

  root.Astro = { sunSign: sunSign, element: element, relation: relation, lifePath: lifePath, validBirth: validBirth, snapshot: snapshot };
})(typeof window !== "undefined" ? window : this);
