(function (root, factory) {
  if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Sample = factory(); }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // One invented Seattle day. Weather, moon and calendar are made up.
  return {
    context: {
      day: "2026-11-13",
      place: { band: "Seattle, WA" },
      sunrise: "07:05",
      sunset: "16:46",
      moon: { phase: "waxing crescent" },
      weather: [
        { from: "00:00", to: "13:40", sky: "rain" },
        { from: "13:40", to: "16:30", sky: "dry" },
        { from: "16:30", to: "23:59", sky: "rain" }
      ],
      calendar: [{ start: "12:30", end: "13:30", title: "Appointment" }]
    }
  };
});
