// Shared SkillManifest type. Skills live under <mindPath>/.github/skills/<name>/SKILL.md
// with YAML frontmatter (name, version, description) and a markdown body that
// teaches the agent how to use the skill. The renderer surfaces these in the
// AboutAgentPanel so users can see what a mind can do.

export interface SkillManifest {
  /** Directory name under .github/skills/, used as the stable id. */
  id: string;
  /** YAML `name` from the SKILL.md frontmatter. Falls back to id. */
  name: string;
  /** Optional YAML `version` field. */
  version?: string;
  /** Optional YAML `description` field (one-line summary). */
  description?: string;
}
