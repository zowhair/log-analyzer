# Assessment Answers

---

## Q1 — How to Run

No installation required beyond Node.js v14+.

```bash

# Generate a test log (10,000 lines)
node scripts/generate-log.js sample.log 10000

# Run the analyzer
node analyze.js sample.log

# Show top 20 slowest endpoints instead of default 10
node analyze.js sample.log --slowest 20

# Help
node analyze.js --help
```

To generate a large file for stress-testing:

```bash
node scripts/generate-log.js big.log 500000
node analyze.js big.log --slowest 5
```

---

## Q2 — Stack Choice

**Why Node.js CLI:**

Node's built-in `readline` module was the decisive reason. It emits one line at a time from a `ReadStream`, so a 500,000-line log file is processed at constant memory, the program holds only the current line and the running aggregator, never the whole file. That's a deliberate architectural choice, not an afterthought, and it's the right one for a tool that has to handle "a few hundred to a few hundred thousand lines."

Beyond that: JSON parsing is built-in (critical for mixed-format logs), the standard library has everything needed (no `npm install`), and Node starts fast, it's a CLI, not a service.

**What would have been a worse choice and why:**

A browser-based React dashboard would be actively wrong. Browsers have no filesystem API for streaming a log file; you'd need to read the whole thing into memory, which is exactly what this tool avoids. Building a UI also consumes time that belongs to parsing correctness. A 500,000-line log file would stall or crash a browser tab.

Shell scripting (`awk`/`sed`) would also be worse: handling four timestamp formats, three response-time units, JSON lines, and quoted referrer fields in pure shell is brittle, unreadable, and nearly untestable.

---

## Q3 — One Real Edge Case

**Edge case: quoted referrer fields containing spaces**

A log line can end with quoted extra fields:

```
2024-03-15T14:23:01Z 192.168.1.42 GET /api/users 200 142ms "Mozilla/5.0" "https://newtest.com/my results page"
```

The referrer `"https://example.com/my results page"` contains two spaces. A naive `line.split(' ')` produces eleven tokens instead of eight, shifting every positional field that follows out of alignment. The method and path would appear in the wrong slots, and the line would either fail to parse or produce garbage.

**File and line that handles it:**

`src/parser.js`, **line 16**:

```javascript
if (line[i] === '"') {
```

This is the branch inside `tokenize()` (lines 9–35) that detects an opening quote and then scans forward to the matching closing quote, collecting the entire span — spaces included — as a single token. The surrounding `else` branch at line 28 handles ordinary unquoted tokens by splitting on spaces as usual.

**What would break without it:**

The referrer `"https://example.com/my results page"` would split into four tokens: `"https://example.com/my`, `results`, `page"`. Every field after the response time would be consumed by those phantom tokens. If there happened to be N such space-containing fields on a line, the field count would be inflated by N, breaking the positional assumptions the parser relies on for every field from IP address onward.

---

## Q4 — AI Usage

AI (Claude) was used to help build this project.

**What was asked:**

[PLACEHOLDER — describe what you asked Claude to build/generate. For example: "I asked Claude to scaffold the overall project structure, write the parser and aggregator modules, and produce the generator script based on the spec."]

**What Claude produced:**

[PLACEHOLDER describe what Claude generated initially. For example: "Claude produced the full file set: parser.js with the tokenizer and timestamp branches, aggregator.js, reporter.js, analyze.js, and the generator script, along with README and ANSWERS drafts."]

**What I changed and why:**

[PLACEHOLDER — describe at least one specific change you made to Claude's output and why you made it. Be concrete: what exactly did you modify (a function, a heuristic, an output format, an edge-case branch), and what was your reason? Examples of the kind of thing to note: changed the status-code lookahead logic because the original had a false-positive on bare integers, reformatted the report output, adjusted the generator's deviation ratios, fixed a regex, etc.]

---

## Q5 — Honest Gap

**The genuine weakness: no unit tests for individual parser branches.**

The parser has several interacting paths — four timestamp formats, three response-time units, quoted-field tokenization, JSON detection, the status-code lookahead — and none of them have dedicated unit tests. The only validation that everything works is running the generator and eyeballing the output. That's not enough.

Specifically, the status-code lookahead heuristic (checking whether the token *after* a 3-digit number looks like a response time before committing to treating the number as a status code) is subtle and could silently misclassify a bare integer response time like `200` as a status code `200` if it appears at end-of-line with no following token. The tool won't crash — it will just miscount which is the worst kind of wrong.

**With another day:** I'd add a `tests/` directory with a test runner (Node's built-in `node:test` module, no Jest needed) that exercises `parseLine()` with fixtures for every timestamp format, every response-time unit, the quoted-referrer case, the JSON branch, and the explicitly malformed lines. I'd also add a property-based roundtrip test: generate a line from the generator, parse it, and assert that every field round-trips correctly.
