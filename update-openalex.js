// Refreshes the published OpenAlex data in one step: fetches every person,
// writes stats-openalex.js, and adds today's snapshot to history-openalex.js.
// The scheduled GitHub Action runs this; it works the same locally.
//
// Usage:
//   node update-openalex.js [./people-bmi.json]
//
// Nothing is written if fewer than MIN_SHARE of the people came back, so a
// bad run (OpenAlex down, rate limited) leaves the published data alone and
// exits non-zero.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const history = require('./history');

const MIN_SHARE = 0.9;
const HERE = __dirname;
const STATS_FILE = path.join(HERE, 'stats-openalex.js');
const HISTORY_FILE = path.join(HERE, 'history-openalex.js');

const peopleFile = process.argv[2] || './people-bmi.json';
const total = Object.keys(JSON.parse(fs.readFileSync(peopleFile, 'utf8'))).length;

const output = execFileSync(process.execPath, [path.join(HERE, 'fetch-openalex.js'), peopleFile], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 64 * 1024 * 1024,
});

const sandbox = {};
vm.runInNewContext(output, sandbox);
const found = sandbox.data.filter((person) => person && person.stats).length;
console.error(`OpenAlex returned ${found} of ${total} people`);

if (found < Math.ceil(total * MIN_SHARE)) {
  console.error(`Need at least ${Math.round(MIN_SHARE * 100)}%; leaving ${path.basename(STATS_FILE)} unchanged`);
  process.exit(1);
}

fs.writeFileSync(STATS_FILE, output);
const day = new Date().toISOString().slice(0, 10);
const snapshot = history.appendSnapshot(HISTORY_FILE, sandbox.data, day);
console.error(`Saved ${Object.keys(snapshot.stats).length} people for ${day} to ${path.basename(HISTORY_FILE)}`);
