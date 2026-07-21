// EPUB -> plain text, in-browser, no dependencies.
// An epub is a ZIP of XHTML. We parse the ZIP central directory ourselves and
// inflate entries with the native DecompressionStream, then walk the OPF spine
// so text comes out in real reading order.
// ponytail: handles the common case (deflate/stored, no zip64, no encryption).
// A zip64 or DRM'd epub will throw a clear error — add handling if one shows up.

export async function extractEpub(buf) {
  const files = unzip(buf);
  const textOf = async (path) => new TextDecoder().decode(await inflate(files[path]));

  const container = await textOf('META-INF/container.xml');
  const opfPath = xml(container).getElementsByTagNameNS('*', 'rootfile')[0].getAttribute('full-path');
  const opfDir = opfPath.includes('/') ? opfPath.replace(/[^/]*$/, '') : '';

  const opf = xml(await textOf(opfPath));
  const hrefById = {};
  for (const it of opf.getElementsByTagNameNS('*', 'item')) {
    hrefById[it.getAttribute('id')] = it.getAttribute('href');
  }

  const parts = [];
  const chapters = [];  // { offset, title } — one per substantial spine doc, for the TOC
  let offset = 0;
  for (const ref of opf.getElementsByTagNameNS('*', 'itemref')) {
    const href = hrefById[ref.getAttribute('idref')];
    if (!href) continue;
    const path = normalize(opfDir + decodeURIComponent(href.split('#')[0]));
    if (!files[path]) continue;
    const doc = new DOMParser().parseFromString(await textOf(path), 'text/html');
    const heading = doc.body?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent?.trim();
    // textContent glues blocks together; give each block/break a newline first.
    doc.body?.querySelectorAll('p,div,br,li,h1,h2,h3,h4,h5,h6,tr,blockquote')
      .forEach(e => e.append('\n'));
    const t = (doc.body?.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!t) continue;
    // Only list a real chapter heading. Without one we'd otherwise fall back to the first
    // line of prose, which fills the contents with junk like "Copyright © 2017 by…".
    const title = chapterTitle(heading, t);
    if (title) chapters.push({ offset, title });
    parts.push(t);
    offset += t.length + 2; // account for the '\n\n' joiner between parts
  }
  if (!parts.length) throw new Error('no readable text in epub');

  // Cover art: EPUB3 marks it with properties="cover-image"; EPUB2 uses <meta name="cover">.
  let cover = null;
  const ref = findCover(opf);
  if (ref) {
    const p = normalize(opfDir + decodeURIComponent(ref.href.split('#')[0]));
    if (files[p]) cover = new Blob([await inflate(files[p])], { type: ref.type || 'image/jpeg' });
  }
  return { text: parts.join('\n\n'), chapters, cover };
}

// A contents entry is worth showing only if it's an actual heading (or a short title-like
// first line) and isn't front-matter/back-matter boilerplate.
const NOT_A_CHAPTER = /copyright|all rights reserved|\bisbn\b|acknowledg|about the author|^index$|^notes?$|^contents$|dedication|title page|also by|praise for|thank you for buying|newsletter|colophon|permissions/i;
function chapterTitle(heading, text) {
  let t = (heading || '').replace(/\s+/g, ' ').trim();
  if (!t) {
    // No heading: accept only a short, title-ish opening line.
    const first = text.split('\n', 1)[0].replace(/\s+/g, ' ').trim();
    if (first.length > 0 && first.length <= 60 && !/[.!?]$/.test(first)) t = first;
  }
  if (!t || t.length > 80) return null;
  if (NOT_A_CHAPTER.test(t)) return null;
  return t;
}

function findCover(opf) {
  const items = [...opf.getElementsByTagNameNS('*', 'item')];
  const byProps = items.find(it => (it.getAttribute('properties') || '').includes('cover-image'));
  if (byProps) return { href: byProps.getAttribute('href'), type: byProps.getAttribute('media-type') };
  const meta = [...opf.getElementsByTagNameNS('*', 'meta')]
    .find(m => (m.getAttribute('name') || '').toLowerCase() === 'cover');
  if (meta) {
    const it = items.find(i => i.getAttribute('id') === meta.getAttribute('content'));
    if (it) return { href: it.getAttribute('href'), type: it.getAttribute('media-type') };
  }
  return null;
}

function xml(s) {
  const doc = new DOMParser().parseFromString(s, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('malformed epub XML');
  return doc;
}

function normalize(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

// --- minimal ZIP reader ----------------------------------------------------
function unzip(buf) {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  let eocd = buf.byteLength - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a zip / epub');
  const count = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);

  const files = {};
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commentLen = dv.getUint16(off + 32, true);
    const localOff = dv.getUint32(off + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(off + 46, off + 46 + nameLen));
    // Local header repeats name/extra lengths; the data starts after them.
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    files[name] = { method, comp: bytes.subarray(start, start + compSize) };
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

async function inflate(entry) {
  if (!entry) throw new Error('missing zip entry');
  if (entry.method === 0) return entry.comp;            // stored
  if (entry.method === 8) {                             // deflate
    const stream = new Blob([entry.comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('unsupported zip compression ' + entry.method);
}
