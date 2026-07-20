import { delaySeconds, sentenceEnd, paragraphEnd, prevParagraphStart, paragraphStartAt,
  percentToOffset, offsetToPercent, bookmarkLabel, highlightsMarkdown, buildSegments, updateStreak, dayKey } from './logic.js';

const cfg = self.CONFIG;
const $ = (id) => document.getElementById(id);
const $text = $('text');
const $more = $('more');
const $earlier = $('earlier');
const $empty = $('empty');
const $go = $('go');
const $progress = $('progress');
const $books = $('books');
const $streak = $('streak');
const $totop = $('totop');
const $hltools = $('hltools');
const $panel = $('panel');
const $scrub = $('scrub');
const $scrubpct = $('scrubpct');
const $chapters = $('chapters');
const $bmarks = $('bmarks');
const onDemand = new URLSearchParams(location.search).has('ondemand');

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
  const { installDate, books, activeId, streak, settings: saved, pro: isProSaved } = await chrome.storage.local.get(
    ['installDate', 'books', 'activeId', 'streak', 'settings', 'pro']
  );
  pro = isProSaved === true;
  settings = { ...cfg.readerDefaults, ...(saved || {}) };
  applySettings();               // set fonts/theme before first paint
  wirePanel();
  if (onDemand) document.querySelector('footer').hidden = true; // pure reading, no YouTube gate
  else startCountdown(installDate);
  showStreak(streak);
  buildSwitcher(books, activeId);
  buildHlTools();
  loadBook(books, activeId);
  if (book) { renderChapters(); renderBookmarks(); refreshScrub(); }
}

// Hover bar: switch between the (≤3) loaded books without leaving the page.
function buildSwitcher(books, activeId) {
  for (const b of books || []) {
    const btn = document.createElement('button');
    btn.textContent = b.name.replace(/\.(pdf|epub|txt)$/i, '');
    if (b.id === activeId) btn.className = 'on';
    btn.onclick = async () => {
      if (b.id === activeId) return;
      await chrome.storage.local.set({ activeId: b.id });
      location.reload();
    };
    $books.append(btn);
  }
}

function showStreak(streak) {
  const s = streak || { current: 0, best: 0 };
  $streak.textContent = `🔥 ${s.current || 0} · best ${s.best || 0}`;
}

// --- growing delay ---------------------------------------------------------
function startCountdown(installDate) {
  let remaining = delaySeconds(cfg, installDate);
  const tick = () => {
    if (remaining <= 0.001) {
      $go.disabled = false;
      $go.classList.add('ready');
      $go.textContent = 'Continue to YouTube';
      return;
    }
    $go.textContent = `Continue to YouTube (${remaining.toFixed(1)}s)`;
    remaining = Math.round((remaining - 0.1) * 10) / 10;
    setTimeout(tick, 100);
  };
  tick();
}

$go.onclick = async () => {
  if ($go.disabled) return;
  $go.disabled = true;
  await chrome.runtime.sendMessage({ type: 'continue' });
  location.href = 'https://www.youtube.com/';
};

// --- flowing reader --------------------------------------------------------
// PAGER: base..pos bound ONE page (they move together — no accumulation). `readPos`
// persists the current page start (`base`). `baited` = showing just the opening sentence.
let book, base, pos, baited, settings, pro = false, streakMarked = false;

// Show a single page starting at `start`. Snaps to the paragraph; clamps into range and, if
// at/after the end, backs up to the last paragraph. bait=true shows just the first sentence.
// Returns true if the end-fallback fired (a stale position needing repair).
function showPage(start, bait) {
  const floor = book.startOffset || 0;
  base = Math.max(floor, Math.min(paragraphStartAt(book.text, start), book.text.length));
  let fellBack = false;
  if (base >= book.text.length || sentenceEnd(book.text, base) <= base) {
    base = Math.max(floor, prevParagraphStart(book.text, book.text.length));
    fellBack = true;
  }
  baited = bait;
  pos = bait ? sentenceEnd(book.text, base) : paragraphEnd(book.text, base);
  $more.disabled = false;
  $more.textContent = 'Read on ↓';
  renderShown();
  updateEarlier();
  updateProgress();
  refreshScrub();
  window.scrollTo(0, 0);
  return fellBack;
}

function loadBook(books, activeId) {
  book = (books || []).find(b => b.id === activeId);
  if (!book || !book.text) { $empty.hidden = false; return; }
  book.highlights = book.highlights || [];
  book.bookmarks = book.bookmarks || [];
  $more.hidden = false;
  $more.onclick = onReadOn;
  $earlier.onclick = onEarlier;
  const repaired = showPage(book.readPos || 0, true); // open with one sentence
  if (repaired) persistBook();                        // rewrite a stale saved position
}

// Navigate to an arbitrary offset (scrubber / chapter / bookmark) → show that paragraph.
function jumpTo(offset) {
  showPage(offset, false);
  persistBook();
  closePanel();
}

// "Read on": expand the bait sentence to its full paragraph, then page forward one paragraph
// at a time. Each page REPLACES the last — nothing accumulates, nothing to scroll.
function onReadOn() {
  markReadOnce();
  if (baited) { showPage(base, false); persistBook(); return; } // sentence → full paragraph
  const next = paragraphEnd(book.text, base);
  if (next >= book.text.length) { $more.textContent = '— end of book —'; $more.disabled = true; return; }
  showPage(next, false);
  persistBook();
}

// "Read earlier": show the previous paragraph (replaces the page).
function onEarlier() {
  if (base <= (book.startOffset || 0)) return;
  showPage(prevParagraphStart(book.text, base), false);
  persistBook();
}

function updateEarlier() {
  $earlier.hidden = base <= (book.startOffset || 0);
}

// Rebuild the shown range [base,pos) with its highlights. Cheap for the few pages
// read before Continue. ponytail: re-render whole range per chunk; go incremental only if slow.
function renderShown() {
  const frag = document.createDocumentFragment();
  for (const seg of buildSegments(base, pos, book.highlights)) {
    const t = document.createTextNode(book.text.slice(seg.start, seg.end));
    if (!seg.variant) { frag.append(t); continue; }
    const mark = document.createElement('mark');
    mark.className = 'hl-' + seg.variant;
    mark.append(t);
    frag.append(mark);
  }
  $text.replaceChildren(frag);
}

function updateProgress() {
  const span = book.text.length - (book.startOffset || 0);
  const pct = span > 0 ? ((base - (book.startOffset || 0)) / span) * 100 : 0;
  $progress.style.width = Math.min(100, Math.max(0, pct)) + '%';
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

async function markReadOnce() {
  if (streakMarked) return;
  streakMarked = true;
  const { streak } = await chrome.storage.local.get('streak');
  const next = updateStreak(streak || {}, dayKey());
  await chrome.storage.local.set({ streak: next });
  showStreak(next);
}

// --- highlighting ----------------------------------------------------------
let pendingRange = null;

function buildHlTools() {
  for (const v of cfg.highlightVariants) {
    const sw = document.createElement('button');
    sw.className = 'sw ' + (v === 'underline' ? 'hl-underline' : '');
    sw.title = v;
    if (v === 'underline') sw.textContent = 'U';
    else sw.style.background = swatchColor(v);
    sw.onclick = () => applyHighlight(v);
    $hltools.append(sw);
  }
  const erase = document.createElement('button');
  erase.className = 'erase';
  erase.textContent = 'erase';
  erase.onclick = eraseHighlight;
  $hltools.append(erase);
}
function swatchColor(v) {
  return { yellow: 'rgba(255,214,0,.7)', green: 'rgba(60,205,130,.7)',
    pink: 'rgba(255,105,155,.7)', blue: 'rgba(90,160,255,.7)' }[v] || '#888';
}

// Absolute offset in book.text for a selection point inside #text. Measuring the text
// length from #text's start handles both text-node and element containers (e.g. a point
// on a <mark> boundary). Marks add no characters, so this matches book.text offsets.
function absOffset(node, offset) {
  const r = document.createRange();
  r.setStart($text, 0);
  r.setEnd(node, offset);
  return base + r.toString().length;
}

document.addEventListener('mouseup', (e) => {
  if ($hltools.contains(e.target)) return; // clicking the toolbar isn't a new selection
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { hideTools(); return; }
  const r = sel.getRangeAt(0);
  if (!$text.contains(r.commonAncestorContainer)) { hideTools(); return; }
  let a = absOffset(r.startContainer, r.startOffset);
  let b = absOffset(r.endContainer, r.endOffset);
  if (a === b) { hideTools(); return; }
  pendingRange = { start: Math.min(a, b), end: Math.max(a, b) };
  const box = r.getBoundingClientRect();
  $hltools.style.display = 'flex';
  $hltools.style.left = (window.scrollX + box.left) + 'px';
  $hltools.style.top = (window.scrollY + box.top - $hltools.offsetHeight - 6) + 'px';
});

function hideTools() { $hltools.style.display = 'none'; pendingRange = null; }

function applyHighlight(variant) {
  if (!pendingRange) return;
  book.highlights.push({ ...pendingRange, variant });
  finishHighlightEdit();
}
function eraseHighlight() {
  if (!pendingRange) return;
  book.highlights = book.highlights.filter(h => h.end <= pendingRange.start || h.start >= pendingRange.end);
  finishHighlightEdit();
}
function finishHighlightEdit() {
  window.getSelection().removeAllRanges();
  hideTools();
  renderShown();
  persistBook();
}

// --- reader panel: settings, jump, contents, bookmarks ---------------------
function applySettings() {
  const r = document.documentElement;
  r.style.setProperty('--fs', settings.fontSize + 'px');
  r.style.setProperty('--lh', settings.lineHeight);
  r.style.setProperty('--w', settings.width + 'px');
  if (settings.theme && settings.theme !== 'system') r.dataset.theme = settings.theme;
  else delete r.dataset.theme;
  if (settings.font === 'sans') r.dataset.font = 'sans'; else delete r.dataset.font;
  document.querySelectorAll('#themes button').forEach(b =>
    b.classList.toggle('on', (settings.theme || 'system') === b.dataset.theme));
  document.querySelectorAll('#fonts button').forEach(b =>
    b.classList.toggle('on', (settings.font || 'serif') === b.dataset.font));
}
const saveSettings = () => chrome.storage.local.set({ settings });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Pro gate: unlock if paid, else send them to Gumroad.
function requirePro() { if (pro) return true; window.open(cfg.proUrl, '_blank'); return false; }

function wirePanel() {
  $('menu').onclick = () => { $panel.classList.toggle('open'); if (book) refreshScrub(); };
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
  document.querySelectorAll('#themes button').forEach(b => {
    b.onclick = () => {
      if (b.hasAttribute('data-pro') && !requirePro()) return;
      settings.theme = b.dataset.theme; applySettings(); saveSettings();
    };
  });
  document.querySelectorAll('#fonts button').forEach(b => {
    b.onclick = () => {
      if (b.hasAttribute('data-pro') && !requirePro()) return;
      settings.font = b.dataset.font; applySettings(); saveSettings();
    };
  });
  $('export').onclick = exportHighlights;
  $scrub.oninput = () => { $scrubpct.textContent = $scrub.value + '%'; };
  $scrub.onchange = () => book && jumpTo(percentToOffset(book.text, +$scrub.value, book.startOffset || 0));
  $('bmAdd').onclick = addBookmark;
  if (pro) {
    const g = $('getproR');
    g.textContent = '✓ Pro active';
    g.removeAttribute('href');
    g.style.cssText = 'background:transparent;color:inherit;opacity:.7;padding:0';
    // drop the ★ "locked" markers now that everything's unlocked
    document.querySelectorAll('#panel [data-pro]').forEach(b => { b.textContent = b.textContent.replace(/\s*★/, ''); });
  } else {
    $('getproR').href = cfg.proUrl;
  }
}

function exportHighlights() {
  if (!requirePro()) return;
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

// The offset of the paragraph at the top of the viewport — "the spot I'm looking at".
function currentTopOffset() {
  const rect = $text.getBoundingClientRect();
  const x = rect.left + Math.min(20, rect.width / 2);
  const r = document.caretRangeFromPoint?.(x, 8);
  if (r && $text.contains(r.startContainer)) {
    return paragraphStartAt(book.text, absOffset(r.startContainer, r.startOffset));
  }
  return base;
}

function addBookmark() {
  const at = currentTopOffset();
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
