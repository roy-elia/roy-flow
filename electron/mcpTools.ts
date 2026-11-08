/* MCP (JSON-RPC 2.0) request handling over the user's Notetaker notes only. Shared by the localhost HTTP
   endpoint in the main process and the stdio launcher (electron/mcp-stdio.ts). No Electron imports. */
import type { Meeting } from '../src/shared/types';

export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'list_meetings',
    description: 'List the user\'s Roy Flow Notetaker meeting notes, newest first, with date, length and summary.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum notes to return (default 20)' },
        since: { type: 'string', description: 'Only notes on or after this ISO date' },
      },
    },
  },
  {
    name: 'get_meeting',
    description: 'Get one meeting note in full: summary, action items, the user\'s own notes and the transcript.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Meeting id from list_meetings or search_meetings' } }, required: ['id'] },
  },
  {
    name: 'search_meetings',
    description: 'Full-text search across meeting titles, summaries, notes and transcripts.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number', description: 'Maximum results (default 10)' } },
      required: ['query'],
    },
  },
];

const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const brief = (m: Meeting) => ({ id: m.id, title: m.title, date: new Date(m.ts).toISOString(), minutes: m.minutes, summary: m.overview || null });
const fullText = (m: Meeting) => [m.title, m.overview, ...(m.actionItems ?? []), m.thoughts ?? '', ...(m.transcript ?? []).map((s) => s.text)].join('\n');

function callTool(name: string, args: Record<string, unknown>, meetings: Meeting[]): unknown {
  const sorted = [...meetings].filter((m) => !m.demo).sort((a, b) => b.ts - a.ts);
  if (name === 'list_meetings') {
    const since = typeof args.since === 'string' ? Date.parse(args.since) : NaN;
    const limit = Math.min(Number(args.limit) || 20, 200);
    return sorted.filter((m) => isNaN(since) || m.ts >= since).slice(0, limit).map(brief);
  }
  if (name === 'get_meeting') {
    const m = sorted.find((x) => x.id === args.id);
    if (!m) throw new Error(`No meeting with id ${String(args.id)}`);
    return {
      ...brief(m),
      actionItems: m.actionItems ?? [],
      notes: m.thoughts ?? '',
      transcript: (m.transcript ?? []).map((s) => `[${fmtT(s.t)}] ${s.text}`).join('\n'),
    };
  }
  if (name === 'search_meetings') {
    const q = String(args.query ?? '').toLowerCase().trim();
    if (!q) throw new Error('query is required');
    const terms = q.split(/\s+/);
    const limit = Math.min(Number(args.limit) || 10, 50);
    return sorted
      .map((m) => {
        const text = fullText(m);
        const low = text.toLowerCase();
        const score = terms.reduce((n, t) => n + (low.split(t).length - 1), 0);
        const at = low.indexOf(terms[0]);
        const snippet = at >= 0 ? text.slice(Math.max(0, at - 80), at + 160).replace(/\s+/g, ' ') : '';
        return { m, score, snippet };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => ({ ...brief(r.m), snippet: r.snippet }));
  }
  throw new Error(`Unknown tool ${name}`);
}

/** returns the JSON-RPC response, or null for notifications */
export function handleRpc(req: RpcRequest, meetings: () => Meeting[], version: string): Record<string, unknown> | null {
  const isNotification = req.id === undefined || req.id === null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: req.id ?? null, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: req.id ?? null, error: { code, message } });
  switch (req.method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'roy-flow-notetaker', version },
        instructions: 'Read-only access to the user\'s Roy Flow Notetaker meeting notes. Dictation history is never exposed.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = String(req.params?.name ?? '');
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const data = callTool(name, args, meetings());
        return ok({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        return ok({ content: [{ type: 'text', text: e instanceof Error ? e.message : 'Tool failed' }], isError: true });
      }
    }
    default:
      if (isNotification || req.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${req.method}`);
  }
}
