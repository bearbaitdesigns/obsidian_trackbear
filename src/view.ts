import { ItemView, setIcon, type WorkspaceLeaf } from 'obsidian';
import type TrackBearPlugin from '../main';
import { ALL_SECTIONS, optionsFromSettings, renderDashboard, type Section } from './render';

export const VIEW_TYPE_TRACKBEAR = 'trackbear-stats-view';

const TABS: { id: 'all' | Section; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stats', label: 'Stats' },
  { id: 'projects', label: 'Projects' },
  { id: 'goals', label: 'Goals' },
  { id: 'leaderboards', label: 'Boards' },
];

export class TrackBearView extends ItemView {
  private tab: 'all' | Section = 'all';
  private unsubscribe: (() => void) | null = null;
  private ticker: number | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: TrackBearPlugin) {
    super(leaf);
  }

  getViewType() { return VIEW_TYPE_TRACKBEAR; }
  getDisplayText() { return 'TrackBear'; }
  getIcon() { return 'paw-print'; }

  async onOpen() {
    this.unsubscribe = this.plugin.subscribe(() => this.render());
    // keep the "updated x ago" label fresh
    this.ticker = window.setInterval(() => this.updateTimestamp(), 30_000);
    this.registerInterval(this.ticker);
    this.render();
    if(!this.plugin.data && !this.plugin.loading) void this.plugin.refresh();
  }

  async onClose() {
    this.unsubscribe?.();
  }

  private updateTimestamp() {
    const el = this.contentEl.querySelector('.tb-updated');
    if(el) el.textContent = this.plugin.statusText();
  }

  render() {
    const root = this.contentEl;
    root.empty();
    root.addClass('trackbear-view');

    const header = root.createDiv({ cls: 'tb-header' });
    const brand = header.createDiv({ cls: 'tb-brand' });
    setIcon(brand.createSpan({ cls: 'tb-brand-icon' }), 'paw-print');
    brand.createSpan({ text: 'TrackBear', cls: 'tb-brand-name' });
    const right = header.createDiv({ cls: 'tb-header-right' });
    right.createSpan({ cls: 'tb-updated', text: this.plugin.statusText() });
    const log = right.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Log progress' } });
    setIcon(log, 'plus-circle');
    log.onclick = () => this.plugin.openLogModal();
    const btn = right.createEl('button', { cls: 'clickable-icon tb-refresh', attr: { 'aria-label': 'Refresh' } });
    setIcon(btn, 'refresh-cw');
    if(this.plugin.loading) btn.addClass('is-loading');
    btn.onclick = () => void this.plugin.refresh();

    const tabs = root.createDiv({ cls: 'tb-tabs' });
    for(const t of TABS) {
      const b = tabs.createEl('button', { text: t.label, cls: 'tb-tab' + (t.id === this.tab ? ' is-active' : '') });
      b.onclick = () => { this.tab = t.id; this.render(); };
    }

    const body = root.createDiv({ cls: 'tb-body' });
    const s = this.plugin.settings;

    if(!s.apiKey) {
      const e = body.createDiv({ cls: 'tb-empty tb-setup' });
      e.createEl('p', { text: 'Connect your TrackBear account to see your stats here.' });
      e.createEl('p', { cls: 'tb-muted', text: 'Create an API key on TrackBear under Settings → API keys, then paste it into this plugin\'s settings.' });
      const open = e.createEl('button', { text: 'Open settings', cls: 'mod-cta' });
      open.onclick = () => this.plugin.openSettings();
      return;
    }
    if(this.plugin.error) {
      body.createDiv({ cls: 'tb-error', text: this.plugin.error });
    }
    if(!this.plugin.data) {
      if(this.plugin.loading) body.createDiv({ cls: 'tb-empty', text: 'Loading your stats…' });
      return;
    }

    renderDashboard(body, this.plugin.data, optionsFromSettings(s, this.tab === 'all' ? ALL_SECTIONS : [this.tab]));
  }
}
