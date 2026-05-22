'use strict';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
const VALID_METHODS = new Set(['GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS','CONNECT','TRACE']);

// Tokenize a line respecting double-quoted strings as single tokens.
// A naive split(' ') breaks on lines like: 200 142ms "Mozilla/5.0 (Windows NT)"
// because spaces inside quotes would produce extra tokens and shift all field positions.
function tokenize(line) {
  const tokens = [];
  let i = 0;
  const len = line.length;
  while (i < len) {
    while (i < len && line[i] === ' ') i++;
    if (i >= len) break;
    if (line[i] === '"') {
      // Quoted token: scan until closing quote, treating the whole span as one token.
      // Without this branch, a referrer like "https://example.com/my page" would be
      // split into ["https://example.com/my", "page\""], corrupting every field after it.
      i++;
      const start = i;
      while (i < len && line[i] !== '"') {
        if (line[i] === '\\') i++; // skip escaped character
        i++;
      }
      tokens.push(line.slice(start, i));
      if (i < len) i++; // skip closing quote
    } else {
      const start = i;
      while (i < len && line[i] !== ' ') i++;
      tokens.push(line.slice(start, i));
    }
  }
  return tokens;
}

// Parse timestamp token(s), returns { date, consumed, format } or null.
// consumed = number of tokens the timestamp occupied (1 or 2).
function parseTimestamp(t1, t2) {
  if (!t1) return null;

  // ISO 8601: 2024-03-15T14:23:01Z  or  2024-03-15T14:23:01.123Z
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(t1)) {
    const d = new Date(t1);
    if (!isNaN(d)) return { date: d, consumed: 1, format: 'iso' };
  }

  // Unix epoch: 10 digits (seconds) or 13 digits (ms)
  if (/^\d{10,13}$/.test(t1)) {
    const n = parseInt(t1, 10);
    const d = new Date(t1.length <= 10 ? n * 1000 : n);
    if (!isNaN(d)) return { date: d, consumed: 1, format: 'epoch' };
  }

  // Slash date: 2024/03/15 14:23:01  (two tokens)
  if (t2 && /^\d{4}\/\d{2}\/\d{2}$/.test(t1) && /^\d{2}:\d{2}:\d{2}$/.test(t2)) {
    const d = new Date(t1.replace(/\//g, '-') + 'T' + t2 + 'Z');
    if (!isNaN(d)) return { date: d, consumed: 2, format: 'slash' };
  }

  // Human date: 15-Mar-2024 14:23:01  (two tokens)
  if (t2 && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(t1) && /^\d{2}:\d{2}:\d{2}$/.test(t2)) {
    const m = t1.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) {
      const month = MONTHS[m[2]];
      if (month !== undefined) {
        const [h, mi, s] = t2.split(':').map(Number);
        const d = new Date(Date.UTC(parseInt(m[3]), month, parseInt(m[1]), h, mi, s));
        if (!isNaN(d)) return { date: d, consumed: 2, format: 'human' };
      }
    }
  }

  return null;
}

// Normalize response time to milliseconds.
// Handles: 142ms  |  0.142s  |  142 (bare integer, assumed ms)
function parseResponseTime(token) {
  if (!token) return null;
  const msMatch = token.match(/^(\d+(?:\.\d+)?)ms$/);
  if (msMatch) return parseFloat(msMatch[1]);
  const sMatch = token.match(/^(\d+(?:\.\d+)?)s$/);
  if (sMatch) return parseFloat(sMatch[1]) * 1000;
  if (/^\d+(?:\.\d+)?$/.test(token)) return parseFloat(token); // bare number → ms
  return null;
}

// Parse a JSON-format log line mixed in when logging config changes.
function parseJsonLine(line) {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== 'object' || Array.isArray(obj) || obj === null) return null;

    const ts  = obj.timestamp ?? obj.time ?? obj.ts ?? obj['@timestamp'] ?? null;
    const ip  = obj.ip ?? obj.remoteAddr ?? obj.remote_addr ?? obj.clientIp ?? null;
    const method = ((obj.method ?? obj.httpMethod ?? '')).toUpperCase();
    const path   = obj.path ?? obj.url ?? obj.uri ?? null;
    const statusRaw = obj.status ?? obj.statusCode ?? obj.status_code ?? null;
    const rtRaw     = obj.responseTime ?? obj.response_time ?? obj.duration ?? obj.latency ?? null;

    if (!VALID_METHODS.has(method) || !path) return null;

    let date = null;
    if (ts !== null) {
      if (typeof ts === 'number') {
        date = new Date(ts > 1e10 ? ts : ts * 1000);
      } else {
        date = new Date(ts);
      }
      if (isNaN(date)) date = null;
    }

    let responseTimeMs = null;
    if (rtRaw !== null) {
      if (typeof rtRaw === 'number') {
        responseTimeMs = rtRaw; // assume ms
      } else {
        responseTimeMs = parseResponseTime(String(rtRaw));
      }
    }

    const status = statusRaw !== null ? parseInt(statusRaw, 10) : null;

    return {
      timestamp: date,
      timestampFormat: 'json',
      ip,
      method,
      path,
      status: (status !== null && !isNaN(status)) ? status : null,
      responseTimeMs,
      format: 'json',
    };
  } catch {
    return null;
  }
}

// Parse a standard (or deviantly-formatted) log line.
function parseStandardLine(line) {
  const tokens = tokenize(line);
  if (tokens.length < 5) return null;

  const tsResult = parseTimestamp(tokens[0], tokens[1]);
  if (!tsResult) return null;

  const off = tsResult.consumed;
  if (tokens.length < off + 3) return null;

  const ip     = tokens[off];
  const method = tokens[off + 1].toUpperCase();
  const path   = tokens[off + 2];

  if (!VALID_METHODS.has(method)) return null;
  if (!path.startsWith('/'))      return null;

  let status        = null;
  let responseTimeMs = null;
  let nextIdx       = off + 3;
  const statusToken = tokens[nextIdx];

  if (statusToken === '-') {
    // Explicit missing status marker
    nextIdx++;
  } else if (statusToken && /^\d{3}$/.test(statusToken)) {
    const n = parseInt(statusToken, 10);
    if (n >= 100 && n <= 599) {
      // Only treat as status code when the following token looks like a response time,
      // guarding against a bare integer response time being mistaken for a status code.
      const following = tokens[nextIdx + 1];
      if (!following || parseResponseTime(following) !== null) {
        status = n;
        nextIdx++;
      }
    }
  }
  // else: status absent — fall through and try to read response time directly

  if (tokens[nextIdx]) {
    responseTimeMs = parseResponseTime(tokens[nextIdx]);
    if (responseTimeMs !== null) nextIdx++;
  }

  return {
    timestamp: tsResult.date,
    timestampFormat: tsResult.format,
    ip,
    method,
    path,
    status,
    responseTimeMs,
    format: 'standard',
  };
}

// Public entry point — NEVER throws. Returns null for unparseable lines.
function parseLine(line) {
  try {
    if (!line || !line.trim()) return null;
    const trimmed = line.trim();
    if (trimmed.startsWith('{')) return parseJsonLine(trimmed);
    return parseStandardLine(trimmed);
  } catch {
    return null;
  }
}

module.exports = { parseLine, tokenize, parseResponseTime };
