import { CONFIG } from './config.js';
import * as pdfjs from './pdfjs/pdf.min.mjs';
import { extractEpub } from './epub.js';
import { detectStart, normalizeDomain, bookTitle } from './logic.js';
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');

const $status = document.getElementById('status');
const $shelf = document.getElementById('shelf');
const $file = document.getElementById('file');
const $drop = document.getElementById('drop');

$file.onchange = () => $file.files[0] && importFile($file.files[0]);
$drop.ondragover = (e) => { e.preventDefault(); };
$drop.ondrop = (e) => { e.preventDefault(); e.dataTransfer.files[0] && importFile(e.dataTransfer.files[0]); };

render();

async function importFile(file) {
  const { books = [] } = await chrome.storage.local.get('books');
  $status.textContent = `Reading "${file.name}"…`;
  try {
    const name = file.name.toLowerCase();
    let text, chapters = [], cover = null;
    if (name.endsWith('.pdf')) {
      ({ text, cover } = await extractPdf(await file.arrayBuffer()));
    } else if (name.endsWith('.epub')) {
      const r = await extractEpub(await file.arrayBuffer());
      text = r.text; chapters = r.chapters;
      if (r.cover) cover = await coverFromBlob(r.cover);
    } else {
      text = await file.text();
    }
    if (!text.trim()) throw new Error('no extractable text (scanned PDF?)');
    const start = detectStart(text, CONFIG.startMinChars); // auto-skip front-matter
    const id = Date.now().toString(36);
    books.push({ id, name: file.name, text, startOffset: start, readPos: start, chapters, bookmarks: [], cover });
    await chrome.storage.local.set({ books, activeId: id });
    $status.textContent = `Added "${file.name}" — starts reading at char ${start.toLocaleString()}.`;
    render();
  } catch (err) {
    $status.textContent = `Could not read "${file.name}": ${err.message}`;
  }
}

async function extractPdf(buf) {
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map(it => it.str).join(' '));
  }
  let cover = null;
  try { cover = await pdfCover(pdf); } catch { /* cover is optional */ }
  return { text: pages.join('\n\n'), cover };
}

// --- cover art -------------------------------------------------------------
const COVER_W = 320; // downscaled so a shelf of books stays small in storage

async function pdfCover(pdf) {
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: Math.min(1, COVER_W / base.width) });
  const c = document.createElement('canvas');
  c.width = Math.round(viewport.width); c.height = Math.round(viewport.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
  return c.toDataURL('image/jpeg', 0.8);
}

async function coverFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
    });
    const scale = Math.min(1, COVER_W / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return null; } finally { URL.revokeObjectURL(url); }
}

async function render() {
  const { books = [], activeId } = await chrome.storage.local.get(['books', 'activeId']);
  renderShelf($shelf, books, activeId);
}

// Uniform cover grid. Clicking a cover makes that book active.
function renderShelf(root, books, activeId) {
  root.replaceChildren();
  for (const b of books) {
    const pct = b.text.length > b.startOffset
      ? Math.max(0, Math.floor(((b.readPos - b.startOffset) / (b.text.length - b.startOffset)) * 100)) : 0;
    const card = document.createElement('div');
    card.className = 'card' + (b.id === activeId ? ' active' : '');

    const art = document.createElement('div');
    art.className = 'art';
    art.title = b.name;
    if (b.cover) {
      const img = document.createElement('img');
      img.src = b.cover; img.alt = b.name; img.loading = 'lazy';
      art.append(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph';
      ph.textContent = bookTitle(b.name);
      art.append(ph);
    }
    art.onclick = () => update(s => (s.activeId = b.id));

    const h = document.createElement('h3');
    h.textContent = bookTitle(b.name);
    const meta = document.createElement('small');
    meta.textContent = (b.id === activeId ? '● active · ' : '') + pct + '% read';

    const acts = document.createElement('div');
    acts.className = 'acts';
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => update(s => (s.books = s.books.filter(x => x.id !== b.id),
      s.activeId === b.id && (s.activeId = s.books[0]?.id)));
    acts.append(del);

    card.append(art, h, meta, acts);
    root.append(card);
  }
}

async function update(mutate) {
  const state = await chrome.storage.local.get(['books', 'activeId']);
  state.books = state.books || [];
  mutate(state);
  await chrome.storage.local.set(state);
  render();
}

// --- tabs ------------------------------------------------------------------
document.querySelectorAll('#tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b === btn));
    document.querySelectorAll('section[data-panel]').forEach(s => {
      s.hidden = s.dataset.panel !== btn.dataset.tab;
    });
    if (btn.dataset.tab === "focus") renderSites();
  };
});

// --- Focus: block any site -------------------------------------------
const $siteInput = document.getElementById('siteInput');
const $siteStatus = document.getElementById('siteStatus');
const $siteList = document.getElementById('siteList');

async function renderSites() {
  const { blocked = [] } = await chrome.storage.local.get('blocked');
  $siteList.replaceChildren();
  // YouTube is always on, and can't be removed — it's the point of the extension.
  for (const [d, fixed] of [['youtube.com', true], ...blocked.map(d => [d, false])]) {
    const row = document.createElement('div');
    row.className = 'site';
    const name = document.createElement('span');
    name.textContent = d + (fixed ? '  (always)' : '');
    row.append(name);
    if (!fixed) {
      const rm = document.createElement('button');
      rm.textContent = 'Remove';
      rm.onclick = async () => {
        const { blocked = [] } = await chrome.storage.local.get('blocked');
        await chrome.storage.local.set({ blocked: blocked.filter(x => x !== d) });
        renderSites();
      };
      row.append(rm);
    }
    $siteList.append(row);
  }
}

document.getElementById('siteAdd').onclick = async () => {
  const domain = normalizeDomain($siteInput.value);
  if (!domain) { $siteStatus.textContent = 'Enter a domain like instagram.com'; return; }
  // Redirecting arbitrary sites needs host access; ask for it on this click (a user gesture).
  const granted = await chrome.permissions.request({ origins: ['*://*/*'] }).catch(() => false);
  if (!granted) { $siteStatus.textContent = 'Permission needed to block other sites.'; return; }
  const { blocked = [] } = await chrome.storage.local.get('blocked');
  if (!blocked.includes(domain) && domain !== 'youtube.com') {
    await chrome.storage.local.set({ blocked: [...blocked, domain] });
  }
  $siteInput.value = '';
  $siteStatus.textContent = `Blocking ${domain}.`;
  renderSites();
};

// --- Data: backup & restore (free — never lock users out of their own data) --
const $dataStatus = document.getElementById('dataStatus');

document.getElementById('exportAll').onclick = async () => {
  const all = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(all)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `pageturn-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  $dataStatus.textContent = `Exported ${(all.books || []).length} book(s).`;
};

const $importFile = document.getElementById('importFile');
document.getElementById('importBtn').onclick = () => $importFile.click();
$importFile.onchange = async () => {
  const file = $importFile.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data || typeof data !== 'object' || !Array.isArray(data.books)) {
      throw new Error('not a Pageturn backup');
    }
    if (!confirm(`Restore ${data.books.length} book(s)? This replaces everything currently stored.`)) return;
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
    $dataStatus.textContent = 'Restored. Reloading…';
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    $dataStatus.textContent = `Could not restore: ${e.message}`;
  } finally {
    $importFile.value = '';
  }
};
