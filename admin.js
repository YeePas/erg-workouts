import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import {
  MACHINE_LABEL, MACHINE_ICON, WEEKDAYS, summary, sessionDate, programStatus, programWeek,
  parseDay, dayString, monday, addDays,
} from "./model.js";

// Same project and key as the app. Everything here goes through admin-only functions
// (supabase/admin.sql): without an admin account the database returns nothing.
const SUPABASE_URL = "https://gsxdogmmpxnuspuohbhw.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdzeGRvZ21tcHhudXNwdW9oYmh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxMzI3NTIsImV4cCI6MjEwNzcwODc1Mn0.LpGSq5CSV6U5clxCXG6CK1ug7dCSQkGhrQ1KVUnDtoU";
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const date = (value, withTime = true) => value
  ? new Date(value).toLocaleString("nl-NL", withTime
    ? { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" })
  : "–";
const MACHINE = MACHINE_LABEL;

const state = {
  user: null,
  page: location.hash.slice(1) || "overview",
  logs: { search: "", errors: false, rows: 500 },
  userFilters: null,
};

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
  $$("#nav button").forEach((button) => (button.onclick = () => go(button.dataset.page)));
  window.onhashchange = () => {
    state.page = location.hash.slice(1) || "overview";
    if (state.user && !$("#nav").hidden) render();
  };
  load();
}

function go(page) {
  state.page = page;
  history.replaceState(null, "", `#${page}`);
  render();
}

async function load() {
  renderAccount();
  if (!state.user) return renderLogin();
  $("#nav").hidden = true;
  const { data: isAdmin, error } = await db.rpc("is_admin_account");
  if (error || !isAdmin) {
    $("#main").innerHTML = `<div class="card login stack"><h2>Geen toegang</h2>
      <p class="muted">${error ? "Draai eerst supabase/admin-mfa.sql." : "Dit account is geen beheerder. Draai supabase/admin.sql en controleer het e-mailadres bovenin dat bestand."}</p></div>`;
    return;
  }
  // The database only answers admin requests from a session with a second factor (aal2).
  const { data: level } = await db.auth.mfa.getAuthenticatorAssuranceLevel();
  if (level?.currentLevel !== "aal2") {
    const { data: factors } = await db.auth.mfa.listFactors();
    const totp = factors?.totp?.find((f) => f.status === "verified");
    return totp ? renderMfaCode(totp.id) : renderMfaSetup();
  }
  $("#nav").hidden = false;
  render();
}

// MARK: Tweestapsverificatie

/** First time: scan a QR code in an authenticator app and confirm with a code. */
async function renderMfaSetup() {
  $("#main").innerHTML = `<div class="card login stack"><h2>Tweestapsverificatie instellen</h2><p class="muted">Laden…</p></div>`;
  // Leftovers from an earlier, unfinished setup would block a new one.
  const { data: factors } = await db.auth.mfa.listFactors();
  for (const factor of factors?.all ?? []) {
    if (factor.status === "unverified") await db.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "Erg Workouts beheer" });
  if (error) {
    $("#main").innerHTML = `<div class="card login stack"><h2>Tweestapsverificatie</h2>
      <p class="error">${esc(error.message)}</p>
      <p class="muted small">Staat TOTP aan in Supabase → Authentication → Multi-Factor?</p></div>`;
    return;
  }
  $("#main").innerHTML = `
    <form class="card login stack" id="mfa">
      <h2>Tweestapsverificatie instellen</h2>
      <p class="muted">Het beheer is alleen bereikbaar met een tweede stap. Scan de QR-code met een authenticator-app (Apple Wachtwoorden, Google Authenticator, 1Password) en vul de code van 6 cijfers in.</p>
      <img class="qr" src="${data.totp.qr_code}" alt="QR-code voor je authenticator-app">
      <details><summary class="small">Kan niet scannen? Gebruik deze sleutel</summary><p class="mono">${esc(data.totp.secret)}</p></details>
      <label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
      <button class="primary" type="submit">Bevestigen</button>
      <p class="error small" id="mfa-error"></p>
    </form>`;
  bindMfaForm(data.id);
}

/** Every sign-in: the code from the authenticator app. */
function renderMfaCode(factorId) {
  $("#main").innerHTML = `
    <form class="card login stack" id="mfa">
      <h2>Tweestapsverificatie</h2>
      <p class="muted">Vul de code van 6 cijfers uit je authenticator-app in.</p>
      <label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required autofocus></label>
      <button class="primary" type="submit">Inloggen</button>
      <p class="error small" id="mfa-error"></p>
    </form>`;
  bindMfaForm(factorId);
}

function bindMfaForm(factorId) {
  $("#mfa").onsubmit = async (event) => {
    event.preventDefault();
    const code = String(new FormData(event.target).get("code")).replace(/\s/g, "");
    const { error } = await db.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      $("#mfa-error").textContent = error.message.includes("Invalid") ? "Onjuiste code, probeer het opnieuw." : error.message;
      return;
    }
    load();
  };
}

function renderAccount() {
  const el = $("#account");
  if (!state.user) return (el.innerHTML = "");
  el.innerHTML = `<span class="small">${esc(state.user.email)}</span> <button class="link" id="logout">Uitloggen</button>`;
  $("#logout").onclick = () => db.auth.signOut();
}

function renderLogin() {
  $("#nav").hidden = true;
  $("#main").innerHTML = `
    <form class="card login stack" id="login">
      <h1>Beheer</h1>
      <p class="muted">Alleen voor de beheerder van Erg Workouts.</p>
      <label>E-mail <input name="login" autocomplete="username" required></label>
      <label>Wachtwoord <input name="password" type="password" autocomplete="current-password" required></label>
      <button class="primary" type="submit">Inloggen</button>
      <p class="error small" id="login-error"></p>
    </form>`;
  $("#login").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const login = String(form.get("login")).trim();
    const email = login.includes("@") ? login : `${login.toLowerCase()}@ergworkouts.test`;
    const { error } = await db.auth.signInWithPassword({ email, password: String(form.get("password")) });
    if (error) $("#login-error").textContent = error.message === "Invalid login credentials" ? "Onjuiste e-mail of wachtwoord." : error.message;
  };
}

function render() {
  $$("#nav button").forEach((b) => b.classList.toggle("active", b.dataset.page === state.page));
  const pages = { overview: renderOverview, issues: renderIssues, logs: renderLogs, gyms: renderGyms, users: renderUsers, settings: renderSettings };
  (pages[state.page] ?? renderOverview)();
}

// MARK: Overzicht

async function renderOverview() {
  $("#main").innerHTML = `<h1>Overzicht</h1><p class="muted">Laden…</p>`;
  const s = await run(db.rpc("admin_stats"));
  const tile = (label, value, hint = "") => `<div class="card stat"><div class="muted small">${label}</div>
    <div class="value">${value}</div>${hint ? `<div class="muted small">${hint}</div>` : ""}</div>`;
  const weeks = s.per_week ?? [];
  const max = Math.max(1, ...weeks.map((w) => w.results));
  $("#main").innerHTML = `
    <h1>Overzicht</h1>
    <div class="stats">
      ${tile("Gebruikers", s.users, `${s.new_users_30d} nieuw in 30 dagen`)}
      ${tile("Actief deze week", s.active_7d, `${s.active_30d} in 30 dagen`)}
      ${tile("Trainingen deze week", s.results_7d, `${s.results_30d} in 30 dagen`)}
      ${tile("Meters in 30 dagen", Math.round(s.meters_30d).toLocaleString("nl-NL"))}
      ${tile("Sportscholen", s.gyms)}
      ${tile("Open meldingen", s.open_issues, `<a href="#issues" data-go="issues">bekijken</a>`)}
    </div>
    <div class="grid" style="margin-top:14px">
      <div class="card stack"><h3>Trainingen per week</h3>
        ${weeks.length ? `<div class="bars">${weeks.map((w) => `<div class="bar-row">
          <span class="muted small">${new Date(w.week).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}</span>
          <div class="bar"><span style="width:${(w.results / max) * 100}%"></span></div>
          <span class="small">${w.results} · ${w.users} pers.</span></div>`).join("")}</div>` : `<p class="muted">Nog geen trainingen.</p>`}
      </div>
      <div class="card stack"><h3>Per apparaat (30 dagen)</h3>
        ${Object.keys(s.per_machine_30d ?? {}).length ? `<table>${Object.entries(s.per_machine_30d).map(([m, n]) =>
          `<tr><td>${MACHINE[m] ?? esc(m)}</td><td class="num">${n}</td></tr>`).join("")}</table>` : `<p class="muted">Nog geen trainingen.</p>`}
        <p class="muted small">Logregels in de database: ${Number(s.logs).toLocaleString("nl-NL")}</p>
      </div>
    </div>`;
  $$("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go(a.dataset.go); }));
}

// MARK: Meldingen

async function renderIssues() {
  $("#main").innerHTML = `<h1>Meldingen</h1><p class="muted">Laden…</p>`;
  const issues = await run(db.rpc("admin_issues"));
  const label = { nieuw: "Nieuw", bezig: "Bezig", opgelost: "Opgelost" };
  $("#main").innerHTML = `
    <div class="row"><h1>Meldingen</h1><span class="spacer"></span><button id="refresh">Vernieuwen</button></div>
    <p class="muted">Meldingen via "Probleem melden" in de app en op de website.</p>
    ${issues.length ? issues.map((i) => `
      <div class="card stack issue ${i.status}" data-id="${i.id}">
        <div class="row"><span class="tag ${i.status === "nieuw" ? "orange" : ""}">${label[i.status]}</span>
          <strong>${esc(i.display_name || i.email || "Zonder account")}</strong>
          <span class="muted small">${esc(i.email ?? "")} · ${date(i.created_at)} · ${i.source === "web" ? "website" : "app"}
            ${i.app_version ? ` · versie ${esc(i.app_version)}` : ""}${i.device ? ` · ${esc(i.device)}` : ""}</span></div>
        <p class="message">${esc(i.message)}</p>
        ${i.logs ? `<details><summary class="small">Logboek (${i.logs.split("\n").length} regels)</summary><pre class="logs">${esc(i.logs)}</pre></details>` : ""}
        <div class="fields">
          <label>Status <select data-status>${Object.entries(label).map(([v, l]) => `<option value="${v}" ${v === i.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          <label style="grid-column: span 3">Notitie <input data-note value="${esc(i.admin_note ?? "")}" placeholder="Voor jezelf"></label>
        </div>
        <div class="row"><button class="primary" data-save>Opslaan</button><button class="link danger" data-delete>Verwijderen</button></div>
      </div>`).join("") : `<div class="card"><p class="muted">Geen meldingen.</p></div>`}`;
  $("#refresh").onclick = renderIssues;
  $$(".issue").forEach((card) => {
    const id = card.dataset.id;
    $("[data-save]", card).onclick = async () => {
      await run(db.from("issues").update({ status: $("[data-status]", card).value, admin_note: $("[data-note]", card).value, updated_at: new Date().toISOString() }).eq("id", id), "Opgeslagen");
      renderIssues();
    };
    $("[data-delete]", card).onclick = async () => {
      if (!confirm("Deze melding verwijderen?")) return;
      await run(db.from("issues").delete().eq("id", id), "Verwijderd");
      renderIssues();
    };
  });
}

// MARK: Logs

async function renderLogs() {
  const f = state.logs;
  $("#main").innerHTML = `
    <div class="row"><h1>Logs</h1><span class="spacer"></span><button class="danger" id="cleanup">Opruimen…</button></div>
    <form class="row card" id="filter">
      <input id="search" placeholder="Zoek in tekst, toestel of e-mail" value="${esc(f.search)}" style="flex:1; min-width:220px">
      <label class="check"><input type="checkbox" id="errors" ${f.errors ? "checked" : ""}> Alleen fouten</label>
      <select id="rows">${[200, 500, 2000].map((n) => `<option ${n === f.rows ? "selected" : ""}>${n}</option>`).join("")}</select>
      <button class="primary" type="submit">Zoeken</button>
    </form>
    <div class="card" style="margin-top:14px" id="log-table"><p class="muted">Laden…</p></div>`;
  $("#filter").onsubmit = (e) => {
    e.preventDefault();
    Object.assign(f, { search: $("#search").value.trim(), errors: $("#errors").checked, rows: Number($("#rows").value) });
    renderLogs();
  };
  $("#cleanup").onclick = async () => {
    const days = prompt("Logs ouder dan hoeveel dagen verwijderen?", "30");
    if (!days) return;
    const removed = await run(db.rpc("admin_cleanup_logs", { older_than_days: Number(days) }));
    toast(`${removed} logregels verwijderd`);
    renderLogs();
  };
  const rows = await run(db.rpc("admin_logs", { search: f.search || null, errors_only: f.errors, max_rows: f.rows }));
  $("#log-table").innerHTML = rows.length ? `<table class="log-rows"><tr><th>Tijd</th><th>Gebruiker / toestel</th><th>Melding</th></tr>
    ${rows.map((r) => `<tr><td class="nowrap muted small">${date(r.logged_at)}</td>
      <td class="small">${esc(r.email ?? "—")}<div class="muted">${esc(r.device)} · ${esc(r.app_version ?? "")}</div></td>
      <td class="mono ${/(fout|mislukt|error|failed|crash)/i.test(r.message) ? "error" : ""}">${esc(r.message)}</td></tr>`).join("")}</table>`
    : `<p class="muted">Geen logregels gevonden.</p>`;
}

// MARK: Sportscholen

async function renderGyms() {
  $("#main").innerHTML = `<h1>Sportscholen</h1><p class="muted">Laden…</p>`;
  const gyms = await run(db.rpc("admin_gyms"));
  $("#main").innerHTML = `
    <div class="row"><h1>Sportscholen</h1><span class="spacer"></span><button class="primary" id="new-gym">+ Nieuwe sportschool</button></div>
    <div class="card">${gyms.length ? `<table><tr><th>Naam</th><th>Code</th><th>Account</th><th class="num">Leden</th><th class="num">Trainingen</th><th class="num">Programma's</th><th class="num">Resultaten 30d</th><th></th></tr>
      ${gyms.map((g) => `<tr><td><strong>${esc(g.name)}</strong><div class="muted small">sinds ${date(g.created_at, false)}</div></td>
        <td class="mono">${esc(g.join_code)}</td><td class="small">${esc(g.account ?? "—")}</td>
        <td class="num">${g.members}</td><td class="num">${g.trainings}</td><td class="num">${g.programs}</td><td class="num">${g.results_30d}</td>
        <td class="nowrap"><button class="link" data-view="${g.id}">Bekijk</button><button class="link" data-edit="${g.id}">Wijzig</button><button class="link danger" data-delete="${g.id}">Verwijder</button></td></tr>`).join("")}</table>`
      : `<p class="muted">Nog geen sportscholen.</p>`}</div>`;

  $("#new-gym").onclick = () => openDialog({
    title: "Nieuwe sportschool",
    body: `<div class="stack">
      <div class="fields">
        <label>Naam <input id="g-name" placeholder="CrossFit Voorbeeld"></label>
        <label>Code voor leden <input id="g-code" placeholder="VOORBEELD"></label>
      </div>
      <div class="fields">
        <label>Inlognaam of e-mail <input id="g-login" placeholder="voorbeeld"></label>
        <label>Wachtwoord <input id="g-password" type="text" placeholder="minstens 8 tekens"></label>
      </div>
      <p class="muted small">Een inlognaam zonder @ wordt <em>naam@ergworkouts.test</em>. Bestaat het account al, dan wordt het het sportschoolaccount en blijft het wachtwoord ongewijzigd. Geef het wachtwoord zelf door aan de sportschool.</p>
    </div>`,
    saveLabel: "Aanmaken",
    onSave: async (root) => {
      await run(db.rpc("admin_create_gym", {
        gym_name: $("#g-name", root).value, code: $("#g-code", root).value,
        login: $("#g-login", root).value, password: $("#g-password", root).value,
      }), "Sportschool aangemaakt");
      renderGyms();
    },
  });
  $$("[data-view]").forEach((b) => (b.onclick = () => renderGymDetail(gyms.find((x) => x.id === b.dataset.view))));
  $$("[data-edit]").forEach((b) => (b.onclick = () => {
    const g = gyms.find((x) => x.id === b.dataset.edit);
    openDialog({
      title: g.name,
      body: `<div class="fields"><label>Naam <input id="g-name" value="${esc(g.name)}"></label>
        <label>Code voor leden <input id="g-code" value="${esc(g.join_code)}"></label></div>
        <p class="muted small">Een nieuwe code geldt alleen voor nieuwe leden; bestaande leden blijven lid.</p>`,
      onSave: async (root) => {
        await run(db.rpc("admin_update_gym", { gym: g.id, gym_name: $("#g-name", root).value, code: $("#g-code", root).value }), "Opgeslagen");
        renderGyms();
      },
    });
  }));
  $$("[data-delete]").forEach((b) => (b.onclick = async () => {
    const g = gyms.find((x) => x.id === b.dataset.delete);
    if (prompt(`Typ de naam om ${g.name} te verwijderen. Trainingen, programma's en lidmaatschappen gaan verloren; accounts en resultaten van leden blijven.`) !== g.name) return;
    await run(db.rpc("admin_delete_gym", { gym: g.id }), "Sportschool verwijderd");
    renderGyms();
  }));
}

/** Read-only view of one gym's one-off trainings and programs, to help the gym. */
async function renderGymDetail(g) {
  $("#main").innerHTML = `<div class="row"><button class="link" id="back">← Sportscholen</button></div><h1>${esc(g.name)}</h1><p class="muted">Laden…</p>`;
  $("#back").onclick = renderGyms;
  const today = new Date();
  const from = addDays(monday(today), -14);
  const to = addDays(monday(today), 6 * 7 - 1);
  const [workouts, programs] = await Promise.all([
    run(db.rpc("admin_gym_workouts", { gym: g.id, from_date: dayString(from), to_date: dayString(to) })),
    run(db.rpc("admin_gym_programs", { gym: g.id })),
  ]);

  const dayLabel = (date) => `${WEEKDAYS[(date.getDay() + 6) % 7]} ${date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}`;
  const training = (w, label, note) => `<div class="training">
    <div class="icon" title="${MACHINE_LABEL[w.machine]}">${MACHINE_ICON[w.machine]}</div>
    <div class="body"><div class="name">${label ? `<span class="muted">${esc(label)} · </span>` : ""}${esc(w.name)}</div>
      <div class="meta">${MACHINE_LABEL[w.machine]} · ${esc(summary(w))}</div>
      ${note ? `<div class="meta">${esc(note)}</div>` : ""}</div></div>`;

  // One-off trainings, grouped per week.
  const weeks = [];
  for (let start = monday(from); start <= to; start = addDays(start, 7)) {
    const items = workouts.filter((w) => {
      const day = parseDay(w.scheduled_for);
      return day >= start && day < addDays(start, 7);
    });
    weeks.push({ start, items });
  }
  const thisWeek = dayString(monday(today));
  const oneOffs = weeks.some((w) => w.items.length) ? weeks.map(({ start, items }) => `
    <div class="week-block ${dayString(start) === thisWeek ? "current" : ""}">
      <div class="muted small"><strong>Week van ${start.toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}</strong>${dayString(start) === thisWeek ? " · deze week" : ""}</div>
      ${items.length ? items.map((i) => training(i.workout, dayLabel(parseDay(i.scheduled_for)), i.note)).join("") : `<p class="muted small">Geen losse trainingen.</p>`}
    </div>`).join("") : `<p class="muted">Geen losse trainingen tussen ${from.toLocaleDateString("nl-NL")} en ${to.toLocaleDateString("nl-NL")}.</p>`;

  // Programs with all their weeks; the running week is open.
  const programCards = programs.length ? programs.map((p) => {
    const current = programWeek(p);
    const weekList = Array.from({ length: p.weeks }, (_, n) => n + 1).map((week) => {
      const sessions = p.sessions.filter((s) => s.week === week).sort((a, b) => a.weekday - b.weekday);
      return `<details ${week === current ? "open" : ""}>
        <summary><strong>Week ${week}</strong> <span class="muted small">${addDays(parseDay(p.start_date), (week - 1) * 7).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
          · ${sessions.length} ${sessions.length === 1 ? "training" : "trainingen"}${week === current ? " · deze week" : ""}</span></summary>
        ${sessions.length ? sessions.map((s) => training(s.workout, dayLabel(sessionDate(p, s)), s.note)).join("") : `<p class="muted small">Geen trainingen.</p>`}
      </details>`;
    }).join("");
    return `<div class="card stack"><div><strong>${esc(p.name)}</strong>
      <div class="muted small">${programStatus(p)} · start ${parseDay(p.start_date).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })} · ${p.sessions.length} trainingen in ${p.weeks} weken</div></div>
      ${weekList}</div>`;
  }).join("") : `<div class="card"><p class="muted">Nog geen programma's.</p></div>`;

  $("#main").innerHTML = `
    <div class="row"><button class="link" id="back">← Sportscholen</button></div>
    <div class="row"><h1>${esc(g.name)}</h1><span class="spacer"></span><button id="refresh">Vernieuwen</button></div>
    <p class="muted">Code <strong class="mono">${esc(g.join_code)}</strong> · account ${esc(g.account ?? "—")} · ${g.members} leden · alleen inzien</p>
    <h2>Losse trainingen</h2>
    <div class="card stack">${oneOffs}</div>
    <h2>Programma's</h2>
    <div class="stack">${programCards}</div>`;
  $("#back").onclick = renderGyms;
  $("#refresh").onclick = () => renderGymDetail(g);
}

// MARK: Gebruikers

/** Gym names a user belongs to, with whether they are that gym's account. */
function userGyms(u) {
  return (u.gyms ?? "").split(", ").filter(Boolean).map((part) => ({
    name: part.replace(/ \(account\)$/, ""), isAccount: part.endsWith(" (account)"),
  }));
}

const USER_FILTER_DEFAULTS = { q: "", gym: "", kind: "", activity: "", hidden: false, logging: false, sort: "new" };

async function renderUsers() {
  $("#main").innerHTML = `<h1>Gebruikers</h1><p class="muted">Laden…</p>`;
  const users = await run(db.rpc("admin_users"));
  const f = (state.userFilters ??= { ...USER_FILTER_DEFAULTS });
  const gymNames = [...new Set(users.flatMap((u) => userGyms(u).map((g) => g.name)))].sort((a, b) => a.localeCompare(b, "nl"));
  const daysAgo = (value) => (value ? (Date.now() - new Date(value)) / 86400000 : Infinity);

  const matches = (u) => {
    const gyms = userGyms(u);
    if (f.q) {
      const q = f.q.toLowerCase();
      if (![u.email, u.display_name, u.gyms].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
    }
    if (f.gym === "-" && gyms.length) return false;
    if (f.gym && f.gym !== "-" && !gyms.some((g) => g.name === f.gym)) return false;
    const isAccount = gyms.some((g) => g.isAccount);
    if (f.kind === "member" && (u.is_admin || isAccount)) return false;
    if (f.kind === "account" && !isAccount) return false;
    if (f.kind === "admin" && !u.is_admin) return false;
    const idle = daysAgo(u.last_result);
    if (f.activity === "7" && idle > 7) return false;
    if (f.activity === "30" && idle > 30) return false;
    if (f.activity === "idle" && (idle <= 30 || u.results === 0)) return false;
    if (f.activity === "never" && u.results > 0) return false;
    if (f.hidden && u.show_on_leaderboard) return false;
    if (f.logging && u.remote_logging !== true) return false;
    return true;
  };
  const sorters = {
    new: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    active: (a, b) => daysAgo(a.last_result) - daysAgo(b.last_result),
    results: (a, b) => b.results - a.results,
    name: (a, b) => (a.display_name || a.email).localeCompare(b.display_name || b.email, "nl"),
  };

  const draw = () => {
    const shown = users.filter(matches).sort(sorters[f.sort] ?? sorters.new);
    $("#user-table").innerHTML = shown.length ? `<table><tr><th>Gebruiker</th><th>Sportschool</th><th class="num">Trainingen</th><th>Laatste training</th><th>Laatst ingelogd</th><th></th></tr>
      ${shown.map((u) => `<tr><td><strong>${esc(u.display_name || "—")}</strong>${u.is_admin ? ` <span class="tag">beheerder</span>` : ""}
          ${u.show_on_leaderboard ? "" : ` <span class="tag orange">verborgen</span>`}${u.remote_logging === true ? ` <span class="tag">logging</span>` : ""}
          <div class="muted small">${esc(u.email)}</div></td>
        <td class="small">${esc(u.gyms ?? "—")}</td><td class="num">${u.results}</td>
        <td class="small">${date(u.last_result, false)}</td><td class="small">${date(u.last_sign_in_at)}</td>
        <td class="nowrap"><button class="link" data-edit="${u.id}">Wijzig</button>${u.is_admin ? "" : `<button class="link danger" data-delete="${u.id}">Verwijder</button>`}</td></tr>`).join("")}</table>`
      : `<p class="muted">Geen gebruikers met deze filters.</p>`;
    $("#user-count").textContent = `${shown.length} van ${users.length} gebruikers`;
    $("#reset-filters").hidden = JSON.stringify(f) === JSON.stringify(USER_FILTER_DEFAULTS);
    $$("[data-edit]").forEach((b) => (b.onclick = () => editUser(users.find((u) => u.id === b.dataset.edit))));
    $$("[data-delete]").forEach((b) => (b.onclick = async () => {
      const u = users.find((x) => x.id === b.dataset.delete);
      if (prompt(`Typ het e-mailadres om ${u.email} definitief te verwijderen, met alle resultaten en benchmarks.`) !== u.email) return;
      await run(db.rpc("admin_delete_user", { member: u.id }), "Gebruiker verwijderd");
      renderUsers();
    }));
  };

  const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
  $("#main").innerHTML = `
    <div class="row"><h1>Gebruikers</h1><span class="spacer"></span><span class="muted small" id="user-count"></span></div>
    <div class="card filters">
      <input id="f-q" placeholder="Zoek op naam, e-mail of sportschool" value="${esc(f.q)}">
      <select id="f-gym">${option("", "Alle sportscholen", f.gym)}${option("-", "Geen sportschool", f.gym)}${gymNames.map((n) => option(n, n, f.gym)).join("")}</select>
      <select id="f-kind">${option("", "Iedereen", f.kind)}${option("member", "Leden", f.kind)}${option("account", "Sportschoolaccounts", f.kind)}${option("admin", "Beheerders", f.kind)}</select>
      <select id="f-activity">${option("", "Elke activiteit", f.activity)}${option("7", "Getraind deze week", f.activity)}${option("30", "Getraind in 30 dagen", f.activity)}${option("idle", "Langer dan 30 dagen niet", f.activity)}${option("never", "Nog nooit getraind", f.activity)}</select>
      <select id="f-sort">${option("new", "Nieuwste eerst", f.sort)}${option("active", "Laatst getraind", f.sort)}${option("results", "Meeste trainingen", f.sort)}${option("name", "Naam", f.sort)}</select>
      <label class="check"><input type="checkbox" id="f-hidden" ${f.hidden ? "checked" : ""}> Verborgen op leaderboard</label>
      <label class="check"><input type="checkbox" id="f-logging" ${f.logging ? "checked" : ""}> Logging aan</label>
      <button class="link" id="reset-filters">Filters wissen</button>
    </div>
    <div class="card" id="user-table" style="margin-top:14px"></div>
    <p class="muted small">Wachtwoorden herstellen gaat via Supabase → Authentication → Users.</p>`;

  $("#f-q").oninput = (e) => { f.q = e.target.value.trim(); draw(); };
  for (const key of ["gym", "kind", "activity", "sort"]) $(`#f-${key}`).onchange = (e) => { f[key] = e.target.value; draw(); };
  for (const key of ["hidden", "logging"]) $(`#f-${key}`).onchange = (e) => { f[key] = e.target.checked; draw(); };
  $("#reset-filters").onclick = () => { state.userFilters = { ...USER_FILTER_DEFAULTS }; renderUsers(); };
  draw();
}

function editUser(u) {
  const logging = u.remote_logging === null ? "" : String(u.remote_logging);
  openDialog({
    title: u.email,
    body: `<div class="stack">
      <label>Naam op het leaderboard <input id="u-name" value="${esc(u.display_name ?? "")}"></label>
      <label class="check"><input type="checkbox" id="u-show" ${u.show_on_leaderboard ? "checked" : ""}> Zichtbaar op het leaderboard</label>
      <label>Logs naar de server <select id="u-logging">
        <option value="" ${logging === "" ? "selected" : ""}>Algemene instelling volgen</option>
        <option value="true" ${logging === "true" ? "selected" : ""}>Altijd aan (voor dit toestel debuggen)</option>
        <option value="false" ${logging === "false" ? "selected" : ""}>Uit</option></select></label>
    </div>`,
    onSave: async (root) => {
      const value = $("#u-logging", root).value;
      await run(db.rpc("admin_set_user", {
        member: u.id, new_name: $("#u-name", root).value, show: $("#u-show", root).checked,
        logging: value === "" ? null : value === "true",
      }), "Opgeslagen");
      renderUsers();
    },
  });
}

// MARK: Instellingen

async function renderSettings() {
  $("#main").innerHTML = `<h1>Instellingen</h1><p class="muted">Laden…</p>`;
  const config = await run(db.from("app_config").select("*").eq("id", 1).single());
  $("#main").innerHTML = `
    <h1>Instellingen</h1>
    <form class="card stack" id="config" style="max-width:640px">
      <label>Mededeling in de app <textarea id="c-announcement" placeholder="Bijv. vanavond tussen 22:00 en 23:00 onderhoud.">${esc(config.announcement ?? "")}</textarea></label>
      <p class="muted small">Iedereen ziet de mededeling één keer bij het openen van de app. Leeg = geen mededeling.</p>
      <label>Minimale app-versie <input id="c-min" value="${esc(config.min_version ?? "")}" placeholder="bijv. 1.2"></label>
      <p class="muted small">Oudere versies tonen alleen nog "Update nodig". Leeg = geen eis. Let op: zet hier nooit een versie die nog niet in TestFlight of de App Store staat.</p>
      <label class="check"><input type="checkbox" id="c-logging" ${config.remote_logging ? "checked" : ""}> Logs van alle toestellen naar de server sturen</label>
      <p class="muted small">Per gebruiker aan of uit te zetten bij Gebruikers. Zet dit uit na de testfase.</p>
      <div class="row"><button class="primary" type="submit">Opslaan</button><span class="muted small">Laatst gewijzigd: ${date(config.updated_at)}</span></div>
    </form>`;
  $("#config").onsubmit = async (e) => {
    e.preventDefault();
    await run(db.from("app_config").update({
      announcement: $("#c-announcement").value.trim() || null,
      min_version: $("#c-min").value.trim() || null,
      remote_logging: $("#c-logging").checked,
      updated_at: new Date().toISOString(),
    }).eq("id", 1), "Instellingen opgeslagen");
    renderSettings();
  };
}

// MARK: Dialog

function openDialog({ title, body, onSave, saveLabel = "Bewaar" }) {
  const dialog = $("#dialog");
  dialog.innerHTML = `<div class="head"><h3>${esc(title)}</h3><button class="link" data-close>Sluit</button></div>
    <div class="content">${body}</div>
    <div class="foot"><button data-close>Annuleer</button><button class="primary" data-save>${esc(saveLabel)}</button></div>`;
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
