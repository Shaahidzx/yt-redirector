// Pure functions, no browser APIs, so they're unit-testable (see selfcheck.mjs).

// Delay grows with age: base, then +step every rampEveryDays days, capped.
export function delaySeconds(cfg, installDate, now = Date.now()) {
  const days = Math.floor((now - (installDate || now)) / 86400000);
  return Math.min(cfg.cap, cfg.base + cfg.step * Math.floor(days / cfg.rampEveryDays));
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
      out.push(`- ${book.text.slice(h.start, h.end).trim().replace(/\s+/g, ' ')} _(${h.variant})_`);
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
