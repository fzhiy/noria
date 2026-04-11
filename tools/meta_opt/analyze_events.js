#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function usage() {
  console.error('Usage: node tools/meta_opt/analyze_events.js <events-file> [target]');
  process.exit(1);
}

function increment(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function topEntries(map, limit = 10) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

if (process.argv.length < 3) {
  usage();
}

const eventsFile = path.resolve(process.argv[2]);
const target = process.argv[3] || '';

if (!fs.existsSync(eventsFile)) {
  console.error(`ERROR: Event log not found: ${eventsFile}`);
  process.exit(1);
}

const raw = fs.readFileSync(eventsFile, 'utf8').split(/\r?\n/).filter(Boolean);
const eventCounts = new Map();
const skillCounts = new Map();
const commandCounts = new Map();
const toolFailureCounts = new Map();
const toolUseCounts = new Map();
const sessionIds = new Set();
const recentMatches = [];

for (const line of raw) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }

  if (event.session) {
    sessionIds.add(event.session);
  }
  increment(eventCounts, event.event || 'unknown');

  if (event.event === 'skill_invoke' && event.skill) {
    increment(skillCounts, event.skill);
  }
  if (event.event === 'slash_command' && event.command) {
    increment(commandCounts, event.command);
  }
  if (event.tool) {
    increment(toolUseCounts, event.tool);
  }
  if (event.event === 'tool_failure' && event.tool) {
    increment(toolFailureCounts, event.tool);
  }

  if (
    target &&
    (
      event.skill === target ||
      event.command === target ||
      (typeof event.input_summary === 'string' && event.input_summary.includes(target)) ||
      (typeof event.args === 'string' && event.args.includes(target))
    )
  ) {
    recentMatches.push(event);
  }
}

console.log('# ARIS Event Summary');
console.log('');
console.log(`- Events file: \`${eventsFile}\``);
console.log(`- Total events: ${raw.length}`);
console.log(`- Sessions: ${sessionIds.size}`);
console.log(`- Skill invocations: ${skillCounts.size === 0 ? 0 : [...skillCounts.values()].reduce((a, b) => a + b, 0)}`);
if (target) {
  console.log(`- Target filter: \`${target}\``);
  console.log(`- Target-matching events: ${recentMatches.length}`);
}
console.log('');

function printTable(title, rows, left, right) {
  console.log(`## ${title}`);
  if (rows.length === 0) {
    console.log('');
    console.log('_None_');
    console.log('');
    return;
  }
  console.log('');
  console.log(`| ${left} | ${right} |`);
  console.log(`| --- | ---: |`);
  for (const [name, count] of rows) {
    console.log(`| ${name} | ${count} |`);
  }
  console.log('');
}

printTable('Events', topEntries(eventCounts), 'Event', 'Count');
printTable('Skills', topEntries(skillCounts), 'Skill', 'Count');
printTable('Slash Commands', topEntries(commandCounts), 'Command', 'Count');
printTable('Tool Usage', topEntries(toolUseCounts), 'Tool', 'Count');
printTable('Tool Failures', topEntries(toolFailureCounts), 'Tool', 'Count');

if (target) {
  console.log('## Target Sample');
  console.log('');
  if (recentMatches.length === 0) {
    console.log('_No matching events found._');
  } else {
    for (const event of recentMatches.slice(-10)) {
      const summary = event.input_summary || event.args || event.prompt_preview || '';
      console.log(`- ${event.ts || 'unknown'} | ${event.event || 'unknown'} | ${summary}`);
    }
  }
  console.log('');
}
