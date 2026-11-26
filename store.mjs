const database = new Promise((resolve, reject) => {
  const request = indexedDB.open('paperdesk', 3);
  request.onupgradeneeded = () => {
    for (const name of ['papers', 'pdfs', 'runs', 'folders', 'lab']) {
      if (!request.result.objectStoreNames.contains(name)) {
        request.result.createObjectStore(name, { keyPath: 'id' });
      }
    }
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Close the other Paperdesk tabs and refresh this tab.'));
});

async function transact(names, mode, open) {
  const handle = await database;
  return new Promise((resolve, reject) => {
    const transaction = handle.transaction(names, mode);
    const request = open(transaction);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onabort = () => reject(transaction.error || new Error('Could not save changes.'));
  });
}

export function db(store, method, value) {
  const mode = ['put', 'delete'].includes(method) ? 'readwrite' : 'readonly';
  return transact([store], mode, (transaction) => transaction.objectStore(store)[method](value));
}

export function storeImport(paper, blob) {
  return transact(['papers', 'pdfs'], 'readwrite', (transaction) => {
    transaction.objectStore('papers').put(paper);
    transaction.objectStore('pdfs').put({ id: paper.id, blob });
  });
}

export function updatePaper(paper, fields) {
  return transact(['papers'], 'readwrite', (transaction) => {
    const papers = transaction.objectStore('papers');
    const record = papers.get(paper.id);
    record.onsuccess = () => {
      if (record.result?.hidden || (!record.result && !paper.sample)) return;
      papers.put({ ...(record.result || paper), ...fields });
    };
  });
}

export function removePaper(paper) {
  return transact(['papers', 'pdfs'], 'readwrite', (transaction) => {
    const records = transaction.objectStore('papers');
    if (paper.sample) records.put({ id: paper.id, sample: true, hidden: true });
    else records.delete(paper.id);
    transaction.objectStore('pdfs').delete(paper.id);
  });
}

export function removeFolder(id) {
  return transact(['papers', 'folders'], 'readwrite', (transaction) => {
    const papers = transaction.objectStore('papers').openCursor();
    papers.onsuccess = () => {
      const cursor = papers.result;
      if (!cursor) return;
      if (cursor.value.folderId === id) cursor.update({ ...cursor.value, folderId: '' });
      cursor.continue();
    };
    transaction.objectStore('folders').delete(id);
  });
}
