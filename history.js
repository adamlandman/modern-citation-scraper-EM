// Keeps a dated history of each person's citation stats so trends can be
// shown over time. The history file is plain JS (`var statsHistory = {...};`)
// so index.html can load it with a <script> tag, the same way as stats-*.js.
//
// Format:
//   { "snapshots": [
//       { "date": "2024-11-21",
//         "stats": { "<scholar user id>": { "name": "...", "citations": 4902,
//                                            "hindex": 39, "i10index": 82 } } } ] }
//
// To seed or backfill history from an existing stats file:
//   node history.js ./stats-bmi.js ./history-bmi.js

var fs = require('fs');
var vm = require('vm');

var PREFIX = 'var statsHistory = ';

function userId(url) {
  var match = /user=([^&]+)/.exec(url || '');
  return match ? match[1] : null;
}

// YYYY-MM-DD in the scraping machine's local time zone.
function formatDate(date) {
  var pad = function(n) { return (n < 10 ? '0' : '') + n; };
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function readHistory(path) {
  if (!fs.existsSync(path)) return { snapshots: [] };
  var sandbox = {};
  vm.runInNewContext(fs.readFileSync(path, 'utf8'), sandbox);
  return sandbox.statsHistory || { snapshots: [] };
}

function writeHistory(path, history) {
  fs.writeFileSync(path, PREFIX + JSON.stringify(history, null, 2) + ';\n');
}

// Builds a snapshot from scrape results (the objects written to stats-*.js),
// skipping people whose profile failed to scrape.
function makeSnapshot(results, day) {
  var stats = {};
  results.forEach(function(person) {
    if (!person || !person.stats) return;
    var id = userId(person.url) || person.name;
    stats[id] = {
      name: person.name,
      citations: parseInt(person.stats.citations[0], 10),
      hindex: parseInt(person.stats.hindex[0], 10),
      i10index: parseInt(person.stats.i10index[0], 10)
    };
  });
  return { date: day, stats: stats };
}

// Adds the snapshot to the history file, replacing any earlier snapshot from
// the same day so reruns don't create duplicates.
function appendSnapshot(path, results, day) {
  var history = readHistory(path);
  var snapshot = makeSnapshot(results, day);
  // A run where every profile failed shouldn't wipe out that day's snapshot.
  if (Object.keys(snapshot.stats).length === 0) return snapshot;
  history.snapshots = history.snapshots.filter(function(s) { return s.date !== day; });
  history.snapshots.push(snapshot);
  history.snapshots.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  writeHistory(path, history);
  return snapshot;
}

module.exports = { appendSnapshot: appendSnapshot, formatDate: formatDate };

if (require.main === module) {
  var statsPath = process.argv[2];
  var historyPath = process.argv[3];
  if (!statsPath || !historyPath) {
    console.error('Usage: node history.js <stats-file.js> <history-file.js>');
    process.exit(1);
  }
  var sandbox = {};
  vm.runInNewContext(fs.readFileSync(statsPath, 'utf8'), sandbox);
  // Use the calendar day as written in the stats file (e.g. "Thu Nov 21 2024 ..."),
  // not as converted to this machine's time zone.
  var m = /^\w{3} (\w{3} \d{1,2} \d{4})/.exec(sandbox.date);
  var day = formatDate(m ? new Date(m[1]) : new Date(sandbox.date));
  var snapshot = appendSnapshot(historyPath, sandbox.data, day);
  console.error('Added ' + Object.keys(snapshot.stats).length + ' people for ' + day + ' to ' + historyPath);
}
