import { MarkdownRenderChild, Notice, Plugin, TFile } from 'obsidian';
import { TrackBearApi } from './src/api';
import { fmtCount, overallStats } from './src/compute';
import { ALL_SECTIONS, optionsFromSettings, pickMeasure, renderDashboard, type Section } from './src/render';
import { DEFAULT_SETTINGS, TrackBearSettingTab, type TrackBearSettings } from './src/settings';
import type { Measure, TrackBearData } from './src/types';
import { TrackBearView, VIEW_TYPE_TRACKBEAR } from './src/view';
import { LogProgressModal, type LogModalOptions } from './src/log-modal';
import { NoteSync } from './src/sync';
import { countWords } from './src/wordcount';

const MEASURES = ['word', 'time', 'page', 'chapter', 'scene', 'line'];

export default class TrackBearPlugin extends Plugin {
  settings: TrackBearSettings = { ...DEFAULT_SETTINGS };
  data: TrackBearData | null = null;
  error: string | null = null;
  loading = false;
  sync = new NoteSync(this);

  private listeners = new Set<() => void>();
  private refreshTimer: number | null = null;
  private autoSyncTimer: number | null = null;
  private statusEl: HTMLElement | null = null;
  private inflight: Promise<void> | null = null;

  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE_TRACKBEAR, leaf => new TrackBearView(leaf, this));
    this.addSettingTab(new TrackBearSettingTab(this.app, this));
    this.addRibbonIcon('paw-print', 'Open TrackBear stats', () => void this.activateView());

    this.addCommand({ id: 'open-view', name: 'Open stats panel', callback: () => void this.activateView() });
    this.addCommand({ id: 'refresh', name: 'Refresh stats', callback: () => void this.refresh() });

    // ---- logging from the vault ----
    this.addCommand({ id: 'log-progress', name: 'Log progress…', callback: () => this.openLogModal() });
    this.addCommand({
      id: 'log-current-note',
      name: 'Log word count of current note (or selection)…',
      editorCallback: (editor, ctx) => {
        const sel = editor.getSelection();
        const file = ctx.file;
        const text = sel || editor.getValue();
        this.openLogModal({
          count: countWords(text),
          projectId: file ? this.projectIdFor(file) : undefined,
          source: sel ? 'Words in your selection' : `Words in ${file?.basename ?? 'this note'}`,
        });
      },
    });
    this.addCommand({ id: 'sync-linked-notes', name: 'Sync word counts of linked notes', callback: () => void this.sync.sync() });
    this.addCommand({
      id: 'sync-current-note',
      name: 'Sync word count of current note',
      checkCallback: checking => {
        const file = this.app.workspace.getActiveFile();
        if(!file || file.extension !== 'md' || !this.sync.linkedValue(file)) return false;
        if(!checking) void this.sync.sync({ only: [file] });
        return true;
      },
    });

    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => {
      const sel = editor.getSelection();
      menu.addItem(item => item
        .setTitle(sel ? 'TrackBear: log selection\'s words' : 'TrackBear: log this note\'s words')
        .setIcon('paw-print')
        .onClick(() => {
          const file = info.file;
          this.openLogModal({
            count: countWords(sel || editor.getValue()),
            projectId: file ? this.projectIdFor(file) : undefined,
            source: sel ? 'Words in your selection' : `Words in ${file?.basename ?? 'this note'}`,
          });
        }));
    }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if(!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(item => item.setTitle('TrackBear: log word count').setIcon('paw-print').onClick(async () => {
        this.openLogModal({
          count: countWords(await this.app.vault.cachedRead(file)),
          projectId: this.projectIdFor(file),
          source: `Words in ${file.basename}`,
        });
      }));
      if(this.sync.linkedValue(file)) {
        menu.addItem(item => item.setTitle('TrackBear: sync word count').setIcon('refresh-cw')
          .onClick(() => void this.sync.sync({ only: [file] })));
      }
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.sync.onRename(oldPath, file.path)));
    this.registerEvent(this.app.vault.on('delete', file => this.sync.onDelete(file.path)));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('tb-statusbar');
    this.statusEl.onClickEvent(() => void this.activateView());
    this.updateStatusBar();

    this.registerMarkdownCodeBlockProcessor('trackbear', (source, el, ctx) => {
      const child = new TrackBearBlock(el, this, source);
      ctx.addChild(child);
    });

    this.app.workspace.onLayoutReady(() => {
      if(this.settings.apiKey) void this.refresh();
    });
    this.scheduleRefresh();
    this.scheduleAutoSync();
  }

  onunload() {
    if(this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    if(this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
  }

  openLogModal(opts: LogModalOptions = {}) {
    if(!this.settings.apiKey) { new Notice('TrackBear: add your API key in settings first.'); this.openSettings(); return; }
    new LogProgressModal(this.app, this, opts).open();
  }

  projectIdFor(file: TFile): number | undefined {
    const v = this.sync.linkedValue(file);
    if(!v) return undefined;
    return this.sync.resolveProject(v, this.data?.projects ?? [])?.id;
  }

  scheduleAutoSync() {
    if(this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
    this.autoSyncTimer = null;
    const mins = this.settings.autoSyncMinutes;
    if(mins > 0) {
      this.autoSyncTimer = window.setInterval(() => void this.sync.sync({ quiet: true }), Math.max(1, mins) * 60_000);
      this.registerInterval(this.autoSyncTimer);
    }
  }

  // ---------- data ----------

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    this.updateStatusBar();
    for(const fn of this.listeners) {
      try { fn(); } catch(e) { console.error('TrackBear render error', e); }
    }
  }

  refresh(): Promise<void> {
    if(this.inflight) return this.inflight;
    if(!this.settings.apiKey) { this.error = null; this.notify(); return Promise.resolve(); }

    this.loading = true;
    this.notify();
    const api = new TrackBearApi(this.settings.baseUrl, this.settings.apiKey);
    this.inflight = api.fetchAll(this.settings.maxLeaderboards, this.settings.hideEndedLeaderboards)
      .then(d => { this.data = d; this.error = null; })
      .catch(err => { this.error = (err as Error).message; console.error('TrackBear', err); })
      .finally(() => { this.loading = false; this.inflight = null; this.notify(); });
    return this.inflight;
  }

  scheduleRefresh() {
    if(this.refreshTimer !== null) window.clearInterval(this.refreshTimer);
    this.refreshTimer = null;
    const mins = this.settings.refreshMinutes;
    if(mins > 0) {
      this.refreshTimer = window.setInterval(() => void this.refresh(), Math.max(1, mins) * 60_000);
      this.registerInterval(this.refreshTimer);
    }
  }

  statusText(): string {
    if(this.loading) return 'Refreshing…';
    if(!this.data) return '';
    const mins = Math.floor((Date.now() - this.data.fetchedAt) / 60_000);
    return mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins}m ago` : `Updated ${Math.floor(mins / 60)}h ago`;
  }

  private updateStatusBar() {
    if(!this.statusEl) return;
    if(!this.settings.showStatusBar || !this.data) { this.statusEl.hide(); return; }
    const measure = pickMeasure(this.data, this.settings.measure);
    const st = overallStats(this.data.days, measure, this.settings.weekStartsOn);
    this.statusEl.setText(`🐻 ${fmtCount(st.today, measure)} today` + (st.currentStreak > 1 ? ` · ${st.currentStreak}-day streak` : ''));
    this.statusEl.setAttr('aria-label', 'Open TrackBear stats');
    this.statusEl.show();
  }

  // ---------- ui ----------

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_TRACKBEAR)[0];
    if(!leaf) {
      const right = workspace.getRightLeaf(false);
      if(!right) return;
      await right.setViewState({ type: VIEW_TYPE_TRACKBEAR, active: true });
      leaf = right;
    }
    workspace.revealLeaf(leaf);
  }

  openSettings() {
    // `setting` is an internal but stable API used widely by community plugins
    const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
    setting?.open();
    setting?.openTabById(this.manifest.id);
  }

  async loadSettings() {
    const saved = (await this.loadData()) ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
    this.settings.baselines = { ...(saved.baselines ?? {}) };

    // v1 -> v2: completed leaderboards hidden and finished projects shown by default.
    // Saved v1 settings store the old defaults, so apply the new ones once.
    if((saved.settingsVersion ?? 1) < 2) {
      const legacy = saved as { showInactiveProjects?: boolean };
      this.settings.hideEndedLeaderboards = true;
      this.settings.showFinishedProjects = true;
      this.settings.showAbandonedProjects = legacy.showInactiveProjects ?? false;
      delete (this.settings as unknown as Record<string, unknown>).showInactiveProjects;
      this.settings.settingsVersion = 2;
      if(Object.keys(saved).length) await this.saveSettings();
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

/** Renders a ```trackbear``` code block and re-renders whenever data refreshes. */
class TrackBearBlock extends MarkdownRenderChild {
  private sections: Section[] = ALL_SECTIONS;
  private measure: Measure | 'auto' | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(el: HTMLElement, private plugin: TrackBearPlugin, source: string) {
    super(el);
    for(const raw of source.split('\n')) {
      const m = raw.match(/^\s*(\w+)\s*:\s*(.+?)\s*$/);
      if(!m) continue;
      const key = m[1].toLowerCase(), val = m[2].toLowerCase();
      if(key === 'show') {
        const parts = val.split(/[\s,]+/).map(p => (p === 'boards' ? 'leaderboards' : p) as Section)
          .filter(p => ALL_SECTIONS.includes(p));
        if(parts.length) this.sections = parts;
      }
      if(key === 'measure' && (val === 'auto' || MEASURES.includes(val))) this.measure = val as Measure | 'auto';
    }
  }

  onload() {
    this.unsubscribe = this.plugin.subscribe(() => this.render());
    this.render();
    if(!this.plugin.data && !this.plugin.loading && this.plugin.settings.apiKey) void this.plugin.refresh();
  }

  onunload() {
    this.unsubscribe?.();
  }

  private render() {
    const el = this.containerEl;
    el.empty();
    el.addClass('trackbear-block');
    const p = this.plugin;
    if(!p.settings.apiKey) { el.createDiv({ cls: 'tb-empty', text: 'TrackBear: add your API key in settings.' }); return; }
    if(p.error) el.createDiv({ cls: 'tb-error', text: p.error });
    if(!p.data) { el.createDiv({ cls: 'tb-empty', text: 'Loading TrackBear stats…' }); return; }
    renderDashboard(el, p.data, optionsFromSettings(p.settings, this.sections, this.measure));
  }
}
