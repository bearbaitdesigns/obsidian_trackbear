import { setIcon } from 'obsidian';
import type { Measure, TrackBearData } from './types';
import {
  cadenceLabel, fmtCount, goalProgress, heatmapCells, level, MEASURE_LABEL,
  overallStats, relativeDay, usedMeasures,
} from './compute';

export type Section = 'stats' | 'projects' | 'goals' | 'leaderboards';
export const ALL_SECTIONS: Section[] = ['stats', 'projects', 'goals', 'leaderboards'];

export interface RenderOptions {
  sections: Section[];
  measure: Measure | 'auto';
  weekStartsOn: number;
  heatmapWeeks: number;
  showInactiveProjects: boolean;
  baseUrl: string;
}

const INACTIVE_PHASES = new Set(['finished', 'abandoned']);

function link(parent: HTMLElement, text: string, href: string, cls?: string) {
  const a = parent.createEl('a', { text, href, cls });
  a.setAttr('target', '_blank');
  a.setAttr('rel', 'noopener');
  return a;
}

function sectionHeader(parent: HTMLElement, title: string, icon: string, href?: string) {
  const h = parent.createDiv({ cls: 'tb-section-header' });
  const iconEl = h.createSpan({ cls: 'tb-section-icon' });
  setIcon(iconEl, icon);
  h.createSpan({ text: title, cls: 'tb-section-title' });
  if(href) link(h, 'Open', href, 'tb-section-link');
}

function bar(parent: HTMLElement, percent: number, done = false) {
  const outer = parent.createDiv({ cls: 'tb-bar' });
  const inner = outer.createDiv({ cls: 'tb-bar-fill' + (done ? ' is-done' : '') });
  inner.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

export function pickMeasure(data: TrackBearData, opt: Measure | 'auto'): Measure {
  if(opt !== 'auto') return opt;
  return usedMeasures(data.days)[0] ?? 'word';
}

export function renderDashboard(el: HTMLElement, data: TrackBearData, opts: RenderOptions) {
  el.addClass('trackbear');
  const base = opts.baseUrl.replace(/\/+$/, '');
  for(const s of opts.sections) {
    const sec = el.createDiv({ cls: `tb-section tb-${s}` });
    if(s === 'stats') renderStats(sec, data, opts, base);
    if(s === 'projects') renderProjects(sec, data, opts, base);
    if(s === 'goals') renderGoals(sec, data, opts, base);
    if(s === 'leaderboards') renderBoards(sec, data, base);
  }
}

// ---------- stats ----------

function renderStats(sec: HTMLElement, data: TrackBearData, opts: RenderOptions, base: string) {
  const measure = pickMeasure(data, opts.measure);
  sectionHeader(sec, 'Stats', 'bar-chart-2', `${base}/stats/lifetime`);
  const st = overallStats(data.days, measure, opts.weekStartsOn);
  const unit = MEASURE_LABEL[measure]?.[1] ?? measure;

  const grid = sec.createDiv({ cls: 'tb-stat-grid' });
  const card = (label: string, value: string, sub?: string) => {
    const c = grid.createDiv({ cls: 'tb-stat' });
    c.createDiv({ cls: 'tb-stat-label', text: label });
    c.createDiv({ cls: 'tb-stat-value', text: value });
    if(sub) c.createDiv({ cls: 'tb-stat-sub', text: sub });
  };
  card('Today', fmtCount(st.today, measure, false), unit);
  card('This week', fmtCount(st.week, measure, false), unit);
  card('This month', fmtCount(st.month, measure, false), unit);
  card('All time', fmtCount(st.allTime, measure, false), unit);
  card('Current streak', `${st.currentStreak} ${st.currentStreak === 1 ? 'day' : 'days'}`, `Longest ${st.longestStreak}`);
  card('30-day average', fmtCount(st.dailyAvg30, measure, false), `${unit} per day`);

  const { cells, max } = heatmapCells(data.days, measure, opts.heatmapWeeks, opts.weekStartsOn);
  const hm = sec.createDiv({ cls: 'tb-heatmap' });
  for(const c of cells) {
    const cell = hm.createDiv({ cls: `tb-cell tb-l${c.future ? 'x' : level(c.count, max)}` });
    if(!c.future) cell.setAttr('aria-label', `${c.date}: ${fmtCount(c.count, measure)}`);
  }
  const foot = sec.createDiv({ cls: 'tb-muted tb-small' });
  foot.setText(`Last ${opts.heatmapWeeks} weeks` + (st.bestDay ? ` · best day ${fmtCount(st.bestDay.count, measure)} on ${st.bestDay.date}` : ''));
}

// ---------- projects ----------

function renderProjects(sec: HTMLElement, data: TrackBearData, opts: RenderOptions, base: string) {
  sectionHeader(sec, 'Projects', 'book-open', `${base}/projects`);
  const projects = data.projects
    .filter(p => opts.showInactiveProjects || !INACTIVE_PHASES.has(p.phase))
    .sort((a, b) => Number(b.starred) - Number(a.starred) || (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''));

  if(projects.length === 0) {
    sec.createDiv({ cls: 'tb-empty', text: 'No current projects. Start one on TrackBear.' });
    return;
  }
  for(const p of projects) {
    const item = sec.createDiv({ cls: 'tb-item' });
    const row = item.createDiv({ cls: 'tb-row' });
    const title = row.createDiv({ cls: 'tb-item-title' });
    if(p.starred) { const s = title.createSpan({ cls: 'tb-star' }); setIcon(s, 'star'); }
    link(title, p.title, `${base}/projects/${p.id}`);
    row.createSpan({ cls: `tb-pill tb-phase-${p.phase.replace(/\s+/g, '-')}`, text: p.phase });

    const totals = Object.entries(p.totals ?? {})
      .filter(([, n]) => (n ?? 0) !== 0)
      .map(([m, n]) => fmtCount(n ?? 0, m as Measure));
    const meta = item.createDiv({ cls: 'tb-row tb-meta' });
    meta.createSpan({ text: totals.length ? totals.join(' · ') : 'Nothing logged yet' });
    meta.createSpan({ text: relativeDay(p.lastUpdated) });
  }
}

// ---------- goals ----------

function renderGoals(sec: HTMLElement, data: TrackBearData, opts: RenderOptions, base: string) {
  sectionHeader(sec, 'Goals', 'target', `${base}/goals`);
  const goals = [...data.goals].sort((a, b) => Number(b.starred) - Number(a.starred) || a.title.localeCompare(b.title));
  if(goals.length === 0) {
    sec.createDiv({ cls: 'tb-empty', text: 'No goals yet. Set one on TrackBear.' });
    return;
  }

  for(const g of goals) {
    const item = sec.createDiv({ cls: 'tb-item' });
    const row = item.createDiv({ cls: 'tb-row' });
    const title = row.createDiv({ cls: 'tb-item-title' });
    if(g.starred) { const s = title.createSpan({ cls: 'tb-star' }); setIcon(s, 'star'); }
    link(title, g.title, `${base}/goals/${g.id}`);

    const prog = goalProgress(g, data.tallies, opts.weekStartsOn);
    if(prog.kind === 'target') {
      row.createSpan({ cls: 'tb-meta', text: `${fmtCount(prog.total, prog.measure, false)} / ${fmtCount(prog.target, prog.measure)}` });
      bar(item, prog.percent, prog.complete);
      const bits = [`${Math.floor(prog.percent)}%`];
      if(prog.complete) bits.push('complete');
      else if(prog.ended) bits.push('ended');
      if(prog.daysLeft !== null && !prog.complete) bits.push(`${prog.daysLeft} ${prog.daysLeft === 1 ? 'day' : 'days'} left`);
      if(prog.perDayNeeded) bits.push(`${fmtCount(prog.perDayNeeded, prog.measure)}/day to finish`);
      item.createDiv({ cls: 'tb-muted tb-small', text: bits.join(' · ') });
    } else if(prog.kind === 'habit') {
      const streak = row.createSpan({ cls: 'tb-pill tb-pill-streak', text: `${prog.currentStreak} streak` });
      if(prog.currentStreak === 0) streak.addClass('is-zero');
      const strip = item.createDiv({ cls: 'tb-habit-strip' });
      for(const r of prog.ranges.slice(-21)) {
        const c = strip.createDiv({ cls: 'tb-habit-cell' + (r.success ? ' is-success' : '') + (r.current ? ' is-current' : '') });
        c.setAttr('aria-label', `${r.start}${r.end !== r.start ? ' – ' + r.end : ''}: ${prog.measure ? fmtCount(r.total, prog.measure) : r.total + ' entries'}`);
      }
      const bits = [cadenceLabel(prog.cadence), `longest ${prog.longestStreak}`];
      if(prog.currentRange) {
        bits.push(prog.threshold !== null && prog.measure
          ? `this period ${fmtCount(prog.currentRange.total, prog.measure, false)} / ${fmtCount(prog.threshold, prog.measure)}`
          : `this period ${prog.currentRange.success ? 'done' : 'not yet'}`);
      }
      item.createDiv({ cls: 'tb-muted tb-small', text: bits.join(' · ') });
    } else {
      item.createDiv({ cls: 'tb-muted tb-small', text: 'Goal type not supported yet.' });
    }
  }
}

// ---------- leaderboards ----------

function renderBoards(sec: HTMLElement, data: TrackBearData, base: string) {
  sectionHeader(sec, 'Leaderboards', 'trophy', `${base}/leaderboards`);
  if(data.boards.length === 0) {
    const hidden = data.hiddenBoards ?? 0;
    sec.createDiv({ cls: 'tb-empty', text: hidden
      ? `No active leaderboards. ${hidden} completed ${hidden === 1 ? 'board is' : 'boards are'} hidden.`
      : 'You are not on any leaderboards.' });
    return;
  }
  for(const b of data.boards) {
    const item = sec.createDiv({ cls: 'tb-item' });
    const row = item.createDiv({ cls: 'tb-row' });
    const title = row.createDiv({ cls: 'tb-item-title' });
    if(b.board.starred) { const s = title.createSpan({ cls: 'tb-star' }); setIcon(s, 'star'); }
    link(title, b.board.title, `${base}/leaderboards/${b.board.uuid}`);
    const unit = b.board.individualGoalMode ? 'individual goals' : (MEASURE_LABEL[b.measure]?.[1] ?? b.measure);
    row.createSpan({ cls: 'tb-meta', text: `${unit} · ${b.standings.length} ${b.standings.length === 1 ? 'person' : 'people'}` });

    if(b.board.startDate || b.board.endDate) {
      item.createDiv({ cls: 'tb-muted tb-small', text: `${b.board.startDate ?? '…'} → ${b.board.endDate ?? 'ongoing'}` });
    }
    if(b.error) { item.createDiv({ cls: 'tb-error tb-small', text: b.error }); continue; }

    const goal = !b.board.individualGoalMode ? b.board.goal?.[b.measure] : undefined;
    if(goal) {
      const sum = b.standings.reduce((s, x) => s + x.total, 0);
      if(b.board.fundraiserMode) {
        item.createDiv({ cls: 'tb-small', text: `Together: ${fmtCount(sum, b.measure)} of ${fmtCount(goal, b.measure)}` });
        bar(item, (sum / goal) * 100, sum >= goal);
      }
    }

    const table = item.createDiv({ cls: 'tb-standings' });
    const myIdx = b.standings.findIndex(s => s.id === b.myParticipantId);
    const show = new Set<number>();
    for(let i = 0; i < Math.min(5, b.standings.length); i++) show.add(i);
    if(myIdx >= 0) show.add(myIdx);
    let lastShown = -1;
    b.standings.forEach((s, i) => {
      if(!show.has(i)) return;
      if(lastShown >= 0 && i > lastShown + 1) table.createDiv({ cls: 'tb-standing tb-gap', text: '⋯' });
      lastShown = i;
      const r = table.createDiv({ cls: 'tb-standing' + (i === myIdx ? ' is-me' : '') });
      r.createSpan({ cls: 'tb-rank', text: String(i + 1) });
      const name = r.createSpan({ cls: 'tb-name' });
      const dot = name.createSpan({ cls: 'tb-dot' });
      if(s.color) dot.style.backgroundColor = s.color;
      name.createSpan({ text: i === myIdx ? `${s.name} (you)` : s.name });
      const val = s.goal && b.board.individualGoalMode
        ? `${Math.floor((s.total / s.goal) * 100)}%`
        : fmtCount(s.total, b.measure, false);
      r.createSpan({ cls: 'tb-total', text: val });
    });
  }
}
