# TrackBear Stats for Obsidian

Shows your [TrackBear](https://trackbear.app) writing data inside Obsidian and lets you log progress without leaving your vault. You can see your stats, current projects, goals, and leaderboards in a sidebar panel, embed them in any note, glance at today's count in the status bar, and send word counts from your notes straight to TrackBear.

By [bearbaitdesigns](https://github.com/bearbaitdesigns).

## Features

- **Sidebar panel** with tabs for All, Stats, Projects, Goals, and Boards. Open it from the paw-print ribbon icon or with the command **TrackBear Stats: Open stats panel**.
- **Stats**: today, this week, this month, all time, current and longest daily streak, 30-day average, best day, and a heatmap of recent weeks.
- **Projects**: your active projects (starred projects first) with their phase, totals for each measure, and when you last logged progress.
- **Goals**:
  - Target goals show a progress bar, days left, and how much you need per day to finish.
  - Habit goals show your current and longest streak and a strip of recent periods. Streaks are counted the same way TrackBear counts them.
- **Leaderboards**: the top 5 on each board, plus your own row if you're further down. Fundraiser boards also show the group's combined progress.
- **Status bar**: today's count and your current streak. Click it to open the panel.
- **Embeds**: add a `trackbear` code block to any note. It renders in both Reading view and Live Preview:

  ````markdown
  ```trackbear
  show: stats, goals
  measure: word
  ```
  ````

  `show` takes any of `stats`, `projects`, `goals`, `leaderboards` (or `boards`). If you leave it out, every section is shown. `measure` takes `word`, `time`, `page`, `chapter`, `scene`, `line`, or `auto`.

## Logging progress from your vault

You can log progress by hand, or sync it automatically from notes you link to a project.

### Log by hand

- Run the command **TrackBear Stats: Log progress…**, or click the ⊕ button in the panel header.
- Run **Log word count of current note (or selection)…**, or right-click in the editor or on a file. The amount is filled in with the word count of the note or your selection.

In the dialog, pick a project, a measure (words, time, pages, chapters, scenes, or lines), an amount, a date, and optionally a note and tags. You can either:

- **Add progress**: adds the amount to the project.
- **Set new total**: TrackBear logs the difference between the number you enter and the project's current total. The **Use linked notes** button fills in the combined word count of every note linked to the project.

### Sync linked notes

1. Link a note to a project with a frontmatter property. You can use the project's title or its ID (the number in its TrackBear URL):

   ```yaml
   ---
   trackbear: The Salt Orchard
   ---
   ```

2. Run **Sync word counts of linked notes**, or turn on **Auto-sync** in settings.

Each sync logs the words added since the last sync, as one entry per project. The first time a note is synced, the plugin only records its current word count as a starting point, so words already counted on TrackBear aren't counted twice. If you want a note's existing words logged on its first sync, turn on **Count existing words** in settings.

By default, deleting words logs a negative amount, which matches how TrackBear tracks net progress. Turn on **Only log increases** to ignore deletions.

Word counts leave out frontmatter, `%% comments %%`, HTML comments, and link targets. Each CJK character counts as one word.

## Setup

1. On TrackBear, go to **Account → API keys** (https://trackbear.app/account/api-keys) and create a key. It starts with `tb.`.
2. In Obsidian, go to **Settings → TrackBear Stats**, paste the key, and click **Test**.

The key is saved in `.obsidian/plugins/trackbear-stats/data.json` inside your vault. Leave that file out if you sync or share your vault publicly.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Auto-refresh | 15 min | Set it to 0 to refresh only when you ask (use the refresh button or the command). |
| Measure for stats | Automatic | Automatic uses whichever measure you log most. |
| Week starts on | Sunday | Set this to match your TrackBear setting. The API key can't read your TrackBear preferences, so this has to be set here. |
| Heatmap weeks | 20 | 4–52 |
| Leaderboards to show | 5 | Each board adds 2 requests per refresh. |
| Hide completed leaderboards | Off | Hides boards whose end date has passed. They also stop counting toward "Leaderboards to show". |
| Show finished/abandoned projects | Off | |
| Status bar | On | |
| Server URL | https://trackbear.app | Change this only if you self-host TrackBear. |
| Project property | `trackbear` | The frontmatter property that links a note to a project. |
| Auto-sync linked notes | 0 (off) | Minutes between automatic syncs. |
| Count existing words when a note is first linked | Off | |
| Only log increases | Off | |
| Note / tags for synced progress | "Synced from Obsidian" | Added to every entry a sync creates. |
| Reset sync history | | Forgets the last-synced word count of every note. |

## Install

**With BRAT:** install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, choose **Add beta plugin**, and enter `bearbaitdesigns/obsidian_trackbear`.

**Manual:** download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/bearbaitdesigns/obsidian_trackbear/releases/latest) into `<your vault>/.obsidian/plugins/trackbear-stats/`. Then reload Obsidian and turn on **TrackBear Stats** under Community plugins.

**From source:**

```bash
npm install
npm run build      # outputs main.js
```

## Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`):

```bash
npm version minor        # bumps package.json, manifest.json and versions.json, commits, and tags e.g. 1.1.0
git push --follow-tags   # pushing triggers the Release workflow
```

Pushing a new version in `manifest.json` to `main` is enough by itself: if that version has no release yet, the workflow tags and releases it. A tag push works too.

Or, without pushing a tag: go to **Actions → Release → Run workflow**. Leave the version blank to release the version in `manifest.json`; the workflow creates the tag for you.

The workflow checks that the version matches `manifest.json`, runs the build, and publishes a GitHub release with `main.js`, `manifest.json`, `styles.css`, and a zip of all three. Running it again for a version that already has a release replaces that release's files.

## How it works

The plugin calls the TrackBear v1 API (`/api/v1/...`) with `Authorization: Bearer <key>`. It uses Obsidian's `requestUrl`, which works on desktop and mobile and isn't blocked by CORS. These are the endpoints it reads:

- `GET /project`: projects with their totals
- `GET /goal` and `GET /tally`: goal definitions and the tallies used to calculate progress and streaks
- `GET /stats/days`: per-day totals for the stats cards and heatmap
- `GET /leaderboard`, `GET /leaderboard/:uuid/participants`, `GET /leaderboard/:uuid/me`: leaderboards, standings, and which row is yours
- `POST /tally`: logs progress, either by hand or from a sync

The plugin only writes to TrackBear when you log progress or a sync runs. Each note's last-synced word count is stored in the plugin's `data.json`.
