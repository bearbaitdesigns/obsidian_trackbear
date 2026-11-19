import { App, Modal, Notice, Setting } from 'obsidian';
import type TrackBearPlugin from '../main';
import { TrackBearApi } from './api';
import { fmtCount, fmtDate } from './compute';
import type { Measure, Project } from './types';

export interface LogModalOptions {
  count?: number;
  projectId?: number;
  note?: string;
  /** label shown under the count, e.g. "Current note: Chapter 3.md" */
  source?: string;
}

const MEASURE_OPTIONS: Record<Measure, string> = {
  word: 'Words', time: 'Time (minutes)', page: 'Pages', chapter: 'Chapters', scene: 'Scenes', line: 'Lines',
};
const INACTIVE = new Set(['finished', 'abandoned']);

export class LogProgressModal extends Modal {
  private projectId: number | null = null;
  private measure: Measure = 'word';
  private mode: 'add' | 'total' = 'add';
  private count = '';
  private date = fmtDate(new Date());
  private note = '';
  private tags = '';
  private errorEl: HTMLElement | null = null;
  private submitting = false;

  constructor(app: App, private plugin: TrackBearPlugin, private opts: LogModalOptions = {}) {
    super(app);
    if(opts.count !== undefined) this.count = String(opts.count);
    if(opts.note) this.note = opts.note;
    this.projectId = opts.projectId ?? plugin.settings.lastProjectId ?? null;
  }

  async onOpen() {
    this.titleEl.setText('Log progress to TrackBear');
    this.modalEl.addClass('tb-log-modal');
    if(!this.plugin.data) {
      this.contentEl.createDiv({ cls: 'tb-muted', text: 'Loading your projects…' });
      await this.plugin.refresh();
    }
    this.render();
  }

  onClose() { this.contentEl.empty(); }

  private projects(): Project[] {
    const all = this.plugin.data?.projects ?? [];
    return [...all].sort((a, b) =>
      Number(INACTIVE.has(a.phase)) - Number(INACTIVE.has(b.phase)) ||
      Number(b.starred) - Number(a.starred) ||
      (b.lastUpdated ?? '').localeCompare(a.lastUpdated ?? ''));
  }

  private render() {
    const { contentEl } = this;
    contentEl.empty();

    const projects = this.projects();
    if(projects.length === 0) {
      contentEl.createDiv({ cls: 'tb-error', text: this.plugin.error ?? 'No TrackBear projects found. Create one on TrackBear first.' });
      return;
    }
    if(!this.projectId || !projects.some(p => p.id === this.projectId)) this.projectId = projects[0].id;

    new Setting(contentEl).setName('Project').addDropdown(d => {
      for(const p of projects) d.addOption(String(p.id), INACTIVE.has(p.phase) ? `${p.title} (${p.phase})` : p.title);
      d.setValue(String(this.projectId)).onChange(v => { this.projectId = Number(v); this.render(); });
    });

    new Setting(contentEl).setName('Measure').addDropdown(d => d
      .addOptions(MEASURE_OPTIONS).setValue(this.measure)
      .onChange(v => { this.measure = v as Measure; this.render(); }));

    const project = projects.find(p => p.id === this.projectId);
    const currentTotal = project ? (project.totals?.[this.measure] ?? 0) : 0;

    new Setting(contentEl)
      .setName('Type')
      .setDesc(this.mode === 'add'
        ? 'Adds this amount to the project.'
        : `Sets the project's running total. TrackBear logs the difference from ${fmtCount(currentTotal, this.measure)}.`)
      .addDropdown(d => d
        .addOptions({ add: 'Add progress', total: 'Set new total' })
        .setValue(this.mode)
        .onChange(v => { this.mode = v as 'add' | 'total'; this.render(); }));

    const countSetting = new Setting(contentEl)
      .setName(this.mode === 'add' ? 'Amount' : 'New total')
      .addText(t => {
        t.inputEl.type = 'number';
        t.inputEl.step = '1';
        t.setValue(this.count).onChange(v => { this.count = v; this.clearError(); });
        window.setTimeout(() => t.inputEl.focus(), 0);
      });
    if(this.opts.source) countSetting.setDesc(this.opts.source);

    if(this.mode === 'total' && this.measure === 'word' && this.projectId) {
      const linked = this.plugin.sync.linkedFiles(this.projectId);
      if(linked.length > 0) {
        countSetting.addButton(b => b
          .setButtonText(`Use linked notes (${linked.length})`)
          .setTooltip('Total word count of all notes linked to this project')
          .onClick(async () => {
            const total = await this.plugin.sync.totalWords(linked);
            this.count = String(total);
            this.render();
          }));
      }
    }

    new Setting(contentEl).setName('Date').addText(t => {
      t.inputEl.type = 'date';
      t.setValue(this.date).onChange(v => { this.date = v; });
    });

    new Setting(contentEl).setName('Note').setDesc('Optional').addText(t => t
      .setPlaceholder('Finished chapter 3')
      .setValue(this.note).onChange(v => { this.note = v; }));

    new Setting(contentEl).setName('Tags').setDesc('Optional, comma-separated. New tags are created.').addText(t => t
      .setPlaceholder('sprint, morning')
      .setValue(this.tags).onChange(v => { this.tags = v; }));

    this.errorEl = contentEl.createDiv({ cls: 'tb-error' });
    this.errorEl.hide();

    new Setting(contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('Log').setCta().onClick(() => void this.submit()));

    contentEl.addEventListener('keydown', e => {
      if(e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) { e.preventDefault(); void this.submit(); }
    });
  }

  private showError(msg: string) { if(this.errorEl) { this.errorEl.setText(msg); this.errorEl.show(); } }
  private clearError() { this.errorEl?.hide(); }

  private async submit() {
    if(this.submitting) return;
    const n = Number(this.count);
    if(this.count.trim() === '' || !Number.isInteger(n)) { this.showError('Enter a whole number.'); return; }
    if(this.mode === 'add' && n === 0) { this.showError('Enter an amount other than 0.'); return; }
    if(this.mode === 'total' && n < 0) { this.showError('A total can\'t be negative.'); return; }
    if(!/^\d{4}-\d{2}-\d{2}$/.test(this.date)) { this.showError('Pick a date.'); return; }
    if(!this.projectId) { this.showError('Pick a project.'); return; }

    this.submitting = true;
    const s = this.plugin.settings;
    try {
      const tally = await new TrackBearApi(s.baseUrl, s.apiKey).createTally({
        date: this.date,
        measure: this.measure,
        count: n,
        setTotal: this.mode === 'total',
        note: this.note.trim(),
        workId: this.projectId,
        tags: this.tags.split(',').map(t => t.trim()).filter(Boolean),
      });
      s.lastProjectId = this.projectId;
      await this.plugin.saveSettings();
      const title = this.projects().find(p => p.id === this.projectId)?.title ?? 'project';
      new Notice(`TrackBear: logged ${fmtCount(tally.count, this.measure)} to ${title}.`);
      this.close();
      void this.plugin.refresh();
    } catch(err) {
      this.showError((err as Error).message);
    } finally {
      this.submitting = false;
    }
  }
}
