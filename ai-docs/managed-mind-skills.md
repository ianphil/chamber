# Managed Mind Skills

Chamber can equip minds with managed skills at runtime. A managed skill is a Chamber-owned capability guide that is installed into each mind under `.github/skills/<name>/`, versioned with Chamber metadata, and upgraded as Chamber learns better ways to use that capability.

Use this pattern when Chamber needs to teach minds a workflow, product contract, or taste layer without permanently expanding the always-loaded tool surface.

## When to create a managed skill

Create a managed skill when the capability is mostly about **how** the mind should think, write, or operate:

- product workflows, such as creating Chamber Lens views;
- UI and brand guidance;
- file layout conventions;
- examples, checklists, and anti-patterns;
- progressive instructions that should load only when relevant.

Prefer a runtime tool when Chamber must enforce a hard boundary:

- credential access;
- filesystem safety beyond the mind workspace;
- privileged operations;
- deterministic validation or side effects;
- operations that must not depend on model judgment.

The Lens split is the reference model: Lens discovery and Canvas rendering enforce service-level safety, while the Lens skill teaches the mind how to create useful, Chamber-branded views.

## Marketplace layout

Chamber-owned managed skills live in the default Genesis marketplace, not in
the desktop installer:

```text
genesis-minds/plugins/genesis-minds/skills/<skill-name>/
  SKILL.md         # name/version frontmatter is the source of truth
  references/      # optional, for deeper docs
  scripts/         # optional, for deterministic helpers
  assets/          # optional, templates or static files
```

Contributor-facing skills used while developing Chamber can live under:

```text
.github/skills/<skill-name>/
```

For example, Chamber vendors Anthropic's `skill-creator` skill in `.github/skills/skill-creator/` so contributors can use it to design and improve future managed skills.

## Skill file structure

Follow the progressive-disclosure model used by Anthropic skills:

1. **Metadata**: `name` and `description` are always visible to the model and drive triggering.
2. **`SKILL.md` body**: loaded when the skill triggers; keep it concise and operational.
3. **Marketplace resources**: references, scripts, and assets loaded only when needed.

The frontmatter description should be pushy enough to trigger in real user language. Include synonyms and debugging contexts.

```markdown
---
name: lens
version: 2.0.0
description: Create, inspect, fix, and manage Chamber Lens views. Use this skill whenever the user mentions Lens, lenses, Chamber views, dashboards, panels, reports, forms, command centers, app-like screens, self-modifying UI, or says a Lens icon/view is missing. Always use this skill before creating or editing files under .github/lens.
---
```

Put non-negotiable contracts in the first screenful of `SKILL.md`. If a mind only skims the top of the file, it should still see the required schema, file names, and anti-patterns.

## Authoring checklist

When creating or updating a managed skill:

1. Define the exact user phrases and contexts that should trigger the skill.
2. Put those triggers in the frontmatter `description`.
3. Put required contracts before explanation or examples.
4. Include at least one valid minimal example.
5. Include common invalid examples or forbidden field names when mistakes are likely.
6. Add a mechanical completion checklist the mind can run before reporting success.
7. Keep subjective quality guidance in the skill, not in permanent tools.
8. Keep hard safety enforcement in services, IPC, or runtime tools.
9. Add install/upgrade tests for missing, managed, legacy, and locally edited skills.
10. Test with a real mind conversation when the skill affects agent behavior.

## Installation and upgrades

Managed skills are installed by Chamber bootstrap code, not by Genesis templates. This lets Chamber progressively equip existing and newly created minds. Chamber-managed skills are system-owned: when the default marketplace skill changes, Chamber overwrites the installed copy from marketplace bytes. Users who want custom behavior should copy the skill to a different name instead of editing the managed copy in place.

The bootstrap path should be idempotent and safe to call from:

- existing-agent import;
- mind load/session creation;
- Genesis scaffold activation;
- Genesis template activation.

Use `ManagedSkillService.installIntoMind(mindPath)` for marketplace skills. `bootstrapMindCapabilities(mindPath)` remains for non-network local capability seeds such as default Lens views.

For each managed skill, write metadata next to the installed skill:

```text
.github/skills/<skill-name>/
  SKILL.md
  .chamber-skill.json
```

Example metadata:

```json
{
  "name": "lens",
  "version": "2.0.0",
  "managedBy": "chamber",
  "algorithm": "sha256-framed-v2",
  "files": [{ "path": "SKILL.md", "sha256": "<framed sha256>" }],
  "capabilities": ["lens-json", "canvas-lens", "chamber-theme-v1"],
  "source": {
    "type": "marketplace",
    "marketplaceId": "github:ianphil/genesis-minds",
    "owner": "ianphil",
    "repo": "genesis-minds",
    "ref": "master",
    "plugin": "genesis-minds",
    "root": "skills/lens"
  }
}
```

Upgrade policy:

- Install when missing.
- Upgrade managed skills when metadata says Chamber owns the file and the version, file set, or checksums differ.
- Clobber locally edited Chamber-managed skills so system-owned guidance returns to the marketplace version.
- For old unversioned Chamber-shaped skills, back up the previous file and install the managed version.
- Preserve unmanaged skills that do not look like the Chamber-owned skill.

Backups should stay beside the skill:

```text
SKILL.legacy-backup.md
SKILL.legacy-backup-1.md
```

## Testing expectations

Add focused tests for:

- installing the skill when missing;
- reading exact bytes from the default Genesis marketplace;
- upgrading managed unmodified skills;
- preserving locally edited managed skills;
- migrating legacy unversioned Chamber-owned skills with a backup;
- preserving unrelated unmanaged skills;
- calling the bootstrap path before SDK session creation.

For behavior-sensitive skills, also run a manual mind conversation. Ask a realistic prompt and inspect the resulting files. If the mind misses the contract, improve the skill before adding tools.

## Lessons from Lens

The Lens skill originally put the Canvas manifest shape below general workflow prose. A mind manually inspected only the top of the file and created an invalid manifest using `title` and `renderer`. Chamber correctly ignored the view because discovery requires `name`, `icon`, `view`, and `source`.

The fix was not a Lens-specific creation tool. The better skill design was:

- make the trigger description include missing-icon and view-debugging scenarios;
- move the required manifest schema to the top;
- explicitly forbid likely wrong fields;
- add a final validation checklist;
- keep UI brand guidance in the skill;
- keep runtime validation in Lens discovery and Canvas services.

Use that pattern for future Chamber-managed skills.
