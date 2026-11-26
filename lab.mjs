import { labModes, citationPattern, readMarkdownTable } from './lab-modes.mjs';
import { modelLabel, routeLab } from './model-routing.mjs';
import { db } from './store.mjs';

const modeDefaults = { mode: 'strategy', question: '', manuscript: '', seed: '', since: '', sourceReport: '', outlineReport: '', strategyReport: '', verify: false };
const modeById = (id) => labModes.find((mode) => mode.id === id);
const timeLabel = (date) => new Date(date).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
const safeLine = (value) => String(value || '').replace(/[\r\n]+/g, ' ');

function element(tag, className = '', text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, run, primary = false) {
  const node = element('button', primary ? 'primary-button' : 'small-button', label);
  node.type = 'button'; node.addEventListener('click', run);
  return node;
}

function sourceLink(record) {
  const label = `${record.id ? `${record.id} · ` : ''}${record.title || record.doi}`;
  if (!record.url) return element('strong', '', label);
  const link = element('a', '', label); link.href = record.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  return link;
}

function metadata(record) {
  return [record.authors?.slice(0, 3).join(', '), record.year, record.venue, record.doi && `DOI ${record.doi}`].filter(Boolean).join(' · ');
}

const sourceText = (source) => source.kind === 'pdf' ? `${source.document} · ${source.title} · PDF p. ${source.page}` : `${source.id} · ${source.title} (${source.year || 'year unknown'})`;
const retained = (report) => (report?.records || []).filter((record) => !report.keptIds || report.keptIds.includes(record.id));
const strategyStages = [['design', 'Hypotheses and study design'], ['review', 'Methodological review']];

function profileLabel(profile = {}) {
  return [modelLabel(profile) || 'Connection default model', profile.engine === 'api' ? 'OpenAI API' : 'Codex'].join(' · ');
}

function withSources(text, report) {
  return text?.replace(citationPattern, (_token, id) => report.evidence[id] ? `(${sourceText(report.evidence[id])})` : '[Unverified source]') || '';
}

export function reportMarkdown(report) {
  const answer = withSources(report.answer, report);
  const lines = [`# ${modeById(report.mode).label}`, `Run time: ${report.timestamp}`, report.question, answer];
  if (report.profile) lines.push(`Model: ${profileLabel(report.profile)}`);
  if (report.strategy) {
    lines.push(`## Research strategy run\n\n${profileLabel(report.strategy.profile)} · ${report.strategy.status === 'complete' ? 'All three stages complete' : 'Partially complete'}`);
    for (const [key, title] of strategyStages) {
      if (report.strategy[key]) lines.push(`### ${title}\n\n${withSources(report.strategy[key], report)}`);
    }
  }
  if (report.reviewer?.findings) lines.push(`## First reviewer findings\n\n${withSources(report.reviewer.findings, report)}`);
  if (report.verification) lines.push(`## GPT evidence check\n\n${withSources(report.verification, report)}`);
  if (report.documents?.length) lines.push(`## Analysis scope\n${report.documents.map((doc) => `- ${doc.document}: ${safeLine(doc.title)} (${doc.passages} excerpts)`).join('\n')}`);
  if (report.notices?.length) lines.push(`## Items to verify\n${report.notices.map((notice) => `- ${notice}`).join('\n')}`);
  if (report.log?.length) lines.push(`## Search log${report.since ? ` (since ${report.since})` : ''}\n${report.log.map((entry) => `- ${entry.provider} | ${entry.query} | ${entry.error || `${entry.count} results`}`).join('\n')}`);
  if (report.records?.length) lines.push(`## Retrieved literature\n${report.records.map((record) => `- ${record.id} ${record.title}. ${metadata(record)}. ${record.url}`).join('\n')}`);
  if (report.keptIds) lines.push(`Papers selected for the next step: ${report.keptIds.join(', ') || 'none'}`);
  if (report.audit?.length) lines.push(`## DOI lookup results\n${report.audit.map((record) => `- ${record.doi}: ${record.status}${record.title ? ` · ${record.title} · ${metadata(record)} · ${record.url}` : ''}`).join('\n')}`);
  const excerpts = Object.values(report.evidence).filter((source) => source.kind === 'pdf');
  if (excerpts.length) lines.push(`## Cited PDF excerpts\n${excerpts.map((source) => `### ${sourceText(source)}\n\n${source.text.replace(/^/gm, '> ')}`).join('\n\n')}`);
  return lines.filter(Boolean).join('\n\n') + '\n';
}

function reportCsv(report) {
  if (!['extract', 'compare'].includes(report.mode) || !report.answer) return '';
  const lines = report.answer.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const table = readMarkdownTable(lines, index);
    if (!table?.rows.length) continue;
    const csvCell = (value) => {
      const text = withSources(value, report).trim();
      const guarded = /^[=+@\-]/.test(text) ? `'${text}` : text;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const grid = [table.headers, ...table.rows.map((row) => table.headers.map((_, i) => row[i] || ''))];
    return '\uFEFF' + grid.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  return '';
}

function literatureRis(report) {
  const entries = report.records?.length ? retained(report) : (report.audit || []).filter((record) => record.title && record.url);
  return entries.map((record) => {
    const kind = /journal.article|journal article/i.test(record.type || '') ? 'JOUR' : 'GEN';
    return [`TY  - ${kind}`, `TI  - ${safeLine(record.title)}`, ...record.authors.map((author) => `AU  - ${safeLine(author)}`),
      record.year && `PY  - ${safeLine(record.year)}`, record.venue && `JO  - ${safeLine(record.venue)}`,
      record.doi && `DO  - ${safeLine(record.doi)}`, `UR  - ${record.url}`, 'ER  -'].filter(Boolean).join('\r\n');
  }).join('\r\n\r\n') + '\r\n';
}

export function createLab({ getPapers, getCurrent, getFolder, getCorpus, call, renderMarkdown, showPdf, handoff, canRun, openSettings, download, notify, confirm }) {
  const input = { ...modeDefaults, documents: new Set() };
  let archive = [], active = null, running = null, error = '', host, initialized = false;

  async function load() { archive = (await db('lab', 'getAll')).sort((a, b) => b.timestamp.localeCompare(a.timestamp)); }

  function selectMode(mode, paper) {
    if (running) return;
    active = null; error = '';
    input.mode = mode || input.mode;
    if (paper && !paper.trashedAt) input.documents.add(paper.id);
  }

  function startFrom(report, mode) {
    Object.assign(input, {
      mode, sourceReport: retained(report).length ? report.id : '', outlineReport: mode === 'draft' && report.mode === 'outline' ? report.id : '',
      strategyReport: mode === 'strategy' && report.strategy?.status === 'complete' ? report.id : '', seed: mode === 'strategy' ? '' : report.seed || '', since: report.since || '', question: '',
    });
    input.documents = new Set(report.documents?.map((document) => document.paperId) || []);
    active = null; error = ''; render();
    host.querySelector('#lab-question')?.focus();
  }

  const openPdfSource = (source) => showPdf(source.paperId, source.page);

  function showSource(source) {
    const node = element('div', 'lab-source');
    if (source.kind === 'pdf') {
      node.append(button(sourceText(source), () => openPdfSource(source)), element('p', 'muted', source.text));
      return node;
    }
    if (source.id) node.id = `lab-source-${source.id}`;
    node.append(sourceLink(source), element('p', 'muted', metadata(source)));
    if (source.providers?.length) node.append(element('p', 'lab-source-level', `${source.abstract ? 'Abstract' : 'Metadata'} · ${source.providers.join(' / ')}`));
    if (source.notice) node.append(element('p', 'form-error', `Publication record: ${source.notice}`));
    if (source.abstract) {
      const detail = element('details', 'lab-detail'); detail.append(element('summary', '', 'Show abstract'), element('p', 'muted', source.abstract)); node.append(detail);
    }
    return node;
  }

  function showReport(report) {
    const container = element('section', 'panel-card lab-report');
    const mode = modeById(report.mode);
    const head = element('div', 'run-head');
    head.append(element('h3', 'panel-title', mode.label), button('New run', () => { active = null; error = ''; render(); }));
    container.append(head, element('p', 'muted', timeLabel(report.timestamp)));
    const profile = report.profile || report.strategy?.profile;
    if (profile) {
      const status = report.strategy ? (report.strategy.status === 'complete' ? 'All three stages complete' : 'Review incomplete') : report.reviewer ? (report.reviewer.status === 'complete' ? 'Review and decision complete' : 'Editorial decision incomplete') : '';
      container.append(element('p', 'strategy-profile', [profileLabel(profile), status].filter(Boolean).join(' · ')));
    }
    if (report.question) container.append(element('p', 'lab-request', report.question));
    if (report.notices?.length) {
      const notices = element('ul', 'lab-notices');
      for (const notice of report.notices) notices.append(element('li', '', notice));
      container.append(notices);
    }
    const openSource = (source) => {
      if (source.kind === 'pdf') openPdfSource(source);
      else {
        const target = document.getElementById(`lab-source-${source.id}`);
        if (target) { target.querySelector('details')?.setAttribute('open', ''); target.scrollIntoView({ block: 'nearest' }); }
      }
    };
    if (report.answer) {
      const answer = element('div', 'message lab-answer');
      renderMarkdown(answer, report.answer, report.evidence, openSource); container.append(answer);
    }
    if (report.strategy) {
      for (const [key, title] of strategyStages) {
        if (!report.strategy[key]) continue;
        const stage = element('details', 'lab-detail');
        const content = element('div', 'message lab-answer');
        renderMarkdown(content, report.strategy[key], report.evidence, openSource);
        stage.append(element('summary', '', title), content); container.append(stage);
      }
    }
    if (report.reviewer?.findings) {
      const review = element('details', 'lab-detail');
      const content = element('div', 'message lab-answer'); renderMarkdown(content, report.reviewer.findings, report.evidence, openSource);
      review.append(element('summary', '', 'Detailed first reviewer findings'), content); container.append(review);
    }
    if (report.verification) {
      const detail = element('details', 'lab-detail'); detail.open = true;
      const audit = element('div', 'message lab-answer');
      renderMarkdown(audit, report.verification, report.evidence, openSource);
      detail.append(element('summary', '', 'GPT evidence check'), audit); container.append(detail);
    }
    if (report.documents?.length) {
      const scope = element('details', 'lab-detail'); scope.append(element('summary', '', `PDFs analyzed (${report.documents.length})`));
      for (const doc of report.documents) scope.append(element('p', 'muted', `${doc.document} · ${doc.title} · ${doc.passages} excerpts`));
      const cited = Object.values(report.evidence).filter((source) => source.kind === 'pdf');
      for (const source of cited) scope.append(showSource(source));
      container.append(scope);
    }
    if (report.log?.length) {
      const log = element('details', 'lab-detail'); log.append(element('summary', '', `Search log (${report.log.length})${report.since ? ` · since ${report.since}` : ''}`));
      for (const entry of report.log) log.append(element('p', 'muted', `${entry.provider} · ${entry.query} · ${entry.error || `${entry.count} results`}`));
      container.append(log);
    }
    if (report.records?.length) {
      container.append(element('h3', 'field-label', `Retrieved papers (${report.records.length})`));
      container.append(element('p', 'muted', 'Select papers for the next outline, draft, or RIS export.'));
      for (const record of report.records) {
        const row = showSource(record), choice = element('label', 'lab-paper-choice');
        const check = element('input'); check.type = 'checkbox'; check.checked = retained(report).some((item) => item.id === record.id);
        check.addEventListener('change', async () => {
          const before = report.keptIds;
          const list = new Set(retained(report).map((item) => item.id));
          if (check.checked) list.add(record.id); else list.delete(record.id);
          const next = [...list]; report.keptIds = next;
          try { await db('lab', 'put', report); }
          catch (err) { if (report.keptIds === next) report.keptIds = before; check.checked = retained(report).some((item) => item.id === record.id); notify(err.message); }
        });
        choice.append(check, element('span', '', 'Keep for next step')); row.append(choice); container.append(row);
      }
    }
    if (report.audit?.length) {
      container.append(element('h3', 'field-label', 'DOI lookup results'), element('p', 'muted', 'This checks DOI registration and metadata. Read the underlying paper to verify whether it supports a claim.'));
      for (const record of report.audit) {
        const row = showSource(record); row.append(element('p', 'lab-source-level', record.status)); container.append(row);
      }
    }
    const actions = element('div', 'research-actions lab-output-actions');
    const filename = `paperdesk-${report.mode}-${report.timestamp.slice(0, 10)}`;
    actions.append(button('Save Markdown', () => download(new Blob([reportMarkdown(report)], { type: 'text/markdown;charset=utf-8' }), `${filename}.md`)));
    const csv = reportCsv(report);
    if (csv) actions.append(button('Save extraction CSV', () => download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${filename}.csv`)));
    if (report.records?.length || report.audit?.some((entry) => entry.title && entry.url)) actions.append(button('Save RIS', () => {
      if (report.records?.length && !retained(report).length) { notify('Select at least one paper to include.'); return; }
      download(new Blob([literatureRis(report)], { type: 'application/x-research-info-systems;charset=utf-8' }), `${filename}.ris`);
    }));
    if (report.mode !== 'doi' && (report.records?.length || report.documents?.length)) actions.append(button('Build outline from these sources', () => startFrom(report, 'outline')));
    if (report.mode === 'outline') actions.append(button('Draft from this outline', () => startFrom(report, 'draft')));
    if (report.strategy?.status === 'complete') actions.append(button('Plan the next research step', () => startFrom(report, 'strategy')));
    actions.append(button('Continue in ARS', () => handoff(mode.handoff, reportMarkdown(report), filename, report.question)));
    container.append(actions);
    return container;
  }

  function showForm() {
    const form = element('form', 'panel-card research-form lab-form');
    form.append(element('h3', 'panel-title', 'Research Lab'));
    const selector = element('select'); selector.id = 'lab-mode'; selector.setAttribute('aria-label', 'Research Lab mode');
    for (const group of [...new Set(labModes.map((mode) => mode.group))]) {
      const options = element('optgroup'); options.label = group;
      for (const mode of labModes.filter((entry) => entry.group === group)) options.append(new Option(mode.label, mode.id));
      selector.append(options);
    }
    const mode = modeById(input.mode);
    selector.value = mode.id; selector.disabled = Boolean(running);
    selector.addEventListener('change', () => { input.mode = selector.value; error = ''; render(); host.querySelector('#lab-mode')?.focus(); });
    form.append(selector, element('p', 'muted', mode.guide));
    const route = routeLab(mode.id);
    if (route) form.append(element('p', 'strategy-profile lab-model-label', modelLabel(route)));
    const label = element('label', 'field-label', mode.id === 'doi' ? 'DOIs or references to verify' : mode.id === 'strategy' ? 'Research goal and current obstacle' : 'Research request'); label.htmlFor = 'lab-question';
    const question = element('textarea'); question.id = 'lab-question'; question.maxLength = 18_000; question.value = input.question; question.disabled = Boolean(running);
    question.placeholder = mode.id === 'doi' ? 'Paste references that include DOIs' : mode.id === 'strategy' ? 'Describe your goal, available data, and time or budget constraints.' : mode.id === 'reviewer' ? 'For example, review the methods and novelty. Include a target journal if applicable.' : 'For example, compare tumor-size adjustment and external validation';
    question.addEventListener('input', () => { input.question = question.value; });
    form.append(label, question);
    if (mode.id === 'reviewer') {
      const heading = element('label', 'field-label', 'Paste manuscript (optional)'); heading.htmlFor = 'lab-manuscript';
      const manuscript = element('textarea'); manuscript.id = 'lab-manuscript'; manuscript.maxLength = 32_000;
      manuscript.value = input.manuscript; manuscript.disabled = Boolean(running); manuscript.placeholder = 'Paste the manuscript or section to review if you do not have a PDF.';
      manuscript.addEventListener('input', () => { input.manuscript = manuscript.value; });
      form.append(heading, manuscript, element('p', 'field-help', 'GPT runs separately for reviewer feedback and the editorial decision.'));
    }
    if (mode.id === 'draft' && archive.some((report) => report.id === input.outlineReport)) {
      const previous = element('div', 'research-actions');
      previous.append(element('p', 'muted', 'Previous IMRaD outline attached'), button('Detach outline', () => { input.outlineReport = ''; render(); }));
      previous.querySelector('button').disabled = Boolean(running);
      form.append(previous);
    }
    if (mode.id === 'strategy') {
      form.append(element('p', 'field-help', 'GPT runs separately for hypothesis design, methodological review, and final planning.'));
      if (archive.some((report) => report.id === input.strategyReport)) {
        const previous = element('div', 'research-actions');
        const detach = button('Detach plan', () => { input.strategyReport = ''; render(); }); detach.disabled = Boolean(running);
        previous.append(element('p', 'muted', 'Previous strategy plan attached'), detach); form.append(previous);
      }
    }
    if (mode.id === 'hyper' || mode.id === 'strategy') {
      const fields = element('div', 'lab-search-fields');
      for (const [key, labelText, limit, hint] of [['seed', mode.id === 'strategy' ? 'Public query (optional)' : 'Public query', 220, 'e.g. CT texture recurrence'], ['since', 'Start year (optional)', 4, '2022']]) {
        const fieldLabel = element('label', 'field-label', labelText);
        const field = element('input'); field.maxLength = limit; field.value = input[key]; field.placeholder = hint; field.disabled = Boolean(running);
        if (key === 'since') { field.inputMode = 'numeric'; field.pattern = '\\d{4}'; } else field.required = mode.id === 'hyper';
        field.addEventListener('input', () => { input[key] = field.value; }); fieldLabel.append(field); fields.append(fieldLabel);
      }
      form.append(fields, element('p', 'field-help', 'Europe PMC and Crossref receive the public query and any expanded queries.'));
    }
    if (mode.id !== 'doi') {
      const picker = element('details', 'lab-picker'); picker.open = true;
      const papers = getPapers().filter((paper) => !paper.trashedAt);
      const count = element('summary', '', `PDFs to analyze · ${papers.filter((paper) => input.documents.has(paper.id)).length} selected`); picker.append(count);
      const actions = element('div', 'research-actions');
      actions.append(button('Current PDF', () => { const current = getCurrent(); if (current) input.documents = new Set([current.id]); render(); }), button('Current folder', () => { const folder = getFolder(); if (folder) input.documents = new Set(papers.filter((paper) => paper.folderId === folder.id).slice(0, 6).map((paper) => paper.id)); render(); }), button('Clear selection', () => { input.documents.clear(); render(); }));
      actions.querySelectorAll('button').forEach((control, index) => { control.disabled = Boolean(running) || (index === 0 && !getCurrent()) || (index === 1 && !getFolder()); });
      picker.append(actions);
      const list = element('div', 'lab-paper-list');
      for (const paper of papers) {
        const choice = element('label', 'lab-paper-choice'); const check = element('input');
        check.type = 'checkbox'; check.checked = input.documents.has(paper.id); check.disabled = Boolean(running);
        check.addEventListener('change', () => {
          if (check.checked && input.documents.size >= 6) { check.checked = false; notify('Select up to six PDFs per run.'); return; }
          if (check.checked) input.documents.add(paper.id); else input.documents.delete(paper.id);
          count.textContent = `PDFs to analyze · ${papers.filter((item) => input.documents.has(item.id)).length} selected`;
        });
        choice.append(check, element('span', '', paper.title)); list.append(choice);
      }
      picker.append(list);
      form.append(picker);
      if (mode.id !== 'hyper' && archive.some((report) => retained(report).length)) {
        const reference = element('label', 'field-label', 'Include previously retrieved literature'); const sources = element('select');
        sources.append(new Option('None', ''));
        for (const report of archive.filter((entry) => retained(entry).length).slice(0, 25)) sources.append(new Option((report.seed || report.question || modeById(report.mode).label).slice(0, 80), report.id));
        sources.value = input.sourceReport; sources.disabled = Boolean(running);
        sources.addEventListener('change', () => { input.sourceReport = sources.value; }); reference.append(sources); form.append(reference);
      }
      const checkLabel = element('label', 'lab-paper-choice'); const check = element('input'); check.type = 'checkbox'; check.checked = input.verify; check.disabled = Boolean(running);
      check.addEventListener('change', () => { input.verify = check.checked; });
      checkLabel.append(check, element('span', '', 'Check claims against citations · one extra GPT request')); form.append(checkLabel);
    }
    const controls = element('div', 'research-actions'); const submit = element('button', 'primary-button', 'Run'); submit.type = 'submit'; submit.disabled = Boolean(running); controls.append(submit);
    if (running) controls.append(button('Stop', () => running.controller.abort()));
    form.append(controls);
    if (running) form.append(element('p', 'lab-progress', running.progress));
    if (error) form.append(element('p', 'form-error', error));
    form.addEventListener('submit', (event) => { event.preventDefault(); run(mode); });
    return form;
  }

  function render(destination = host) {
    if (!destination) return;
    host = destination;
    if (!initialized) { initialized = true; const paper = getCurrent(); if (paper) input.documents.add(paper.id); }
    const scroll = host.scrollTop;
    host.replaceChildren(active ? showReport(active) : showForm());
    if (archive.length) {
      const prior = element('section', 'panel-card'); prior.append(element('h3', 'panel-title', 'Recent Research Lab reports'));
      for (const entry of archive.slice(0, 15)) {
        const row = element('div', 'lab-archive-row');
        const label = `${modeById(entry.mode)?.label || entry.mode} · ${safeLine(entry.question || entry.seed || timeLabel(entry.timestamp)).slice(0, 64)}`;
        const open = button(label, () => { active = entry; render(); host.scrollTop = 0; }); open.disabled = Boolean(running);
        const remove = button('Delete', async () => {
          if (!await confirm('Delete this Research Lab report?', 'The saved analysis and search log will be deleted.')) return;
          try { await db('lab', 'delete', entry.id); archive = archive.filter((item) => item !== entry); if (active === entry) active = null; render(); }
          catch (err) { notify(err.message); }
        }); remove.disabled = Boolean(running);
        row.append(open, remove); prior.append(row);
      }
      host.append(prior);
    }
    host.scrollTop = scroll;
  }

  async function run(mode) {
    if (running) return;
    if (mode.id !== 'doi' && !canRun()) { await openSettings(); return; }
    const question = input.question.trim(), seed = input.seed.trim(), since = input.since.trim();
    const selected = getPapers().filter((paper) => input.documents.has(paper.id) && !paper.trashedAt).slice(0, 6);
    if (selected.length < mode.minimum) { error = `Select at least ${mode.minimum} PDFs.`; render(); return; }
    if (mode.id === 'hyper' && seed.length < 3) { error = 'Enter a public query to search the literature.'; render(); return; }
    const manuscript = mode.id === 'reviewer' ? input.manuscript.trim() : '';
    if (mode.id === 'reviewer' && !selected.length && !manuscript) { error = 'Select a PDF or paste a manuscript to review.'; render(); return; }
    const controller = new AbortController(); running = { controller, progress: 'Finding evidence in your selected sources…' }; error = ''; render();
    try {
      const { documents, exclusions } = mode.id === 'doi' ? { documents: [], exclusions: [] } : await getCorpus(selected, `${question.slice(0, 1200)} ${['hyper', 'strategy'].includes(mode.id) ? seed : ''} ${mode.task}`, controller.signal);
      const previousReport = archive.find((report) => report.id === input.sourceReport);
      const previousRecords = ['hyper', 'doi'].includes(mode.id) ? [] : retained(previousReport);
      const outline = mode.id === 'draft' && archive.find((report) => report.id === input.outlineReport);
      const previousStrategy = mode.id === 'strategy' && archive.find((report) => report.id === input.strategyReport);
      const result = await call({ mode: mode.id, question, manuscript, documents, exclusions, seed, since, previousRecords, previousOutline: outline?.answer?.slice(0, 12_000), previousPlan: previousStrategy?.answer?.slice(0, 14_000), verify: input.verify }, controller.signal, (stage) => {
        running.progress = stage; if (host.querySelector('.lab-progress')) host.querySelector('.lab-progress').textContent = stage;
      });
      const report = { ...result, id: crypto.randomUUID() };
      await db('lab', 'put', report); archive.unshift(report); active = report;
    } catch (err) { error = controller.signal.aborted ? 'Stopped the run.' : err.message; }
    finally { running = null; if (host.querySelector('.lab-form')) { render(); if (active) host.scrollTop = 0; } }
  }

  return { load, render, selectMode };
}
