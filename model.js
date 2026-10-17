// The app's workout model in JavaScript. Workouts are stored as JSON in Supabase and
// decoded by the iOS app, so every key the Swift `Workout`/`Interval` types require
// must be present (see Workout.swift).

export const MACHINES = ["rower", "skiErg", "bikeErg"];
export const MACHINE_LABEL = { rower: "RowErg", skiErg: "SkiErg", bikeErg: "BikeErg" };
export const MACHINE_ICON = { rower: "🚣", skiErg: "⛷️", bikeErg: "🚴" };
export const paceDistance = (machine) => (machine === "bikeErg" ? 1000 : 500);

export const KINDS = {
  distance: "Afstand",
  time: "Tijd",
  distanceIntervals: "Intervallen (afstand)",
  timeIntervals: "Intervallen (tijd)",
  custom: "Eigen intervallen",
};

export const WEEKDAYS = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];

export const uuid = () => crypto.randomUUID().toUpperCase();

// MARK: Formatting

/** 125 -> "2:05", 3725 -> "1:02:05" */
export function clock(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** 103.6 -> "1:43.6" */
export function clockTenths(seconds) {
  const tenths = Math.round(seconds * 10);
  return `${clock(Math.floor(tenths / 10))}.${tenths % 10}`;
}

export function percent(value) {
  const tenths = Math.round(value * 10) / 10;
  return Number.isInteger(tenths) ? `${tenths}%` : `${tenths.toFixed(1)}%`;
}

/** "2:05" or "125" -> 125 */
export function parseClock(text) {
  const parts = String(text).trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// MARK: Power (Concept2: watts = 2.80 / (seconds per meter)^3)

export const watts = (pace) => (pace > 0 ? 2.8 / Math.pow(pace / 500, 3) : 0);
export const paceForWatts = (w) => (w > 0 ? 500 * Math.cbrt(2.8 / w) : 0);

// MARK: Workouts

export function interval(fields = {}) {
  return {
    id: uuid(), usesDistance: false, distance: 500, duration: 240, rest: 60,
    ...fields,
  };
}

export function workout(fields = {}) {
  return {
    id: uuid(), name: "Training", machine: "rower", kind: "distance",
    distance: 2000, duration: 1200, intervalCount: 4, rest: 120, intervals: [],
    ...fields,
  };
}

function target(item, unit) {
  if (item.targetPercent != null) return ` @ ${percent(item.targetPercent)}`;
  if (item.targetPace != null) return ` @ ${clock(item.targetPace)}${unit}`;
  return "";
}

export function summary(w) {
  const unit = `/${paceDistance(w.machine)}m`;
  if (w.kind === "custom") {
    return w.intervals.map((i) => (i.usesDistance ? `${i.distance}m` : clock(i.duration)) + target(i, "")).join(" · ");
  }
  const work = w.kind === "distance" || w.kind === "distanceIntervals" ? `${w.distance}m` : clock(w.duration);
  const isInterval = w.kind === "distanceIntervals" || w.kind === "timeIntervals";
  return (isInterval ? `${w.intervalCount} × ${work} / ${clock(w.rest)} rust` : work) + target(w, unit);
}

/** The same workout on another machine: distances scale with the pace distance (×2 on the BikeErg). */
export function onMachine(w, machine) {
  if (machine === w.machine) return w;
  const scale = paceDistance(machine) / paceDistance(w.machine);
  return {
    ...w,
    machine,
    distance: Math.round(w.distance * scale),
    intervals: w.intervals.map((i) => ({ ...i, distance: Math.round(i.distance * scale) })),
  };
}

export function adjusted(w, paceChange, percentChange) {
  const round = (x) => Math.round(x * 10) / 10;
  const shift = (item) => {
    const copy = { ...item };
    if (copy.targetPercent != null) copy.targetPercent = Math.max(round(copy.targetPercent + percentChange), 10);
    else if (copy.targetPace != null) copy.targetPace = Math.max(copy.targetPace + paceChange, 30);
    return copy;
  };
  return { ...shift(w), id: uuid(), intervals: w.intervals.map(shift) };
}

// MARK: Standard sets (same names, targets and fixed ids as Workout.standard(for:))

export function standard(machine) {
  const m = machine === "bikeErg" ? 2 : 1;
  const base = { machine };
  const list = [
    { name: "Duur 20 min", kind: "time", duration: 1200, targetPercent: 45 },
    { name: "Duur 30 min", kind: "time", duration: 1800, targetPercent: 50 },
    { name: "3 × 10 min", kind: "timeIntervals", duration: 600, intervalCount: 3, rest: 120, targetPercent: 55 },
    { name: "4 × 5 min", kind: "timeIntervals", duration: 300, intervalCount: 4, rest: 90, targetPercent: 60 },
    { name: `2 × ${2000 * m}m`, kind: "distanceIntervals", distance: 2000 * m, intervalCount: 2, rest: 180, targetPercent: 62 },
    { name: `4 × ${1000 * m}m`, kind: "distanceIntervals", distance: 1000 * m, intervalCount: 4, rest: 120, targetPercent: 72 },
    { name: `8 × ${500 * m}m`, kind: "distanceIntervals", distance: 500 * m, intervalCount: 8, rest: 90, targetPercent: 78 },
    { name: "Ladder 4-3-2", kind: "custom", intervals: [[240, 74], [180, 78], [120, 81]].map(([d, p]) => interval({ duration: d, rest: 90, targetPercent: p })) },
    { name: "Noorse 4×4", kind: "timeIntervals", duration: 240, intervalCount: 4, rest: 180, targetPercent: 74 },
    { name: "Piramide 1-2-3-4-3-2-1", kind: "custom", intervals: [[1, 85], [2, 80], [3, 76], [4, 72], [3, 76], [2, 80], [1, 85]].map(([min, p]) => interval({ duration: min * 60, rest: 60, targetPercent: p })) },
    { name: "30/30 × 20", kind: "timeIntervals", duration: 30, intervalCount: 20, rest: 30, targetPercent: 88 },
    { name: "10 × 1 min", kind: "timeIntervals", duration: 60, intervalCount: 10, rest: 60, targetPercent: 85 },
    { name: "Tabata 8 × 20 s", kind: "timeIntervals", duration: 20, intervalCount: 8, rest: 10, targetPercent: 95 },
    { name: `${2 * m}k-test`, kind: "distance", distance: 2000 * m },
    { name: `Benchmarktest ${paceDistance(machine)}m`, kind: "distance", distance: paceDistance(machine) },
  ];
  const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 14, 9, 15, 10, 11, 12, 13];
  const prefix = MACHINES.indexOf(machine) + 1;
  return list.map((fields, index) =>
    workout({ ...base, ...fields, id: `0000000${prefix}-0000-0000-0000-${String(numbers[index]).padStart(12, "0")}` })
  );
}

/** A copy with its own id, so a training gets its own leaderboard. */
/** A new copy for another machine, with distances converted ("Kopieer voor …"). */
export const copyFor = (w, machine) => fresh(onMachine(w, machine));
export const fresh = (w) => ({ ...structuredClone(w), id: uuid(), intervals: (w.intervals || []).map((i) => ({ ...i, id: uuid() })) });

// MARK: Dates (weeks start on Monday)

export function dayString(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDay(text) {
  const [y, m, d] = text.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function monday(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export function sessionDate(program, session) {
  return addDays(parseDay(program.start_date), (session.week - 1) * 7 + (session.weekday - 1));
}

export function programWeek(program, date = new Date()) {
  const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today - parseDay(program.start_date)) / 86400000);
  if (days < 0) return null;
  const week = Math.floor(days / 7) + 1;
  return week <= program.weeks ? week : null;
}

export function programStatus(program) {
  const week = programWeek(program);
  if (week) return `Week ${week} van ${program.weeks}`;
  return parseDay(program.start_date) > new Date()
    ? `Start ${parseDay(program.start_date).toLocaleDateString("nl-NL", { day: "numeric", month: "long" })}`
    : "Afgelopen";
}

export function sessionsInWeek(program, week) {
  return program.sessions.filter((s) => s.week === week).sort((a, b) => a.weekday - b.weekday);
}

export function copyWeek(program, week, paceChange, percentChange) {
  if (week >= program.weeks) return;
  program.sessions = program.sessions.filter((s) => s.week !== week + 1);
  for (const session of sessionsInWeek(program, week)) {
    program.sessions.push({ ...session, id: uuid(), week: week + 1, workout: adjusted(session.workout, paceChange, percentChange) });
  }
}

// MARK: Program templates (same as ProgramTemplates.swift)

const timed = (name, machine, seconds, pct) => workout({ name, machine, kind: "time", duration: seconds, targetPercent: pct });
const blocks = (name, machine, count, seconds, rest, pct) =>
  workout({ name, machine, kind: "timeIntervals", duration: seconds, intervalCount: count, rest, targetPercent: pct });
const dist = (name, machine, count, meters, rest, pct) => {
  const f = machine === "bikeErg" ? 2 : 1;
  return workout({ name: name.replace(`${meters}m`, `${meters * f}m`), machine, kind: "distanceIntervals", distance: meters * f, intervalCount: count, rest, targetPercent: pct });
};

export const TEMPLATES = {
  base: {
    name: "Basis 6 weken (polarized)", weeks: 6, needsMachine: true,
    summary: "3× per week: lange duur, drempelblokken en Noorse 4×4. Veel rustig, weinig maar echt hard; week 4 lichter.",
    sessions: (machine) => baseSessions([machine, machine, machine]),
  },
  twoK: {
    name: "2k-voorbereiding 8 weken", weeks: 8, needsMachine: true,
    summary: "Begint en eindigt met een 2k-test. Opbouw van basis via drempel naar 2k-tempo, week 4 lichter, week 7 afbouwen.",
    sessions: twoKSessions,
  },
  sprint: {
    name: "Sprint & power 4 weken", weeks: 4, needsMachine: true,
    summary: "3× per week korte, harde intervallen: 10 × 1 min, 30/30 en Tabata, elke week iets zwaarder.",
    sessions: sprintSessions,
  },
  trifecta: {
    name: "Erg-trifecta 6 weken", weeks: 6, needsMachine: false,
    summary: "Zoals Basis 6 weken, maar elke training op een andere machine: RowErg, SkiErg en BikeErg wisselen.",
    sessions: () => baseSessions(["rower", "skiErg", "bikeErg"]),
  },
};

const session = (week, weekday, w, note = "") => ({ id: uuid(), week, weekday, workout: w, note });

function baseSessions(machines) {
  const duration = [30, 35, 40, 30, 45, 45], easy = [45, 45.5, 46, 45, 46.5, 47];
  const blockMin = [10, 11, 12, 10, 12, 13], threshold = [55, 55.5, 56, 54, 56.5, 57];
  const fours = [4, 4, 5, 4, 5, 5], vo2 = [72, 73, 73, 71, 74, 75];
  const out = [];
  for (let week = 1; week <= 6; week++) {
    const i = week - 1, machine = (slot) => machines[(slot + i) % machines.length];
    const light = week === 4 ? "Herstelweek: rustiger aan." : "";
    out.push(session(week, 2, timed(`Duur ${duration[i]} min`, machine(0), duration[i] * 60, easy[i]), light));
    out.push(session(week, 4, blocks(`3 × ${blockMin[i]} min`, machine(1), 3, blockMin[i] * 60, 120, threshold[i]), light));
    out.push(session(week, 6, blocks(`Noorse ${fours[i]}×4`, machine(2), fours[i], 240, 180, vo2[i]),
      week === 1 ? "Noorse 4×4: hard maar gelijkmatig, de rust actief uitrijden." : light));
  }
  return out;
}

function twoKSessions(m) {
  const test = () => fresh(standard(m).find((w) => w.kind === "distance" && w.distance >= 2000));
  const d = (name, count, meters, rest, pct) => dist(name, m, count, meters, rest, pct);
  const light = "Herstelweek: rustiger aan.";
  return [
    session(1, 2, test(), "Starttest: rij hem voluit, dit is je beginpunt."),
    session(1, 4, timed("Duur 30 min", m, 1800, 50)), session(1, 6, d("4 × 1000m", 4, 1000, 120, 70)),
    session(2, 2, blocks("3 × 10 min", m, 3, 600, 120, 55)), session(2, 4, timed("Duur 35 min", m, 2100, 50)), session(2, 6, d("8 × 500m", 8, 500, 90, 76)),
    session(3, 2, blocks("4 × 5 min", m, 4, 300, 90, 60)), session(3, 4, timed("Duur 40 min", m, 2400, 50)), session(3, 6, d("4 × 1000m", 4, 1000, 120, 72)),
    session(4, 2, blocks("3 × 10 min", m, 3, 600, 120, 54), light), session(4, 4, timed("Duur 30 min", m, 1800, 48), light), session(4, 6, d("6 × 500m", 6, 500, 120, 76), light),
    session(5, 2, d("2 × 2000m", 2, 2000, 180, 62)), session(5, 4, timed("Duur 40 min", m, 2400, 50)), session(5, 6, d("8 × 500m", 8, 500, 90, 78)),
    session(6, 2, blocks("4 × 5 min", m, 4, 300, 90, 62)), session(6, 4, timed("Duur 45 min", m, 2700, 50)), session(6, 6, d("4 × 1000m", 4, 1000, 120, 74)),
    session(7, 2, d("4 × 500m", 4, 500, 120, 80), "Afbouwen: kort en scherp, niet vermoeien."), session(7, 4, timed("Duur 25 min", m, 1500, 48), "Afbouwen."), session(7, 6, d("3 × 1000m", 3, 1000, 180, 74), "Afbouwen."),
    session(8, 2, timed("Duur 20 min", m, 1200, 45), "Rustig, morgen of overmorgen de test."), session(8, 4, test(), "Eindtest: vergelijk met week 1!"),
  ];
}

function sprintSessions(m) {
  const out = [];
  for (let week = 1; week <= 4; week++) {
    const step = week - 1;
    out.push(session(week, 1, blocks("10 × 1 min", m, 10, 60, 60, 85 + step)));
    out.push(session(week, 3, blocks(`30/30 × ${14 + 2 * week}`, m, 14 + 2 * week, 30, 30, 88 + step / 2)));
    out.push(session(week, 5, blocks("Tabata 8 × 20 s", m, 8, 20, 10, Math.round((93 + (step * 2) / 3) * 10) / 10),
      week === 1 ? "Tabata: 8 keer 20 seconden alles geven, 10 seconden rust." : ""));
  }
  return out;
}

export function programFromTemplate(key, gymId, machine, start) {
  const t = TEMPLATES[key];
  return {
    id: uuid(), gym_id: gymId, name: t.needsMachine ? `${t.name} · ${MACHINE_LABEL[machine]}` : t.name,
    start_date: dayString(monday(start)), weeks: t.weeks, sessions: t.sessions(machine),
  };
}
