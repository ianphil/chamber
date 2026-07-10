/**
 * Self-declared metadata discovered from a skill directory on disk.
 *
 * Presence in this list does not establish marketplace provenance, content
 * hash verification, management status, update status, or trust. Managed-skill
 * integrity and lifecycle remain the responsibility of ManagedSkillService.
 * Values are untrusted local file content and must be rendered as text.
 */
export interface SkillManifest {
  /** Directory name under .github/skills and the stable on-disk identifier. */
  id: string;
  /** Display name from SKILL.md; falls back to id when absent or blank. */
  name: string;
  /** Self-declared version string from SKILL.md, if present. */
  version?: string;
  /** Self-declared description from SKILL.md, if present. */
  description?: string;
}
