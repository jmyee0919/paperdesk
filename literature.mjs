import { failure } from './research.mjs';

const crossref = 'https://api.crossref.org/works';
const european = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';
const providerNames = ['Europe PMC', 'Crossref'];

function plain(value, limit = 2800) {
  return String(value || '').replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#x?[\da-f]+);/gi, (entity, code) => {
      const known = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      if (known[code]) return known[code];
      if (!code.startsWith('#')) return entity;
      const hex = code[1].toLowerCase() === 'x';
      const number = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
      return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
    }).replace(/\s+/g, ' ').trim().slice(0, limit);
}

function doiUrl(doi) { return `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`; }

function crossRecord(item) {
  const doi = String(item.DOI || '').toLowerCase();
  return {
    title: plain(item.title?.[0], 450), doi, authors: (item.author || []).slice(0, 30).map((author) => plain(author.name || `${author.given || ''} ${author.family || ''}`, 110)).filter(Boolean),
    year: item.published?.['date-parts']?.[0]?.[0] || item.issued?.['date-parts']?.[0]?.[0] || '',
    venue: plain(item['container-title']?.[0], 200), abstract: plain(item.abstract), url: doi ? doiUrl(doi) : '',
    type: plain(item.type, 120), notice: (item['update-to'] || []).map((entry) => plain(entry.type, 60)).filter(Boolean).join(', '),
  };
}

function europeRecord(item) {
  const doi = String(item.doi || '').toLowerCase();
  const pmid = /^\d+$/.test(item.pmid || '') ? String(item.pmid) : '';
  const pmcid = /^PMC\d+$/.test(item.pmcid || '') ? item.pmcid : '';
  const types = item.pubTypeList?.pubType || [];
  return {
    title: plain(item.title, 450), doi, pmid, pmcid,
    authors: (item.authorList?.author || []).slice(0, 30).map((author) => plain(author.fullName || author.collectiveName, 110)).filter(Boolean),
    year: item.pubYear || '', venue: plain(item.journalInfo?.journal?.title || item.journalTitle, 200),
    abstract: plain(item.abstractText), type: types.join(', ').slice(0, 150), notice: types.filter((entry) => /retract|withdraw|correction/i.test(entry)).join(', '),
    url: doi ? doiUrl(doi) : pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : pmcid ? `https://europepmc.org/articles/${pmcid}` : '',
  };
}

async function getData(url, signal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), redirect: 'error',
    headers: { Accept: 'application/json', 'User-Agent': 'Paperdesk/0.3 (personal academic literature search)' },
  });
  if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
  return response.json();
}

function lookup(provider, query, since, signal) {
  if (provider === 'Europe PMC') {
    const term = since ? `(${query}) AND FIRST_PDATE:[${since}-01-01 TO 3000-12-31]` : query;
    const url = `${european}?${new URLSearchParams({ query: term, format: 'json', resultType: 'core', pageSize: '7' })}`;
    return getData(url, signal).then((data) => {
      if (!Array.isArray(data.resultList?.result)) throw new Error('Unrecognized response format');
      return data.resultList.result.map(europeRecord);
    });
  }
  const params = new URLSearchParams({ query, rows: '7', select: 'DOI,title,author,published,issued,container-title,abstract,type,update-to' });
  if (since) params.set('filter', `from-pub-date:${since}-01-01`);
  return getData(`${crossref}?${params}`, signal).then((data) => {
    if (!Array.isArray(data.message?.items)) throw new Error('Unrecognized response format');
    return data.message.items.map(crossRecord);
  });
}

function normalizedTitle(title) { return title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }

export function mergeLiterature(batches) {
  const records = [];
  for (const { provider, rows } of batches) {
    for (const [index, item] of rows.entries()) {
      if (!item.title || !item.url) continue;
      const titleKey = normalizedTitle(item.title);
      const existing = records.find((record) => {
        if (item.doi && record.doi) return item.doi === record.doi;
        if (item.pmid && record.pmid) return item.pmid === record.pmid;
        return titleKey.length >= 20 && titleKey === record.titleKey && item.year && String(item.year) === String(record.year);
      });
      const weight = 1 / (8 + index);
      if (!existing) { records.push({ ...item, titleKey, score: weight, providers: [provider] }); continue; }
      existing.score += weight;
      if (!existing.providers.includes(provider)) existing.providers.push(provider);
      for (const key of ['doi', 'pmid', 'pmcid', 'venue', 'year', 'type', 'notice']) if (!existing[key]) existing[key] = item[key];
      if (existing.doi) existing.url = doiUrl(existing.doi);
      if (item.abstract.length > existing.abstract.length) existing.abstract = item.abstract;
      if (item.authors.length > existing.authors.length) existing.authors = item.authors;
    }
  }
  return records.sort((a, b) => b.score - a.score || Number(Boolean(b.abstract)) - Number(Boolean(a.abstract)))
    .slice(0, 16).map(({ titleKey, score, ...record }, index) => ({ ...record, kind: 'literature', id: `R${index + 1}` }));
}

export async function searchLiterature(queries, since, signal) {
  const jobs = queries.flatMap((query) => providerNames.map((provider) => ({ provider, query })));
  const results = await Promise.allSettled(jobs.map(({ provider, query }) => lookup(provider, query, since, signal)));
  signal.throwIfAborted();
  const batches = [], log = [];
  for (const [index, result] of results.entries()) {
    const job = jobs[index];
    if (result.status === 'fulfilled') {
      const rows = result.value;
      batches.push({ provider: job.provider, rows }); log.push({ ...job, count: rows.length });
    } else log.push({ ...job, error: result.reason?.status ? `HTTP ${result.reason.status}` : 'Connection or response error' });
  }
  return { records: mergeLiterature(batches), log };
}

export async function auditDois(text, signal) {
  const candidates = text.match(/10\.\d{4,9}\/[^\s<>"']+/gi) || [];
  const dois = [...new Set(candidates.map((value) => {
    let doi = value.toLowerCase().replace(/[.,;\]}]+$/, '');
    while (doi.endsWith(')') && (doi.match(/\)/g) || []).length > (doi.match(/\(/g) || []).length) doi = doi.slice(0, -1);
    return doi;
  }))];
  if (!dois.length) throw failure('Enter at least one DOI to verify. Example: 10.1234/abcd');
  if (dois.length > 24) throw failure('Check up to 24 DOIs per run.');
  const rows = [];
  for (let i = 0; i < dois.length; i += 4) {
    const batch = await Promise.all(dois.slice(i, i + 4).map(async (doi) => {
      try {
        const data = await getData(`${crossref}/${encodeURIComponent(doi)}`, signal);
        const item = crossRecord(data.message || {});
        if (item.doi !== doi) return { doi, status: 'Returned DOI did not match' };
        return { ...item, doi, status: 'Crossref registration confirmed' };
      } catch (err) {
        if (signal.aborted) throw err;
        return { doi, status: err.status === 404 ? 'No Crossref record found' : 'Lookup failed · try again' };
      }
    }));
    rows.push(...batch);
  }
  return rows;
}
