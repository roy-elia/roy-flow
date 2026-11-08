/* Preload: exposes a minimal, allow-listed IPC bridge as window.royflow (contextIsolation on, sandboxed). */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, type RoyFlowBridge } from '../src/shared/ipc';

const allowed = (list: readonly string[], ch: string) => {
  if (!list.includes(ch)) throw new Error(`IPC channel not allowed: ${ch}`);
};

const bridge: RoyFlowBridge = {
  isElectron: true,
  platform: process.platform,
  send: (channel, ...payload) => {
    allowed(SEND_CHANNELS, channel);
    ipcRenderer.send(channel, ...payload);
  },
  invoke: (channel, ...args) => {
    allowed(INVOKE_CHANNELS, channel);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (channel, cb) => {
    allowed(EVENT_CHANNELS, channel);
    const h = (_e: IpcRendererEvent, payload: unknown) => cb(payload as never);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
};

contextBridge.exposeInMainWorld('royflow', bridge);
