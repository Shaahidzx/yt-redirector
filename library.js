import * as pdfjs from './pdfjs/pdf.min.mjs';
import { extractEpub } from './epub.js';
import { detectStart } from './logic.js';
pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');

const $status = document.getElementById('status');
const $list = document.getElementById('list');
const $file = document.getElementById('file');
const $drop = document.getElementById('drop');

document.getElementById('getpro').href = self.CONFIG.proUrl;
document.getElementById('getpro2').href = self.CONFIG.proUrl;
$file.onchange = () => $file.files[0] && importFile($file.files[0]);

// --- Pro license (Gumroad) -------------------------------------------------
const $license = document.getElementById('license');
const $activate = document.getElementById('activate');
const $deactivate = document.getElementById('deactivate');
const $proStatus = document.getElementById('proStatus');

async function isPro() { return (await chrome.storage.local.get('pro')).pro === true; }

async function refreshProUI() {
  if (await isPro()) {
    $proStatus.textContent = '✓ Pro active';
    $proStatus.className = 'ok';
    $license.hidden = true; $activate.hidden = true; $deactivate.hidden = false;
  } else {
    $proStatus.className = ''; $deactivate.hidden = true;
  }
}

$activate.onclick = async () => {
  const key = $license.value.trim();
  if (!key) return;
  $proStatus.textContent = 'Checking…'; $proStatus.className = '';
  try {
    const res = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ product_id: self.CONFIG.gumroadProductId, license_key: key }),
    });
    const data = await res.json();
    const p = data.purchase || {};
    if (data.success && !p.refunded && !p.chargebacked && !p.disputed) {
      await chrome.storage.local.set({ pro: true, license: key });
      refreshProUI();
    } else {
      $proStatus.textContent = data.message || 'Invalid or refunded license.';
      $proStatus.className = 'err';
    }
  } catch (e) {
    $proStatus.textContent = 'Could not reach Gumroad. Check your connection.';
    $proStatus.className = 'err';
  }
};

$deactivate.onclick = async () => {
  await chrome.storage.local.set({ pro: false, license: '' });
  $proStatus.textContent = ''; $license.hidden = false; $activate.hidden = false;
  refreshProUI();
};

refreshProUI();
$drop.ondragover = (e) => { e.preventDefault(); };
$drop.ondrop = (e) => { e.preventDefault(); e.dataTransfer.files[0] && importFile(e.dataTransfer.files[0]); };

render();

async function importFile(file) {
  const { books = [] } = await chrome.storage.local.get('books');
  if (!(await isPro()) && books.length >= self.CONFIG.maxBooks) {
    $status.textContent = `Free limit is ${self.CONFIG.maxBooks} books — delete one, or Get Pro for unlimited.`;
    return;
  }
  $status.textContent = `Reading "${file.name}"…`;
  try {
    const name = file.name.toLowerCase();
    let text, chapters = [];
    if (name.endsWith('.pdf')) text = await extractPdf(await file.arrayBuffer());
    else if (name.endsWith('.epub')) ({ text, chapters } = await extractEpub(await file.arrayBuffer()));
    else text = await file.text();
    if (!text.trim()) throw new Error('no extractable text (scanned PDF?)');
    const start = detectStart(text, self.CONFIG.startMinChars); // auto-skip front-matter
    const id = Date.now().toString(36);
    books.push({ id, name: file.name, text, startOffset: start, readPos: start, chapters, bookmarks: [] });
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
  return pages.join('\n\n');
}

async function render() {
  const { books = [], activeId } = await chrome.storage.local.get(['books', 'activeId']);
  $list.innerHTML = '';
  for (const b of books) {
    const el = document.createElement('div');
    el.className = 'book' + (b.id === activeId ? ' active' : '');
    const read = b.text.length ? Math.floor(((b.readPos - b.startOffset) / (b.text.length - b.startOffset)) * 100) : 0;
    el.innerHTML = `
      <h3>${escape(b.name)}</h3>
      <small>${b.id === activeId ? '● active · ' : ''}${Math.max(0, read)}% read</small>
      <div style="margin-top:10px">
        <button data-act="active">${b.id === activeId ? 'Active' : 'Make active'}</button>
        <button data-act="delete">Delete</button>
      </div>`;
    wire(el, b);
    $list.append(el);
  }
}

function wire(el, b) {
  el.querySelector('[data-act=active]').onclick = () => update(s => (s.activeId = b.id));
  el.querySelector('[data-act=delete]').onclick = () =>
    update(s => (s.books = s.books.filter(x => x.id !== b.id), s.activeId === b.id && (s.activeId = s.books[0]?.id)));
}

async function update(mutate) {
  const state = await chrome.storage.local.get(['books', 'activeId']);
  state.books = state.books || [];
  mutate(state);
  await chrome.storage.local.set(state);
  render();
}

function escape(s) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
