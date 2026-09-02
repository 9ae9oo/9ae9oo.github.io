# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

**No build step needed.** The app runs as plain HTML/CSS/JS.

- **Quick test**: Double-click `index.html` or run `python3 -m http.server 8000` and visit `http://localhost:8000`
- **Single-file build** (offline): `python3 scripts/build-single.py` → `dist/mini-workspace.html`

## Architecture Overview

This is a **single-page app with a central data store**, not component-based.

### Data Flow
- **Single source of truth**: All state lives in `MW.store` (localStorage key `mw.v1`, schema version 5)
- **Subscription pattern**: Each module subscribes to store changes and re-renders when its data changes
- **No external libraries**: Pure JS; only external request is YouTube IFrame API for music

### Module Structure
Each feature has one or more JS files under `js/`:

- **`store.js`** — Persistent state (todos, events, habits, ledger, settings). Exports `MW.store` with `.get()`, `.update()`, `.subscribe()`.
- **`shell.js`** — App shell: hash routing (`#/page`), floating windows, modals, notifications, sounds
- **`util.js`** — Shared utilities: DOM helpers (`U.el()`, `U.$()`, `U.cls()`), date formatting, week math
- **`app.js`** — Boot sequence and home dashboard (renders calendar + inbox + habits + ledger cards)
- **Feature modules** (`calendar.js`, `todo.js`, `pomodoro.js`, `memo.js`, `habits.js`, `habitgrid.js`, `work.js`, `ledger.js`, `assistants.js`, `tax.js`, `music.js`, `markdown.js`, `settings.js`)

Each feature file exports a namespace like `MW.calendar`, `MW.todo`, etc., with:
- `render(container)` — DOM render function called by shell when the page/widget is shown
- `eventX()` — Event handlers referenced in `render()` (not separate; defined inline for clarity)
- Data accessors (e.g., `MW.calendar.eventsOn(ymd)`) if the module needs to compute derivatives

### Naming Convention
- **`mw-*`** CSS classes (app-wide tokens in `css/tokens.css`)
- **`MW.*`** JS namespaces under `window.MW`
- **`U.*`** utilities from `util.js` (imported at the top of each module as `var U = MW.util`)

### Style Layers
Each CSS file handles one domain; no build step, so **all 5 CSS files must be included** in `index.html` in order:

1. `tokens.css` — Color/font vars and basic reset
2. `shell.css` — Layout, responsive breakpoint (≤900px = mobile), floating windows, modals
3. `widgets.css` — Pomodoro, inbox, memo, markdown rendering
4. `calendar.css` — Calendar views, habit grid, alarms
5. `ledger.css` — Accounting (ledger, assistants, tax reference)

## Design Principles (Enforced)

These are not suggestions; they're baked into the codebase:

- **Single source of truth** — No duplicate data. Todos, habits, transactions exist once; pages filter to show subsets.
- **Derived values never saved** — Account balance, budget remainder, tax amounts are recalculated on render.
- **One input, many screens** — Enter assistant payment once; it auto-generates ledger entry, tax table, and payroll.
- **Auto-save with feedback** — Update → localStorage immediately → toast notification (no explicit Save button).
- **Single store subscription** — When data changes, *all* subscribed modules re-render; no partial updates.

## Making Changes

### Adding a Feature
1. Create `js/new-feature.js` with `window.MW.newFeature = { render: function(el) { ... }, ... }`
2. Subscribe to store in `render()`: `MW.store.subscribe('path.to.data', function() { MW.newFeature.render(container); })`
3. Include the file in `index.html` after `app.js`
4. Add route in `shell.js` if it needs a page (not just a floating widget)
5. Update `css/shell.css` or new file if layout differs from existing widgets

### Modifying Store Schema
- Increment `VERSION` in `store.js` and add a migration in the `defaults()` function or after `.get()`
- Test with existing browsers (data is already in localStorage) by incrementing version to trigger migration
- Include before/after examples in commit message

### Testing Changes Locally
- Open `index.html` directly or via `python3 -m http.server 8000`
- Open DevTools Console to inspect `MW.store.get()`
- Modify in DevTools to test: `MW.store.update('path', newValue)`
- Export JSON backup before risky changes (Settings → Data → Export)

### Deploying
- Push to `main` → GitHub Pages auto-publishes (or set branch in Settings)
- No build step, no deployment script needed
- Optional: generate single-file version: `python3 scripts/build-single.py`

## Key Gotchas

- **Hash routing**: Pages change via `#/calendar`, not path-based. Reloading preserves the page.
- **Mobile breakpoint**: 900px. Below that, bottom tab bar + full-screen sheets replace top nav + floating windows. Test at 800px width.
- **Floating window position**: Stored in `settings.floats`. Moved/resized windows persist; deleting from store resets position.
- **CORS**: iCal imports fail from Google Calendar; users must download `.ics` file directly.
- **No offline alarms**: Desktop notifications only work with tab open. Missed alarms appear as "past alarms" on next open.
- **Pomodoro continuation**: Closing the floating widget doesn't stop the timer; it stays in the top bar.

## Data Persistence Strategy

- **Load**: On boot, `app.js` calls `MW.store.get()`, which loads from `localStorage.mw.v1` or returns schema defaults
- **Save**: Every `MW.store.update()` writes to localStorage immediately and triggers all subscribers
- **Backup**: JSON export (Settings → Data → Export) is the only backup. No cloud sync.
- **Recovery**: JSON import (same settings page) restores from backup

### Migration to Desktop (Electron/Tauri)

The code is already **abstracted for storage portability**. To switch from web to desktop:

1. **Storage layer**: `MW.store` currently hardcodes localStorage. Wrap storage operations in a platform-check:
   ```js
   // In store.js, detect environment
   var useFileSystem = typeof window.electronAPI !== 'undefined'; // or tauri window
   // Route .get()/.update() to localStorage (web) or file I/O API (desktop)
   ```
2. **No other code changes needed**: All modules call `MW.store` uniformly; they don't know or care about storage backend.
3. **Desktop extras** (not needed for web):
   - App auto-launch, tray icon, background notifications → handled by Electron/Tauri wrapper, not app code
   - Desktop version can use persistent file paths instead of localStorage key `mw.v1`

**Current roadmap**: Desktop wrapper is planned; this app is ready for it.

## Browser & Platform Environment

- No ES modules (uses plain `<script>`); compatible with `file://` protocol
- localStorage key is `mw.v1` (keyed to schema version)
- Responsive: tested on mobile (≤900px) and desktop
- **Platform detection ready**: Code can detect `window.electronAPI` or `window.__TAURI__` if running in desktop wrapper

## Extending to Desktop App

When wrapping with Electron or Tauri:

1. **Before wrapping**: No code changes needed in this repo
2. **Wrapper setup**: Define platform-specific APIs (file I/O, IPC for notifications, menu bar)
3. **In `store.js` or early in `app.js`**: Add platform check to route `MW.store` calls to file I/O instead of localStorage
4. **Data migration**: Parse old localStorage backup as initial file, then all saves go to disk
5. **Bonus features** (desktop only): Auto-launch, tray icon, persistent notifications—handled by wrapper, not app code

The **storage abstraction is built in**; just provide an alternative backend.
