// Starts Relay, Chirp and the web UI together with one command (`npm start`).
//
// Each service is launched directly with this Node binary — no shell, no cmd.exe — so it works
// the same in any terminal on Windows, macOS or Linux. If one service stops, the others keep
// running (e.g. Chirp carries on without Relay). Ctrl+C stops everything.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'web', 'package.json'));
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const SERVICES = [
  { name: 'relay', color: 35, cwd: join(root, 'relay-service'), args: ['src/server.js'] },
  { name: 'chirp', color: 36, cwd: join(root, 'chirp-service'), args: ['src/server.js'] },
  { name: 'web', color: 32, cwd: join(root, 'web'), args: [viteBin] },
];

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const width = Math.max(...SERVICES.map((s) => s.name.length));
const prefix = (s) => {
  const label = `[${s.name.padEnd(width)}]`;
  return useColor ? `\x1b[${s.color}m${label}\x1b[0m ` : `${label} `;
};

function pipe(stream, out, pre) {
  let buffered = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffered += chunk;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop();
    for (const line of lines) out.write(`${pre}${line}\n`);
  });
  stream.on('end', () => { if (buffered) out.write(`${pre}${buffered}\n`); });
}

let stopping = false;
const children = SERVICES.map((s) => {
  const child = spawn(process.execPath, s.args, {
    cwd: s.cwd,
    env: { ...process.env, FORCE_COLOR: useColor ? '1' : '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  pipe(child.stdout, process.stdout, prefix(s));
  pipe(child.stderr, process.stderr, prefix(s));
  child.on('exit', (code, signal) => {
    if (!stopping) console.log(`${prefix(s)}stopped (${signal ?? `exit code ${code}`}); the other services keep running.`);
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) process.exit(0);
  });
  return child;
});

const { RELAY_PORT = 4000, CHIRP_PORT = 4001, WEB_PORT = 5173 } = process.env;
console.log(`Starting Relay (:${RELAY_PORT}), Chirp (:${CHIRP_PORT}) and the web UI (http://localhost:${WEB_PORT}). Press Ctrl+C to stop.`);

function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
