/* Local MCP endpoint (Streamable HTTP, JSON responses) on 127.0.0.1 with a per-install secret path,
   plus the Claude Desktop config entry for the stdio launcher. Exposes Notetaker notes only. */
import { app, dialog, type BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { handleRpc, type RpcRequest } from './mcpTools';
import { meetingsFile, writeMeetingsExport } from './data';
import type { McpInfo } from '../src/shared/ipc';
import type { Meeting } from '../src/shared/types';

const SERVER_NAME = 'roy-flow-notes';
const cfgFile = () => path.join(app.getPath('userData'), 'mcp.json');
const claudeDir = path.join(os.homedir(), 'Library/Application Support/Claude');
const claudeConfig = path.join(claudeDir, 'claude_desktop_config.json');

let server: http.Server | null = null;
let port = 0;
let token = '';

function settings(): { port: number; token: string } {
  try {
    const j = JSON.parse(readFileSync(cfgFile(), 'utf8')) as { port: number; token: string };
    if (j.port && j.token) return j;
  } catch {
    /* first run */
  }
  const j = { port: 47321, token: randomBytes(18).toString('base64url') };
  mkdirSync(path.dirname(cfgFile()), { recursive: true });
  writeFileSync(cfgFile(), JSON.stringify(j), { mode: 0o600 });
  return j;
}

export function startMcpServer(getMeetings: () => Meeting[], log: (...a: unknown[]) => void) {
  if (server) return;
  const s = settings();
  token = s.token;
  writeMeetingsExport();
  const srv = http.createServer((req, res) => {
    const host = (req.headers.host ?? '').split(':')[0];
    const origin = req.headers.origin;
    if (!['127.0.0.1', 'localhost'].includes(host) || (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) {
      res.writeHead(403).end();
      return;
    }
    if (req.url !== `/mcp/${token}`) {
      res.writeHead(404).end();
      return;
    }
    if (req.method === 'DELETE') return void res.writeHead(200).end();
    if (req.method !== 'POST') return void res.writeHead(405, { Allow: 'POST' }).end();
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c: string) => {
      body += c;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on('end', () => {
      let parsed: RpcRequest | RpcRequest[];
      try {
        parsed = JSON.parse(body) as RpcRequest | RpcRequest[];
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const out = list.map((r) => handleRpc(r, getMeetings, app.getVersion())).filter(Boolean);
      if (!out.length) return void res.writeHead(202).end();
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(Array.isArray(parsed) ? out : out[0]));
    });
  });
  const tryListen = (p: number, left: number) => {
    srv.once('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EADDRINUSE' && left > 0) tryListen(p + 1, left - 1);
      else log('[mcp] could not listen', e.code);
    });
    srv.listen(p, '127.0.0.1', () => {
      port = p;
      server = srv;
      if (p !== s.port) writeFileSync(cfgFile(), JSON.stringify({ port: p, token }), { mode: 0o600 });
      log('[mcp] listening on 127.0.0.1:' + p);
    });
  };
  tryListen(s.port, 10);
}

export function stopMcpServer() {
  server?.close();
  server = null;
}

function stdioEntry() {
  const script = app.isPackaged ? path.join(process.resourcesPath, 'mcp/mcp-stdio.cjs') : path.join(app.getAppPath(), 'dist-electron/mcp-stdio.cjs');
  return { command: process.execPath, args: [script, meetingsFile()], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

function readClaudeConfig(): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(claudeConfig, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function mcpInfo(): McpInfo {
  const e = stdioEntry();
  const cfg = readClaudeConfig();
  const servers = (cfg?.mcpServers ?? {}) as Record<string, unknown>;
  return {
    url: server ? `http://127.0.0.1:${port}/mcp/${token}` : '',
    command: `ELECTRON_RUN_AS_NODE=1 "${e.command}" "${e.args[0]}" "${e.args[1]}"`,
    args: e.args,
    claudeConfig: claudeConfig,
    claudeInstalled: existsSync(claudeDir),
    added: SERVER_NAME in servers,
    running: !!server,
  };
}

/** write the stdio entry into Claude Desktop's config, only after the user confirms */
export async function addToClaude(win: BrowserWindow | null): Promise<{ ok: boolean; cancelled?: boolean; error?: string }> {
  const entry = stdioEntry();
  const opts = {
    type: 'question' as const,
    buttons: ['Add to Claude', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Add Roy Flow to Claude Desktop?',
    detail:
      `This adds an MCP server named "${SERVER_NAME}" to:\n${claudeConfig}\n\n` +
      'Claude will be able to list, read and search your Notetaker meeting notes (never your dictations). ' +
      'A backup of the current file is saved next to it. Restart Claude Desktop afterwards.',
  };
  const r = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
  if (r.response !== 0) return { ok: false, cancelled: true };
  try {
    mkdirSync(claudeDir, { recursive: true });
    const raw = existsSync(claudeConfig) ? readFileSync(claudeConfig, 'utf8') : '';
    let cfg: Record<string, unknown> = {};
    if (raw.trim()) {
      cfg = JSON.parse(raw) as Record<string, unknown>;
      copyFileSync(claudeConfig, `${claudeConfig}.royflow-backup`);
    }
    const servers = { ...((cfg.mcpServers ?? {}) as Record<string, unknown>), [SERVER_NAME]: entry };
    writeFileSync(claudeConfig, JSON.stringify({ ...cfg, mcpServers: servers }, null, 2));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof SyntaxError ? 'Claude\'s config file is not valid JSON, so it was left unchanged.' : 'Could not write Claude\'s config file.' };
  }
}
