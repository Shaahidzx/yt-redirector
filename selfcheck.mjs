// Run: node selfcheck.mjs   — asserts the delay ramp, reading units, and start-detector behave.
import assert from 'node:assert';
import { delaySeconds, sentenceEnd, paragraphEnd, prevParagraphStart, paragraphStartAt, percentToOffset, offsetToPercent, bookmarkLabel, highlightsMarkdown, searchBook, normalizeDomain, buildRedirectRules, detectStart, dayKey, prevKey, updateStreak, buildSegments } from './logic.js';

const cfg = { startSeconds: 1, targetSeconds: 300, targetDays: 100 };
const DAY = 86400000;
const t0 = 1_700_000_000_000;
const delayAt = (d) => delaySeconds(cfg, t0, t0 + d * DAY);

// Delay curve: starts at `start`, reaches `target` on day N, then stays there.
assert.strictEqual(delayAt(0), 1);
assert.strictEqual(delayAt(100), 300);
assert.strictEqual(delayAt(250), 300);                       // clamped past the target day
assert.strictEqual(delaySeconds(cfg, undefined), 1);    // no install date yet

// Strictly increasing, and never a jarring jump: the day-to-day RATIO is constant,
// so day 1→2 feels exactly like day 50→51. That's the whole point of the curve.
for (let d = 0; d < 100; d++) assert.ok(delayAt(d + 1) >= delayAt(d), `not increasing at day ${d}`);
const early = delayAt(21) / delayAt(20), late = delayAt(71) / delayAt(70);
assert.ok(Math.abs(early - late) < 0.01, `ratio drifted: ${early} vs ${late}`);
assert.ok(early > 1.05 && early < 1.07, `expected ~+5.9%/day, got ${early}`);

// Degenerate configs fall back to the target instead of exploding.
assert.strictEqual(delaySeconds({ startSeconds: 5, targetSeconds: 5, targetDays: 10 }, t0, t0), 5);
assert.strictEqual(delaySeconds({ startSeconds: 1, targetSeconds: 60, targetDays: 0 }, t0, t0), 60);

// Reading units. Paragraphs are newline-separated in our extracted text.
const p1 = 'First para. It has two sentences.';
const p2 = 'Second para continues the story here.';
const p3 = 'Third and last paragraph.';
const txt = [p1, p2, p3].join('\n\n');

// sentenceEnd: one sentence, doesn't cross the paragraph newline.
assert.strictEqual(txt.slice(0, sentenceEnd(txt, 0)), 'First para.');
assert.strictEqual(txt.slice(11, sentenceEnd(txt, 11)).trim(), 'It has two sentences.');
// A heading line with no terminator returns the whole line, not heading + next sentence.
const withHeading = 'Chapter One\n\nHe woke early. Then he rose.';
assert.strictEqual(withHeading.slice(0, sentenceEnd(withHeading, 0)), 'Chapter One');

// paragraphEnd: exactly one paragraph forward; mid-paragraph start finishes that paragraph.
assert.strictEqual(txt.slice(0, paragraphEnd(txt, 0)).trim(), p1);
assert.strictEqual(txt.slice(11, paragraphEnd(txt, 11)).trim(), 'It has two sentences.'); // rest of p1
assert.strictEqual(paragraphEnd(txt, txt.indexOf(p3)), txt.length); // last paragraph reaches the end

// prevParagraphStart: walk back one paragraph, clamp at 0.
assert.strictEqual(prevParagraphStart(txt, txt.indexOf(p2)), 0);          // p2 → start of p1
assert.strictEqual(txt.slice(prevParagraphStart(txt, txt.indexOf(p3))).startsWith(p2), true); // p3 → p2
assert.strictEqual(prevParagraphStart(txt, 0), 0);                        // already at start

// paragraphStartAt: snap any offset to its paragraph start; clamp at 0.
const p2at = txt.indexOf(p2);
assert.strictEqual(paragraphStartAt(txt, p2at + 5), p2at);                // mid-p2 → start of p2
assert.strictEqual(paragraphStartAt(txt, p2at), p2at);                    // already at start
assert.strictEqual(paragraphStartAt(txt, 3), 0);                          // mid-p1 → 0

// percent <-> offset round-trips over [floor, len].
const floor = 4;
assert.strictEqual(percentToOffset(txt, 0, floor), floor);
assert.strictEqual(percentToOffset(txt, 100, floor), txt.length);
assert.ok(Math.abs(offsetToPercent(txt, percentToOffset(txt, 50, floor), floor) - 50) <= 1); // integer-offset rounding
assert.strictEqual(offsetToPercent(txt, floor, floor), 0);

// bookmarkLabel: first sentence, clamped with an ellipsis.
assert.strictEqual(bookmarkLabel(txt, 0), 'First para.');
assert.strictEqual(bookmarkLabel('x'.repeat(100), 0, 10), 'xxxxxxxxx…');
assert.strictEqual(bookmarkLabel('', 0), '(bookmark)');

// highlightsMarkdown: lists highlights + bookmarks, or a placeholder when empty.
const exBook = { name: 'B', text: 'Alpha beta. Gamma delta.', highlights: [{ start: 0, end: 10, variant: 'yellow' }], bookmarks: [{ pos: 0, label: 'Alpha beta.' }] };
const md = highlightsMarkdown(exBook);
assert.ok(md.includes('# B') && md.includes('- Alpha beta _(yellow)_') && md.includes('## Bookmarks'));
assert.ok(highlightsMarkdown({ name: 'E', text: '', highlights: [], bookmarks: [] }).includes('No highlights'));
// notes ride along with their highlight in the export.
assert.ok(highlightsMarkdown({ name: 'N', text: 'Alpha beta.', highlights: [{ start: 0, end: 10, variant: 'blue', note: 'key idea' }], bookmarks: [] }).includes('note: key idea'));

// searchBook: finds every occurrence with a snippet + offset; empty query → nothing.
const sb = 'The cat sat. Later the cat ran. No feline here.';
const hits = searchBook(sb, 'cat');
assert.strictEqual(hits.length, 2);
assert.strictEqual(hits[0].offset, sb.indexOf('cat'));
assert.ok(hits[1].offset > hits[0].offset && hits[1].snippet.toLowerCase().includes('cat'));
assert.deepStrictEqual(searchBook(sb, '  '), []);
assert.strictEqual(searchBook('a a a a', 'a', 2).length, 2); // respects max

// normalizeDomain: strip scheme/www/path/port/case; reject junk.
assert.strictEqual(normalizeDomain('https://WWW.Reddit.com/r/all?x=1'), 'reddit.com');
assert.strictEqual(normalizeDomain('  instagram.com  '), 'instagram.com');
assert.strictEqual(normalizeDomain('news.ycombinator.com:443'), 'news.ycombinator.com');
assert.strictEqual(normalizeDomain('notadomain'), '');
assert.strictEqual(normalizeDomain(''), '');

// buildRedirectRules: one main_frame redirect per domain, unique ids, carries ?to=
const rules = buildRedirectRules(['youtube.com', 'reddit.com'], 'abc123');
assert.strictEqual(rules.length, 2);
assert.deepStrictEqual(rules.map(r => r.id), [1, 2]);
assert.ok(rules[0].action.redirect.regexSubstitution.startsWith('chrome-extension://abc123/reader.html?to='));
assert.deepStrictEqual(rules[0].condition.resourceTypes, ['main_frame']);
assert.ok(new RegExp(rules[1].condition.regexFilter).test('https://www.reddit.com/r/x'));
assert.ok(!new RegExp(rules[1].condition.regexFilter).test('https://notreddit.com/x'));

// detectStart: skip title/copyright/TOC front-matter, land on the first long prose block.
const chapter = 'It was a cold morning when he finally understood. ' .repeat(12); // >500 chars
const book = [
  'The Great Novel',                    // title page (short)
  'Copyright 2026 Someone. All rights reserved. ISBN 000.', // front-matter keyword
  'Contents\nChapter One\nChapter Two', // TOC (short-ish)
  chapter,                              // <-- real start
  'The next chapter.',
].join('\n\n');
const at = detectStart(book);
assert.strictEqual(book.slice(at).startsWith(chapter.trim()[0]) && book.slice(at, at + 20), chapter.slice(0, 20));
assert.ok(at > book.indexOf('Contents'));  // landed after the TOC
assert.strictEqual(detectStart('short\n\nalso short'), 0); // nothing long → offset 0

// Streak: prevKey handles month/year rollover; increment / reset / same-day / best.
assert.strictEqual(prevKey('2026-3-1'), '2026-2-28');
assert.strictEqual(prevKey('2026-1-1'), '2025-12-31');
assert.strictEqual(dayKey(new Date(2026, 6, 19)), '2026-7-19'); // month is 1-based here
let st = { last: null, current: 0, best: 0 };
st = updateStreak(st, '2026-7-10'); assert.deepStrictEqual(st, { last: '2026-7-10', current: 1, best: 1 });
st = updateStreak(st, '2026-7-10'); assert.strictEqual(st.current, 1);          // same day: no change
st = updateStreak(st, '2026-7-11'); assert.strictEqual(st.current, 2);          // consecutive: +1
st = updateStreak(st, '2026-7-12'); assert.strictEqual(st.current, 3);
assert.strictEqual(st.best, 3);
st = updateStreak(st, '2026-7-15'); assert.strictEqual(st.current, 1);          // 2-day gap: reset
assert.strictEqual(st.best, 3);                                                 // best survives

// buildSegments: middle highlight → text|mark|text; clip at edge; overlap → later wins; none → plain.
let segs = buildSegments(0, 10, [{ start: 3, end: 6, variant: 'yellow' }]);
assert.deepStrictEqual(segs, [
  { start: 0, end: 3, variant: null },
  { start: 3, end: 6, variant: 'yellow' },
  { start: 6, end: 10, variant: null },
]);
segs = buildSegments(5, 10, [{ start: 0, end: 7, variant: 'green' }]); // clipped to range start
assert.deepStrictEqual(segs, [
  { start: 5, end: 7, variant: 'green' },
  { start: 7, end: 10, variant: null },
]);
segs = buildSegments(0, 10, [{ start: 0, end: 10, variant: 'yellow' }, { start: 2, end: 5, variant: 'pink' }]);
assert.strictEqual(segs.find(s => s.start === 2).variant, 'pink');  // later-added wins on overlap
assert.strictEqual(segs.find(s => s.start === 5).variant, 'yellow');
assert.deepStrictEqual(buildSegments(0, 4, []), [{ start: 0, end: 4, variant: null }]);

console.log('ok');
