/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import {
  Brain,
  Eye,
  Globe,
  Layout,
  List,
  Search,
  Sparkles,
  SquarePen,
  Terminal,
  Wrench,
} from 'lucide-react';
import { iconForReasoning, iconForToolName } from './workEntryIcon';

describe('iconForToolName', () => {
  const cases: Array<[string, unknown]> = [
    ['bash', Terminal],
    ['shell_exec', Terminal],
    ['run_command', Terminal],
    ['terminal', Terminal],
    ['write_file', SquarePen],
    ['edit', SquarePen],
    ['apply_patch', SquarePen],
    ['create_file', SquarePen],
    ['read_file', Eye],
    ['view', Eye],
    ['get_file', Eye],
    ['grep', Search],
    ['search_code', Search],
    ['find', Search],
    ['list_directory', List],
    ['ls', List],
    ['glob', List],
    ['fetch_url', Globe],
    ['http_get', Globe],
    ['web_search', Globe],
    ['lens.create', Layout],
    ['lens_refresh', Layout],
    ['view.write', Layout],
    ['mind.invoke', Sparkles],
    ['mind_list', Sparkles],
    ['some_unknown_tool', Wrench],
    ['', Wrench],
  ];

  for (const [name, expected] of cases) {
    it(`maps "${name}" correctly`, () => {
      expect(iconForToolName(name)).toBe(expected);
    });
  }

  it('is case-insensitive', () => {
    expect(iconForToolName('BASH')).toBe(Terminal);
    expect(iconForToolName('WriteFile')).toBe(SquarePen);
  });
});

describe('iconForReasoning', () => {
  it('returns Brain', () => {
    expect(iconForReasoning()).toBe(Brain);
  });
});
