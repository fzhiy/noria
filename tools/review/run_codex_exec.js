#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage() {
  console.error('Usage: node tools/review/run_codex_exec.js <prompt-file> [--nightmare|--effort <tier>] [-- <extra codex args>]');
  console.error('  --nightmare       Force GPT-5.4 xhigh + full-auto (mandatory for /gpt-nightmare-review)');
  console.error('  --effort <tier>   Set effort tier: lite|standard|extended|heavy|beast');
  console.error('                    heavy/beast → GPT-5.4 xhigh; others → GPT-5.4 xhigh (floor, never below)');
  process.exit(1);
}

if (process.argv.length < 3) {
  usage();
}

const promptFile = path.resolve(process.argv[2]);
if (!fs.existsSync(promptFile)) {
  console.error(`ERROR: Prompt file not found: ${promptFile}`);
  process.exit(1);
}

const prompt = fs.readFileSync(promptFile, 'utf8');
const separatorIndex = process.argv.indexOf('--');
const extraArgs = separatorIndex === -1 ? [] : process.argv.slice(separatorIndex + 1);

// --nightmare flag forces GPT-5.4 xhigh + full-auto (independent of config.toml defaults)
const isNightmare = process.argv.includes('--nightmare');

// --effort flag: all tiers use GPT-5.4 xhigh (non-negotiable floor from effort-contract.md)
const effortIdx = process.argv.indexOf('--effort');
const effortTier = effortIdx >= 0 ? process.argv[effortIdx + 1] : null;
const validTiers = ['lite', 'standard', 'extended', 'heavy', 'beast'];
if (effortTier && !validTiers.includes(effortTier)) {
  console.error(`Invalid effort tier: ${effortTier}. Valid: ${validTiers.join(', ')}`);
  process.exit(1);
}

// Both --nightmare and --effort always use GPT-5.4 xhigh (effort contract non-negotiable floor)
const forceArgs = (isNightmare || effortTier)
  ? ['--model', 'gpt-5.4', '-c', 'model_reasoning_effort="xhigh"', '--full-auto']
  : [];
const nightmareArgs = forceArgs; // backward compat

const candidates = process.platform === 'win32' ? ['codex.cmd', 'codex'] : ['codex'];
let result = null;

for (const command of candidates) {
  result = spawnSync(command, ['exec', prompt, '--skip-git-repo-check', ...nightmareArgs, ...extraArgs], {
    encoding: 'utf8',
    shell: false,
  });

  if (!result.error || result.error.code !== 'ENOENT') {
    break;
  }
}

if (!result || (result.error && result.error.code === 'ENOENT')) {
  console.error('ERROR: Could not find Codex CLI. Install @openai/codex and ensure it is on PATH.');
  process.exit(1);
}

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exit(typeof result.status === 'number' ? result.status : 1);
