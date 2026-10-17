import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import {
  MACHINES, MACHINE_LABEL, MACHINE_ICON, KINDS, WEEKDAYS, TEMPLATES,
  uuid, clock, clockTenths, percent, parseClock, watts, paceDistance,
  workout, interval, summary, standard, fresh,
  dayString, parseDay, monday, addDays, sessionDate, programWeek, programStatus,
  sessionsInWeek, copyWeek, programFromTemplate, copyFor, copyProgramFor,
} from "./model.js";

// Same project and publishable key as the app; row level security protects the data.
const SUPABASE_URL = "https://gsxdogmmpxnuspuohbhw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzeGRvZ21tcHhudXNwdW9oYmh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzI3NTIsImV4cCI6MjEwNzcwODc1Mn0.LpGSq5CSV6U5clxCXG6CK1ug7dCSQkGhrQ1KVUnDtoU";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = {
  user: null,
  gyms: [],          // gyms this account coaches
  gymId: localStorage.getItem("gymId"),
  workouts: [],      // gym_workouts rows
  programs: [],      // gym_programs rows
  page: "planning",
  weekOffset: 0,     // planning: weeks from this week
  program: null,     // program being edited (a copy)
  board: { kind: "programs", program: null, training: null },
};

const gym = () => state.gyms.find((g) => g.id === state.gymId);

function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast" + (isError ? " error" : "");
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 3000);
}

async function run(promise, okMessage) {
  const { data, error } = await promise;
  if (error) {
    toast(error.message, true);
    console.error(error);
    throw error;
  }
  if (okMessage) toast(okMessage);
  return data;
}

// MARK: Session

async function start() {
  const { data } = await db.auth.getSession();
  state.user = data.session?.user ?? null;
  db.auth.onAuthStateChange((_event, session) => {
    const changed = (session?.user?.id ?? null) !== (state.user?.id ?? null);
    state.user = session?.user ?? null;
    if (changed) load();
  });
  load();
}

async function load() {
  renderAccount();
  if (!state.user) return renderLogin();
  const memberships = await run(
    db.from("gym_members").select("role, gyms(id, name, join_code)").eq("user_id", state.user.id)
  );
  state.gyms = memberships.filter((m) => m.role === "coach").map((m) => m.gyms);
  if (!state.gyms.length) {
    $("#nav").hidden = true;
    $("#main").innerHTML = `<div class="card login stack"><h2>Geen sportschool</h2>
      <p class="muted">Dit is geen sportschoolaccount. De website is alleen voor sportscholen; leden gebruiken de app.</p></div>`;
    return;
  }
  if (!gym()) state.gymId = state.gyms[0].id;
  await loadGym();
}

async function loadGym() {
  localStorage.setItem("gymId", state.gymId);
  const [workouts, programs] = await Promise.all([
    run(db.from("gym_workouts").select("id, gym_id, scheduled_for, workout, note").eq("gym_id", state.gymId).order("scheduled_for")),
    run(db.from("gym_programs").select("id, gym_id, name, start_date, weeks, sessions").eq("gym_id", state.gymId).order("start_date", { ascending: false })),
  ]);
  state.workouts = workouts;
  state.programs = programs;
  $("#nav").hidden = false;
  renderAccount();
  render();
}

function renderAccount() {
  const el = $("#account");
  if (!state.user) return (el.innerHTML = "");
  const gymPicker = state.gyms.length > 1
    ? `<select id="gym-picker">${state.gyms.map((g) => `<option value="${g.id}" ${g.id === state.gymId ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select>`
    : state.gyms.length ? `<strong>${esc(gym()?.name)}</strong>` : "";
  el.innerHTML = `${gymPicker} <span class="small">${esc(state.user.email)}</span> <button class="link" id="logout">Uitloggen</button>`;
  $("#logout").onclick = async () => { await db.auth.signOut(); state.gyms = []; };
  const picker = $("#gym-picker");
  if (picker) picker.onchange = () => { state.gymId = picker.value; state.program = null; loadGym(); };
}

function renderLogin() {
  $("#nav").hidden = true;
  $("#main").innerHTML = `
    <form class="card login stack" id="login">
      <h1>Inloggen</h1>
      <p class="muted">Voor sportschoolaccounts: plan trainingen en programma's voor je leden. Leden gebruiken de app.</p>
      <label>Gebruikersnaam of e-mail <input name="login" autocomplete="username" required></label>
      <label>Wachtwoord <input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Inloggen</button>
      <p class="error small" id="login-error"></p>
    </form>
    <div class="copyright muted small"><img src="logo.png" alt="">© ${new Date().getFullYear()} Warenhuis Willemsen</div>`;
  $("#login").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const login = String(form.get("login")).trim();
    const email = login.includes("@") ? login : `${login.toLowerCase()}@ergworkouts.test`;
    const { error } = await db.auth.signInWithPassword({ email, password: String(form.get("password")) });
    if (error) $("#login-error").textContent = error.message === "Invalid login credentials" ? "Onjuiste gebruikersnaam of wachtwoord." : error.message;
  };
}

// MARK: Navigation

$$("#nav button").forEach((button) => {
  button.onclick = () => { state.page = button.dataset.page; state.program = null; render(); };
});

function render() {
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === state.page));
  if (state.page === "planning") renderPlanning();
  else if (state.page === "programs") state.program ? renderProgramEditor() : renderPrograms();
  else renderLeaderboard();
}

// MARK: Planning

/** One-off trainings and program sessions between two dates. */
function scheduled(from, to) {
  const items = state.workouts
    .map((w) => ({ date: parseDay(w.scheduled_for), workout: w.workout, note: w.note, oneOff: w }))
    .filter((i) => i.date >= from && i.date < to);
  for (const program of state.programs) {
    for (const session of program.sessions) {
      const date = sessionDate(program, session);
      if (date >= from && date < to) items.push({ date, workout: session.workout, note: session.note, program, session });
    }
  }
  return items.sort((a, b) => a.date - b.date);
}

/** A compact "Kopieer voor…" menu with the other machines. */
function copyForSelect(machine, attribute, value) {
  return `<select class="copy-for" ${attribute}="${value}" title="Dezelfde training voor een ander apparaat">
    <option value="">Kopieer voor…</option>
    ${MACHINES.filter((m) => m !== machine).map((m) => `<option value="${m}">${MACHINE_ICON[m]} ${MACHINE_LABEL[m]}</option>`).join("")}
  </select>`;
}

function trainingRow(item) {
  const w = item.workout;
  const label = item.program ? `<span class="tag">${esc(item.program.name)} · week ${item.session.week}</span>` : `<span class="tag orange">Losse training</span>`;
  return `<div class="training">
    <div class="icon" title="${MACHINE_LABEL[w.machine]}">${MACHINE_ICON[w.machine]}</div>
    <div class="body">
      <div class="name">${esc(w.name)} ${label}</div>
      <div class="meta">${MACHINE_LABEL[w.machine]} · ${esc(summary(w))}</div>
      ${item.note ? `<div class="meta">${esc(item.note)}</div>` : ""}
    </div>
    ${copyForSelect(w.machine, "data-copy-item", item.oneOff ? `oneoff:${item.oneOff.id}` : `session:${item.program.id}:${item.session.id}`)}
    ${item.oneOff
      ? `<button class="link" data-edit-oneoff="${item.oneOff.id}">Wijzig</button><button class="link danger" data-delete-oneoff="${item.oneOff.id}">Verwijder</button>`
      : `<button class="link" data-open-program="${item.program.id}" data-week="${item.session.week}">Open programma</button>`}
  </div>`;
}

function renderPlanning() {
  const first = addDays(monday(new Date()), state.weekOffset * 7);
  const weeks = [0, 1, 2, 3].map((i) => addDays(first, i * 7));
  const todayString = dayString(new Date());
  const weekNumber = (date) => {
    const thursday = addDays(date, 3);
    const jan4 = new Date(thursday.getFullYear(), 0, 4);
    return 1 + Math.round(((thursday - monday(jan4)) / 86400000) / 7);
  };

  $("#main").innerHTML = `
    <div class="row"><h1>Planning</h1><span class="spacer"></span>
      <button data-shift="-1">← Eerder</button><button data-shift="0">Deze week</button><button data-shift="1">Later →</button>
      <button class="primary" id="new-oneoff">+ Losse training</button>
    </div>
    <p class="muted">Code voor leden: <strong>${esc(gym().join_code)}</strong> <button class="link" id="edit-code">Wijzig</button></p>
    ${weeks.map((weekStart) => {
      const days = [0, 1, 2, 3, 4, 5, 6].map((d) => addDays(weekStart, d));
      const items = scheduled(weekStart, addDays(weekStart, 7));
      return `<h2>Week ${weekNumber(weekStart)} · ${weekStart.toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}</h2>
        <div class="card">${items.length ? days.map((day) => {
          const dayItems = items.filter((i) => dayString(i.date) === dayString(day));
          if (!dayItems.length) return "";
          return `<div class="day"><div class="date ${dayString(day) === todayString ? "today" : ""}">${WEEKDAYS[(day.getDay() + 6) % 7]}
            <small>${day.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</small></div>
            <div>${dayItems.map(trainingRow).join("")}</div></div>`;
        }).join("") : `<p class="muted">Geen trainingen.</p>`}</div>`;
    }).join("")}`;

  $$("[data-shift]").forEach((b) => (b.onclick = () => {
    const shift = Number(b.dataset.shift);
    state.weekOffset = shift === 0 ? 0 : state.weekOffset + shift * 4;
    renderPlanning();
  }));
  $("#edit-code").onclick = editJoinCode;
  $("#new-oneoff").onclick = () => editOneOff({
    id: uuid(), gym_id: state.gymId, scheduled_for: dayString(new Date()), note: "", workout: fresh(standard("rower")[7]),
  });
  $$("[data-edit-oneoff]").forEach((b) => (b.onclick = () => editOneOff(structuredClone(state.workouts.find((w) => w.id === b.dataset.editOneoff)))));
  $$("[data-delete-oneoff]").forEach((b) => (b.onclick = async () => {
    if (!confirm("Deze training verwijderen?")) return;
    await run(db.from("gym_workouts").delete().eq("id", b.dataset.deleteOneoff), "Training verwijderd");
    await loadGym();
  }));
  $$("[data-copy-item]").forEach((select) => (select.onchange = () => {
    const machine = select.value;
    select.value = "";
    if (!machine) return;
    // Copies become a one-off training on the same day; the original stays as it is.
    const [kind, id, sessionId] = select.dataset.copyItem.split(":");
    let source;
    if (kind === "oneoff") {
      const w = state.workouts.find((x) => x.id === id);
      source = { day: w.scheduled_for, note: w.note, workout: w.workout };
    } else {
      const program = state.programs.find((p) => p.id === id);
      const session = program.sessions.find((s) => s.id === sessionId);
      source = { day: dayString(sessionDate(program, session)), note: session.note, workout: session.workout };
    }
    editOneOff({ id: uuid(), gym_id: state.gymId, scheduled_for: source.day, note: source.note || "", workout: copyFor(source.workout, machine) });
  }));
  $$("[data-open-program]").forEach((b) => (b.onclick = () => {
    state.page = "programs";
    state.program = structuredClone(state.programs.find((p) => p.id === b.dataset.openProgram));
    render();
    $(`#week-${b.dataset.week}`)?.scrollIntoView({ behavior: "smooth" });
  }));
}

function editOneOff(item) {
  openDialog({
    title: "Losse training",
    body: `<div class="fields">
        <label>Datum <input type="date" id="oneoff-date" value="${item.scheduled_for}"></label>
      </div>
      <label style="margin-top:12px">Toelichting voor de leden <textarea id="oneoff-note">${esc(item.note)}</textarea></label>
      <h3>Workout</h3><div id="wf"></div>`,
    onOpen: (root) => mountWorkoutForm($("#wf", root), item.workout),
    saveLabel: "Publiceer",
    onSave: async (root) => {
      const row = {
        id: item.id, gym_id: state.gymId, note: $("#oneoff-note", root).value.trim(),
        scheduled_for: $("#oneoff-date", root).value, workout: readWorkoutForm($("#wf", root)),
      };
      await run(db.from("gym_workouts").upsert(row), "Training gepubliceerd");
      await loadGym();
    },
  });
}

/** Members join with this code in the app; changing it doesn't affect existing members. */
function editJoinCode() {
  openDialog({
    title: "Code voor leden",
    body: `<label>Code <input id="join-code" value="${esc(gym().join_code)}" maxlength="16" style="text-transform:uppercase"></label>
      <p class="muted small">Nieuwe leden vullen deze code in de app in bij Account → Sportschool toevoegen. 4–16 letters of cijfers.
      Bestaande leden blijven gewoon lid.</p>`,
    onSave: async (root) => {
      const code = $("#join-code", root).value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4,16}$/.test(code)) {
        toast("Gebruik 4 tot 16 letters of cijfers, zonder spaties.", true);
        throw new Error("invalid code");
      }
      const { error } = await db.from("gyms").update({ join_code: code }).eq("id", state.gymId);
      if (error) {
        toast(error.code === "23505" ? "Deze code is al in gebruik door een andere sportschool." : error.message, true);
        throw error;
      }
      gym().join_code = code;
      toast("Code gewijzigd");
      renderPlanning();
    },
  });
}

// MARK: Programs

function renderPrograms() {
  $("#main").innerHTML = `
    <div class="row"><h1>Programma's</h1><span class="spacer"></span>
      <button id="new-program">+ Leeg programma</button>
      <button class="primary" id="from-template">Uit sjabloon</button>
    </div>
    <p class="muted">Programma's van meerdere weken. Leden zien automatisch de trainingen van de lopende week.</p>
    <div class="grid">${state.programs.map((p) => `
      <div class="card stack">
        <div><strong>${esc(p.name)}</strong><div class="muted small">${programStatus(p)} · ${p.sessions.length} trainingen in ${p.weeks} weken</div>
        <div class="muted small">Start ${parseDay(p.start_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}</div></div>
        <div class="row"><button data-open="${p.id}">Openen</button><span class="spacer"></span>${programCopySelect(p.id)}</div>
      </div>`).join("") || `<p class="muted">Nog geen programma's.</p>`}
    </div>`;
  $("#new-program").onclick = () => {
    state.program = { id: uuid(), gym_id: state.gymId, name: "Nieuw programma", start_date: dayString(addDays(monday(new Date()), 7)), weeks: 8, sessions: [], isNew: true };
    renderProgramEditor();
  };
  $("#from-template").onclick = chooseTemplate;
  $$("[data-open]").forEach((b) => (b.onclick = () => {
    state.program = structuredClone(state.programs.find((p) => p.id === b.dataset.open));
    renderProgramEditor();
  }));
  bindProgramCopy((id) => state.programs.find((p) => p.id === id));
}

/** "Kopieer voor…" for a whole program: every training converted for one machine. */
function programCopySelect(id) {
  return `<select class="copy-for" data-copy-program="${id}" title="Het hele programma voor één apparaat">
    <option value="">Kopieer voor…</option>
    ${MACHINES.map((m) => `<option value="${m}">${MACHINE_ICON[m]} ${MACHINE_LABEL[m]}</option>`).join("")}
  </select>`;
}

function bindProgramCopy(find) {
  $$("[data-copy-program]").forEach((select) => (select.onchange = () => {
    const machine = select.value;
    select.value = "";
    if (!machine) return;
    state.program = copyProgramFor(find(select.dataset.copyProgram), machine);
    renderProgramEditor();
    toast(`Kopie voor ${MACHINE_LABEL[machine]}: controleer en publiceer`);
  }));
}

function chooseTemplate() {
  openDialog({
    title: "Programma uit sjabloon",
    body: `<div class="stack">
      ${Object.entries(TEMPLATES).map(([key, t], i) => `
        <label class="card" style="display:flex;gap:10px;align-items:flex-start;color:var(--text)">
          <input type="radio" name="template" value="${key}" ${i === 0 ? "checked" : ""}>
          <span><strong>${t.name}</strong><br><span class="muted">${t.summary}</span></span>
        </label>`).join("")}
      <div class="fields">
        <label>Machine <select id="tpl-machine">${MACHINES.map((m) => `<option value="${m}">${MACHINE_LABEL[m]}</option>`).join("")}</select></label>
        <label>Start (maandag) <input type="date" id="tpl-start" value="${dayString(addDays(monday(new Date()), 7))}"></label>
      </div></div>`,
    onOpen: (root) => {
      const update = () => ($("#tpl-machine", root).disabled = !TEMPLATES[$("input[name=template]:checked", root).value].needsMachine);
      $$("input[name=template]", root).forEach((r) => (r.onchange = update));
      update();
    },
    saveLabel: "Maak programma",
    onSave: (root) => {
      const key = $("input[name=template]:checked", root).value;
      state.program = { ...programFromTemplate(key, state.gymId, $("#tpl-machine", root).value, parseDay($("#tpl-start", root).value)), isNew: true };
      renderProgramEditor();
    },
  });
}

function renderProgramEditor() {
  const p = state.program;
  const progression = state.progression ??= { percent: 5, seconds: -1 };
  $("#main").innerHTML = `
    <div class="row"><button class="link" id="back">← Programma's</button></div>
    <div class="row"><h1>${esc(p.name)}</h1><span class="spacer"></span>
      ${p.isNew ? "" : `${programCopySelect(p.id)}<button class="danger" id="delete-program">Verwijderen</button>`}
      <button class="primary" id="save-program">${p.isNew ? "Publiceer" : "Opslaan"}</button>
    </div>
    <div class="card stack">
      <div class="fields">
        <label style="grid-column: span 2">Naam <input id="p-name" value="${esc(p.name)}"></label>
        <label>Start (maandag) <input type="date" id="p-start" value="${p.start_date}"></label>
        <label>Weken <input type="number" id="p-weeks" min="1" max="16" value="${p.weeks}"></label>
      </div>
      <div class="fields">
        <label>Opbouw % vermogen per week <input type="number" id="prog-percent" step="0.1" value="${progression.percent}"></label>
        <label>Opbouw vaste pace (s per week) <input type="number" id="prog-seconds" step="1" value="${progression.seconds}"></label>
      </div>
      <p class="muted small">Bij "Kopieer naar alle volgende weken" gaan percentages elke week omhoog met de opbouw (bijv. 90% → 95% → 100%) en veranderen vaste paces met de seconden (negatief = sneller).</p>
    </div>
    ${Array.from({ length: p.weeks }, (_, i) => i + 1).map((week) => {
      const sessions = sessionsInWeek(p, week);
      const start = addDays(parseDay(p.start_date), (week - 1) * 7);
      return `<div class="card week" id="week-${week}" style="margin-top:14px">
        <div class="week-head"><strong>Week ${week}</strong>
          <span class="muted small">${start.toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}${programWeek(p) === week ? " · deze week" : ""}</span>
          <span class="spacer"></span>
          <button class="link" data-add="${week}">+ Training</button>
          ${week < p.weeks ? `<button class="link" data-copy-all="${week}" ${sessions.length ? "" : "disabled"}>Kopieer naar alle volgende weken</button>` : ""}
        </div>
        ${sessions.map((s) => `<div class="training">
          <div class="icon">${MACHINE_ICON[s.workout.machine]}</div>
          <div class="body"><div class="name">${WEEKDAYS[s.weekday - 1]} · ${esc(s.workout.name)}</div>
            <div class="meta">${MACHINE_LABEL[s.workout.machine]} · ${esc(summary(s.workout))}</div>
            ${s.note ? `<div class="meta">${esc(s.note)}</div>` : ""}</div>
          <button class="link" data-edit-session="${s.id}">Wijzig</button>
          <button class="link danger" data-delete-session="${s.id}">Verwijder</button>
        </div>`).join("") || `<p class="muted small">Geen trainingen.</p>`}
      </div>`;
    }).join("")}`;

  const readHeader = () => {
    p.name = $("#p-name").value.trim() || p.name;
    p.start_date = dayString(monday(parseDay($("#p-start").value)));
    p.weeks = Math.min(Math.max(Number($("#p-weeks").value) || 1, 1), 16);
    progression.percent = Number($("#prog-percent").value) || 0;
    progression.seconds = Number($("#prog-seconds").value) || 0;
  };
  $("#p-weeks").onchange = () => { readHeader(); renderProgramEditor(); };
  $("#p-start").onchange = () => { readHeader(); renderProgramEditor(); };
  $("#back").onclick = () => { state.program = null; renderPrograms(); };
  bindProgramCopy(() => { readHeader(); return p; });
  $("#save-program").onclick = async () => {
    readHeader();
    p.sessions = p.sessions.filter((s) => s.week <= p.weeks);
    const { isNew, ...row } = p;
    await run(db.from("gym_programs").upsert(row), isNew ? "Programma gepubliceerd" : "Programma opgeslagen");
    state.program = null;
    await loadGym();
    renderPrograms();
  };
  $("#delete-program")?.addEventListener("click", async () => {
    if (!confirm(`"${p.name}" verwijderen? Leden zien de trainingen dan niet meer.`)) return;
    await run(db.from("gym_programs").delete().eq("id", p.id), "Programma verwijderd");
    state.program = null;
    await loadGym();
    renderPrograms();
  });
  $$("[data-add]").forEach((b) => (b.onclick = () => {
    readHeader();
    const week = Number(b.dataset.add);
    const used = new Set(sessionsInWeek(p, week).map((s) => s.weekday));
    const weekday = [1, 3, 5, 2, 4, 6, 7].find((d) => !used.has(d)) ?? 1;
    const last = sessionsInWeek(p, week).at(-1)?.workout ?? standard("rower")[7];
    editSession({ id: uuid(), week, weekday, note: "", workout: fresh(last) }, true);
  }));
  $$("[data-edit-session]").forEach((b) => (b.onclick = () => { readHeader(); editSession(structuredClone(p.sessions.find((s) => s.id === b.dataset.editSession))); }));
  $$("[data-delete-session]").forEach((b) => (b.onclick = () => {
    readHeader();
    p.sessions = p.sessions.filter((s) => s.id !== b.dataset.deleteSession);
    renderProgramEditor();
  }));
  $$("[data-copy-all]").forEach((b) => (b.onclick = () => {
    readHeader();
    for (let w = Number(b.dataset.copyAll); w < p.weeks; w++) copyWeek(p, w, progression.seconds, progression.percent);
    renderProgramEditor();
    toast("Doorgekopieerd met opbouw");
  }));
}

function editSession(session, isNew = false) {
  const p = state.program;
  openDialog({
    title: `Week ${session.week} · training`,
    body: `<div class="fields">
        <label>Dag <select id="s-day">${WEEKDAYS.map((d, i) => `<option value="${i + 1}" ${session.weekday === i + 1 ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      </div>
      <label style="margin-top:12px">Toelichting voor de leden <textarea id="s-note">${esc(session.note)}</textarea></label>
      <h3>Workout</h3><div id="wf"></div>`,
    onOpen: (root) => mountWorkoutForm($("#wf", root), session.workout),
    saveLabel: isNew ? "Toevoegen" : "Bewaar",
    onSave: (root) => {
      session.weekday = Number($("#s-day", root).value);
      session.note = $("#s-note", root).value.trim();
      session.workout = readWorkoutForm($("#wf", root));
      p.sessions = p.sessions.filter((s) => s.id !== session.id).concat(session);
      renderProgramEditor();
    },
  });
}

// MARK: Workout form

/** Renders an editable workout into `root`; read it back with `readWorkoutForm`. */
function mountWorkoutForm(root, initial) {
  root.workout = structuredClone(initial);
  const draw = () => {
    const w = root.workout;
    const isDistance = w.kind === "distance" || w.kind === "distanceIntervals";
    const isInterval = w.kind === "distanceIntervals" || w.kind === "timeIntervals";
    root.innerHTML = `
      <div class="fields">
        <label style="grid-column: span 2">Kies uit standaard
          <select data-k="pick"><option value="">— zelf samenstellen —</option>
            ${MACHINES.map((m) => `<optgroup label="Standaard ${MACHINE_LABEL[m]}">${standard(m).map((s, i) => `<option value="${m}:${i}">${esc(s.name)}</option>`).join("")}</optgroup>`).join("")}
          </select></label>
      </div>
      <div class="fields" style="margin-top:12px">
        <label style="grid-column: span 2">Naam <input data-k="name" value="${esc(w.name)}"></label>
        <label>Machine <select data-k="machine">${MACHINES.map((m) => `<option value="${m}" ${w.machine === m ? "selected" : ""}>${MACHINE_LABEL[m]}</option>`).join("")}</select></label>
        <label>Type <select data-k="kind">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${w.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
      </div>
      ${w.kind === "custom" ? customRows(w) : `
      <div class="fields" style="margin-top:12px">
        ${isDistance ? `<label>Afstand (m) <input type="number" data-k="distance" min="100" step="100" value="${w.distance}"></label>`
                     : `<label>Tijd (m:ss) <input data-k="duration" value="${clock(w.duration)}"></label>`}
        ${isInterval ? `<label>Aantal <input type="number" data-k="intervalCount" min="1" max="30" value="${w.intervalCount}"></label>
                        <label>Rust (m:ss) <input data-k="rest" value="${clock(w.rest)}"></label>` : ""}
        ${targetFields(w, "")}
      </div>`}
      <p class="muted small" style="margin-top:12px">${esc(summary(w))}</p>`;

    $$("[data-k], [data-i]", root).forEach((input) => (input.onchange = () => { readInto(root); draw(); }));
    $("[data-k=pick]", root).onchange = (event) => {
      if (!event.target.value) return;
      const [machine, index] = event.target.value.split(":");
      root.workout = fresh(standard(machine)[Number(index)]);
      draw();
    };
    $("[data-add-interval]", root)?.addEventListener("click", () => {
      readInto(root);
      const last = root.workout.intervals.at(-1);
      root.workout.intervals.push(last ? { ...last, id: uuid() } : interval({ targetPercent: 80 }));
      draw();
    });
    $$("[data-remove-interval]", root).forEach((b) => (b.onclick = () => {
      readInto(root);
      root.workout.intervals.splice(Number(b.dataset.removeInterval), 1);
      draw();
    }));
  };
  draw();
}

function targetFields(item, prefix) {
  const mode = item.targetPercent != null ? "percent" : item.targetPace != null ? "pace" : "none";
  const value = mode === "percent" ? item.targetPercent : mode === "pace" ? clock(item.targetPace) : "";
  return `<label>Target <select data-${prefix ? "i" : "k"}="${prefix}tmode">
      <option value="none" ${mode === "none" ? "selected" : ""}>Geen</option>
      <option value="percent" ${mode === "percent" ? "selected" : ""}>% benchmark</option>
      <option value="pace" ${mode === "pace" ? "selected" : ""}>Vaste pace</option></select></label>
    ${mode === "none" ? "" : `<label>${mode === "percent" ? "% vermogen" : "Pace (m:ss)"}
      <input data-${prefix ? "i" : "k"}="${prefix}tvalue" ${mode === "percent" ? `type="number" step="0.5"` : ""} value="${value}"></label>`}`;
}

function customRows(w) {
  return `<div style="margin-top:12px">${w.intervals.map((i, n) => `
    <div class="interval-row" data-row="${n}">
      <div class="n">${n + 1}</div>
      <label>Op <select data-i="type"><option value="time" ${i.usesDistance ? "" : "selected"}>Tijd</option><option value="distance" ${i.usesDistance ? "selected" : ""}>Afstand</option></select></label>
      <label>${i.usesDistance ? "Afstand (m)" : "Tijd (m:ss)"} <input data-i="value" value="${i.usesDistance ? i.distance : clock(i.duration)}"></label>
      <label>Rust erna <input data-i="rest" value="${clock(i.rest)}"></label>
      ${targetFields(i, "x")}
      <button class="link danger" data-remove-interval="${n}" title="Verwijder">✕</button>
    </div>`).join("")}
    <button class="link" data-add-interval>+ Interval</button></div>`;
}

/** Applies the form's inputs to `root.workout`. */
function readInto(root) {
  const w = root.workout;
  const value = (key) => $(`[data-k=${key}]`, root)?.value;
  const applyTarget = (item, mode, raw) => {
    delete item.exactPace;
    if (mode === "percent") { item.targetPercent = Math.round((Number(raw) || 80) * 10) / 10; delete item.targetPace; }
    else if (mode === "pace") { item.targetPace = Math.round(parseClock(raw) || 120); delete item.targetPercent; }
    else { delete item.targetPercent; delete item.targetPace; }
  };
  if (value("name") != null) w.name = value("name").trim() || w.name;
  if (value("machine")) w.machine = value("machine");
  if (value("kind")) {
    const kind = value("kind");
    if (kind === "custom" && w.kind !== "custom" && !w.intervals.length) {
      w.intervals = [interval({ duration: 240, rest: 90, targetPercent: 74 }), interval({ duration: 180, rest: 90, targetPercent: 78 })];
    }
    w.kind = kind;
  }
  if (value("distance") != null) w.distance = Math.max(100, Math.round(Number(value("distance")) || 2000));
  if (value("duration") != null) w.duration = Math.max(10, Math.round(parseClock(value("duration")) || 600));
  if (value("intervalCount") != null) w.intervalCount = Math.min(Math.max(Math.round(Number(value("intervalCount")) || 1), 1), 30);
  if (value("rest") != null) w.rest = Math.max(0, Math.round(parseClock(value("rest")) ?? 60));
  if (value("tmode") != null) {
    const mode = value("tmode");
    const previous = w.targetPercent != null ? "percent" : w.targetPace != null ? "pace" : "none";
    applyTarget(w, mode, mode === previous ? value("tvalue") : mode === "percent" ? 80 : "2:00");
  }
  $$("[data-row]", root).forEach((row) => {
    const i = w.intervals[Number(row.dataset.row)];
    const field = (key) => $(`[data-i=${key}]`, row)?.value;
    const usesDistance = field("type") === "distance";
    if (usesDistance !== i.usesDistance) {
      i.usesDistance = usesDistance;
    } else if (usesDistance) {
      i.distance = Math.max(100, Math.round(Number(field("value")) || 500));
    } else {
      i.duration = Math.max(10, Math.round(parseClock(field("value")) || 60));
    }
    i.rest = Math.max(0, Math.round(parseClock(field("rest")) ?? 60));
    const mode = field("xtmode");
    const previous = i.targetPercent != null ? "percent" : i.targetPace != null ? "pace" : "none";
    applyTarget(i, mode, mode === previous ? field("xtvalue") : mode === "percent" ? 80 : "2:00");
  });
}

function readWorkoutForm(root) {
  readInto(root);
  return structuredClone(root.workout);
}

// MARK: Leaderboard

/** Running programs first, then upcoming, then finished (newest first). */
function leaderboardPrograms() {
  const order = (p) => (programWeek(p) ? 0 : parseDay(p.start_date) > new Date() ? 1 : 2);
  return [...state.programs].sort((a, b) => order(a) - order(b) || b.start_date.localeCompare(a.start_date));
}

/** Trainings of the last four weeks up to today, newest first, with a stable key. */
function leaderboardTrainings() {
  const today = new Date();
  const end = addDays(new Date(today.getFullYear(), today.getMonth(), today.getDate()), 1);
  return scheduled(addDays(end, -29), end).reverse().map((item) => ({
    ...item, key: item.oneOff ? item.oneOff.id : item.session.id,
  }));
}

async function renderLeaderboard() {
  const b = state.board;
  const segmented = (key, options) => `<div class="segmented">${options.map(([value, label]) =>
    `<button data-${key}="${value}" class="${b[key] === value ? "active" : ""}">${label}</button>`).join("")}</div>`;
  const programs = leaderboardPrograms();
  const trainings = leaderboardTrainings();
  if (!programs.some((p) => p.id === b.program)) b.program = programs[0]?.id ?? null;
  if (!trainings.some((t) => t.key === b.training)) b.training = trainings[0]?.key ?? null;
  const dateLabel = (date) => date.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });

  const picker = b.kind === "programs"
    ? (programs.length ? `<select id="pick">${programs.map((p) =>
        `<option value="${p.id}" ${p.id === b.program ? "selected" : ""}>${esc(p.name)} · ${programStatus(p)}</option>`).join("")}</select>` : "")
    : (trainings.length ? `<select id="pick">${trainings.map((t) =>
        `<option value="${t.key}" ${t.key === b.training ? "selected" : ""}>${dateLabel(t.date)} · ${esc(t.workout.name)} · ${MACHINE_LABEL[t.workout.machine]}</option>`).join("")}</select>` : "");

  $("#main").innerHTML = `
    <div class="row"><h1>Leaderboard</h1><span class="spacer"></span><button class="danger" id="reset">Leegmaken</button></div>
    <div class="row">${segmented("kind", [["programs", "Programma's"], ["trainings", "Trainingen"]])} ${picker}</div>
    <div class="card" style="margin-top:14px" id="board"><p class="muted">Laden…</p></div>`;

  $$("[data-kind]").forEach((button) => (button.onclick = () => { b.kind = button.dataset.kind; renderLeaderboard(); }));
  $("#pick") && ($("#pick").onchange = (e) => { b[b.kind === "programs" ? "program" : "training"] = e.target.value; renderLeaderboard(); });
  $("#reset").onclick = async () => {
    if (!confirm(`Leaderboard van ${gym().name} leegmaken? Alle ranglijsten beginnen opnieuw vanaf nu; resultaten blijven bewaard.`)) return;
    await run(db.rpc("reset_leaderboard", { gym: state.gymId }), "Leaderboard leeggemaakt");
    renderLeaderboard();
  };

  const medal = (rank) => ["🥇", "🥈", "🥉"][rank] ?? rank + 1;
  if (b.kind === "programs") {
    const program = programs.find((p) => p.id === b.program);
    if (!program) return ($("#board").innerHTML = `<p class="muted">Nog geen programma's. Maak er een bij Programma's.</p>`);
    const rows = await run(db.rpc("leaderboard_program", { gym: state.gymId, program: program.id }));
    $("#board").innerHTML = (rows?.length ? `<table><tr><th></th><th>Naam</th><th class="num">Meters</th><th class="num">Trainingen</th></tr>
      ${rows.map((r, i) => `<tr><td class="rank">${medal(i)}</td><td>${esc(r.name)}</td>
        <td class="num"><strong>${Math.round(r.meters).toLocaleString("nl-NL")} m</strong></td><td class="num">${r.workouts}</td></tr>`).join("")}</table>`
      : `<p class="muted">Nog geen resultaten voor ${esc(program.name)}.</p>`)
      + `<p class="muted small">Alle meters van de trainingen uit dit programma, op het geplande apparaat.</p>`;
  } else {
    const item = trainings.find((t) => t.key === b.training);
    if (!item) return ($("#board").innerHTML = `<p class="muted">Geen trainingen in de afgelopen vier weken.</p>`);
    const w = item.workout;
    const byTime = w.kind === "distance" || w.kind === "distanceIntervals" || (w.kind === "custom" && w.intervals.every((i) => i.usesDistance));
    const rows = await run(db.rpc("leaderboard_training", { gym: state.gymId, workout: w.id, machine_name: w.machine })) ?? [];
    const best = Object.values(rows.reduce((acc, r) => {
      const old = acc[r.member];
      if (!old || (byTime ? r.time_seconds < old.time_seconds : r.distance_meters > old.distance_meters)) acc[r.member] = r;
      return acc;
    }, {})).sort((x, y) => (byTime ? x.time_seconds - y.time_seconds : y.distance_meters - x.distance_meters));
    const unit = paceDistance(w.machine);
    $("#board").innerHTML = (best.length ? `<table><tr><th></th><th>Naam</th><th class="num">${byTime ? "Tijd" : "Meters"}</th><th class="num">Pace</th><th class="num">Datum</th></tr>
      ${best.map((r, i) => `<tr><td class="rank">${medal(i)}</td><td>${esc(r.name)}</td>
        <td class="num"><strong>${byTime ? clockTenths(r.time_seconds) : `${Math.round(r.distance_meters).toLocaleString("nl-NL")} m`}</strong></td>
        <td class="num">${r.distance_meters > 0 ? clockTenths(r.time_seconds / r.distance_meters * unit) : "–"}/${unit}m</td>
        <td class="num muted">${new Date(r.date).toLocaleDateString("nl-NL")}</td></tr>`).join("")}</table>`
      : `<p class="muted">Nog geen resultaten voor deze training.</p>`)
      + `<p class="muted small">${esc(summary(w))} · ${byTime ? "snelste tijd telt" : "meeste meters telt"}.</p>`;
  }
}

// MARK: Dialog

function openDialog({ title, body, onOpen, onSave, saveLabel = "Bewaar" }) {
  const dialog = $("#dialog");
  dialog.innerHTML = `<div class="head"><h3>${esc(title)}</h3><button class="link" data-close>Sluit</button></div>
    <div class="content">${body}</div>
    <div class="foot"><button data-close>Annuleer</button><button class="primary" data-save>${esc(saveLabel)}</button></div>`;
  onOpen?.(dialog);
  $$("[data-close]", dialog).forEach((b) => (b.onclick = () => dialog.close()));
  $("[data-save]", dialog).onclick = async () => {
    try {
      await onSave(dialog);
      dialog.close();
    } catch {
      // The error was shown already; keep the dialog open.
    }
  };
  dialog.showModal();
}

start();
