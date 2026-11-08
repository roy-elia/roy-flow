// Bundles the Electron main process and preload into dist-electron/*.cjs with esbuild.
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron'], sourcemap: false, logLevel: 'warning' };
await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' });
await build({ ...common, entryPoints: ['electron/mcp-stdio.ts'], outfile: 'dist-electron/mcp-stdio.cjs' });
console.log('built dist-electron/main.cjs, dist-electron/preload.cjs');
