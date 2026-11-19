import { requestUrl } from 'obsidian';
import { fmtDate } from './compute';
import type {
  ApiPayload, BoardWithStandings, DayCount, Goal, Leaderboard, Measure,
  Participant, Participation, Project, Tally, TallyCreatePayload, TrackBearData,
} from './types';

export class TrackBearError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message);
  }
}

export class TrackBearApi {
  constructor(private baseUrl: string, private apiKey: string) {}

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, payload?: unknown): Promise<T> {
    if(!this.apiKey) throw new TrackBearError('Add your TrackBear API key in the plugin settings.');
    const url = this.baseUrl.replace(/\/+$/, '') + '/api/v1' + path;
    let res;
    try {
      res = await requestUrl({
        url,
        method,
        headers: { Authorization: `Bearer ${this.apiKey.trim()}`, Accept: 'application/json' },
        contentType: payload === undefined ? undefined : 'application/json',
        body: payload === undefined ? undefined : JSON.stringify(payload),
        throw: false,
      });
    } catch(err) {
      throw new TrackBearError(`Couldn't reach TrackBear (${(err as Error).message}).`);
    }

    let body: ApiPayload<T> | null = null;
    try { body = res.json as ApiPayload<T>; } catch { /* non-JSON body */ }

    if(res.status === 401 || res.status === 403) {
      throw new TrackBearError('TrackBear rejected the API key. Check it in settings.', res.status, body && !body.success ? body.error.code : undefined);
    }
    if(res.status === 429) {
      throw new TrackBearError('TrackBear is rate limiting requests. Try again in a minute.', 429);
    }
    if(!body || res.status >= 400 || !body.success) {
      const msg = body && !body.success ? body.error.message : `HTTP ${res.status}`;
      throw new TrackBearError(`TrackBear request failed: ${msg}`, res.status);
    }
    return body.data;
  }

  /**
   * Log progress. With setTotal, TrackBear treats `count` as the project's new
   * running total for that measure and records the difference.
   */
  createTally(payload: TallyCreatePayload) {
    return this.request<Tally>('POST', '/tally', payload);
  }

  ping() { return this.get<unknown>('/ping/api-token'); }
  projects() { return this.get<Project[]>('/project'); }
  goals() { return this.get<Goal[]>('/goal'); }
  tallies() { return this.get<Tally[]>('/tally'); }
  days() { return this.get<DayCount[]>('/stats/days'); }
  leaderboards() { return this.get<Leaderboard[]>('/leaderboard'); }
  participants(uuid: string) { return this.get<Participant[]>(`/leaderboard/${encodeURIComponent(uuid)}/participants`); }
  myParticipation(uuid: string) { return this.get<Participation | null>(`/leaderboard/${encodeURIComponent(uuid)}/me`); }

  async fetchAll(maxBoards: number, hideEndedBoards = false): Promise<TrackBearData> {
    const [projects, goals, tallies, days, boards] = await Promise.all([
      this.projects(), this.goals(), this.tallies(), this.days(), this.leaderboards(),
    ]);

    // starred boards first, then most recently started
    // a board is complete once its end date has passed; boards without one never end
    const today = fmtDate(new Date());
    const visible = hideEndedBoards ? boards.filter(b => !b.endDate || b.endDate >= today) : boards;
    const sorted = [...visible].sort((a, b) =>
      Number(b.starred) - Number(a.starred) || (b.startDate ?? '').localeCompare(a.startDate ?? ''));
    const chosen = sorted.slice(0, Math.max(0, maxBoards));

    const withStandings: BoardWithStandings[] = [];
    for(const board of chosen) {
      withStandings.push(await this.boardStandings(board));
    }

    return { fetchedAt: Date.now(), projects, goals, tallies, days, boards: withStandings, hiddenBoards: boards.length - visible.length };
  }

  private async boardStandings(board: Leaderboard): Promise<BoardWithStandings> {
    const measure: Measure = (Object.keys(board.goal ?? {})[0] as Measure) ?? board.measures[0] ?? 'word';
    try {
      const [participants, me] = await Promise.all([
        this.participants(board.uuid),
        this.myParticipation(board.uuid).catch(() => null),
      ]);
      const standings = participants.map(p => {
        const m = board.individualGoalMode && p.goal ? p.goal.measure : measure;
        const total = p.tallies
          .filter(t => t.measure === m)
          .filter(t => (!board.startDate || t.date >= board.startDate) && (!board.endDate || t.date <= board.endDate))
          .reduce((sum, t) => sum + t.count, 0);
        return {
          id: p.id,
          name: p.displayName || 'Anonymous',
          color: p.color,
          total,
          goal: board.individualGoalMode ? (p.goal?.count ?? null) : (board.goal?.[measure] ?? null),
        };
      }).sort((a, b) => b.total - a.total);
      return { board, measure, myParticipantId: me?.id ?? null, standings };
    } catch(err) {
      return { board, measure, myParticipantId: null, standings: [], error: (err as Error).message };
    }
  }
}
