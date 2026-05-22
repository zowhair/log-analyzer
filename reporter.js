'use strict';

function pct(n, total) {
  if (!total) return '0.0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

function rpad(str, width) { return String(str).padEnd(width); }
function lpad(str, width) { return String(str).padStart(width); }

function bar(n, total, width) {
  if (!total) return '';
  const filled = Math.round((n / total) * width);
  return '#'.repeat(filled);
}

function fmt(n) { return n.toLocaleString('en-US'); }

function section(title) {
  console.log(title.toUpperCase());
  console.log('-'.repeat(50));
}

function report(agg, opts = {}) {
  const slowestN = Math.max(1, parseInt(opts.slowest) || 10);
  const {
    totalLines, parsedLines, skippedLines,
    formatCounts, timestampFormats,
    statusCodes, methods, endpoints,
    errorCount, jsonLineCount,
  } = agg;

  console.log('');
  console.log('='.repeat(52));
  console.log('  LOG ANALYSIS REPORT');
  console.log('='.repeat(52));
  console.log('');

  // ── Lines processed ──────────────────────────────────
  section('Lines Processed');
  console.log(`  Total:    ${lpad(fmt(totalLines), 10)}`);
  console.log(`  Parsed:   ${lpad(fmt(parsedLines), 10)}  (${pct(parsedLines, totalLines)})`);
  console.log(`  Skipped:  ${lpad(fmt(skippedLines), 10)}  (${pct(skippedLines, totalLines)})`);
  if (skippedLines > 0) {
    console.log(`\n  !! Skipped ${fmt(skippedLines)} unparseable lines (${pct(skippedLines, totalLines)})`);
  }
  console.log('');

  // ── Format anomalies ─────────────────────────────────
  const hasAnomalies = jsonLineCount > 0 || timestampFormats.size > 1;
  section('Format Anomalies');
  if (!hasAnomalies) {
    console.log('  None detected — all lines use consistent formatting.');
  } else {
    if (jsonLineCount > 0) {
      console.log(`  JSON-format lines detected:  ${fmt(jsonLineCount)}`);
    }
    if (timestampFormats.size > 1) {
      console.log(`  Distinct timestamp formats:  ${timestampFormats.size}`);
      const nonJsonFmts = Object.entries(formatCounts).filter(([f]) => f !== 'json' && formatCounts[f] > 0);
      for (const [fmt_, count] of nonJsonFmts) {
        console.log(`    ${rpad(fmt_, 10)} ${lpad(fmt(count), 7)} lines`);
      }
    }
  }
  console.log('');

  // ── Status code breakdown ─────────────────────────────
  section('Status Codes');
  if (!parsedLines) {
    console.log('  No parsed lines.');
  } else {
    const sortedStatuses = Object.entries(statusCodes).sort((a, b) => {
      const an = parseInt(a[0]) || 99999;
      const bn = parseInt(b[0]) || 99999;
      return an - bn;
    });
    for (const [code, count] of sortedStatuses) {
      const b = bar(count, parsedLines, 20);
      console.log(`  ${rpad(code, 8)}  ${lpad(fmt(count), 7)}  (${lpad(pct(count, parsedLines), 6)})  ${b}`);
    }
  }
  console.log('');

  // ── Error rate ────────────────────────────────────────
  section('Error Rate');
  console.log(`  4xx + 5xx errors:  ${fmt(errorCount)}  (${pct(errorCount, parsedLines)})`);
  console.log('');

  // ── HTTP methods ──────────────────────────────────────
  section('Request Methods');
  const sortedMethods = Object.entries(methods).sort((a, b) => b[1] - a[1]);
  if (!sortedMethods.length) {
    console.log('  No method data.');
  } else {
    for (const [method, count] of sortedMethods) {
      console.log(`  ${rpad(method, 10)}  ${lpad(fmt(count), 7)}  (${pct(count, parsedLines)})`);
    }
  }
  console.log('');

  // ── Slowest endpoints ─────────────────────────────────
  section(`Top ${slowestN} Slowest Endpoints (by max response time)`);
  const endpointEntries = Object.entries(endpoints);
  if (!endpointEntries.length) {
    console.log('  No endpoint timing data available.');
  } else {
    const slowest = endpointEntries
      .sort((a, b) => b[1].maxMs - a[1].maxMs)
      .slice(0, slowestN);
    for (const [ep, stats] of slowest) {
      const avg = Math.round(stats.totalMs / stats.count);
      console.log(`  ${ep}`);
      console.log(`    max=${Math.round(stats.maxMs)}ms  avg=${avg}ms  requests=${fmt(stats.count)}`);
    }
  }
  console.log('');
}

module.exports = { report };
