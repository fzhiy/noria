#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

function toWslPath(windowsPath) {
  const normalized = path.resolve(windowsPath).replace(/\\/g, '/');
  const driveMatch = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) {
    return normalized;
  }

  const drive = driveMatch[1].toLowerCase();
  const rest = driveMatch[2];
  return `/mnt/${drive}/${rest}`;
}

function bashQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

const repoRoot = path.resolve(__dirname, '..', '..');
const currentDir = process.cwd();
const args = process.argv.slice(2);

const repoRootWsl = toWslPath(repoRoot);
const currentDirWsl = toWslPath(currentDir);
const agentDeckWsl = `${repoRootWsl}/.codex-tools/bin/agent-deck`;
const argString = args.map(bashQuote).join(' ');

const bashCommand = [
  `if [ ! -x ${bashQuote(agentDeckWsl)} ]; then`,
  `  echo "ERROR: agent-deck binary not found at ${agentDeckWsl}" >&2`,
  '  exit 1',
  'fi',
  `cd ${bashQuote(currentDirWsl)} 2>/dev/null || cd ${bashQuote(repoRootWsl)}`,
  `exec ${bashQuote(agentDeckWsl)}${argString ? ` ${argString}` : ''}`,
].join('\n');

const result = spawnSync('wsl.exe', ['-e', 'bash', '-lc', bashCommand], {
  stdio: 'inherit',
  windowsHide: false,
});

if (result.error) {
  console.error(`ERROR: Failed to launch WSL: ${result.error.message}`);
  process.exit(1);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
