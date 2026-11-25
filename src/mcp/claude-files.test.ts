import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURATION_TOOLS, QUERY_TOOLS } from './server';

const root = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

const SKILL_TOOLS: Record<string, string[]> = {
  'fechar-mes': [
    'closing_status',
    'balances',
    'pending_items',
    'categories',
    'categorize',
    'offset',
    'explain_divergence',
    'confirm_check',
    'goals',
    'investments',
    'close_month',
    'read_document',
    'save_report',
  ],
  'revisar-historico': ['spending', 'transactions', 'categories', 'categorize', 'edit_category'],
};

describe('Claude Code integration files', () => {
  it('declares the project MCP server', () => {
    expect(JSON.parse(read('.mcp.json')).mcpServers.fyminance).toEqual({
      command: 'node',
      args: ['--env-file-if-exists=.env', '--import', 'tsx', 'src/mcp/server.ts'],
    });
  });

  it('pre-approves exactly the read-only tools', () => {
    const allow = JSON.parse(read('.claude/settings.json')).permissions.allow as string[];
    const tools = allow
      .filter((rule) => rule.startsWith('mcp__fyminance__'))
      .map((rule) => rule.slice('mcp__fyminance__'.length))
      .sort();
    expect(tools).toEqual([...QUERY_TOOLS].sort());
    for (const tool of CURATION_TOOLS) expect(tools).not.toContain(tool);
  });

  it.each(Object.entries(SKILL_TOOLS))('ships the %s skill using existing tools', (name, tools) => {
    const text = read(`.claude/skills/${name}/SKILL.md`);
    expect(text.startsWith(`---\nname: ${name}\ndescription: `)).toBe(true);
    const known = new Set<string>([...QUERY_TOOLS, ...CURATION_TOOLS]);
    for (const tool of tools) {
      expect(known.has(tool)).toBe(true);
      expect(text).toContain(`\`${tool}\``);
    }
  });
});
