// Runs the API server and the Vite dev server together.
import { spawn } from 'node:child_process';

const apiPort = process.env.PORT || '3000';
const procs = [
  spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'server/index.js'], { stdio: 'inherit', env: { ...process.env, PORT: apiPort } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: { ...process.env, API_PORT: apiPort } }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
