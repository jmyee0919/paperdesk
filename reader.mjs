import { getDocument, GlobalWorkerOptions, TextLayer } from './vendor/pdf.mjs';

GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';

const options = {
  cMapUrl: '/vendor/cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/standard_fonts/',
  wasmUrl: '/vendor/wasm/', iccUrl: '/vendor/iccs/', isEvalSupported: false,
};

export async function loadPdf(source) {
  const input = source instanceof Blob ? { data: new Uint8Array(await source.arrayBuffer()) } : { url: source };
  return getDocument({ ...input, ...options }).promise;
}

export async function pageText(pdf, number) {
  const page = await pdf.getPage(number);
  const text = await page.getTextContent();
  return text.items.map((item) => typeof item.str === 'string' ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
}

export function normalizeSearch(text) { return text.toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }

export async function indexPdf(pdf, signal) {
  const passages = [], pages = [];
  for (let page = 1; page <= pdf.numPages; page += 1) {
    signal.throwIfAborted();
    const raw = await pageText(pdf, page);
    pages.push(normalizeSearch(raw));
    const text = raw.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ');
    let start = 0, number = 1;
    while (start < text.length) {
      const endLimit = Math.min(start + 1300, text.length);
      const space = text.lastIndexOf(' ', endLimit);
      const end = endLimit === text.length || space <= start ? endLimit : space;
      passages.push({ id: `P${page}-${number++}`, page, text: text.slice(start, end).trim() });
      if (end === text.length) break;
      const overlap = text.indexOf(' ', Math.max(start + 1, end - 120));
      start = overlap >= 0 && overlap < end ? overlap + 1 : end;
    }
  }
  return { passages, pages };
}

export function highlightPage(container, query, scrollToFirst = false) {
  if (!CSS.highlights) return;
  CSS.highlights.delete('paperdesk-find');
  const word = normalizeSearch(query);
  if (!word) return;
  const nodes = [...container.querySelectorAll('.textLayer span')].map((span) => span.firstChild)
    .filter((node) => node?.nodeType === Node.TEXT_NODE);
  const source = nodes.map((node) => node.data).join(' ');
  const offsets = [];
  let search = '';
  for (let i = 0; i < source.length; i += 1) {
    const character = /\s/.test(source[i]) ? ' ' : source[i].toLocaleLowerCase();
    if (character === ' ' && search.endsWith(' ')) continue;
    search += character;
    for (let j = 0; j < character.length; j += 1) offsets.push(i);
  }
  let cursor = 0;
  const spans = nodes.map((node) => {
    const span = { node, start: cursor, end: cursor + node.length };
    cursor = span.end + 1;
    return span;
  });
  const ranges = [];
  for (let match = search.indexOf(word); match !== -1 && ranges.length < 300; match = search.indexOf(word, match + word.length)) {
    const start = offsets[match], end = offsets[match + word.length - 1] + 1;
    const first = spans.find((span) => start >= span.start && start < span.end);
    const last = spans.find((span) => end > span.start && end <= span.end);
    if (!first || !last) continue;
    const range = new Range(); range.setStart(first.node, start - first.start); range.setEnd(last.node, end - last.start); ranges.push(range);
  }
  if (!ranges.length) return;
  CSS.highlights.set('paperdesk-find', new Highlight(...ranges));
  if (scrollToFirst) ranges[0].startContainer.parentElement.scrollIntoView({ block: 'center', inline: 'nearest' });
}

const stopWords = new Set(['the', 'this', 'that', 'what', 'with', 'about', 'paper', '논문을', '논문의', '대해서', '알려줘', '설명해']);
const tokenize = (text) => text.toLocaleLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) || [];
const sectionPatterns = [/abstract|초록|background/i, /methods?|materials|patients|cohort|방법/i, /statistical analysis|adjustment|validation|통계/i, /results?|findings|결과/i, /discussion|limitations?|한계|고찰/i];

export function selectPassages(passages, question, page, analysis = false, limit = 29) {
  if (passages.length <= limit) return passages;
  const words = [...new Set(tokenize(question).filter((word) => !stopWords.has(word)))].slice(0, 80);
  const occurrences = new Map(words.map((word) => [word, 0]));
  let lengths = 0;
  const records = passages.map((item, index) => {
    const terms = tokenize(item.text), termCounts = new Map();
    for (const token of terms) if (occurrences.has(token)) termCounts.set(token, (termCounts.get(token) || 0) + 1);
    for (const token of termCounts.keys()) occurrences.set(token, occurrences.get(token) + 1);
    lengths += terms.length;
    return { item, index, size: terms.length, termCounts };
  });
  const average = Math.max(1, lengths / passages.length);
  const ranked = records.map((entry) => {
    let score = 0;
    for (const [token, count] of entry.termCounts) {
      const hits = occurrences.get(token);
      const weight = Math.log(1 + (passages.length - hits + 0.5) / (hits + 0.5));
      score += weight * (2.2 * count) / (count + 1.2 * (0.25 + 0.75 * entry.size / average));
    }
    return { ...entry, score, relevance: score + (entry.item.page === page ? 1.4 : 0) };
  }).sort((a, b) => b.relevance - a.relevance || a.index - b.index);
  const pool = new Map();
  const add = (entry) => { if (entry && pool.size < limit) pool.set(entry.id, entry); };
  add(ranked.find((entry) => entry.item.page === page)?.item);
  if (analysis || !ranked.some((entry) => entry.score > 0)) {
    add(passages[0]);
    for (const pattern of sectionPatterns) {
      const candidates = ranked.filter(({ item }) => pattern.test(item.text));
      add(candidates.find(({ item }) => pattern.test(item.text.slice(0, 120)) && !pool.has(item.id))?.item || candidates.find(({ item }) => !pool.has(item.id))?.item);
    }
    add(passages.at(-1));
  }
  for (const { item } of ranked) {
    if (pool.size >= limit) break;
    add(item);
  }
  return [...pool.values()].sort((a, b) => a.page - b.page || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

export function createRenderer(container) {
  let renderTask, textLayer, sequence = 0;
  return async function render(pdf, number, zoom, scroll = true) {
    const current = ++sequence;
    renderTask?.cancel();
    textLayer?.cancel();
    if (!pdf) return;
    const page = await pdf.getPage(number);
    if (current !== sequence) return;
    const raw = page.getViewport({ scale: 1 });
    const scale = Math.min(1.5, (container.clientWidth - 56) / raw.width) * zoom;
    const viewport = page.getViewport({ scale: Math.max(0.2, scale) });
    const outputScale = Math.min(2, window.devicePixelRatio || 1);
    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-sheet';
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;
    wrapper.style.setProperty('--scale-factor', viewport.scale);
    wrapper.style.setProperty('--user-unit', viewport.userUnit || 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    const layer = document.createElement('div');
    layer.className = 'textLayer';
    wrapper.append(canvas, layer);
    container.replaceChildren(wrapper);
    if (scroll) container.scrollTo({ top: 0, left: 0 });
    try {
      renderTask = page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
      textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
      await Promise.all([renderTask.promise, textLayer.render()]);
    } catch (err) {
      if (current === sequence && !['RenderingCancelledException', 'AbortException'].includes(err.name)) throw err;
    }
  };
}
