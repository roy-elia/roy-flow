/* Stdio MCP launcher for Roy Flow's Notetaker notes. Run with the app's own binary as Node:
     ELECTRON_RUN_AS_NODE=1 "Roy Flow.app/Contents/MacOS/Roy Flow" mcp-stdio.cjs <meetings-mcp.json>
   It reads only the meetings export the app writes (never the dictation history) and works while the app is closed. */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { handleRpc, type RpcRequest } from './mcpTools';
import type { Meeting } from '../src/shared/types';

const file = process.argv[2] || process.env.ROYFLOW_MEETINGS || '';
const meetings = (): Meeting[] => {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { meetings?: Meeting[] };
    return j.meetings ?? [];
  } catch {
    return [];
  }
};

const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let req: RpcRequest;
  try {
    req = JSON.parse(line) as RpcRequest;
  } catch {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
    return;
  }
  const res = handleRpc(req, meetings, '1.0.0');
  if (res) process.stdout.write(JSON.stringify(res) + '\n');
});
rl.on('close', () => process.exit(0));
