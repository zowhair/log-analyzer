
const readline = require('readline');
const fs = require('fs');
const path = require('path');


const { parseLine } = require('./parser');
const { report }  = require('./reporter');

const args = process.argv.slice(2);


if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node analyze.js <log-file> [options]');
  console.log('');
  console.log('Options:');
  console.log('  --slowest N   Show top N slowest endpoints  (default: 10)');
  console.log('  --help, -h    Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  node analyze.js server.log');
  console.log('  node analyze.js server.log --slowest 20');
  process.exit(args.length ? 0 : 1);
}

let filePath = null;
let slowestN = 10;


for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--slowest' || args[i] === '-n') && args[i + 1]) {
    const n = parseInt(args[++i], 10);
    if (!isNaN(n) && n > 0) slowestN = n;
  } else if (!args[i].startsWith('-')) {
    filePath = args[i];
  }
}

if (!filePath) {
  console.error('Error: no log file specified. Run with --help for usage.');
  process.exit(1);
}

const resolved = path.resolve(filePath);

if (!fs.existsSync(resolved)) {
  console.error(`Error: file not found — ${resolved}`);
  process.exit(1);
}


// Aggregator

const agg = {
  totalLines:       0,
  parsedLines:      0,
  skippedLines:     0,
  formatCounts:     {},      // timestampFormat -> count
  timestampFormats: new Set(),
  jsonLineCount:    0,
  statusCodes:      {},      // status string -> count
  methods:          {},      // method -> count
  errorCount:       0,       // 4xx + 5xx
  endpoints:        {},      // path -> { count, totalMs, maxMs }
};

function aggAdd(parsed) {
  agg.parsedLines++;
  const fmt = parsed.timestampFormat || 'unknown';
  agg.formatCounts[fmt] = (agg.formatCounts[fmt] || 0) + 1;
  if (fmt === 'json') { agg.jsonLineCount++; } else { agg.timestampFormats.add(fmt); }

  const statusKey = parsed.status != null ? String(parsed.status) : 'unknown';
  agg.statusCodes[statusKey] = (agg.statusCodes[statusKey] || 0) + 1;
  if (parsed.status != null && parsed.status >= 400) agg.errorCount++;

  if (parsed.method) agg.methods[parsed.method] = (agg.methods[parsed.method] || 0) + 1;

  if (parsed.path && parsed.responseTimeMs != null) {
    if (!agg.endpoints[parsed.path]) agg.endpoints[parsed.path] = { count: 0, totalMs: 0, maxMs: 0 };
    const ep = agg.endpoints[parsed.path];
    ep.count++;
    ep.totalMs += parsed.responseTimeMs;
    if (parsed.responseTimeMs > ep.maxMs) ep.maxMs = parsed.responseTimeMs;
  }
}

// ── Streaming read ────────────────────────────────────────────────────────────
// readline processes the file line-by-line so arbitrarily large files never
// need to be loaded into memory all at once.

const rl = readline.createInterface({
  input: fs.createReadStream(resolved, { encoding: 'utf8' }),
  crlfDelay: Infinity,  // treat \r\n as a single newline
  terminal: false,
});

rl.on('line', (line) => {
  agg.totalLines++;
  const parsed = parseLine(line);
  if (parsed) {
    aggAdd(parsed);
  } else {
    agg.skippedLines++;
  }
});

rl.on('close', () => {
  report(agg, { slowest: slowestN });
});

rl.on('error', (err) => {
  console.error(`Error reading ${resolved}: ${err.message}`);
  process.exit(1);
});
