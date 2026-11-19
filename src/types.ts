// Shapes returned by the TrackBear v1 API (https://trackbear.app/api/v1).
// Derived from the open-source server at github.com/dispatchrabbi/trackbear.

export type Measure = 'word' | 'time' | 'page' | 'chapter' | 'scene' | 'line';
export type MeasureCounts = Partial<Record<Measure, number>>;

export interface ApiSuccess<T> { success: true; data: T }
export interface ApiFailure { success: false; error: { code: string; message: string } }
export type ApiPayload<T> = ApiSuccess<T> | ApiFailure;

export interface Project {
  id: number;
  uuid: string;
  title: string;
  description: string;
  phase: 'planning' | 'outlining' | 'drafting' | 'revising' | 'on hold' | 'finished' | 'abandoned' | string;
  starred: boolean;
  startingBalance: MeasureCounts;
  totals: MeasureCounts;
  lastUpdated: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalThreshold { measure: Measure; count: number }
export interface GoalCadence { period: number; unit: 'day' | 'week' | 'month' | 'year'; times?: number | null }

export interface Goal {
  id: number;
  uuid: string;
  title: string;
  description: string;
  type: 'target' | 'habit';
  parameters: {
    threshold?: GoalThreshold | null;
    cadence?: GoalCadence | null;
  };
  startDate: string | null;
  endDate: string | null;
  starred: boolean;
  workIds: number[];
  tagIds: number[];
}

export interface Tag { id: number; name: string }

export interface Tally {
  id: number;
  date: string;
  measure: Measure;
  count: number;
  note: string;
  workId: number;
  tags: Tag[];
}

export interface TallyCreatePayload {
  date: string;
  measure: Measure;
  count: number;
  setTotal: boolean;
  note: string;
  workId: number;
  tags: string[];
}

export interface DayCount { date: string; counts: MeasureCounts }

export interface Leaderboard {
  id: number;
  uuid: string;
  title: string;
  description: string;
  measures: Measure[];
  startDate: string | null;
  endDate: string | null;
  goal: MeasureCounts;
  enableTeams: boolean;
  individualGoalMode: boolean;
  fundraiserMode: boolean;
  starred: boolean;
  isPublic: boolean;
  members: { id: number; isParticipant: boolean; isOwner: boolean; displayName: string }[];
  teams: { id: number; name: string; color: string }[];
}

export interface Participant {
  id: number;
  uuid: string;
  displayName: string;
  color: string;
  teamId: number | null;
  goal: null | { measure: Measure; count: number };
  tallies: { uuid: string; date: string; measure: Measure; count: number }[];
}

export interface Participation {
  id: number;
  isParticipant: boolean;
  displayName: string;
}

export interface BoardWithStandings {
  board: Leaderboard;
  measure: Measure;
  myParticipantId: number | null;
  standings: { id: number; name: string; color: string; total: number; goal: number | null }[];
  error?: string;
}

export interface TrackBearData {
  fetchedAt: number;
  projects: Project[];
  goals: Goal[];
  tallies: Tally[];
  days: DayCount[];
  boards: BoardWithStandings[];
  /** completed boards left out because of the "hide completed" setting */
  hiddenBoards: number;
}
