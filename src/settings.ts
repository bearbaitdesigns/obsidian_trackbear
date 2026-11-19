import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type TrackBearPlugin from '../main';
import { TrackBearApi } from './api';
import type { Measure } from './types';
import type { NoteBaseline } from './sync';

export interface TrackBearSettings {
  apiKey: string;
  baseUrl: string;
  refreshMinutes: number;
  measure: Measure | 'auto';
  weekStartsOn: number;
  heatmapWeeks: number;
  maxLeaderboards: number;
  showInactiveProjects: boolean;
  showStatusBar: boolean;
  // logging from the vault
  projectProperty: string;
  autoSyncMinutes: number;
  countExistingWords: boolean;
  onlyLogIncreases: boolean;
  syncNote: string;
  syncTags: string;
  lastProjectId: number | null;
  baselines: Record<string, NoteBaseline>;
}

export const DEFAULT_SETTINGS: TrackBearSettings = {
  apiKey: '',
  baseUrl: 'https://trackbear.app',
  refreshMinutes: 15,
  measure: 'auto',
  weekStartsOn: 0,
  heatmapWeeks: 20,
  maxLeaderboards: 5,
  showInactiveProjects: false,
  showStatusBar: true,
  projectProperty: 'trackbear',
  autoSyncMinutes: 0,
  countExistingWords: false,
  onlyLogIncreases: false,
  syncNote: 'Synced from Obsidian',
  syncTags: '',
  lastProjectId: null,
  baselines: {},
};

export class TrackBearSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TrackBearPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.plugin.settings;
    const save = async (refresh = false) => {
      await this.plugin.saveSettings();
      if(refresh) void this.plugin.refresh(); else this.plugin.notify();
    };

    const keyDesc = createFragment(f => {
      f.appendText('Create one on TrackBear under ');
      const a = f.createEl('a', { text: 'Settings → API keys', href: 'https://trackbear.app/account/api-keys' });
      a.setAttr('target', '_blank');
      f.appendText('. It starts with "tb." and is stored in this vault\'s plugin data.');
    });

    new Setting(containerEl)
      .setName('API key')
      .setDesc(keyDesc)
      .addText(t => {
        t.inputEl.type = 'password';
        t.inputEl.addClass('tb-key-input');
        t.setPlaceholder('tb.xxxxxxxxxxxxxxxx')
          .setValue(s.apiKey)
          .onChange(async v => { s.apiKey = v.trim(); await this.plugin.saveSettings(); });
      })
      .addButton(b => b.setButtonText('Test').onClick(async () => {
        if(!s.apiKey) { new Notice('Enter an API key first.'); return; }
        b.setDisabled(true);
        try {
          await new TrackBearApi(s.baseUrl, s.apiKey).ping();
          new Notice('TrackBear: connected.');
          void this.plugin.refresh();
        } catch(err) {
          new Notice(`TrackBear: ${(err as Error).message}`);
        } finally {
          b.setDisabled(false);
        }
      }));

    new Setting(containerEl)
      .setName('Auto-refresh')
      .setDesc('Minutes between automatic refreshes. Set 0 to refresh only on demand.')
      .addText(t => t.setValue(String(s.refreshMinutes)).onChange(async v => {
        const n = Number(v);
        if(Number.isFinite(n) && n >= 0) { s.refreshMinutes = n; await this.plugin.saveSettings(); this.plugin.scheduleRefresh(); }
      }));

    new Setting(containerEl)
      .setName('Measure for stats')
      .setDesc('What the stats cards and heatmap count. Automatic picks the measure you log most.')
      .addDropdown(d => d
        .addOptions({ auto: 'Automatic', word: 'Words', time: 'Time', page: 'Pages', chapter: 'Chapters', scene: 'Scenes', line: 'Lines' })
        .setValue(s.measure)
        .onChange(async v => { s.measure = v as TrackBearSettings['measure']; await save(); }));

    new Setting(containerEl)
      .setName('Week starts on')
      .setDesc('Match your TrackBear setting so weekly totals and habit goals line up.')
      .addDropdown(d => d
        .addOptions({ '0': 'Sunday', '1': 'Monday', '6': 'Saturday' })
        .setValue(String(s.weekStartsOn))
        .onChange(async v => { s.weekStartsOn = Number(v); await save(); }));

    new Setting(containerEl)
      .setName('Heatmap weeks')
      .addSlider(sl => sl.setLimits(4, 52, 1).setValue(s.heatmapWeeks).setDynamicTooltip()
        .onChange(async v => { s.heatmapWeeks = v; await save(); }));

    new Setting(containerEl)
      .setName('Leaderboards to show')
      .setDesc('Starred boards come first. Each board is one extra request per refresh.')
      .addSlider(sl => sl.setLimits(0, 20, 1).setValue(s.maxLeaderboards).setDynamicTooltip()
        .onChange(async v => { s.maxLeaderboards = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Show finished and abandoned projects')
      .addToggle(t => t.setValue(s.showInactiveProjects).onChange(async v => { s.showInactiveProjects = v; await save(); }));

    new Setting(containerEl)
      .setName('Show today\'s count in the status bar')
      .addToggle(t => t.setValue(s.showStatusBar).onChange(async v => { s.showStatusBar = v; await save(); }));

    new Setting(containerEl)
      .setName('Server URL')
      .setDesc('Change only if you self-host TrackBear.')
      .addText(t => t.setPlaceholder(DEFAULT_SETTINGS.baseUrl).setValue(s.baseUrl).onChange(async v => {
        s.baseUrl = v.trim() || DEFAULT_SETTINGS.baseUrl; await this.plugin.saveSettings();
      }));

    new Setting(containerEl).setName('Logging from your vault').setHeading();
    containerEl.createDiv({ cls: 'setting-item-description tb-settings-note' }).setText(
      'Link a note to a project by adding a property to its frontmatter, for example "trackbear: The Salt Orchard" (the project title or its ID). '
      + 'Syncing logs the words you\'ve added to linked notes since the last sync. You can also log progress by hand with the "Log progress" command.');

    new Setting(containerEl)
      .setName('Project property')
      .setDesc('Frontmatter property that links a note to a TrackBear project.')
      .addText(t => t.setPlaceholder('trackbear').setValue(s.projectProperty).onChange(async v => {
        s.projectProperty = v.trim() || DEFAULT_SETTINGS.projectProperty; await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName('Auto-sync linked notes')
      .setDesc('Minutes between automatic syncs. Set 0 to sync only when you run the command.')
      .addText(t => t.setValue(String(s.autoSyncMinutes)).onChange(async v => {
        const n = Number(v);
        if(Number.isFinite(n) && n >= 0) { s.autoSyncMinutes = n; await this.plugin.saveSettings(); this.plugin.scheduleAutoSync(); }
      }));

    new Setting(containerEl)
      .setName('Count existing words when a note is first linked')
      .setDesc('Off: only words written after linking are logged, so text already counted on TrackBear isn\'t counted twice. On: the note\'s full word count is logged on its first sync.')
      .addToggle(t => t.setValue(s.countExistingWords).onChange(async v => { s.countExistingWords = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Only log increases')
      .setDesc('Off: deleting words logs a negative count, like TrackBear\'s own net tracking. On: deletions are ignored.')
      .addToggle(t => t.setValue(s.onlyLogIncreases).onChange(async v => { s.onlyLogIncreases = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Note for synced progress')
      .addText(t => t.setValue(s.syncNote).onChange(async v => { s.syncNote = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Tags for synced progress')
      .setDesc('Optional, comma-separated.')
      .addText(t => t.setPlaceholder('obsidian').setValue(s.syncTags).onChange(async v => { s.syncTags = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Reset sync history')
      .setDesc(`Forget the last-synced word count of ${Object.keys(s.baselines).length} tracked notes. The next sync starts tracking them fresh.`)
      .addButton(b => b.setButtonText('Reset').setWarning().onClick(async () => {
        s.baselines = {}; await this.plugin.saveSettings(); new Notice('TrackBear: sync history reset.'); this.display();
      }));

    new Setting(containerEl).setName('Embedding in notes').setHeading();
    const p = containerEl.createDiv({ cls: 'setting-item-description' });
    p.createEl('p', { text: 'Add a trackbear code block to any note. It renders in Reading view and Live Preview:' });
    p.createEl('pre').createEl('code', { text: '```trackbear\nshow: stats, goals\nmeasure: word\n```' });
    p.createEl('p', { text: 'show accepts any of: stats, projects, goals, leaderboards (default: all).' });
  }
}
