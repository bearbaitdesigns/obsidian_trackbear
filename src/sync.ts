import { Notice, TFile } from 'obsidian';
import type TrackBearPlugin from '../main';
import { TrackBearApi } from './api';
import { fmtCount, fmtDate } from './compute';
import type { Project } from './types';
import { countWords } from './wordcount';

export interface NoteBaseline { projectId: number; words: number }

export interface SyncResult {
  logged: { project: string; count: number }[];
  newlyTracked: number;
  errors: string[];
}

/**
 * Keeps notes linked to TrackBear projects (via a frontmatter property) in sync.
 * For each note we remember the word count we last reported; a sync logs the
 * difference since then as one tally per project.
 */
export class NoteSync {
  private running = false;

  constructor(private plugin: TrackBearPlugin) {}

  private get app() { return this.plugin.app; }

  /** Reads the project a note is linked to from its frontmatter. */
  linkedValue(file: TFile): string | null {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const raw = fm?.[this.plugin.settings.projectProperty];
    if(raw === undefined || raw === null || raw === '') return null;
    return String(Array.isArray(raw) ? raw[0] : raw).trim();
  }

  resolveProject(value: string, projects: Project[]): Project | null {
    const v = value.replace(/^#/, '').trim();
    if(/^\d+$/.test(v)) return projects.find(p => p.id === Number(v)) ?? null;
    const lower = v.toLowerCase();
    return projects.find(p => p.title.toLowerCase() === lower) ?? null;
  }

  /** All markdown files linked to the given project (or to any project). */
  linkedFiles(projectId?: number): TFile[] {
    const projects = this.plugin.data?.projects ?? [];
    return this.app.vault.getMarkdownFiles().filter(f => {
      const v = this.linkedValue(f);
      if(!v) return false;
      if(projectId === undefined) return true;
      return this.resolveProject(v, projects)?.id === projectId;
    });
  }

  async totalWords(files: TFile[]): Promise<number> {
    let total = 0;
    for(const f of files) total += countWords(await this.app.vault.cachedRead(f));
    return total;
  }

  onRename(oldPath: string, newPath: string) {
    const b = this.plugin.settings.baselines;
    if(b[oldPath]) { b[newPath] = b[oldPath]; delete b[oldPath]; void this.plugin.saveSettings(); }
  }

  onDelete(path: string) {
    const b = this.plugin.settings.baselines;
    if(b[path]) { delete b[path]; void this.plugin.saveSettings(); }
  }

  /**
   * Sync linked notes. Pass `only` to restrict to specific files.
   * When `quiet` is true (auto-sync), notices are shown only for logged progress or errors.
   */
  async sync(opts: { only?: TFile[]; quiet?: boolean } = {}): Promise<SyncResult> {
    const result: SyncResult = { logged: [], newlyTracked: 0, errors: [] };
    if(this.running) return result;
    const s = this.plugin.settings;
    if(!s.apiKey) {
      if(!opts.quiet) new Notice('TrackBear: add your API key in settings first.');
      return result;
    }
    this.running = true;
    try {
      if(!this.plugin.data) await this.plugin.refresh();
      const projects = this.plugin.data?.projects ?? [];
      const files = (opts.only ?? this.linkedFiles()).filter(f => this.linkedValue(f));

      // per project: summed delta and the new baselines to commit after a successful post
      const pending = new Map<number, { project: Project; delta: number; updates: [string, NoteBaseline][] }>();
      let baselinesChanged = false;

      for(const file of files) {
        const value = this.linkedValue(file)!;
        const project = this.resolveProject(value, projects);
        if(!project) {
          result.errors.push(`${file.basename}: no TrackBear project matches "${value}".`);
          continue;
        }
        const words = countWords(await this.app.vault.cachedRead(file));
        const prev = s.baselines[file.path];

        if(!prev || prev.projectId !== project.id) {
          if(s.countExistingWords) {
            const entry = pending.get(project.id) ?? { project, delta: 0, updates: [] };
            entry.delta += words;
            entry.updates.push([file.path, { projectId: project.id, words }]);
            pending.set(project.id, entry);
          } else {
            s.baselines[file.path] = { projectId: project.id, words };
            baselinesChanged = true;
          }
          result.newlyTracked++;
          continue;
        }

        let delta = words - prev.words;
        if(delta === 0) continue;
        if(delta < 0 && s.onlyLogIncreases) {
          // move the baseline down so later growth isn't swallowed
          s.baselines[file.path] = { projectId: project.id, words };
          baselinesChanged = true;
          continue;
        }
        const entry = pending.get(project.id) ?? { project, delta: 0, updates: [] };
        entry.delta += delta;
        entry.updates.push([file.path, { projectId: project.id, words }]);
        pending.set(project.id, entry);
      }

      const api = new TrackBearApi(s.baseUrl, s.apiKey);
      const today = fmtDate(new Date());
      for(const { project, delta, updates } of pending.values()) {
        try {
          if(delta !== 0) {
            await api.createTally({
              date: today, measure: 'word', count: delta, setTotal: false,
              note: s.syncNote, workId: project.id, tags: s.syncTags.split(',').map(t => t.trim()).filter(Boolean),
            });
            result.logged.push({ project: project.title, count: delta });
          }
          for(const [path, b] of updates) s.baselines[path] = b;
          baselinesChanged = true;
        } catch(err) {
          result.errors.push(`${project.title}: ${(err as Error).message}`);
        }
      }

      if(baselinesChanged) await this.plugin.saveSettings();
      if(result.logged.length) void this.plugin.refresh();
    } finally {
      this.running = false;
    }

    this.report(result, !!opts.quiet);
    return result;
  }

  private report(r: SyncResult, quiet: boolean) {
    const lines: string[] = [];
    for(const l of r.logged) lines.push(`Logged ${fmtCount(l.count, 'word')} to ${l.project}.`);
    if(r.newlyTracked && !quiet) {
      lines.push(this.plugin.settings.countExistingWords
        ? `Started tracking ${r.newlyTracked} note${r.newlyTracked === 1 ? '' : 's'}.`
        : `Started tracking ${r.newlyTracked} note${r.newlyTracked === 1 ? '' : 's'}. New words from now on will be logged.`);
    }
    lines.push(...r.errors);
    if(!lines.length && !quiet) lines.push('No new words to log.');
    if(lines.length) new Notice('TrackBear: ' + lines.join('\n'), r.errors.length ? 8000 : 5000);
  }
}
