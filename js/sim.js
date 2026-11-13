(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(require("./learner.js")); }
  else { root.Sim = factory(root.Learner); }
})(typeof self !== "undefined" ? self : this, function (Learner) {
  "use strict";

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Ground truth for the simulation: the chance of an "active" pick.
  // Sleep matters on weekend mornings. Cycle phase matters on weekday afternoons. The moon matters nowhere.
  function truth(slice, lens) {
    if (slice === "weekend-morning") { return lens.sleep === "short" ? 0.25 : 0.70; }
    if (slice === "weekday-afternoon") { return lens.cycle === "luteal" ? 0.30 : 0.55; }
    return 0.5;
  }

  function generate(opts) {
    var o = Object.assign({
      weeks: 12, seed: 1, startDow: 1, inaction: 0.2,
      perDaypart: { morning: 2, afternoon: 2, evening: 1 }, truth: truth
    }, opts || {});
    var rnd = mulberry32(o.seed);
    var cycleStart = Math.floor(rnd() * 28);
    var moonStart = rnd() * 360;
    var out = [];
    for (var d = 0; d < o.weeks * 7; d++) {
      var dow = (o.startDow + d) % 7;
      var hours = rnd() < 0.35 ? 5 + rnd() * 1.3 : 7 + rnd() * 1.5;
      var lens = {
        sleep: Learner.sleepState(hours),
        moon: Learner.moonGroupFromElongation((moonStart + d * 12.19) % 360),
        cycle: Learner.cyclePhase(((cycleStart + d) % 28) + 1)
      };
      ["morning", "afternoon", "evening"].forEach(function (part) {
        var slice = (dow === 0 || dow === 6 ? "weekend" : "weekday") + "-" + part;
        for (var k = 0; k < o.perDaypart[part]; k++) {
          if (rnd() < o.inaction) { continue; }
          var active = rnd() < o.truth(slice, lens);
          out.push({
            t: d, slice: slice, lens: Object.assign({}, lens),
            shown: [{ o: "a1", a: true }, { o: "a2", a: true }, { o: "n1", a: false }, { o: "n2", a: false }],
            picked: active ? "a1" : "n1", pickedActive: active, source: "sample"
          });
        }
      });
    }
    return out;
  }

  // Made-up history for the demo: 20 weeks of a busy user, with the effects above.
  // Seed 1 was picked because it shows both real effects and no moon chip. Seeds 6 and 11 of the first
  // twelve show a false moon chip, which is the false-positive risk the simulation measures.
  var DEMO_SEED = 1;
  function demoHistory() {
    return generate({ weeks: 20, seed: DEMO_SEED, startDow: 1, perDaypart: { morning: 3, afternoon: 3, evening: 2 } });
  }

  return { generate: generate, truth: truth, mulberry32: mulberry32, demoHistory: demoHistory, DEMO_SEED: DEMO_SEED };
});
