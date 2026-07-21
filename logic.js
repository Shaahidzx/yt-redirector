// Pure functions, no browser APIs, so they're unit-testable (see selfcheck.mjs).

// The delay grows GEOMETRICALLY: every day is the same small percentage longer than the
// day before, so no two consecutive days ever feel different — it just compounds.
// 1s → 300s over 100 days is +5.87%/day (day 10 ≈ 1.8s, day 50 ≈ 17s, day 100 = 5min).
export function delaySeconds(cfg, installDate, now = Date.now()) {
  // `x || default` would swallow a legitimate 0, so check for a finite number instead.
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const start = Math.max(0.1, num(cfg?.startSeconds, 1));
  const target = num(cfg?.targetSeconds, 300);
  const days = num(cfg?.targetDays, 100);
  if (target <= start || days <= 0) return target;
  // `installDate || now` would swallow a legitimate 0 (epoch), so check for finite.
  const installed = Number.isFinite(Number(installDate)) ? Number(installDate) : now;
  const elapsed = Math.max(0, Math.floor((now - installed) / 86400000));
  const f = Math.min(1, elapsed / days);
  return Math.round(start * Math.pow(target / start, f) * 10) / 10;
}

// Reading units. Extracted text is newline-separated paragraphs.
// ponytail: naive sentence regex; "Mr." / "e.g." will split a beat early. Fix only if it grates.
const SENTENCE_END = /[.!?]["'”’)\]]?(?=\s|$)/;

// End offset of the first sentence at `start`, never crossing into the next paragraph
// (so a heading line with no terminator returns the whole line, not heading + next sentence).
export function sentenceEnd(text, start) {
  const nl = text.indexOf('\n', start);
  const paraEnd = nl < 0 ? text.length : nl;
  const m = SENTENCE_END.exec(text.slice(start, paraEnd));
  return m ? start + m.index + m[0].length : paraEnd;
}

// End offset one paragraph forward: next newline after `start`, swallowing the blank-line
// run. If `start` is mid-paragraph it finishes that paragraph.
export function paragraphEnd(text, start) {
  let end = text.indexOf('\n', start);
  if (end < 0) return text.length;
  while (end < text.length && text[end] === '\n') end++;
  return end;
}

// Start offset of the paragraph before `start` (for reading backward).
export function prevParagraphStart(text, start) {
  let i = start - 1;
  while (i >= 0 && text[i] === '\n') i--;      // skip the gap right before `start`
  if (i < 0) return 0;
  const nl = text.lastIndexOf('\n', i);        // the break before the previous paragraph
  return nl < 0 ? 0 : nl + 1;
}

// Snap an arbitrary offset back to the start of the paragraph it lands in.
export function paragraphStartAt(text, offset) {
  if (offset <= 0) return 0;
  const nl = text.lastIndexOf('\n', offset - 1);
  return nl < 0 ? 0 : nl + 1;
}

// Scrubber math: map a percent (0–100) over the readable span [floor, len] to an offset,
// and back. Kept as a pair so the slider and the % label stay consistent.
export function percentToOffset(text, pct, floor = 0) {
  const span = text.length - floor;
  return floor + Math.round((span * Math.min(100, Math.max(0, pct))) / 100);
}
export function offsetToPercent(text, offset, floor = 0) {
  const span = text.length - floor;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((offset - floor) / span) * 100));
}

// Auto-label for a bookmark: the first sentence at `pos`, trimmed and clamped.
export function bookmarkLabel(text, pos, max = 45) {
  const s = text.slice(pos, sentenceEnd(text, pos)).trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max - 1) + '…' : (s || '(bookmark)');
}

// Guess where the real book starts, skipping front-matter. Extracted text (epub spine
// docs, pdf pages, txt paragraphs) is blank-line separated: front-matter blocks are
// short, the first chapter opens with a long prose block. Return that block's offset.
// ponytail: first-long-prose-block heuristic; a book opening on short dialogue could
// start a beat late. No manual override by design — re-import if it misses.
const FRONT_MATTER = /copyright|all rights reserved|\bisbn\b|table of contents|^\s*contents\s*$|acknowledg|dedication|about the author|title page/i;
export function detectStart(text, minChars = 500) {
  const block = /[^\n](?:[^\n]|\n(?!\n))*/g; // a run of text up to a blank line
  let m;
  while ((m = block.exec(text))) {
    if (m[0].trim().length >= minChars && !FRONT_MATTER.test(m[0].slice(0, 400))) {
      return m.index;
    }
  }
  return 0;
}

// --- reading streak --------------------------------------------------------
// Local calendar day, e.g. "2026-7-19". Local (not UTC) so the day flips at the
// reader's midnight, not the server's.
export function dayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
export function prevKey(key) {
  const [y, mo, d] = key.split('-').map(Number);
  const t = new Date(y, mo - 1, d - 1);
  return dayKey(t);
}
// Advance the streak for a read that happened on `todayKey`. Same day = no change;
// consecutive day = +1; any gap = reset to 1. Best is the high-water mark.
export function updateStreak(state, todayKey) {
  const s = { last: state.last || null, current: state.current || 0, best: state.best || 0 };
  if (s.last === todayKey) return s;
  s.current = s.last === prevKey(todayKey) ? s.current + 1 : 1;
  s.best = Math.max(s.best, s.current);
  s.last = todayKey;
  return s;
}

// Export a book's highlights + bookmarks as Markdown (Pro feature).
export function highlightsMarkdown(book) {
  const out = ['# ' + book.name, ''];
  const hs = [...(book.highlights || [])].sort((a, b) => a.start - b.start);
  if (hs.length) {
    out.push('## Highlights', '');
    for (const h of hs) {
      let line = `- ${book.text.slice(h.start, h.end).trim().replace(/\s+/g, ' ')} _(${h.variant})_`;
      if (h.note) line += `\n  - note: ${h.note.replace(/\s+/g, ' ').trim()}`;
      out.push(line);
    }
    out.push('');
  }
  const bm = [...(book.bookmarks || [])].sort((a, b) => a.pos - b.pos);
  if (bm.length) {
    out.push('## Bookmarks', '');
    for (const b of bm) out.push(`- ${b.label}`);
    out.push('');
  }
  if (!hs.length && !bm.length) out.push('_No highlights or bookmarks yet._');
  return out.join('\n');
}

// Find up to `max` case-insensitive matches of `query` in the book, each with a short
// context snippet and its offset (Pro search). Pure so it's testable.
export function searchBook(text, query, max = 20) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const lower = text.toLowerCase();
  const out = [];
  let i = lower.indexOf(q);
  while (i !== -1 && out.length < max) {
    const from = Math.max(0, i - 30);
    const to = Math.min(text.length, i + q.length + 40);
    let snippet = text.slice(from, to).replace(/\s+/g, ' ').trim();
    if (from > 0) snippet = '…' + snippet;
    if (to < text.length) snippet += '…';
    out.push({ offset: i, snippet });
    i = lower.indexOf(q, i + q.length);
  }
  return out;
}

// --- blocked sites ---------------------------------------------------------
// Turn whatever the user typed ("https://WWW.Reddit.com/r/x") into a bare domain
// ("reddit.com"). Returns '' for junk so callers can reject it.
export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '');   // scheme
  s = s.split('/')[0].split('?')[0].split('#')[0];
  s = s.split('@').pop();              // userinfo
  s = s.split(':')[0];                 // port
  s = s.replace(/^www\./, '');
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return '';
  return s;
}

// DNR redirect rules: any main-frame hit on a blocked domain goes to the reader, carrying
// the original URL so "Continue" can send you back to the exact page.
export function buildRedirectRules(domains, extId) {
  return domains.map((d, i) => ({
    id: i + 1,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: `chrome-extension://${extId}/reader.html?to=\\0` },
    },
    condition: {
      regexFilter: `^https?://([a-z0-9-]+\\.)*${d.replace(/\./g, '\\.')}/.*`,
      resourceTypes: ['main_frame'],
    },
  }));
}

// --- highlight rendering ---------------------------------------------------
// Cut [from,to) at every highlight boundary and label each segment with the
// covering variant (last-added wins on overlap) or null. Pure so it's testable.
export function buildSegments(from, to, highlights = []) {
  const cuts = new Set([from, to]);
  for (const h of highlights) {
    if (h.end <= from || h.start >= to) continue;
    cuts.add(Math.max(from, h.start));
    cuts.add(Math.min(to, h.end));
  }
  const points = [...cuts].sort((a, b) => a - b);
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    if (a >= b) continue;
    const mid = (a + b) / 2;
    let variant = null;
    for (const h of highlights) if (h.start <= mid && mid < h.end) variant = h.variant;
    segs.push({ start: a, end: b, variant });
  }
  return segs;
}
