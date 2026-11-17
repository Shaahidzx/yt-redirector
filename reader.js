import { CONFIG } from './config.js';
import { sentenceEnd, nextSentenceStart, sentenceStartAt, prevSentenceStart,
  percentToOffset, offsetToPercent, bookmarkLabel, highlightsMarkdown, searchBook, buildSegments,
  orpIndex, wordDelay, rampWpm, bumpStats, bookTitle } from './logic.js';

const cfg = CONFIG;
const $ = (id) => document.getElementById(id);
const $text = $('text');
const $more = $('more');
const $prev = $('prev');
const $empty = $('empty');
const $go = $('go');
const $progress = $('progress');
const $books = $('books');
const $totop = $('totop');
const $panel = $('panel');
const $scrub = $('scrub');
const $scrubpct = $('scrubpct');
const $chapters = $('chapters');
const $bmarks = $('bmarks');
const $search = $('search');
const $searchResults = $('searchResults');
const $noteEditor = $('noteEditor');
const $noteText = $('noteText');
const params = new URLSearchParams(location.search);
const onDemand = params.has('ondemand');
// The blocked site we intercepted, so Continue can send you back to that exact page.
const target = safeTarget(params.get('to'));
function safeTarget(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

document.getElementById('opts').onclick = (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
};
// Always-available back-to-top: a floating button that appears once you've scrolled
// down. Instant scroll — smooth-scroll is an unreliable no-op in some webviews.
$totop.onclick = () => window.scrollTo(0, 0);
addEventListener('scroll', () => { $totop.hidden = window.scrollY < 300; });

init();

async function init() {
  const { books, activeId, settings: saved, stats: savedStats } =
    await chrome.storage.local.get(['books', 'activeId', 'settings', 'stats']);
  settings = { ...cfg.readerDefaults, ...(saved || {}) };
  stats = savedStats;
  renderStats();
  wirePanel();                   // builds the theme buttons applySettings marks
  applySettings();               // set fonts/theme before first paint
  if (onDemand) document.querySelector('footer').hidden = true; // pure reading, no YouTube gate
  else $go.textContent = `Continue to ${target ? new URL(target).hostname.replace(/^www\./, '') : 'YouTube'}`;
  buildSwitcher(books, activeId);
  loadBook(books, activeId);
  if (book) { renderChapters(); renderBookmarks(); refreshScrub(); }
}

// Hover bar + the menu's Library shelf: switch books without leaving the page.
function buildSwitcher(books, activeId) {
  $('libManage').onclick = () => chrome.runtime.openOptionsPage();
  for (const b of books || []) {
    const title = bookTitle(b.name);
    const open = async () => {
      if (b.id === activeId) { closePanel(); return; }
      await chrome.storage.local.set({ activeId: b.id });
      location.reload();
    };
    const btn = document.createElement('button');
    btn.textContent = title;
    if (b.id === activeId) btn.className = 'on';
    btn.onclick = open;
    $books.append(btn);

    const card = document.createElement('button');
    card.className = 'book' + (b.id === activeId ? ' on' : '');
    card.title = title;
    card.onclick = open;
    const cover = document.createElement(b.cover ? 'img' : 'div');
    cover.className = 'cover';
    if (b.cover) { cover.src = b.cover; cover.alt = ''; } else cover.textContent = title;
    const name = document.createElement('span');
    name.className = 'bname';
    name.textContent = title;
    const meta = document.createElement('span');
    meta.className = 'bmeta';
    meta.textContent = (b.id === activeId ? '● ' : '') +
      Math.floor(offsetToPercent(b.text || '', b.readPos || 0, b.startOffset || 0)) + '% read';
    card.append(cover, name, meta);
    $('shelf').append(card);
  }
}

// --- continue --------------------------------------------------------------
// ponytail: no delay for now; a better gate replaces the old growing countdown later.
$go.onclick = async () => {
  $go.disabled = true;
  await chrome.runtime.sendMessage({ type: 'continue' });
  location.href = target || 'https://www.youtube.com/';
};

// --- flowing reader --------------------------------------------------------
// PAGER: one sentence per page, [base,pos). The sentence before it stays greyed above
// (teleprompter). `readPos` persists `base`.
let book, base, pos, settings;

// Show the sentence containing `start`, clamped into range; at/after the end, backs up to
// the last sentence. Returns true if that end-fallback fired (a stale position needing repair).
function showPage(start) {
  const floor = book.startOffset || 0;
  const len = book.text.length;
  base = Math.max(floor, sentenceStartAt(book.text, Math.min(start, len)));
  let fellBack = false;
  if (base >= len || sentenceEnd(book.text, base) <= base) {
    base = Math.max(floor, prevSentenceStart(book.text, len));
    fellBack = true;
  }
  pos = sentenceEnd(book.text, base);
  const atEnd = nextSentenceStart(book.text, base) >= len;
  $more.disabled = atEnd;
  $more.title = atEnd ? 'End of book' : 'Next line (→)';
  renderShown();
  renderPrev();
  updateProgress();
  refreshScrub();
  renderQuick();
  window.scrollTo(0, 0);
  return fellBack;
}

function loadBook(books, activeId) {
  book = (books || []).find(b => b.id === activeId);
  if (!book || !book.text) { $empty.hidden = false; return; }
  book.highlights = book.highlights || [];
  book.bookmarks = book.bookmarks || [];
  $more.hidden = false;
  $speed.hidden = false;
  $('energy').hidden = false;
  renderEnergy();
  $more.onclick = onReadOn;
  $('qStar').onclick = toggleStar;
  $('qNote').onclick = noteHere;
  $('qFind').onclick = toggleFind;
  for (const id of ['qStar', 'qNote', 'qFind']) $(id).hidden = false;
  $prev.onclick = onEarlier;
  $speed.onclick = startRsvp;
  // ← / → page through the book, Space speed-reads (ignored while typing in search or a note).
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$rsvp.hidden) {
      const act = { ' ': () => (timer ? pause() : play()), Escape: exitRsvp,
        ArrowUp: () => setWpm(25), ArrowDown: () => setWpm(-25), ArrowLeft: rewind }[e.key];
      if (act) { e.preventDefault(); act(); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); startRsvp(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); onReadOn(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); onEarlier(); }
    if (e.key === '/') { e.preventDefault(); toggleFind(true); return; }
    const quick = { b: toggleStar, s: toggleStar, n: noteHere }[e.key.toLowerCase()];
    if (quick) { e.preventDefault(); quick(); }
  });
  const repaired = showPage(book.readPos || 0);
  readTo = base;                                // nothing before here earns words or energy
  document.title = $('etitle').textContent = bookTitle(book.name);
  if (repaired) persistBook();                  // rewrite a stale saved position
}

// Navigate to an arbitrary offset (scrubber / chapter / bookmark / search).
function jumpTo(offset) {
  showPage(offset);
  persistBook();
  closePanel();
  $('find').hidden = true;
}

// Search lives under the icon row: the icon (or "/") opens it, Esc / a result closes it.
function toggleFind(open = $('find').hidden) {
  $('find').hidden = !open;
  if (open) { $search.focus(); $search.select(); }
}
$search.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('find').hidden = true; $search.blur(); } });

// Next sentence (→ or the button). Each page REPLACES the last — nothing accumulates.
function onReadOn() {
  if ($more.disabled) return;
  const fresh = pos > readTo;      // false when re-reading lines you stepped back over
  if (fresh) {
    countWords(book.text.slice(Math.max(base, readTo), pos).split(/\s+/).filter(Boolean).length);
    flushStats();
  }
  showPage(nextSentenceStart(book.text, base));
  persistBook();
  if (fresh) { readTo = base; charge(); }
  $text.classList.remove('rise');
  void $text.offsetWidth;          // restart the animation
  $text.classList.add('rise');
}

// --- energy bar: per-session sentence goal, levels up when full ----------------
// ponytail: session = page load, nothing stored; persist only if people miss it.
let level = 0, charged = 0;
const goal = () => cfg.energyGoals[Math.min(level, cfg.energyGoals.length - 1)];
function charge() {
  countWords(0, 1);                // one more line finished today
  if (++charged >= goal()) {
    const $e = $('energy');
    $('elabel').textContent = 'Level up';
    $('enum').textContent = 100;
    $e.style.setProperty('--e', 1);
    $e.classList.remove('full'); void $e.offsetWidth; $e.classList.add('full');
    level++; charged = 0;
    setTimeout(renderEnergy, 900);  // let the full bar flash before it resets
    return;
  }
  renderEnergy();
}
function renderEnergy() {
  const $e = $('energy');
  $e.style.setProperty('--e', charged / goal());
  $('elabel').textContent = `Level ${level + 1}`;
  $('enum').textContent = Math.round(charged / goal() * 100);
}

// Step back one sentence (← key, or click the greyed line).
function onEarlier() {
  if (base <= (book.startOffset || 0)) return;
  showPage(prevSentenceStart(book.text, base));
  persistBook();
}

// The sentence just before this one, shown greyed above it.
function renderPrev() {
  const floor = book.startOffset || 0;
  $prev.hidden = base <= floor;
  if (!$prev.hidden) {
    $prev.firstChild.textContent = book.text.slice(Math.max(floor, prevSentenceStart(book.text, base)), base).trim();
  }
}

// Rebuild the shown range [base,pos) with its highlights. Cheap for the few pages
// read before Continue. ponytail: re-render whole range per chunk; go incremental only if slow.
function renderShown() {
  const frag = document.createDocumentFragment();
  for (const seg of buildSegments(base, pos, book.highlights)) {
    const t = textFrag(book.text.slice(seg.start, seg.end));
    if (!seg.variant) { frag.append(t); continue; }
    const mark = document.createElement('mark');
    mark.className = 'hl-' + seg.variant;
    // tag with its source highlight (last one covering the segment) so notes can attach
    const mid = (seg.start + seg.end) / 2;
    let hi = -1;
    book.highlights.forEach((h, idx) => { if (h.start <= mid && mid < h.end) hi = idx; });
    if (hi >= 0) {
      mark.dataset.hl = hi;
      if (book.highlights[hi].note) mark.title = book.highlights[hi].note;
    }
    mark.append(t);
    frag.append(mark);
  }
  $text.replaceChildren(frag);
}

// Plain text, or "bionic": first half of each word bold. <b> adds no characters, so
// absOffset() still maps selections to book offsets.
function textFrag(str) {
  if (!settings.bionic) return document.createTextNode(str);
  const f = document.createDocumentFragment();
  for (const part of str.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s/.test(part)) { f.append(part); continue; }
    const b = document.createElement('b');
    b.textContent = part.slice(0, Math.ceil(part.length / 2));
    f.append(b, part.slice(b.textContent.length));
  }
  return f;
}

// --- RSVP speed reading ----------------------------------------------------
// One word at a time at settings.wpm, focus letter pinned in the centre column.
const $rsvp = $('rsvp');
const $rword = $('rword');
const $rhint = $('rhint');
const $speed = $('speed');
const WORD = /\S+/g;
let rsvpAt = 0, timer = null, rampN = 0, sinceSave = 0;
// Furthest offset read this visit (both modes). Only text past it counts toward words/energy,
// so stepping back to re-read and then going forward again earns nothing twice.
let readTo = 0;

function startRsvp() {
  if (!book || !$rsvp.hidden) return;
  closePanel();
  rsvpAt = base;
  $rsvp.hidden = false;
  play();
}
function play() {
  rampN = 0;
  tick();
}
function tick() {
  WORD.lastIndex = rsvpAt;
  const m = WORD.exec(book.text);
  if (!m) { pause(); return; }                 // end of book
  rsvpAt = m.index;
  showWord(m[0]);
  const fresh = m.index >= readTo;
  if (fresh) countWords(1);
  if (++sinceSave >= 50) { sinceSave = 0; checkpoint(); }
  // A sentence further than any reached this run = one finished sentence; rewinds don't re-charge.
  // Entering a new sentence past the furthest point = the previous one was finished.
  if (fresh) {
    if (sentenceStartAt(book.text, m.index) > readTo) charge();
    readTo = m.index + m[0].length;
  }
  const delay = wordDelay(m[0], rampWpm(settings.wpm, rampN++));
  rsvpAt = m.index + m[0].length;
  updateProgress(rsvpAt);
  timer = setTimeout(tick, delay);
  renderHint();
}
function pause() {
  clearTimeout(timer);
  timer = null;
  checkpoint();
  renderHint();
}
function exitRsvp() {
  pause();
  $rsvp.hidden = true;
  showPage(rsvpAt);
}
// Back to the start of the sentence on screen (or the one before, if already at its start).
function rewind() {
  rsvpAt = sentenceStartAt(book.text, Math.max(0, rsvpAt - 1));
  if (!timer) {
    WORD.lastIndex = rsvpAt; const m = WORD.exec(book.text);
    if (m) showWord(m[0]);
  }
  rampN = 0;
}
function showWord(w) {
  const i = orpIndex(w);
  const [a, b, c] = $rword.children;
  a.textContent = w.slice(0, i); b.textContent = w[i]; c.textContent = w.slice(i + 1);
}
function setWpm(delta) {
  settings.wpm = clamp(settings.wpm + delta, 100, 1000);
  saveSettings();
  renderHint();
  $('wpmVal').textContent = settings.wpm + ' wpm';
}
function renderHint() {
  $rhint.textContent = `${settings.wpm} wpm · space ${timer ? 'pause' : 'play'} · ↑↓ speed · ← rewind · esc exit`;
}
// Save position (sentence containing the current word) + stats, so a closed tab loses nothing.
function checkpoint() {
  base = sentenceStartAt(book.text, Math.min(rsvpAt, book.text.length));
  persistBook();
  flushStats();
}

// --- daily stats -------------------------------------------------------------
let stats;
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
// Active reading time: the gap since the last word/line read, unless you walked away.
let lastAct = Date.now();
function countWords(n, lines = 0) {
  const now = Date.now(), gap = now - lastAct;
  lastAct = now;
  stats = bumpStats(stats, today(), n, lines, gap <= cfg.idleMs ? gap : 0);
  renderStats();
}

// "Today" panel: time, lines, speed, and a 7-day bar chart for consistency.
function renderToday() {
  const days = stats?.days || {};
  const t = days[today()] || { words: 0, lines: 0, ms: 0 };
  const min = Math.round(t.ms / 60000);
  $('tdHead').textContent = `${min} min · ${t.lines.toLocaleString()} lines · ${t.words.toLocaleString()} words`;
  $('tdSpeed').textContent = t.ms >= 60000 ? `≈ ${Math.round(t.words / (t.ms / 60000))} wpm reading speed` : '';
  const week = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    week.push({ key, d, min: (days[key]?.ms || 0) / 60000, lines: days[key]?.lines || 0 });
  }
  $('tdChart').innerHTML = chartSvg(week);
  const active = week.slice(-7).filter(w => w.lines || w.min).length;
  const streak = stats?.day === today() ? stats.streak : 0;
  $('tdCons').textContent = (streak > 1 ? `🔥 ${streak}-day streak · ` : '') + `read ${active} of last 7 days`;
}
// 14-day pill bars, minutes per day: y labels left, ticked axis, a date every week.
function chartSvg(week) {
  const W = 290, H = 170, L = 30, B = 150, T = 10, n = week.length;
  const top = Math.max(5, ...week.map(w => w.min));
  const step = [1, 2, 5, 10, 15, 20, 30, 60, 120].find(s => top / s <= 4) || 240;
  const max = step * Math.ceil(top / step);
  const y = (m) => B - 8 - (m / max) * (B - 8 - T);
  const x = (i) => L + 10 + i * ((W - L - 18) / (n - 1));
  let out = '';
  for (let m = 0; m <= max; m += step)
    out += `<text x="0" y="${y(m) + 3}">${m}m</text>`;
  out += `<path class="axis" d="M${L} ${B}H${W}"/>`;
  week.forEach((w, i) => {
    out += `<path class="axis" d="M${x(i)} ${B}v3"/>`;
    const cls = 'bar' + (i === n - 1 ? ' now' : '') + (w.min ? '' : ' zero');
    const tip = `${w.key}: ${Math.round(w.min)} min, ${w.lines} lines`;
    out += `<path class="${cls}" d="M${x(i)} ${y(0)}V${Math.min(y(0), y(w.min))}"><title>${tip}</title></path>`;
    if (i % 7 === 0 || i === n - 1) {
      const lbl = w.d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
      out += `<text x="${x(i)}" y="${H - 4}" text-anchor="middle">${lbl}</text>`;
    }
  });
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Minutes read, last 14 days">${out}</svg>`;
}
const flushStats = () => chrome.storage.local.set({ stats });
function renderStats() {
  const $s = $('stats');
  if (!stats || stats.day !== today()) { $s.textContent = ''; return; }
  $s.textContent = `${stats.words.toLocaleString()} words today` +
    (stats.streak > 1 ? ` · ${stats.streak}-day streak` : '');
}

function updateProgress(at = base) {
  $progress.style.setProperty('--p', offsetToPercent(book.text, at, book.startOffset || 0) + '%');
}

async function persistBook() {
  const { books } = await chrome.storage.local.get('books');
  const b = (books || []).find(x => x.id === book.id);
  if (b) {
    b.readPos = base;
    b.highlights = book.highlights;
    b.bookmarks = book.bookmarks || [];
    await chrome.storage.local.set({ books });
  }
}

// --- reader panel: settings, jump, contents, bookmarks ---------------------
function applySettings() {
  const r = document.documentElement;
  r.style.setProperty('--fs', settings.fontSize + 'px');
  r.style.setProperty('--lh', settings.lineHeight);
  r.style.setProperty('--w', settings.width + 'px');
  // Themes drive the colour vars inline; "system" clears them so the CSS default
  // (with its prefers-color-scheme dark variant) shows through.
  const pal = settings.theme === 'custom' ? [settings.customBg, settings.customFg]
    : cfg.themes[settings.theme] || [];
  ['--bg', '--fg', '--accent'].forEach((v, i) =>
    pal[i] ? r.style.setProperty(v, pal[i]) : r.style.removeProperty(v));
  if (settings.font && settings.font !== 'serif') r.dataset.font = settings.font; else delete r.dataset.font;
  document.querySelectorAll('#themes button').forEach(b =>
    b.classList.toggle('on', (settings.theme || 'system') === b.dataset.theme));
  document.querySelectorAll('#fonts button').forEach(b =>
    b.classList.toggle('on', (settings.font || 'serif') === b.dataset.font));
  if ($('customBg')) $('customBg').value = settings.customBg;
  if ($('customFg')) $('customFg').value = settings.customFg;
  $('bionic').classList.toggle('on', !!settings.bionic);
  $('wpmVal').textContent = settings.wpm + ' wpm';
}
const saveSettings = () => chrome.storage.local.set({ settings });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function wirePanel() {
  // Click anywhere outside the open panel (and its menu button) closes it.
  document.addEventListener('pointerdown', (e) => {
    if ($panel.classList.contains('open') && !e.target.closest('#panel, #menu')) closePanel();
  });
  // Accordion: one section open at a time, so the panel never becomes a long scroll.
  const sections = [...$panel.querySelectorAll('section')];
  sections.forEach((sec, i) => {
    const h = sec.querySelector('h4');
    if (!h) return;
    if (i === 0) sec.classList.add('open');           // "Jump to" starts open
    h.onclick = () => {
      const wasOpen = sec.classList.contains('open');
      sections.forEach(s => s.classList.remove('open'));
      if (!wasOpen) sec.classList.add('open');
    };
  });
  $('menu').onclick = () => { $panel.classList.toggle('open'); renderToday(); if (book) refreshScrub(); };
  $('pclose').onclick = closePanel;
  const bump = (key, delta, lo, hi, round = (x) => x) => () => {
    settings[key] = round(clamp(settings[key] + delta, lo, hi));
    applySettings(); saveSettings();
  };
  $('fsUp').onclick = bump('fontSize', 1, 13, 30);
  $('fsDown').onclick = bump('fontSize', -1, 13, 30);
  const r1 = (x) => Math.round(x * 10) / 10;
  $('lhUp').onclick = bump('lineHeight', 0.1, 1.2, 2.4, r1);
  $('lhDown').onclick = bump('lineHeight', -0.1, 1.2, 2.4, r1);
  $('wUp').onclick = bump('width', 40, 420, 900);
  $('wDown').onclick = bump('width', -40, 420, 900);
  // Custom colors live-apply as the "custom" theme
  for (const id of ['customBg', 'customFg']) {
    const el = $(id);
    el.oninput = () => { settings[id] = el.value; settings.theme = 'custom'; applySettings(); saveSettings(); };
  }
  $search.oninput = () => renderSearch($search.value);
  // One button per theme, painted in its own colours so it doubles as a preview.
  for (const name of ['system', ...Object.keys(cfg.themes), 'custom']) {
    const b = document.createElement('button');
    b.dataset.theme = name;
    b.textContent = name;
    const [bg, fg] = cfg.themes[name] || [];
    if (bg) { b.style.background = bg; b.style.color = fg; b.style.borderColor = fg; }
    b.onclick = () => { settings.theme = name; applySettings(); saveSettings(); };
    $('themes').append(b);
  }
  document.querySelectorAll('#fonts button').forEach(b => {
    b.onclick = () => {
      settings.font = b.dataset.font; applySettings(); saveSettings();
    };
  });
  $('bionic').onclick = () => {
    settings.bionic = !settings.bionic; applySettings(); saveSettings();
    if (book) renderShown();
  };
  $('wpmUp').onclick = () => setWpm(25);
  $('wpmDown').onclick = () => setWpm(-25);
  $('rsvpStart').onclick = startRsvp;
  $('export').onclick = exportHighlights;
  $scrub.oninput = () => { $scrubpct.textContent = $scrub.value + '%'; };
  $scrub.onchange = () => book && jumpTo(percentToOffset(book.text, +$scrub.value, book.startOffset || 0));
}

function exportHighlights() {
  if (!book) return;
  const blob = new Blob([highlightsMarkdown(book)], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = book.name.replace(/\.[^.]+$/, '') + ' — highlights.md';
  a.click();
  URL.revokeObjectURL(a.href);
}
function closePanel() { $panel.classList.remove('open'); }

function refreshScrub() {
  const p = Math.round(offsetToPercent(book.text, base, book.startOffset || 0));
  $scrub.value = p;
  $scrubpct.textContent = p + '%';
}

function renderChapters() {
  const chs = book.chapters || [];
  $('tocSec').hidden = chs.length === 0;
  $chapters.replaceChildren();
  for (const ch of chs) {
    const btn = document.createElement('button');
    btn.textContent = ch.title || '(chapter)';
    btn.title = btn.textContent;
    btn.onclick = () => jumpTo(ch.offset);
    $chapters.append(btn);
  }
}

function addBookmark() {
  const at = base; // the sentence on screen
  book.bookmarks = book.bookmarks || [];
  if (!book.bookmarks.some(b => b.pos === at)) {
    book.bookmarks.push({ pos: at, label: bookmarkLabel(book.text, at), ts: Date.now() });
    book.bookmarks.sort((a, b) => a.pos - b.pos);
    persistBook();
  }
  renderBookmarks();
}

function renderBookmarks() {
  $bmarks.replaceChildren();
  if (!book.bookmarks?.length) {
    const hint = document.createElement('div');
    hint.className = 'lbl';
    hint.textContent = 'Tap the bookmark icon under a line (or press B) to save it here.';
    $bmarks.append(hint);
  }
  for (const bm of book.bookmarks || []) {
    const row = document.createElement('div');
    row.className = 'bm';
    const label = document.createElement('span');
    label.textContent = bm.label;
    label.title = bm.label;
    label.onclick = () => jumpTo(bm.pos);
    const del = document.createElement('button');
    del.textContent = '✕';
    del.title = 'Remove';
    del.onclick = () => { book.bookmarks = book.bookmarks.filter(b => b !== bm); persistBook(); renderBookmarks(); };
    row.append(label, del);
    $bmarks.append(row);
  }
}

// --- search in book --------------------------------------------------
function renderSearch(query) {
  $searchResults.replaceChildren();
  if (!book || query.trim().length < 2) return;
  const hits = searchBook(book.text, query, 20);
  if (!hits.length) {
    const none = document.createElement('div');
    none.className = 'lbl';
    none.textContent = 'No matches.';
    $searchResults.append(none);
    return;
  }
  for (const hit of hits) {
    const b = document.createElement('button');
    b.className = 'hit';
    b.textContent = hit.snippet;
    b.title = hit.snippet;
    b.onclick = () => jumpTo(hit.offset);
    $searchResults.append(b);
  }
}

// --- quick actions on the sentence on screen: star (S), highlight (H), note (N) ----
const sentEnd = () => base + book.text.slice(base, pos).trimEnd().length;
const starred = () => (book.bookmarks || []).some(b => b.pos === base);
const sentHl = () => book.highlights.findIndex(h => h.start <= base && h.end >= sentEnd());
function renderQuick() {
  $('qStar').classList.toggle('on', starred());
}
function toggleStar() {
  if (starred()) {
    book.bookmarks = book.bookmarks.filter(b => b.pos !== base);
    persistBook(); renderBookmarks();
  } else addBookmark();
  renderQuick();
}
function noteHere() {
  let idx = sentHl();
  if (idx < 0) {
    book.highlights.push({ start: base, end: sentEnd(), variant: 'note' });
    idx = book.highlights.length - 1;
    renderShown();
  }
  openNoteEditor(idx, $text.querySelector(`mark[data-hl="${idx}"]`) || $text);
}

// --- notes on highlights ---------------------------------------------
let noteIdx = null;

$text.addEventListener('click', (e) => {
  const m = e.target.closest?.('mark[data-hl][title]');
  if (!m) return;
  openNoteEditor(+m.dataset.hl, m);
});

function openNoteEditor(idx, el) {
  noteIdx = idx;
  $noteText.value = book.highlights[idx]?.note || '';
  const box = el.getBoundingClientRect();
  $noteEditor.style.display = 'block';
  $noteEditor.style.left = Math.min(window.scrollX + box.left, window.innerWidth - 260) + 'px';
  $noteEditor.style.top = (window.scrollY + box.bottom + 6) + 'px';
  $noteText.focus();
}

function closeNote() { $noteEditor.style.display = 'none'; noteIdx = null; }

$('noteSave').onclick = () => {
  if (noteIdx === null) return;
  const v = $noteText.value.trim();
  if (v) book.highlights[noteIdx].note = v; else book.highlights.splice(noteIdx, 1);
  persistBook(); renderShown(); closeNote();
};
$('noteDel').onclick = () => {
  if (noteIdx === null) return;
  book.highlights.splice(noteIdx, 1);
  persistBook(); renderShown(); closeNote();
};
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || noteIdx === null) return;
  if (!book.highlights[noteIdx]?.note) { book.highlights.splice(noteIdx, 1); renderShown(); } // cancelled a new note
  closeNote();
});
$noteText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('noteSave').click(); }
});
