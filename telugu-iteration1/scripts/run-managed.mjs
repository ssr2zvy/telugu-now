import { spawn } from 'node:child_process';

const domain = process.argv[2];
if (!['test', 'build', 'dev'].includes(domain ?? '')) {
  console.error('Unknown managed process domain.');
  process.exit(2);
}

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const child = spawn(npmCommand, ['run', domain], {
  stdio: 'inherit',
  detached: process.platform !== 'win32',
});

let stopping = false;
let forceTimer;

function signalChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  try {
    if (process.platform === 'win32') {
      child.kill(signal);
    } else {
      // detached:true makes the npm process the leader of a new process group.
      // Signal the whole group so npm's descendants (Vite, tsx, concurrently, etc.)
      // do not survive after the controller stops the managed job.
      process.kill(-child.pid, signal);
    }
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function beginShutdown() {
  if (stopping) return;
  stopping = true;
  signalChild('SIGTERM');
  forceTimer = setTimeout(() => signalChild('SIGKILL'), 4_000);
  forceTimer.unref();
}

process.on('SIGTERM', beginShutdown);
process.on('SIGINT', beginShutdown);

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (forceTimer) clearTimeout(forceTimer);
  if (code !== null) {
    process.exit(code);
  }
  process.exit(signal === 'SIGTERM' || signal === 'SIGINT' ? 143 : 1);
});
