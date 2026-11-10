/* A short morning, told like a choice book.
   The intake interview is not in this demo.
   Choices are offered, not ranked. After a choice, the note says
   which horizon it touches. Nothing here is an alarm or a correction.
   The end of the run is a report she can reopen whenever she wants. */

const MAPS = "https://www.google.com/maps/dir/?api=1&destination="
  + encodeURIComponent("Medical clinic")
  + "&travelmode=driving";

const PROMPT_KEY = "report-prompts";

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
  texted: false
});

let state = fresh();
let node = "morning";
let note = null;
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
          { label: "Sleep", go: "afterSleep", set: { slept: true }, note: { today: "Rest for this morning.", week: "A softer start leaves more of you for the week." } },
          { label: "Socialize digitally", go: "afterSocial", set: { social: true }, note: { today: "A little contact today.", week: "Small contact is how this week stays connected." } },
          { label: "Eat", go: "ready", set: { ate: true }, note: { today: "Breakfast is steadiness for today.", month: "Even mornings are the month you're building." } }
        ]
      };
    case "afterSleep":
      return {
        text: "A little more time in bed.",
        choices: [
          { label: "Eat", go: "ready", set: { ate: true }, note: { today: "Food before the day gets going.", month: "Breakfast is the even month, one morning at a time." } },
          { label: "Have a shower", go: "hungry", set: { showered: true }, note: { today: "Getting ready, at your pace." } }
        ]
      };
    case "afterSocial":
      return {
        text: "Whenever you're ready.",
        choices: [
          { label: "Eat", go: "ready", set: { ate: true }, note: { today: "Food before the day gets going.", month: "Breakfast is the even month, one morning at a time." } },
          { label: "Have a shower", go: "hungry", set: { showered: true }, note: { today: "Getting ready, at your pace." } }
        ]
      };
    case "hungry":
      return {
        text: "Breakfast, here or with you.",
        choices: [
          { label: "Eat here", go: "ready", set: { ate: true }, note: { today: "Breakfast before you head out.", month: "Mornings with food in them are the longer pattern." } },
          { label: "Take breakfast with you", go: "ready", set: { ate: true }, note: { today: "Breakfast comes along.", month: "Mornings with food in them are the longer pattern." } }
        ]
      };
    case "ready":
      return {
        text: "Get ready.",
        choices: [
          { label: "Have a shower", go: "pack", set: { showered: true }, note: { today: "A shower, then the rest of the morning." } },
          { label: "Get dressed", go: "pack", set: { dressed: true }, note: { today: "Dressed, and the morning can move." } }
        ]
      };
    case "pack":
      return {
        text: "A snack for later, if you want it along.",
        choices: [
          { label: "Put a protein bar in your bag", go: "drive", set: { snack: "protein" }, note: { today: "Food for the gap before lunch.", month: "Having something with you is how the month stays even." } },
          { label: "Pack some apple slices", go: "drive", set: { snack: "apple" }, note: { today: "Fruit for the gap before lunch.", month: "Having something with you is how the month stays even." } }
        ]
      };
    case "drive":
      return {
        text: "Time to drive to your appointment.",
        choices: [
          { label: "Directions", go: "afterAppt", maps: MAPS, note: { today: "Getting there is this hour." } }
        ]
      };
    case "afterAppt":
      return {
        text: "A little time before lunch.",
        choices: [
          { label: "Eat your snack", go: "afterSnack", set: { ateSnack: true }, note: { today: "Food in the gap before lunch.", month: "This is the steady month, one gap at a time." } },
          { label: "Walk around the block", go: "afterWalk", set: { walked: true }, note: { today: "Movement in this hour.", week: "One easy walk can be the week.", beyond: "Short walks are how a body stays in a longer life." } },
          { label: "Visit a second hand shop nearby", go: "afterShop", set: { shopped: true }, note: { today: "Something pleasing in this hour.", week: "Pleasure is in the week on purpose." } }
        ]
      };
    case "afterSnack":
      return {
        text: "The snack is done.",
        choices: followUps([
          { label: "Get a croissant", go: "landed", set: { pleasure: true }, note: { today: "Pleasure today, beside the food you already had.", month: "Care and pleasure together are the balance." } }
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
    choices.push({ label: "Eat your snack", go: "afterSnack", set: { ateSnack: true }, note: { today: "Food in the gap before lunch.", month: "This is the steady month, one gap at a time." } });
  }
  if (!state.walked && node !== "afterWalk" && !has("Walk around the block")) {
    choices.push({ label: "Walk around the block", go: "afterWalk", set: { walked: true }, note: { today: "Movement in this hour.", week: "One easy walk can be the week.", beyond: "Short walks are how a body stays in a longer life." } });
  }
  if (!state.pleasure && state.ate && state.snack && !has("Get a croissant")) {
    choices.push({ label: "Get a croissant", go: "landed", set: { pleasure: true }, note: { today: "Pleasure today, beside the food you already had.", month: "Care and pleasure together are the balance." } });
  }
  if (!state.texted && !has("Text a friend")) {
    choices.push({ label: "Text a friend", go: "landed", set: { texted: true }, note: { today: "A friend, today.", week: "Closeness in this week.", beyond: "People stay close in small notes." } });
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
  if (state.texted) today.push("wrote to a friend");

  const lines = [{
    horizon: "Today",
    text: today.length ? "You " + joinList(today) + "." : "A quiet morning."
  }];

  if (state.walked) lines.push({ horizon: "This week", text: "The walk is one easy movement day. It can be the whole of it." });
  else if (state.texted || state.social) lines.push({ horizon: "This week", text: "People showed up this week, in a small way." });
  else if (state.slept) lines.push({ horizon: "This week", text: "Rest this morning belongs to a week that isn't only tasks." });
  else if (state.shopped || state.pleasure) lines.push({ horizon: "This week", text: "Pleasure is in the week on purpose." });

  if ((state.ate || state.ateSnack || state.snack) && state.pleasure) {
    lines.push({ horizon: "This month", text: "Food you planned, and something just because, is the month in balance." });
  } else if (state.ate || state.ateSnack || state.snack) {
    lines.push({ horizon: "This month", text: "Breakfast and something for later are the steady month, one day at a time." });
  }

  if (state.texted) lines.push({ horizon: "Beyond", text: "Friends stay close through small notes, over years rather than projects." });
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

function reportHtml(lines) {
  return `<div class="report">${lines.map((line) => `<p class="report-line"><span class="horizon">${escapeHtml(line.horizon)}</span> ${escapeHtml(line.text)}</p>`).join("")}<p class="prompt">${escapeHtml(promptLine())}</p></div>`;
}

function render() {
  const current = scene();
  const choices = current.choices.map((choice, i) => {
    const selected = choice.prompts === true && promptsOn() || choice.prompts === false && !promptsOn();
    return `<button type="button" data-i="${i}" aria-pressed="${selected ? "true" : "false"}">${escapeHtml(choice.label)}</button>`;
  }).join("");
  const context = current.report ? reportHtml(current.report) : noteHtml();
  app.innerHTML = `
    <section class="card" aria-live="polite">
      <h1 class="step">${escapeHtml(current.text)}</h1>
    </section>
    <div class="choices"><div class="choice-stack">${choices}</div></div>
    <div class="context">${context}</div>
  `;
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
  const el = event.target.closest("[data-i]");
  if (!el) return;
  const choice = scene().choices[Number(el.dataset.i)];
  if (!choice) return;
  if (choice.prompts === true || choice.prompts === false) {
    localStorage.setItem(PROMPT_KEY, choice.prompts ? "on" : "off");
    render();
    return;
  }
  if (choice.maps) window.open(choice.maps, "_blank", "noopener");
  enter(choice.go, choice.set, choice.reset, choice.note);
  speak(scene().text);
});

if (window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener("voiceschanged", () => window.speechSynthesis.getVoices());
}

render();
