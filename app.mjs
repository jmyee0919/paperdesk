import { workflows } from './catalog.mjs';
import { createRenderer, indexPdf, loadPdf, selectPassages, highlightPage, normalizeSearch } from './reader.mjs';
import { db, storeImport, updatePaper, removePaper, removeFolder } from './store.mjs';
import { createLab } from './lab.mjs';
import { citationPattern, evidenceLabel, readMarkdownTable } from './lab-modes.mjs';
import { modelLabel, routeChat, astraHigh } from './model-routing.mjs';

const $ = (value, scope = document) => scope.querySelector(value);
const $$ = (value, scope = document) => [...scope.querySelectorAll(value)];
const icons = {
  mark: '<path d="M6 4h10a2 2 0 0 1 2 2v14H7a3 3 0 0 1-3-3V6a2 2 0 0 1 2-2zM4 17a3 3 0 0 1 3-3h11M8 8h6m-6 3h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2v2l-1 2 2 3 3-1 2 1 1 2 3-1 1-3 2-1 3-1v-3l-2-2-1-2 1-2-3-2-3 1-2-1z"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6"/>',
  route: '<circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/><path d="M7 17h8a3 3 0 0 0 0-6H9a2 2 0 0 1 0-4h8"/>',
  'arrow-up-right': '<path d="M6 18 18 6M8 6h10v10"/>', info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  expand: '<path d="M9 4H4v5m11-5h5v5m-5 11h5v-5M9 20H4v-5"/>',
  left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>', minus: '<path d="M5 12h14"/>',
  spark: '<path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10z"/>',
  up: '<path d="M12 19V5m-6 6 6-6 6 6"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  quote: '<path d="M7 11h4v6H5v-5a6 6 0 0 1 4-6M17 11h4v6h-6v-5a6 6 0 0 1 4-6"/>',
  folder: '<path d="M3 6h6l2 2h10v11H3z"/>',
  'folder-plus': '<path d="M3 6h6l2 2h10v11H3zM12 10v6m-3-3h6"/>',
  star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.1 1 5.9-5.4-2.8-5.4 2.8 1-5.9-4.3-4.1 6-.9z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v7m4-7v7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  bookmark: '<path d="M7 4h10v16l-5-3-5 3z"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  restore: '<path d="M4 4v5h5M4 9a8 8 0 1 1 1 8"/>',
  copy: '<rect x="8" y="8" width="11" height="12" rx="2"/><path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
$$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

const sampleId = 'demo';
const sampleTitle = 'Texture, Tumor Size, and Model Evaluation';
const sample = { id: sampleId, title: sampleTitle, filename: 'paperdesk-sample.pdf', author: 'Paperdesk', note: '', sample: true, messages: [], added: 0 };
const state = {
  papers: [], paper: null, viewId: 0, pdf: null, index: null, page: 1, zoom: 1, tab: 'chat',
  settings: {}, selection: null, pendingSelection: null, chat: null, research: null, runs: [], activeRun: null,
  workflow: workflows[0].id, mode: workflows[0].modes[0][0], researchQuestion: '', attachments: [], includePdf: false,
  folders: [], collection: localStorage.getItem('paperdesk-collection') || 'all', folderEdit: null,
  find: { pages: [], current: -1, revision: 0 }, drafts: new Map(),
};
const render = createRenderer($('#pdf-view'));
let toastTimer;

function toast(message, action) {
  const host = $('#toast');
  host.replaceChildren(message);
  if (action) {
    const button = make('button', 'small-button', action.label);
    button.type = 'button'; button.addEventListener('click', action.run, { once: true }); host.append(button);
  }
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, action ? 8500 : 4500);
}

async function api(route, body, signal) {
  const options = body === undefined ? { signal } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal };
  const response = await fetch(`/api/${route}`, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request could not be completed.');
  return result;
}

function iconButton(name, label, onClick, className = 'icon-button') {
  const button = make('button', className);
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  button.innerHTML = icon(name); button.addEventListener('click', onClick);
  return button;
}

const shelfViews = [
  { id: 'all', name: 'All papers', mark: 'list' },
  { id: 'favorites', name: 'Favorites', mark: 'star' },
  { id: 'reading', name: 'Reading', mark: 'bookmark' },
  { id: 'trash', name: 'Trash', mark: 'trash' },
];
const readingLabels = { unread: 'To read', reading: 'Reading', done: 'Read' };
const paperDragType = 'application/x-paperdesk-paper';

function belongs(paper, collection) {
  if (collection === 'trash') return Boolean(paper.trashedAt);
  if (paper.trashedAt) return false;
  if (collection === 'all') return true;
  if (collection === 'favorites') return Boolean(paper.favorite);
  if (collection === 'reading') return paper.readingStatus === 'reading';
  return paper.folderId === collection;
}

function setCollection(id) {
  state.collection = id;
  localStorage.setItem('paperdesk-collection', id);
  showLibrary();
}

function showCollections() {
  const folders = [...state.folders].sort((a, b) => a.name.localeCompare(b.name));
  const categories = [...shelfViews, ...folders.map((folder) => ({ ...folder, mark: 'folder' }))];
  const host = $('#collections');
  host.replaceChildren();
  for (const entry of categories) {
    const row = make('div', 'collection-row');
    const target = make('button', 'collection-button');
    target.type = 'button'; target.setAttribute('aria-current', String(state.collection === entry.id));
    const mark = make('span'); mark.innerHTML = icon(entry.mark);
    target.append(mark, make('span', 'collection-text', entry.name));
    target.addEventListener('click', () => setCollection(entry.id));
    row.append(target);
    if (entry.mark === 'folder') {
      target.addEventListener('dragover', (event) => {
        if (!event.dataTransfer.types.includes(paperDragType)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.classList.add('drop-target');
      });
      target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
      target.addEventListener('drop', (event) => {
        target.classList.remove('drop-target');
        const paper = state.papers.find((item) => item.id === event.dataTransfer.getData(paperDragType));
        if (!paper || paper.trashedAt) return;
        event.preventDefault();
        savePaperFields(paper, { folderId: entry.id }).then(() => toast(`Moved to the ${entry.name} folder.`)).catch((err) => toast(err.message));
      });
      row.append(iconButton('more', `Manage folder ${entry.name}`, () => editFolder(entry)));
    }
    host.append(row);
  }
}

function showLibrary() {
  const query = $('#find').value.trim().normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const sort = $('#paper-sort').value;
  const visible = state.papers.filter((paper) => {
    if (!belongs(paper, state.collection)) return false;
    const keywords = [paper.title, paper.author, paper.filename, ...(paper.tags || [])].join(' ').normalize('NFKC').toLocaleLowerCase();
    return query.every((word) => keywords.includes(word));
  });
  visible.sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title);
    return (b[sort] || 0) - (a[sort] || 0) || b.added - a.added;
  });
  $('#collection-name').textContent = [...shelfViews, ...state.folders].find((entry) => entry.id === state.collection)?.name || 'All papers';
  $('#library-count').textContent = visible.length;
  showCollections();
  const rows = visible.map((paper) => {
    const row = make('article', 'library-row');
    const button = make('button', 'paper-row');
    button.type = 'button';
    button.setAttribute('aria-current', String(state.paper?.id === paper.id));
    const glyph = make('span', 'paper-glyph'); glyph.innerHTML = icon('file');
    const label = make('span', 'paper-copy', paper.title);
    const subtitle = paper.sample ? 'Sample PDF' : [paper.author, readingLabels[paper.readingStatus]].filter(Boolean).join(' · ') || 'PDF document';
    label.append(make('small', '', subtitle));
    if (paper.tags?.length) label.append(make('small', 'paper-tags', paper.tags.slice(0, 3).join(' · ')));
    button.append(glyph, label);
    row.append(button);
    const actions = make('div', 'paper-row-actions');
    if (paper.trashedAt) {
      button.disabled = true;
      actions.append(iconButton('restore', 'Restore paper', () => restorePaper(paper)), iconButton('trash', 'Delete permanently', () => deletePermanently(paper)));
    } else {
      button.addEventListener('click', () => openPaper(paper));
      button.draggable = true;
      button.addEventListener('dragstart', (event) => {
        event.dataTransfer.setData(paperDragType, paper.id); event.dataTransfer.effectAllowed = 'move';
      });
      const favorite = iconButton('star', 'Favorites', () => savePaperFields(paper, { favorite: !paper.favorite }).catch((err) => toast(err.message)));
      favorite.setAttribute('aria-pressed', String(Boolean(paper.favorite)));
      actions.append(favorite, iconButton('more', 'Manage paper', () => openDetails(paper)));
    }
    row.append(actions);
    return row;
  });
  const empty = query.length ? 'No search results.' : state.collection === 'trash' ? 'Trash is empty.' : 'No papers in this view.';
  $('#papers').replaceChildren(...(rows.length ? rows : [make('p', 'shelf-empty', empty)]));
}

async function savePaperFields(paper, update, refresh = true) {
  const previous = Object.fromEntries(Object.keys(update).map((key) => [key, paper[key]]));
  Object.assign(paper, update);
  try { await updatePaper(paper, update); }
  catch (err) {
    for (const key of Object.keys(update)) if (paper[key] === update[key]) paper[key] = previous[key];
    throw err;
  }
  if (refresh) showLibrary();
}

function editFolder(folder) {
  state.folderEdit = folder || null;
  $('#folder-heading').textContent = folder ? 'Manage folder' : 'New folder';
  $('#folder-name').value = folder?.name || '';
  $('#folder-delete').hidden = !folder;
  $('#folder-error').textContent = '';
  $('#folder-dialog').showModal();
  $('#folder-name').select();
}

function confirmAction(title, copy) {
  const dialog = $('#confirm-dialog');
  $('#confirm-heading').textContent = title; $('#confirm-copy').textContent = copy;
  dialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

async function moveToTrash(paper) {
  try {
    await savePaperFields(paper, { trashedAt: Date.now() });
    if (state.chat?.paper === paper.id) state.chat.controller.abort();
    if (state.paper === paper) await openPaper(state.papers.find((p) => !p.trashedAt && belongs(p, state.collection)) || state.papers.find((p) => !p.trashedAt));
    toast('Moved the paper to Trash.', { label: 'Undo', run: () => restorePaper(paper) });
  } catch (err) { toast(err.message); }
}

async function restorePaper(paper) {
  try { await savePaperFields(paper, { trashedAt: null }); toast('Restored the paper.'); }
  catch (err) { toast(err.message); }
}

async function deletePermanently(paper) {
  if (state.chat?.paper === paper.id) { toast('Wait for the current question to finish before deleting this paper.'); return; }
  if (!await confirmAction('Delete paper permanently?', 'This removes the library copy, notes, chat, bookmarks, and excerpts. Saved Research Lab reports can be deleted separately.')) return;
  try {
    await removePaper(paper);
    state.papers = state.papers.filter((p) => p.id !== paper.id);
    state.drafts.delete(paper.id);
    showLibrary(); toast('Deleted the paper permanently.');
  } catch (err) { toast(err.message); }
}

async function openPaper(paper) {
  if (paper && state.paper === paper && state.pdf) return;
  if (state.paper) state.drafts.set(state.paper.id, { text: $('#question').value, selection: state.selection, quality: $('#chat-quality').value });
  const previous = state.pdf, previousIndex = state.index;
  if (state.chat?.paper !== state.paper?.id) state.indexController?.abort();
  void render(null);
  if (previous) Promise.resolve(previousIndex).finally(() => previous.destroy()).catch(() => {});
  const viewId = ++state.viewId;
  state.paper = paper; state.pdf = null; state.index = null; state.readyIndex = null; state.selection = null;
  state.page = 1; state.zoom = paper?.zoom || 1;
  closePdfFind();
  if (!paper) {
    $('#reading-title').textContent = 'PDF reader';
    $('#question').value = '';
    $('#pdf-view').replaceChildren(make('div', 'reader-empty', 'Open a paper from your library or add a PDF.'));
    localStorage.removeItem('paperdesk-current');
    showLibrary(); showSelection(); updateReaderControls(); showPanel();
    return;
  }
  $('#reading-title').textContent = paper.title;
  const draft = state.drafts.get(paper.id);
  $('#question').value = draft?.text || '';
  $('#chat-quality').value = draft?.quality || 'auto';
  state.selection = draft?.selection || null;
  $('#pdf-view').replaceChildren(make('div', 'reader-empty', 'Opening PDF…'));
  showLibrary(); showSelection(); updateReaderControls(); showPanel();
  localStorage.setItem('paperdesk-current', paper.id);
  try {
    const source = paper.sample ? '/sample.pdf' : (await db('pdfs', 'get', paper.id))?.blob;
    if (!source) throw new Error('The saved PDF could not be found.');
    const pdf = await loadPdf(source);
    if (viewId !== state.viewId) { await pdf.destroy(); return; }
    state.pdf = pdf;
    state.page = Math.min(pdf.numPages, Math.max(1, paper.page || 1));
    draw(true, false, paper.scrollTop || 0);
    const control = new AbortController(); state.indexController = control;
    state.index = indexPdf(pdf, control.signal).then((index) => {
      if (viewId === state.viewId) state.readyIndex = index;
      return index;
    }).catch((err) => {
      if (viewId === state.viewId && !control.signal.aborted) toast(`Could not extract text. ${err.message}`);
      return { passages: [], pages: [] };
    });
    await savePaperFields(paper, { opened: Date.now(), pages: pdf.numPages, readingStatus: paper.readingStatus || 'reading' });
  } catch (err) {
    if (viewId === state.viewId) $('#pdf-view').replaceChildren(make('div', 'reader-empty', err.message || 'The PDF could not be opened.'));
  }
}

async function importFiles(files) {
  if (state.importing) { toast('A PDF import is already running. Try again shortly.'); return; }
  state.importing = true;
  const destination = state.folders.find((folder) => folder.id === state.collection)?.id || '';
  let latest;
  for (const file of files) {
    if (!/\.pdf$/i.test(file.name) || file.size > 80 * 1024 * 1024) { toast('Choose a PDF of 80 MB or less.'); continue; }
    let pdf;
    try {
      const fingerprint = await fingerprintPdf(file);
      const duplicate = state.papers.find((entry) => entry.fingerprint === fingerprint) || await findLegacyDuplicate(file, fingerprint);
      if (duplicate) {
        toast(duplicate.trashedAt ? 'This PDF is in Trash.' : 'This PDF is already in your library.', duplicate.trashedAt ? { label: 'Restore', run: () => restorePaper(duplicate) } : undefined);
        if (!duplicate.trashedAt) latest = duplicate;
        continue;
      }
      pdf = await loadPdf(file);
      const { info } = await pdf.getMetadata().catch(() => ({}));
      const title = info?.Title?.trim() || file.name.replace(/\.pdf$/i, '');
      const folderId = state.folders.some((folder) => folder.id === destination) ? destination : '';
      const paper = { id: crypto.randomUUID(), title, filename: file.name, author: info?.Author?.trim() || '', added: Date.now(), pages: pdf.numPages, note: '', messages: [], folderId, fingerprint };
      await storeImport(paper, file);
      state.papers.unshift(paper);
      latest = paper;
    } catch (err) { toast(`Could not import the PDF. ${err.message || ''}`); }
    finally { await pdf?.destroy().catch(() => {}); }
  }
  state.importing = false;
  if (latest) $('#find').value = '';
  if (latest && !belongs(latest, state.collection)) setCollection('all');
  if (latest) { showLibrary(); openPaper(latest); }
}

async function fingerprintPdf(blob) {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function findLegacyDuplicate(file, fingerprint) {
  for (const entry of state.papers.filter((paper) => !paper.sample && !paper.fingerprint && paper.filename === file.name)) {
    const saved = (await db('pdfs', 'get', entry.id))?.blob;
    if (saved?.size === file.size && await fingerprintPdf(saved) === fingerprint) return entry;
  }
  return null;
}

function updateReaderControls() {
  $('#page-number').value = state.page;
  $('#page-number').max = state.pdf?.numPages || 1;
  $('#page-total').textContent = state.pdf?.numPages || '–';
  $('#previous').disabled = state.page <= 1 || !state.pdf;
  $('#next').disabled = !state.pdf || state.page >= state.pdf.numPages;
  $('#zoom-reset').textContent = `${Math.round(state.zoom * 100)}%`;
  $('#zoom-in').disabled = !state.pdf || state.zoom >= 2.2;
  $('#zoom-out').disabled = !state.pdf || state.zoom <= 0.5;
  const bookmarked = state.paper?.bookmarks?.includes(state.page) || false;
  $('#bookmark-toggle').setAttribute('aria-pressed', String(bookmarked));
  for (const selector of ['#bookmark-toggle', '#reader-tools-open', '#pdf-find-open']) $(selector).disabled = !state.pdf;
  $('#document-info').disabled = !state.paper;
  $('.floating-controls').hidden = !state.pdf;
}

let renderSequence = 0;
function draw(scroll = true, highlight = false, restoreTop = null) {
  updateReaderControls();
  if (!state.pdf) return;
  const version = ++renderSequence, paper = state.paper, page = state.page;
  const viewport = $('#pdf-view'), top = restoreTop ?? (scroll ? 0 : viewport.scrollTop);
  render(state.pdf, state.page, state.zoom, scroll).then(() => {
    if (version !== renderSequence || paper !== state.paper || page !== state.page) return;
    viewport.scrollTop = top;
    highlightPage(viewport, $('#pdf-query').value, highlight);
  }).catch((err) => toast(err.message));
}

function jump(page, highlight = false) {
  if (!state.pdf) return;
  const destination = Math.max(1, Math.min(state.pdf.numPages, Math.round(Number(page) || 1)));
  if (destination === state.page) {
    updateReaderControls();
    if (highlight) highlightPage($('#pdf-view'), $('#pdf-query').value, true);
    else $('#pdf-view').scrollTo({ top: 0, left: 0 });
    return;
  }
  state.page = destination;
  savePaperFields(state.paper, { page: state.page, scrollTop: 0 }, false).catch((err) => toast(err.message));
  draw(true, highlight);
}

function closePdfFind() {
  $('#pdf-find-form').hidden = true;
  $('#pdf-query').value = '';
  state.find.revision += 1;
  state.find.pages = []; state.find.current = -1;
  highlightPage($('#pdf-view'), '');
  updateSearchControls();
}

function openPdfFind() {
  if (!state.pdf) return;
  $('#pdf-find-form').hidden = false;
  $('#pdf-query').focus();
  $('#pdf-query').select();
}

function updateSearchControls(status = '') {
  const { pages, current } = state.find;
  $('#pdf-matches').textContent = status || (pages.length ? `${current + 1} / ${pages.length} pages` : '');
  $('#find-prev').disabled = $('#find-next').disabled = !pages.length;
}

async function searchPdf() {
  const revision = ++state.find.revision;
  const query = normalizeSearch($('#pdf-query').value);
  state.find.pages = []; state.find.current = -1;
  updateSearchControls(query ? 'Searching…' : '');
  highlightPage($('#pdf-view'), '');
  if (!query || !state.index) return;
  const { pages } = await state.index;
  if (revision !== state.find.revision) return;
  if (!pages.some(Boolean)) { updateSearchControls('No searchable text'); return; }
  state.find.pages = pages.flatMap((text, index) => text.includes(query) ? [index + 1] : []);
  if (!state.find.pages.length) { updateSearchControls('No results'); return; }
  const next = state.find.pages.findIndex((page) => page >= state.page);
  state.find.current = next === -1 ? 0 : next;
  updateSearchControls(); jump(state.find.pages[state.find.current], true);
}

function findNext(offset) {
  const { pages, current } = state.find;
  if (!pages.length) return;
  state.find.current = (current + offset + pages.length) % pages.length;
  updateSearchControls(); jump(pages[state.find.current], true);
}

function setTab(value) {
  state.tab = value;
  $$('.tabs [data-tab]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab.dataset.tab === value)));
  $('#chat-form').hidden = value !== 'chat';
  showPanel();
}

function inline(parent, text, evidence = {}, onSource) {
  const tokens = /\[\[((?:D\d+-)?P\d+-\d+|R\d+)\]\]|\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let previous = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(text.slice(previous, match.index));
    const [, source, bold, code, label, url] = match;
    if (source && Object.hasOwn(evidence, source)) {
      const passage = evidence[source];
      const button = make('button', 'citation', evidenceLabel(passage));
      button.type = 'button'; button.title = (passage.title || passage.text || '').slice(0, 180);
      button.addEventListener('click', () => onSource ? onSource(passage) : jump(passage.page));
      parent.append(button);
    } else if (source) parent.append(' [Unverified source]');
    else if (bold) parent.append(make('strong', '', bold));
    else if (code) parent.append(make('code', '', code));
    else if (onSource) parent.append(label);
    else {
      const link = make('a', '', label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link);
    }
    previous = match.index + match[0].length;
  }
  parent.append(text.slice(previous));
}

function markdown(parent, text, evidence, onSource) {
  let list, block;
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      if (block) block = null;
      else { block = make('pre'); parent.append(block); }
      list = null;
      continue;
    }
    if (block) { block.append(`${line}\n`); continue; }
    const parsed = readMarkdownTable(lines, index);
    if (parsed) {
      const { headers, rows, end } = parsed, wrapper = make('div', 'markdown-table-wrap'), table = make('table', 'markdown-table');
      const heading = table.createTHead().insertRow();
      for (const text of headers) { const cell = make('th'); cell.scope = 'col'; inline(cell, text, evidence, onSource); heading.append(cell); }
      const body = table.createTBody(); index = end;
      for (const values of rows) {
        const row = body.insertRow();
        headers.forEach((_, column) => inline(row.insertCell(), values[column] || '—', evidence, onSource));
      }
      wrapper.append(table); parent.append(wrapper); list = null; continue;
    }
    const item = line.match(/^\s*(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (item) {
      const tag = item[2] ? 'OL' : 'UL';
      if (list?.tagName !== tag) { list = make(tag); parent.append(list); }
      const li = make('li'); inline(li, item[3], evidence, onSource); list.append(li); continue;
    }
    list = null;
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,6}\s+(.+)/);
    const p = make(heading ? 'h3' : 'p');
    inline(p, heading?.[1] || line, evidence, onSource);
    parent.append(p);
  }
}

function message(entry) {
  const el = make('article', `message ${entry.role}`);
  const header = make('header', 'message-label');
  const assistant = entry.role === 'assistant';
  header.append(make('span', '', assistant ? 'GPT' : 'You'));
  if (assistant && entry.profile?.model) header.append(make('span', 'message-model', modelLabel(entry.profile)));
  if (assistant && entry.profile?.task === 'reviewer') header.append(make('span', 'message-lens', 'Reviewer view'));
  el.append(header);
  const references = entry.evidence || {};
  if (entry.role === 'user') el.append(make('p', '', entry.text));
  else markdown(el, entry.text, references);
  if (Object.keys(references).length) {
    const details = make('details', 'evidence');
    details.append(make('summary', '', `PDF passages (${Object.keys(references).length})`));
    for (const passage of Object.values(references)) {
      const quote = make('blockquote', '', passage.text);
      const button = make('button', 'citation', `p. ${passage.page}`);
      button.type = 'button'; button.addEventListener('click', () => jump(passage.page));
      quote.prepend(button, ' '); details.append(quote);
    }
    el.append(details);
  }
  const copy = iconButton('copy', entry.role === 'user' ? 'Copy question' : 'Copy answer', async () => {
    try { await navigator.clipboard.writeText(messageText(entry)); toast('Copied to clipboard.'); }
    catch { toast('Copy failed. Select the text and copy it manually.'); }
  });
  el.append(make('div', 'message-actions'));
  el.lastChild.append(copy);
  return el;
}

function messageText(entry) { return entry.text.replace(citationPattern, (_token, key) => entry.evidence?.[key] ? `(PDF p. ${entry.evidence[key].page})` : '[Unverified source]'); }

function card(title, text, label) {
  const el = make('section', 'panel-card');
  if (label) el.append(make('div', 'panel-label', label));
  if (title) el.append(make('h3', 'panel-title', title));
  if (text) el.append(make('p', '', text));
  return el;
}

function progress(text) {
  const busy = make('div', 'progress');
  busy.append(make('span', 'progress-dot'), make('span', '', text));
  return busy;
}

const examples = [
  ['Summarize the methods', 'Summarize the research aim, cohort, and analytical methods. Cite supporting passages.'],
  ['Interpret the results', 'Separate the main findings from the authors’ interpretation. Cite both where possible.'],
  ['Identify limitations', 'Distinguish the limitations stated by the authors from additional issues worth investigating.'],
  ['Ask as a reviewer', 'Review this manuscript from a journal reviewer’s perspective. Identify the biggest publication blocker and the minimum fix, with evidence.'],
];

function showPanel(scroll = false) {
  const body = $('#assistant-body');
  const lastScroll = body.scrollTop;
  if (state.tab === 'lab') { lab.render(body); return; }
  body.replaceChildren();
  if (state.tab === 'research') { showResearch(body); return; }
  const paper = state.paper;
  $('#question').disabled = !paper;
  $('#chat-quality').disabled = !paper;
  $('#send').disabled = !paper || Boolean(state.chat);
  $('#chat-stop').hidden = !state.chat || state.chat.analysis;
  if (!paper) { body.append(card('Open a paper', 'Open a PDF to ask about passages or start an analysis.')); return; }
  const running = state.chat?.paper === paper.id;
  if (state.tab === 'analysis') {
    const overview = card('In-depth paper analysis', 'Get a structured summary of the question, data, methods, results, interpretation, and limitations with source pages.', modelLabel(astraHigh));
    const button = make('button', 'analysis-action', paper.analysis ? 'Analyze again' : 'Start analysis');
    button.type = 'button'; button.disabled = Boolean(state.chat);
    button.addEventListener('click', () => ask('Summarize the research question, data and cohort, study design, methods and statistics, results, interpretation, and limitations. Mark details you cannot verify in the source. Cover Abstract, Methods, Results, Discussion, and Limitations.', true));
    overview.append(button); body.append(overview);
    const presets = make('div', 'research-actions analysis-presets');
    for (const [mode, label] of [['reviewer', 'Reviewer feedback'], ['critique', 'Critical appraisal'], ['methods', 'Methods & statistics'], ['extract', 'Study characteristics'], ['compare', 'Compare papers']]) {
      const tool = make('button', 'small-button', label); tool.type = 'button';
      tool.addEventListener('click', () => { lab.selectMode(mode, paper); setTab('lab'); }); presets.append(tool);
    }
    overview.append(presets);
    if (paper.analysis) body.append(message(paper.analysis));
  } else {
    if (!paper.messages.length && !paper.failedQuestion && !running) {
      const intro = card('Ask about this paper', 'Click a page citation to jump to the PDF.', paper.sample ? 'Sample document' : 'PDF chat');
      const list = make('div', 'quick-list');
      for (const [label, prompt] of examples) {
        const button = make('button', '', label); button.type = 'button';
        const arrow = make('span'); arrow.innerHTML = icon('arrow-up-right'); button.append(arrow);
        button.addEventListener('click', () => { $('#question').value = prompt; $('#question').focus(); }); list.append(button);
      }
      intro.append(list); body.append(intro);
      if (paper.sample) {
        const example = card('Try a page citation', '');
        const el = make('p');
        inline(el, 'The sample and data split are on page 2. [[P2-1]]', { 'P2-1': { page: 2, text: 'Synthetic cohort and split' } });
        example.append(el); body.append(example);
      }
    }
    for (const entry of paper.messages) body.append(message(entry));
    if (running && !state.chat.analysis) body.append(message({ role: 'user', text: state.chat.question }));
    if (paper.failedQuestion && !(running && !state.chat.analysis)) {
      const { question, selection, error, needsSettings, precision } = paper.failedQuestion;
      const status = card('', error);
      const actions = make('div', 'research-actions');
      const configure = needsSettings && !aiAvailable();
      const retry = make('button', 'small-button', configure ? 'Connect AI' : 'Try again');
      retry.type = 'button'; retry.disabled = Boolean(state.chat);
      retry.addEventListener('click', () => configure ? openSettings() : ask(question, false, selection, false, precision === true));
      const edit = make('button', 'small-button', 'Edit and resend'); edit.type = 'button';
      edit.addEventListener('click', () => { $('#question').value = question; $('#chat-quality').value = precision ? 'astra' : 'auto'; state.selection = selection; showSelection(); $('#question').focus(); });
      actions.append(retry, edit); status.append(actions);
      body.append(message({ role: 'user', text: question }), status);
    }
  }
  if (running && state.chat.analysis === (state.tab === 'analysis')) {
    const busy = progress(state.chat.stage);
    if (state.chat.analysis) {
      const stop = make('button', 'small-button', 'Stop analysis'); stop.type = 'button';
      stop.addEventListener('click', () => state.chat?.controller.abort()); busy.append(stop);
    }
    body.append(busy);
  }
  if (state.tab === 'analysis' && paper.analysisError) body.append(make('p', 'form-error', paper.analysisError));
  body.scrollTop = scroll ? body.scrollHeight : lastScroll;
}

function aiAvailable() { return state.settings.engine === 'api' ? state.settings.apiConfigured : state.settings.codex; }

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

async function ask(prompt, analysis = false, selection = analysis ? null : state.selection, clearComposer = true, precision = !analysis && $('#chat-quality').value === 'astra') {
  const question = prompt.trim();
  const paper = state.paper;
  if (!question || !paper || state.chat) return;
  if (!state.index) { toast('Try again once the PDF has loaded.'); return; }
  const page = selection?.page || state.page;
  const search = state.index;
  const purpose = analysis ? 'analysis' : 'chat';
  const route = routeChat({ question, purpose, precision });
  const controller = new AbortController();
  state.chat = { paper: paper.id, question, analysis, controller, stage: 'Finding relevant passages…' };
  if (analysis) paper.analysisError = '';
  else if (clearComposer) {
    $('#question').value = '';
    $('#chat-quality').value = 'auto';
    state.selection = null; showSelection();
  }
  showPanel(true);
  const needsSettings = !aiAvailable();
  try {
    if (needsSettings) throw new Error('Connect AI to send this question again.');
    const { passages: indexed } = await abortable(search, controller.signal);
    controller.signal.throwIfAborted();
    if (!indexed.length) throw new Error('No searchable PDF text. Run OCR on the scanned PDF before importing it.');
    const passages = selectPassages(indexed, `${question} ${selection?.text || ''} ${route.task === 'reviewer' ? 'methods validation bias results limitations' : ''}`, page, route.task !== 'chat');
    state.chat.stage = 'Reviewing the source…';
    if (state.paper?.id === paper.id) showPanel(true);
    const { answer, profile } = await api('chat', { question, purpose, precision, passages, title: paper.title, selection: selection?.text, history: analysis ? [] : paper.messages }, controller.signal);
    const cited = new Set([...answer.matchAll(/\[\[(P\d+-\d+)\]\]/g)].map((match) => match[1]));
    const evidence = Object.fromEntries(passages.filter((p) => cited.has(p.id)).map((p) => [p.id, p]));
    const entry = { role: 'assistant', text: answer, evidence, profile };
    const changes = analysis ? { analysis: entry } : { messages: [...paper.messages, { role: 'user', text: question, selection }, entry], failedQuestion: null };
    await savePaperFields(paper, changes, false);
  } catch (err) {
    const error = controller.signal.aborted ? 'Stopped the request.' : err.message;
    if (analysis) paper.analysisError = error;
    else {
      try { await savePaperFields(paper, { failedQuestion: { question, selection, error, needsSettings, precision } }, false); }
      catch (saveError) { toast(saveError.message); }
    }
  }
  finally { state.chat = null; showPanel(true); }
}

function showSelection() {
  $('#selection-pill').hidden = !state.selection;
  $('#selection-label').textContent = state.selection ? `p. ${state.selection.page} · ${state.selection.text}` : '';
  $('#composer-status').textContent = state.selection ? 'Selected passage included' : 'Enter to send · Shift+Enter for a new line';
}

function showResearch(body) {
  const active = state.activeRun && state.runs.find((run) => run.id === state.activeRun);
  const workflow = workflows.find((entry) => entry.id === (active?.workflow || state.workflow));
  const running = Boolean(state.research);
  const panel = card(active ? '' : 'Research workflows', active ? '' : 'Run ARS-Codex workflows for literature review, manuscript review, experiment design, and more.');
  const form = make('form', 'research-form');
  if (active) {
    const head = make('div', 'run-head');
    head.append(make('h3', 'panel-title', workflow.title));
    const newButton = make('button', 'small-button', 'New run'); newButton.type = 'button'; newButton.disabled = running;
    newButton.addEventListener('click', () => { state.activeRun = null; state.researchQuestion = ''; showPanel(); });
    head.append(newButton); panel.append(head);
    for (const entry of active.messages) panel.append(message(entry));
    if (active.files.length) {
      const links = make('div', 'artifact-links');
      for (const name of active.files) {
        const link = make('a', '', name);
        link.href = `/api/artifacts/${active.id}/${name.split('/').map(encodeURIComponent).join('/')}`;
        link.setAttribute('download', ''); links.append(link);
      }
      panel.append(links);
    }
  } else {
    const typeLabel = make('label', 'field-label', 'Workflow'); typeLabel.htmlFor = 'workflow-type';
    const select = make('select'); select.id = 'workflow-type'; select.disabled = running;
    for (const entry of workflows) select.add(new Option(entry.title, entry.id));
    select.value = workflow.id;
    select.addEventListener('change', () => {
      state.workflow = select.value;
      state.mode = workflows.find((entry) => entry.id === state.workflow).modes[0][0];
      showPanel();
    });
    const modeLabel = make('label', 'field-label', 'Mode'); modeLabel.htmlFor = 'workflow-mode';
    const mode = make('select'); mode.id = 'workflow-mode'; mode.disabled = running;
    for (const [value, label] of workflow.modes) mode.add(new Option(label, value));
    mode.value = state.mode;
    mode.addEventListener('change', () => { state.mode = mode.value; });
    form.append(typeLabel, select, make('p', 'field-help', workflow.description), modeLabel, mode);
  }
  const label = make('label', 'field-label', active ? 'Follow-up request' : 'Research request'); label.htmlFor = 'research-question';
  const textarea = make('textarea'); textarea.id = 'research-question'; textarea.required = true; textarea.disabled = running;
  textarea.placeholder = active ? 'Add information or ask to continue to the next step' : 'Describe your goal, research question, and expected outputs';
  textarea.value = state.researchQuestion;
  textarea.addEventListener('input', () => { state.researchQuestion = textarea.value; });
  form.append(label, textarea);
  {
    const input = make('input'); input.type = 'file'; input.multiple = true; input.hidden = true; input.accept = '.pdf,.docx,.csv,.tsv,.ris,.bib,.json,.jsonl,.txt,.md,.r,.py,.ipynb,.xlsx,.tex';
    input.addEventListener('change', () => { state.attachments = [...input.files]; showPanel(); });
    const fileButton = make('button', 'small-button', 'Attach files'); fileButton.type = 'button'; fileButton.disabled = running;
    fileButton.addEventListener('click', () => input.click());
    const attach = make('div', 'research-actions'); attach.append(fileButton, input);
    if (state.attachments.length) {
      attach.append(make('span', 'muted file-label', state.attachments.map((file) => file.name).join(', ')));
      const clear = make('button', 'small-button', 'Remove'); clear.type = 'button'; clear.disabled = running;
      clear.addEventListener('click', () => { state.attachments = []; showPanel(); }); attach.append(clear);
    }
    form.append(attach);
    if (state.paper) {
      const check = make('input'); check.type = 'checkbox'; check.checked = state.includePdf; check.disabled = running;
      check.addEventListener('change', () => { state.includePdf = check.checked; });
      const checkLabel = make('label', 'muted', ' Include current PDF'); checkLabel.prepend(check); form.append(checkLabel);
    }
  }
  const buttons = make('div', 'research-actions');
  const button = make('button', 'primary-button', active ? 'Continue' : 'Run workflow'); button.type = 'submit'; button.disabled = running;
  buttons.append(button);
  if (running) {
    const cancel = make('button', 'small-button', 'Stop'); cancel.type = 'button';
    cancel.addEventListener('click', () => state.research?.controller.abort()); buttons.append(cancel);
  }
  form.append(buttons);
  if (!state.settings.suiteReady || !state.settings.codex) {
    const connection = make('button', 'small-button', 'Configure Codex and ARS');
    connection.type = 'button'; connection.addEventListener('click', openSettings); form.append(connection);
  } else form.append(make('p', 'field-help', 'Codex can read your attached files. Check which files to include.'));
  form.addEventListener('submit', (event) => { event.preventDefault(); startResearch(active); });
  panel.append(form); body.append(panel);
  if (running) body.append(progress(state.research.stage));
  if (state.researchError) body.append(make('p', 'form-error', state.researchError));
  if (state.runs.length) {
    const prior = card('Recent research runs', '');
    const list = make('div', 'run-history');
    for (const run of state.runs.slice(0, 10)) {
      const item = make('button', '', run.title); item.type = 'button'; item.disabled = running || state.activeRun === run.id;
      item.addEventListener('click', () => { state.activeRun = run.id; state.researchQuestion = ''; state.researchError = ''; showPanel(); }); list.append(item);
    }
    prior.append(list); body.append(prior);
  }
}

function encodeFile(file, name = file.name) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve({ name, data: reader.result.split(',', 2)[1] });
    reader.readAsDataURL(file);
  });
}

async function readResearch(response, onProgress) {
  if (!response.ok) throw new Error((await response.json()).error || 'Could not send the research request.');
  let pending = '', result;
  const consume = (line) => {
    if (!line.trim()) return;
    const event = JSON.parse(line);
    if (event.error) throw new Error(event.error);
    if (event.status) onProgress(event.status);
    if (event.result) result = event.result;
  };
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) consume(line);
  }
  consume(pending);
  if (!result) throw new Error('No result was returned for this run.');
  return result;
}

async function labCorpus(papers, question, signal) {
  const documents = [], exclusions = [];
  const limit = Math.max(5, Math.min(10, Math.floor(42 / Math.max(1, papers.length))));
  for (const paper of papers) {
    signal.throwIfAborted();
    let temporary;
    try {
      let indexed = state.paper?.id === paper.id && state.readyIndex;
      if (!indexed) {
        const source = paper.sample ? '/sample.pdf' : (await db('pdfs', 'get', paper.id))?.blob;
        if (!source) { exclusions.push(`${paper.title} · PDF unavailable`); continue; }
        temporary = await loadPdf(source);
        indexed = await indexPdf(temporary, signal);
      }
      if (!indexed.passages.length) { exclusions.push(`${paper.title} · No extractable text`); continue; }
      documents.push({ paperId: paper.id, title: paper.title, passages: selectPassages(indexed.passages, question, paper.page || 1, true, limit) });
    } catch (err) {
      if (signal.aborted) throw err;
      exclusions.push(`${paper.title} · PDF text extraction failed`);
    } finally { await temporary?.destroy().catch(() => {}); }
  }
  return { documents, exclusions };
}

async function jumpToEvidence(id, page) {
  const paper = state.papers.find((entry) => entry.id === id && !entry.trashedAt);
  if (!paper) { toast('This PDF is unavailable in the library. Saved excerpts are still available under Analysis scope.'); return; }
  await openPaper(paper);
  if (state.paper?.id === id) jump(page);
}

function handoffToArs([workflow, mode], report, filename, question) {
  if (state.research) { toast('Wait for the active ARS run to finish before handing off this report.'); return; }
  state.activeRun = null;
  state.workflow = workflow;
  state.mode = mode;
  state.researchError = '';
  state.researchQuestion = `Run the selected ARS mode using the attached Paperdesk report as background. Separate supported findings from unverified statements.${question ? `\n\nOriginal research request: ${question.slice(0, 7000)}` : ''}`;
  state.attachments = [new File([report], `${filename}.md`, { type: 'text/markdown' })];
  state.includePdf = false;
  setTab('research');
}

const lab = createLab({
  getPapers: () => state.papers,
  getCurrent: () => state.paper,
  getFolder: () => state.folders.find((folder) => folder.id === state.collection),
  getCorpus: labCorpus,
  call: async (payload, signal, update) => readResearch(await fetch('/api/lab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal }), update),
  renderMarkdown: markdown,
  showPdf: jumpToEvidence,
  handoff: handoffToArs,
  canRun: aiAvailable,
  openSettings,
  download: downloadFile,
  notify: toast,
  confirm: confirmAction,
});

async function startResearch(active) {
  const question = state.researchQuestion.trim();
  if (!question || state.research) return;
  if (!state.settings.codex || !state.settings.suiteReady) { await openSettings(); return; }
  const paper = state.includePdf ? state.paper : null;
  const files = state.attachments.slice();
  const controller = new AbortController();
  state.researchError = '';
  state.research = { stage: 'Preparing attachments…', controller };
  showPanel();
  try {
    const inputs = files.map((file) => ({ file, name: file.name }));
    if (paper) {
      const file = paper.sample ? await fetch('/sample.pdf', { signal: controller.signal }).then((res) => res.blob()) : (await db('pdfs', 'get', paper.id))?.blob;
      if (!file) throw new Error('The PDF to attach could not be found.');
      inputs.push({ file, name: paper.filename });
    }
    if (inputs.length > 12 || inputs.reduce((total, { file }) => total + file.size, 0) > 30 * 1024 * 1024) throw new Error('Attach up to 12 files with a combined size of 30 MB.');
    const encoded = await Promise.all(inputs.map(({ file, name }) => encodeFile(file, name)));
    const workflow = active?.workflow || state.workflow;
    const payload = active ? { id: active.id, question, files: encoded } : { workflow, mode: state.mode, question, files: encoded };
    const response = await fetch('/api/research', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    const result = await readResearch(response, (stage) => { state.research.stage = stage; if (state.tab === 'research') showPanel(); });
    const run = active || { id: result.id, title: question.slice(0, 58), workflow, messages: [] };
    run.messages.push({ role: 'user', text: question }, { role: 'assistant', text: result.answer, profile: result.profile });
    run.files = result.files;
    run.updated = Date.now();
    await db('runs', 'put', run);
    state.runs = [run, ...state.runs.filter((value) => value.id !== run.id)];
    state.activeRun = run.id; state.researchQuestion = ''; state.attachments = []; state.includePdf = false;
  } catch (err) { state.researchError = controller.signal.aborted ? 'Stopped the research run.' : err.message; }
  finally { state.research = null; showPanel(); }
}

function renderSettings() {
  const info = state.settings;
  const ready = info.engine === 'api' ? info.apiConfigured : Boolean(info.codex);
  $('#connection').dataset.ready = String(ready);
  $('#connection-label').textContent = ready ? (info.engine === 'api' ? 'OpenAI API key set' : 'Codex CLI detected') : 'Connect AI';
  $('#engine').value = info.engine || 'codex';
  $('#key-info').textContent = info.apiConfigured ? 'A key is set for this session. Leave this blank to keep it.' : 'The key is used only for this session.';
  $('#ars-info').textContent = info.suiteReady ? `ARS-Codex ${info.suiteVersion} installed.` : `Download ${info.suiteVersion || ''} from the upstream repository. Git is required.`;
  $('#install-ars').disabled = Boolean(info.suiteReady);
  $('#install-ars').textContent = info.suiteReady ? 'Installed' : 'Install';
  updateEngineForm();
}

function updateEngineForm() {
  const isApi = $('#engine').value === 'api';
  $('#key-fields').hidden = !isApi;
  $('#engine-info').textContent = isApi ? 'Connect directly to the OpenAI API. Usage is billed separately from ChatGPT.'
    : state.settings.codex ? `Detected ${state.settings.codex}. Paperdesk uses your Codex CLI account for AI requests.`
      : 'Codex CLI was not detected. Install it, run codex login, and restart Paperdesk.';
}

async function refreshSettings() {
  try { state.settings = await api('settings'); renderSettings(); }
  catch (err) { $('#connection-label').textContent = 'Could not check connection'; $('#settings-error').textContent = err.message; }
}

async function openSettings() {
  if (!$('#settings-dialog').open) $('#settings-dialog').showModal();
  $('#settings-error').textContent = '';
  await refreshSettings();
}

function openDetails(paper = state.paper) {
  if (!paper) return;
  state.paperEdit = paper;
  const rows = [['Author', paper.author || 'Unavailable'], ['File', paper.filename], ['Pages', String(paper.pages || '–')]];
  $('#paper-details').replaceChildren(...rows.flatMap(([key, value]) => [make('dt', '', key), make('dd', '', value)]));
  $('#paper-title-edit').value = paper.title;
  const folderSelect = $('#paper-folder-edit');
  folderSelect.replaceChildren(new Option('Unfiled', ''), ...state.folders.map((folder) => new Option(folder.name, folder.id)));
  folderSelect.value = state.folders.some((folder) => folder.id === paper.folderId) ? paper.folderId : '';
  $('#paper-status-edit').value = paper.readingStatus || 'unread';
  $('#paper-tags-edit').value = (paper.tags || []).join(', ');
  $('#paper-note').value = paper.note || '';
  $('#paper-dialog').showModal();
}

function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = make('a'); link.href = url; link.download = filename;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}

async function downloadPaper() {
  const paper = state.paperEdit;
  try {
    const blob = paper.sample ? await fetch('/sample.pdf').then((response) => response.ok ? response.blob() : null) : (await db('pdfs', 'get', paper.id))?.blob;
    if (!blob) throw new Error('The saved PDF could not be found.');
    downloadFile(blob, paper.filename);
  } catch (err) { toast(err.message); }
}

function exportPaper() {
  const paper = state.paperEdit;
  const content = [`# ${paper.title}`];
  if (paper.author) content.push(paper.author);
  if (paper.tags?.length) content.push(`Tags: ${paper.tags.join(', ')}`);
  if (paper.note) content.push(`## Notes\n\n${paper.note}`);
  if (paper.bookmarks?.length) content.push(`## Bookmarks\n\n${paper.bookmarks.map((page) => `- PDF p. ${page}`).join('\n')}`);
  if (paper.clips?.length) content.push(`## Excerpts\n\n${paper.clips.map((clip) => `### PDF p. ${clip.page}\n\n${clip.text.replace(/^/gm, '> ')}`).join('\n\n')}`);
  if (paper.analysis) content.push(`## In-depth analysis\n\n${messageText(paper.analysis)}`);
  if (paper.messages.length) content.push(`## Chat\n\n${paper.messages.map((entry) => `### ${entry.role === 'user' ? 'Question' : 'GPT answer'}\n\n${messageText(entry)}`).join('\n\n')}`);
  downloadFile(new Blob([content.join('\n\n') + '\n'], { type: 'text/markdown;charset=utf-8' }), paper.filename.replace(/\.pdf$/i, '') + '.md');
}

async function toggleBookmark() {
  if (!state.pdf) return;
  const paper = state.paper, page = state.page;
  const pages = paper.bookmarks || [];
  const has = pages.includes(page);
  const bookmarks = (has ? pages.filter((value) => value !== page) : [...pages, page]).sort((a, b) => a - b);
  try { await savePaperFields(paper, { bookmarks }, false); updateReaderControls(); toast(has ? 'Removed the bookmark.' : `Bookmarked PDF p. ${page}.`); }
  catch (err) { toast(err.message); }
}

async function clipSelection() {
  const paper = state.paper, selection = state.pendingSelection;
  if (!paper || !selection) return;
  if (paper.clips?.some((clip) => clip.page === selection.page && clip.text === selection.text)) { toast('This excerpt is already saved.'); return; }
  try {
    await savePaperFields(paper, { clips: [...(paper.clips || []), { ...selection, id: crypto.randomUUID() }] }, false);
    window.getSelection()?.removeAllRanges(); toast('Saved the excerpt.');
  } catch (err) { toast(err.message); }
}

function showReaderTools() {
  const host = $('#saved-reader-items'), paper = state.paper;
  if (!paper || !state.pdf) return;
  host.replaceChildren();
  function addItem(page, text, remove) {
    const row = make('div', 'saved-reader-row');
    const go = make('button', 'citation', `p. ${page}`); go.type = 'button';
    go.addEventListener('click', () => { $('#reader-tools').close(); jump(page); });
    row.append(go);
    if (text) row.append(make('span', 'saved-reader-quote', text));
    row.append(iconButton('close', 'Remove saved item', async () => {
      try { await savePaperFields(paper, remove(), false); updateReaderControls(); showReaderTools(); }
      catch (err) { toast(err.message); }
    }));
    host.append(row);
  }
  host.append(make('h3', 'field-label', 'Bookmarks'));
  for (const page of paper.bookmarks || []) addItem(page, '', () => ({ bookmarks: paper.bookmarks.filter((value) => value !== page) }));
  if (!paper.bookmarks?.length) host.append(make('p', 'muted', 'Use the bookmark button above the PDF to save a page.'));
  host.append(make('h3', 'field-label', 'Excerpts'));
  for (const clip of paper.clips || []) addItem(clip.page, clip.text, () => ({ clips: paper.clips.filter((value) => value.id !== clip.id) }));
  if (!paper.clips?.length) host.append(make('p', 'muted', 'Select a passage in the PDF to save it.'));
}

function shiftZoom(amount) {
  state.zoom = amount ? Math.min(2.2, Math.max(0.5, Math.round((state.zoom + amount) * 10) / 10)) : 1;
  if (state.paper) savePaperFields(state.paper, { zoom: state.zoom }, false).catch((err) => toast(err.message));
  draw(false);
}

function focusLibrarySearch() { $('#find').focus(); $('#find').select(); }

const splitter = $('#panel-splitter'), workspace = $('#workspace');
function setPanelWidth(width) {
  const capped = Math.round(Math.max(285, Math.min(width, 620, innerWidth * (innerWidth <= 1100 ? 0.4 : 0.43))));
  workspace.style.setProperty('--assistant-width', `${capped}px`);
  splitter.setAttribute('aria-valuenow', String(capped));
  localStorage.setItem('paperdesk-assistant-width', capped);
}

const savedPanelWidth = Number(localStorage.getItem('paperdesk-assistant-width'));
if (savedPanelWidth && innerWidth > 810) setPanelWidth(savedPanelWidth);
splitter.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); splitter.setPointerCapture(event.pointerId); workspace.classList.add('is-resizing');
});
splitter.addEventListener('pointermove', (event) => {
  if (splitter.hasPointerCapture(event.pointerId)) setPanelWidth(innerWidth - event.clientX);
});
splitter.addEventListener('lostpointercapture', () => workspace.classList.remove('is-resizing'));
splitter.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  setPanelWidth($('#assistant-panel').clientWidth + (event.key === 'ArrowLeft' ? 24 : -24));
});

$('#import').addEventListener('click', () => $('#paper-files').click());
$('#paper-files').addEventListener('change', (event) => { importFiles([...event.target.files]); event.target.value = ''; });
$('#find-open').addEventListener('click', focusLibrarySearch);
$('#find').addEventListener('input', showLibrary);
$('#paper-sort').addEventListener('change', (event) => { localStorage.setItem('paperdesk-sort', event.target.value); showLibrary(); });
$('#folder-add').addEventListener('click', () => editFolder());
$('#previous').addEventListener('click', () => jump(state.page - 1));
$('#next').addEventListener('click', () => jump(state.page + 1));
$('#page-number').addEventListener('change', (event) => jump(event.target.value));
$('#zoom-in').addEventListener('click', () => shiftZoom(0.15));
$('#zoom-out').addEventListener('click', () => shiftZoom(-0.15));
$('#zoom-reset').addEventListener('click', () => shiftZoom(0));
$('#focus').addEventListener('click', () => { const on = $('#workspace').classList.toggle('focus'); $('#focus').setAttribute('aria-pressed', String(on)); });
$('#document-info').addEventListener('click', () => openDetails());
$('#pdf-find-open').addEventListener('click', openPdfFind);
$('#pdf-find-close').addEventListener('click', closePdfFind);
$('#pdf-query').addEventListener('input', searchPdf);
$('#pdf-find-form').addEventListener('submit', (event) => { event.preventDefault(); findNext(1); });
$('#find-prev').addEventListener('click', () => findNext(-1));
$('#find-next').addEventListener('click', () => findNext(1));
$('#bookmark-toggle').addEventListener('click', toggleBookmark);
$('#reader-tools-open').addEventListener('click', () => { showReaderTools(); $('#reader-tools').showModal(); });
$('#paper-download').addEventListener('click', downloadPaper);
$('#paper-export').addEventListener('click', exportPaper);
$('#paper-trash').addEventListener('click', () => { $('#paper-dialog').close(); moveToTrash(state.paperEdit); });
$('#chat-stop').addEventListener('click', () => state.chat?.controller.abort());
$('#workflows-open').addEventListener('click', () => { $('#workspace').classList.remove('focus'); $('#focus').setAttribute('aria-pressed', 'false'); setTab('research'); });
$('#lab-open').addEventListener('click', () => { $('#workspace').classList.remove('focus'); $('#focus').setAttribute('aria-pressed', 'false'); setTab('lab'); });
$('#settings-open').addEventListener('click', openSettings);
$('#connection').addEventListener('click', openSettings);
$('#engine').addEventListener('change', updateEngineForm);
$$('[data-close]').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
$$('[data-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.tab)));

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('settings', { engine: $('#engine').value, key: $('#key').value });
    $('#key').value = ''; $('#settings-dialog').close(); await refreshSettings(); showPanel();
  } catch (err) { $('#settings-error').textContent = err.message; }
});
$('#install-ars').addEventListener('click', async () => {
  $('#install-ars').disabled = true; $('#install-ars').textContent = 'Installing…'; $('#settings-error').textContent = '';
  try { await api('install', {}); await refreshSettings(); showPanel(); }
  catch (err) { $('#settings-error').textContent = err.message; $('#install-ars').disabled = false; $('#install-ars').textContent = 'Retry'; }
});
$('#notes-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const paper = state.paperEdit;
  if (!paper) return;
  const title = $('#paper-title-edit').value.trim();
  if (!title) { $('#paper-title-edit').focus(); return; }
  const tags = [...new Set($('#paper-tags-edit').value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
  try {
    await savePaperFields(paper, { title, tags, note: $('#paper-note').value, folderId: $('#paper-folder-edit').value, readingStatus: $('#paper-status-edit').value });
    if (state.paper === paper) $('#reading-title').textContent = title;
    $('#paper-dialog').close(); toast('Saved the paper details.');
  }
  catch (err) { toast(err.message); }
});
$('#folder-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('#folder-name').value.trim();
  const existing = state.folderEdit;
  const searchName = name.normalize('NFKC').toLocaleLowerCase();
  if (!name || [...state.folders, ...shelfViews].some((folder) => folder.id !== existing?.id && folder.name.normalize('NFKC').toLocaleLowerCase() === searchName)) {
    $('#folder-error').textContent = name ? 'This name is already in use.' : 'Enter a folder name.'; return;
  }
  try {
    const folder = { id: existing?.id || crypto.randomUUID(), name };
    await db('folders', 'put', folder);
    state.folders = [...state.folders.filter((entry) => entry.id !== folder.id), folder];
    $('#folder-dialog').close(); setCollection(folder.id);
  } catch (err) { $('#folder-error').textContent = err.message; }
});
$('#folder-delete').addEventListener('click', async () => {
  const folder = state.folderEdit;
  if (!folder || !await confirmAction('Delete this folder?', 'Papers in the folder will move to Unfiled. Their PDFs, notes, and chats will remain available.')) return;
  try {
    await removeFolder(folder.id);
    for (const paper of state.papers) if (paper.folderId === folder.id) paper.folderId = '';
    state.folders = state.folders.filter((entry) => entry.id !== folder.id);
    $('#folder-dialog').close(); setCollection(state.collection === folder.id ? 'all' : state.collection);
    toast('Deleted the folder.');
  } catch (err) { $('#folder-error').textContent = err.message; }
});
$('#chat-form').addEventListener('submit', (event) => { event.preventDefault(); ask($('#question').value); });
$('#question').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); }
});
$('#clear-selection').addEventListener('click', () => { state.selection = null; showSelection(); });
document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  state.pendingSelection = text && $('#pdf-view').contains(selection.anchorNode) && $('#pdf-view').contains(selection.focusNode)
    ? { text: text.slice(0, 2500), page: state.page } : null;
  $('#selection-actions').hidden = !state.pendingSelection;
});
$('#selection-actions').addEventListener('mousedown', (event) => event.preventDefault());
$('#clip-selection').addEventListener('click', clipSelection);
$('#ask-selection').addEventListener('click', () => {
  state.selection = state.pendingSelection;
  $('#workspace').classList.remove('focus'); $('#focus').setAttribute('aria-pressed', 'false');
  setTab('chat'); showSelection(); $('#question').focus();
});
document.addEventListener('keydown', (event) => {
  if ($('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === 'k') { event.preventDefault(); focusLibrarySearch(); }
  if ((event.ctrlKey || event.metaKey) && key === 'f' && state.pdf) { event.preventDefault(); openPdfFind(); }
  if (key === 'escape' && !$('#pdf-find-form').hidden) closePdfFind();
});
document.addEventListener('dragover', (event) => {
  if (![...event.dataTransfer.types].includes('Files')) return;
  event.preventDefault(); document.body.classList.add('file-drag');
});
document.addEventListener('dragleave', (event) => { if (!event.relatedTarget) document.body.classList.remove('file-drag'); });
document.addEventListener('drop', (event) => {
  document.body.classList.remove('file-drag');
  if (event.dataTransfer.files.length) { event.preventDefault(); if (!$('dialog[open]')) importFiles([...event.dataTransfer.files]); }
});
let scrollTimer;
$('#pdf-view').addEventListener('scroll', () => {
  if (!state.pdf) return;
  const paper = state.paper, page = state.page, top = $('#pdf-view').scrollTop;
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    if (paper.page && paper.page !== page || paper.trashedAt) return;
    savePaperFields(paper, { page, scrollTop: top }, false).catch((err) => toast(err.message));
  }, 200);
});
let width = 0;
new ResizeObserver(([entry]) => { if (Math.abs(width - entry.contentRect.width) > 1) { width = entry.contentRect.width; draw(false); } }).observe($('#pdf-view'));

async function boot() {
  try {
    const [papers, runs, folders] = await Promise.all([db('papers', 'getAll'), db('runs', 'getAll'), db('folders', 'getAll'), lab.load()]);
    state.papers = papers.filter((value) => !value.sample).sort((a, b) => b.added - a.added);
    const existingSample = papers.find((value) => value.id === sampleId);
    if (!existingSample?.hidden) state.papers.push(existingSample || sample);
    state.folders = folders;
    if (![...shelfViews, ...folders].some((entry) => entry.id === state.collection)) state.collection = 'all';
    $('#paper-sort').value = localStorage.getItem('paperdesk-sort') || 'added';
    state.runs = runs.sort((a, b) => b.updated - a.updated);
    const last = localStorage.getItem('paperdesk-current');
    await openPaper(state.papers.find((value) => value.id === last && !value.trashedAt) || state.papers.find((value) => !value.trashedAt));
  } catch (err) { toast(`Could not open storage. ${err.message || ''}`); }
}

await Promise.all([boot(), refreshSettings()]);
