---
name: lens
version: 2.0.0
description: Create, inspect, fix, and manage Chamber Lens views. Use this skill whenever the user mentions Lens, lenses, Chamber views, dashboards, panels, reports, forms, command centers, app-like screens, self-modifying UI, or says a Lens icon/view is missing. Always use this skill before creating or editing files under .github/lens.
---

# Lens — Chamber Views

Create views in `.github/lens/<view-name>/` to add panels to the Chamber activity bar. Lens is the navigation and discovery model.

Create new Lens views as Canvas Lens views. Classic JSON Lens views are legacy: inspect, refresh, and maintain existing ones, but do not create new classic JSON Lens views unless the user explicitly asks to modify an existing legacy Lens.

## Non-Negotiable Discovery Contract

Chamber discovers only folders under `.github/lens/` that contain a valid `view.json`.

For every new Lens, `view.json` must use this Canvas shape:

```json
{
  "name": "Cron Jobs",
  "icon": "clock",
  "view": "canvas",
  "source": "index.html",
  "prompt": "Optional refresh prompt.",
  "refreshOn": "click"
}
```

Never create new `form`, `table`, `briefing`, `detail`, `status-board`, `timeline`, or `editor` Lens views. Those are legacy view types for existing views only.

Never use `title`, `renderer`, `type`, `component`, `template`, or `file` in `view.json`. Chamber ignores those fields. The required fields for new views are `name`, `icon`, `view: "canvas"`, and `source: "index.html"`.

Before finishing any Lens task, inspect the files and verify:

- `.github/lens/<view-name>/view.json` exists.
- `view.json` has `name`, `icon`, `view`, and `source`.
- Canvas Lens uses `"view": "canvas"` and `"source": "index.html"`.
- `.github/lens/<view-name>/index.html` exists.

## Creating Views

Create each new Lens as a Canvas Lens folder with exactly the files Chamber expects:

```text
.github/lens/<view-name>/
  view.json
  index.html     # Canvas Lens
```

Use a short, stable, lowercase folder name like `cron-jobs`, `daily-briefing`, or `release-command-center`. Keep all Lens files inside that folder. If the folder does not exist, create it before writing files. Do not place Lens files at the root of `.github/lens/`; Chamber discovers only folders that contain a `view.json`.

Write both:

1. `.github/lens/<view-name>/view.json`
2. `.github/lens/<view-name>/index.html`

Before you finish, re-open or inspect the files you wrote and make sure `view.json` points to the source file you actually created.

## Canvas Lens Views

Canvas Lens is the required renderer for new Lens views. Create an HTML file and a `view.json` manifest:

```json
{
  "name": "Command Center",
  "icon": "layout",
  "view": "canvas",
  "source": "index.html",
  "prompt": "Build a Chamber-native dashboard for the user's current priorities.",
  "refreshOn": "click"
}
```

`source` must be an HTML file inside the same view folder. Chamber renders it in-app inside a sandboxed frame, injects Chamber theme styles, and provides a bridge at `window.canvas`.

### Chamber Design Kit

Use the injected classes so your UI feels native:

- `ch-page` — full page wrapper
- `ch-grid` — responsive card grid
- `ch-card` — Chamber card surface
- `ch-button` — primary button
- `ch-button-secondary` — secondary button
- `ch-input` — text/input control
- `ch-table` — table styling
- `ch-badge` — compact status badge
- `ch-muted` — muted text

Use CSS variables when custom styling is needed:

```css
color: var(--ch-foreground);
background: var(--ch-card);
border-color: var(--ch-border);
accent-color: var(--ch-genesis);
```

Do not hard-code a separate visual theme unless the user explicitly asks. Default to dark Chamber-native UI.

### Chamber UI Rubric

Before writing Canvas HTML, design the view like a native Chamber screen:

- Start with `<body class="ch-page">`; never leave raw browser-default body styling.
- Use `ch-grid` for responsive layout and `ch-card` for every major content group.
- Put the primary insight or action in the first card. Do not start with a generic title-only page.
- Use `ch-muted` for labels, timestamps, and secondary explanation.
- Use `ch-badge` for status values such as enabled, blocked, passing, stale, or needs attention.
- Use `ch-button` for the main action and `ch-button-secondary` for lower-priority actions.
- Prefer concise cards, status rows, and action clusters over long unstyled paragraphs.
- Keep spacing generous, dark, and calm. Avoid rainbow colors, default blue links, raw tables without `ch-table`, and unstyled form controls.
- If the user asked for operational data, show summary cards first, then details.
- If the view has actions, wire buttons through `window.canvas.sendAction(...)`; do not fake interactivity.

Self-check before saving:

- Does the page use Chamber classes rather than raw default HTML?
- Is the most useful information visible without scrolling?
- Are statuses visually scannable?
- Are actions explicit and routed through `window.canvas.sendAction(...)`?
- Would this look plausible as a built-in Chamber pane?

### Canvas Actions

Canvas HTML does not get direct SDK access. Send user intent back to Chamber:

```html
<button class="ch-button" onclick="window.canvas.sendAction('approve', { id: 'task-123' })">
  Approve
</button>
```

Chamber routes actions to the active mind. Use your normal tools and context to satisfy the action, then update the HTML source file if the UI should change.

## Legacy JSON Lens Views

Classic JSON Lens views still render for backwards compatibility. Maintain or refresh them when they already exist, but do not create new ones.

```json
{
  "name": "Display Name",
  "icon": "layout",
  "view": "form | table | briefing | detail | status-board | timeline | editor",
  "source": "data.json",
  "prompt": "Optional: what to gather when user clicks Refresh",
  "refreshOn": "click"
}
```

When `prompt` is set, Chamber sends it to you with an output path appended. For classic JSON views, write only valid JSON to that path.

### View Types

- `form` — flat JSON object as key/value rows.
- `briefing` — flat JSON object as card grid.
- `table` — JSON array of objects.
- `detail` — single object detail card.
- `status-board` — array of status objects.
- `timeline` — chronological array.
- `editor` — editable flat object with schema-driven fields.

## Examples

Canvas dashboard:

```html
<!doctype html>
<html>
  <body class="ch-page">
    <section class="ch-grid">
      <article class="ch-card">
        <p class="ch-muted">Top priority</p>
        <h1>Ship Canvas Lens</h1>
        <button class="ch-button" onclick="window.canvas.sendAction('start', { item: 'canvas-lens' })">
          Start
        </button>
      </article>
    </section>
  </body>
</html>
```

Legacy briefing shape:

```json
{
  "name": "Newspaper",
  "icon": "newspaper",
  "view": "briefing",
  "source": "briefing.json",
  "prompt": "Generate a morning briefing. Write a flat JSON object.",
  "refreshOn": "click"
}
```

## Rules

- Keep all Lens files inside `.github/lens/<view-name>/`.
- Never write credentials into Lens files.
- Canvas UI sends intent; the mind uses SDK tools through Chamber.
- Create new Lens views as Canvas Lens views only.
- Use classic JSON Lens types only when maintaining an existing legacy Lens.
- Delete the view folder to remove a view from Chamber.
