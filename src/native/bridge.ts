import type { RoyFlowBridge } from '../shared/ipc';

declare global {
  interface Window {
    royflow?: RoyFlowBridge;
  }
}

/** the preload bridge when running inside the Electron app; undefined in a plain browser */
export const native: RoyFlowBridge | undefined = typeof window !== 'undefined' ? window.royflow : undefined;
export const isElectron = !!native;

if (isElectron) document.documentElement.dataset.electron = 'true';
