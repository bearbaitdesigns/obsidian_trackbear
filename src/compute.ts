import type { DayCount, Goal, Measure, Tally } from './types';

// ---------- dates (all local, YYYY-MM-DD like TrackBear) ----------

export function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(d: Date, n: number): Date {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
export function startOfWeek(d: Date, weekStartsOn: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (r.getDay() - weekStartsOn + 7) % 7;
  return addDays(r, -diff);
}
function startOfUnit(d: Date, unit: string, weekStartsOn: number): Date {
  switch(unit) {
    case 'week': return startOfWeek(d, weekStartsOn);
    case 'month': return new Date(d.getFullYear(), d.getMonth(), 1);
    case 'year': return new Date(d.getFullYear(), 0, 1);
    default: return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
}
function addUnit(d: Date, unit: string, n: number): Date {
  switch(unit) {
    case 'week': return addDays(d, 7 * n);
    case 'month': return new Date(d.getFullYear(), d.getMonth() + n, 1);
    case 'year': return new Date(d.getFullYear() + n, 0, 1);
    default: return addDays(d, n);
  }
}
export function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
}

// ---------- formatting ----------

export const MEASURE_LABEL: Record<Measure, [string, string]> = {
  word: ['word', 'words'], time: ['minute', 'minutes'], page: ['page', 'pages'],
  chapter: ['chapter', 'chapters'], scene: ['scene', 'scenes'], line: ['line', 'lines'],
};

export function fmtCount(n: number, measure: Measure, withUnit = true): string {
  if(measure === 'time') {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(Math.round(n));
    const h = Math.floor(abs / 60), m = abs % 60;
    return sign + (h > 0 ? `${h}h ${m}m` : `${m}m`);
  }
  const s = Math.round(n).toLocaleString();
  if(!withUnit) return s;
  const [one, many] = MEASURE_LABEL[measure] ?? [measure, measure + 's'];
  return `${s} ${Math.abs(n) === 1 ? one : many}`;
}

export function relativeDay(date: string | null, today = fmtDate(new Date())): string {
  if(!date) return 'never';
  const d = daysBetween(date.slice(0, 10), today);
  if(d <= 0) return 'today';
  if(d === 1) return 'yesterday';
  if(d < 7) return `${d} days ago`;
  return parseDate(date.slice(0, 10)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------- overall stats ----------

export interface OverallStats {
  measure: Measure;
  today: number;
  week: number;
  month: number;
  allTime: number;
  currentStreak: number;
  longestStreak: number;
  bestDay: { date: string; count: number } | null;
  dailyAvg30: number;
  activeDays: number;
}

export function overallStats(days: DayCount[], measure: Measure, weekStartsOn: number, now = new Date()): OverallStats {
  const today = fmtDate(now);
  const weekStart = fmtDate(startOfWeek(now, weekStartsOn));
  const monthStart = fmtDate(new Date(now.getFullYear(), now.getMonth(), 1));
  const thirtyAgo = fmtDate(addDays(now, -29));

  const byDate = new Map<string, number>();
  for(const d of days) {
    const c = d.counts?.[measure] ?? 0;
    if(c !== 0) byDate.set(d.date, (byDate.get(d.date) ?? 0) + c);
  }

  let todayN = 0, week = 0, month = 0, all = 0, last30 = 0;
  let best: OverallStats['bestDay'] = null;
  for(const [date, c] of byDate) {
    if(date > today) continue;
    all += c;
    if(date === today) todayN += c;
    if(date >= weekStart) week += c;
    if(date >= monthStart) month += c;
    if(date >= thirtyAgo) last30 += c;
    if(!best || c > best.count) best = { date, count: c };
  }

  // daily streaks: a day counts if it has a positive total
  const active = [...byDate.entries()].filter(([d, c]) => c > 0 && d <= today).map(([d]) => d).sort();
  let longest = 0, run = 0, prev: string | null = null;
  for(const d of active) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  // current streak: ending today, or yesterday if today has nothing yet
  const activeSet = new Set(active);
  let cursor = activeSet.has(today) ? now : addDays(now, -1);
  let current = 0;
  while(activeSet.has(fmtDate(cursor))) { current++; cursor = addDays(cursor, -1); }

  return {
    measure, today: todayN, week, month, allTime: all,
    currentStreak: current, longestStreak: longest, bestDay: best,
    dailyAvg30: last30 / 30, activeDays: active.length,
  };
}

/** Measures the user has actually logged, most-used first. */
export function usedMeasures(days: DayCount[]): Measure[] {
  const totals = new Map<Measure, number>();
  for(const d of days) for(const [m, c] of Object.entries(d.counts ?? {})) {
    totals.set(m as Measure, (totals.get(m as Measure) ?? 0) + Math.abs(c ?? 0));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}

export function heatmapCells(days: DayCount[], measure: Measure, weeks: number, weekStartsOn: number, now = new Date()) {
  const byDate = new Map<string, number>();
  for(const d of days) byDate.set(d.date, (byDate.get(d.date) ?? 0) + (d.counts?.[measure] ?? 0));
  const end = fmtDate(now);
  const start = addDays(startOfWeek(now, weekStartsOn), -7 * (weeks - 1));
  const cells: { date: string; count: number; future: boolean }[] = [];
  for(let i = 0; i < weeks * 7; i++) {
    const date = fmtDate(addDays(start, i));
    cells.push({ date, count: byDate.get(date) ?? 0, future: date > end });
  }
  const max = Math.max(0, ...cells.map(c => c.count));
  return { cells, max };
}

export function level(count: number, max: number): number {
  if(count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count / max) * 4));
}

// ---------- goals ----------

function talliesForGoal(goal: Goal, tallies: Tally[], measure: Measure | null): Tally[] {
  const works = new Set(goal.workIds ?? []);
  const tags = new Set(goal.tagIds ?? []);
  return tallies.filter(t =>
    (measure === null || t.measure === measure) &&
    (works.size === 0 || works.has(t.workId)) &&
    (tags.size === 0 || (t.tags ?? []).some(tag => tags.has(tag.id))) &&
    (!goal.startDate || t.date >= goal.startDate) &&
    (!goal.endDate || t.date <= goal.endDate));
}

export interface TargetProgress {
  kind: 'target';
  measure: Measure;
  total: number;
  target: number;
  percent: number;
  daysLeft: number | null;
  perDayNeeded: number | null;
  ended: boolean;
  complete: boolean;
}

export interface HabitRange { start: string; end: string; total: number; success: boolean; current: boolean }
export interface HabitProgress {
  kind: 'habit';
  measure: Measure | null;
  threshold: number | null;
  cadence: { period: number; unit: string };
  ranges: HabitRange[];
  currentStreak: number;
  longestStreak: number;
  successes: number;
  currentRange: HabitRange | null;
}

export type GoalProgress = TargetProgress | HabitProgress | { kind: 'unknown' };

export function goalProgress(goal: Goal, tallies: Tally[], weekStartsOn: number, now = new Date()): GoalProgress {
  const today = fmtDate(now);
  const p = goal.parameters ?? {};

  if(goal.type === 'target' && p.threshold) {
    const { measure, count: target } = p.threshold;
    const total = talliesForGoal(goal, tallies, measure).reduce((s, t) => s + t.count, 0);
    const ended = !!goal.endDate && goal.endDate < today;
    const daysLeft = goal.endDate && !ended ? daysBetween(today, goal.endDate) + 1 : null;
    const remaining = Math.max(0, target - total);
    return {
      kind: 'target', measure, total, target,
      percent: target > 0 ? Math.min(100, (total / target) * 100) : 0,
      daysLeft, ended, complete: total >= target,
      perDayNeeded: daysLeft && remaining > 0 ? Math.ceil(remaining / daysLeft) : null,
    };
  }

  if(goal.type === 'habit' && p.cadence) {
    const threshold = p.threshold ?? null;
    const relevant = talliesForGoal({ ...goal, startDate: null, endDate: null }, tallies, threshold?.measure ?? null)
      .filter(t => t.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date));
    const empty: HabitProgress = {
      kind: 'habit', measure: threshold?.measure ?? null, threshold: threshold?.count ?? null,
      cadence: p.cadence, ranges: [], currentStreak: 0, longestStreak: 0, successes: 0, currentRange: null,
    };
    if(relevant.length === 0) return empty;

    const startStr = goal.startDate ?? relevant[0].date;
    const endStr = goal.endDate && goal.endDate < today ? goal.endDate : today;
    const end = parseDate(endStr);
    const { period, unit } = p.cadence;

    const ranges: HabitRange[] = [];
    let s = startOfUnit(parseDate(startStr), unit, weekStartsOn);
    let guard = 0;
    while(s <= end && guard++ < 5000) {
      const next = addUnit(s, unit, Math.max(1, period));
      const rs = fmtDate(s), re = fmtDate(addDays(next, -1));
      const inRange = relevant.filter(t => t.date >= rs && t.date <= re);
      const total = threshold === null ? inRange.length : inRange.reduce((sum, t) => sum + t.count, 0);
      const success = threshold === null ? total > 0 : total >= threshold.count;
      ranges.push({ start: rs, end: re, total, success, current: rs <= today && today <= re });
      s = next;
    }

    // same streak rules as TrackBear: an unfinished current range doesn't break a streak
    const streaks: HabitRange[][] = [[]];
    for(const r of ranges) {
      if(r.success) streaks[streaks.length - 1].push(r);
      else if(r.current) { /* in progress */ }
      else if(streaks[streaks.length - 1].length) streaks.push([]);
    }
    const last = ranges[ranges.length - 1];
    return {
      ...empty,
      ranges,
      currentStreak: last?.current ? streaks[streaks.length - 1].length : 0,
      longestStreak: Math.max(0, ...streaks.map(x => x.length)),
      successes: ranges.filter(r => r.success).length,
      currentRange: last?.current ? last : null,
    };
  }

  return { kind: 'unknown' };
}

export function cadenceLabel(c: { period: number; unit: string }): string {
  return c.period === 1 ? `every ${c.unit}` : `every ${c.period} ${c.unit}s`;
}
