# Log Analyzer CLI

A streaming server log analyzer built entirely in Node.js — no npm dependencies, built-in modules only.

## Prerequisites

- Node.js v14 or later (`node --version` to check)
- No `npm install` needed — zero external dependencies

## Quick Start

```bash
# 1. Generate a sample log file (10,000 lines with mixed formats and deliberate mess)
node scripts/generate-log.js sample.log 10000

# 2. Analyze it
node analyze.js sample.log

# 3. Show the top 20 slowest endpoints instead of the default 10
node analyze.js sample.log --slowest 20
```

## Command Reference

### Analyzer

```
node analyze.js <log-file> [options]

Options:
  --slowest N    Show top N slowest endpoints by max response time (default: 10)
  --help, -h     Show help
```

### Generator

```
node scripts/generate-log.js <output-path> <line-count>

Examples:
  node scripts/generate-log.js logs/dev.log 1000
  node scripts/generate-log.js logs/big.log 500000
```

## Log Format Supported

Standard line:

```
2024-03-15T14:23:01Z 192.168.1.42 GET /api/users 200 142ms
```

The analyzer also handles:

| Deviation | Example |
|---|---|
| Slash timestamp | `2024/03/15 14:23:01` |
| Human timestamp | `15-Mar-2024 14:23:01` |
| Unix epoch | `1710512581` |
| Response time in seconds | `0.142s` |
| Bare response time | `142` |
| Missing/dashed status | `192.168.1.1 GET /api 200 -` → status = unknown |
| Quoted user-agent with spaces | `"Mozilla/5.0 (Windows NT 10.0)"` |
| Quoted referrer with spaces | `"https://example.com/my page"` |
| JSON-format lines | `{"method":"GET","path":"/api","status":200,...}` |
| Blank lines | skipped, counted |
| Malformed lines | skipped, counted |

## Sample Output

```
====================================================
  LOG ANALYSIS REPORT
====================================================

LINES PROCESSED
--------------------------------------------------
  Total:        10,000
  Parsed:        9,526  (95.3%)
  Skipped:         474  (4.7%)

  !! Skipped 474 unparseable lines (4.7%)

FORMAT ANOMALIES
--------------------------------------------------
  JSON-format lines detected:  487
  Distinct timestamp formats:  4
    human          130 lines
    iso          8,670 lines
    ...
```

## Project Structure

```
analyze.js              Entry point — streams file line-by-line via readline
src/
  parser.js             Pure parser: tries formats in turn, returns null on failure
  aggregator.js         Accumulates stats from parsed lines
  reporter.js           Prints the terminal summary
scripts/
  generate-log.js       Messy log generator for testing
```

## Design Notes

- **Streaming**: `readline` + `fs.createReadStream` keeps memory use constant regardless of file size.
- **Never crashes on bad input**: the parser wraps everything in `try/catch` and returns `null`; the main loop counts nulls as skipped lines.
- **Always reports skipped lines**: if any lines are skipped, the count and percentage appear prominently in the output.
