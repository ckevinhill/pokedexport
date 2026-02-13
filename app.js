const screenshotInput = document.getElementById('screenshotInput');
const parseStatus = document.getElementById('parseStatus');
const reviewBody = document.getElementById('reviewBody');
const saveSnapshotBtn = document.getElementById('saveSnapshotBtn');
const generateShareBtn = document.getElementById('generateShareBtn');
const copyShareBtn = document.getElementById('copyShareBtn');
const shareLink = document.getElementById('shareLink');
const compareLink = document.getElementById('compareLink');
const runCompareBtn = document.getElementById('runCompareBtn');
const compareOutput = document.getElementById('compareOutput');

let extractedEntries = [];
let latestSnapshot = loadLatestSnapshot();

screenshotInput.addEventListener('change', async (event) => {
  const files = [...event.target.files];
  if (!files.length) {
    parseStatus.textContent = 'No files selected.';
    return;
  }

  extractedEntries = [];
  renderEntries();
  parseStatus.textContent = `Parsing ${files.length} screenshot(s)...`;

  for (const [index, file] of files.entries()) {
    const objectUrl = URL.createObjectURL(file);
    const captured = await detectCapturedState(file);
    const ocr = await runOCR(file);
    const parsed = parseDexText(ocr.text || '');

    extractedEntries.push({
      id: crypto.randomUUID(),
      previewUrl: objectUrl,
      dexNumber: parsed.dexNumber,
      name: parsed.name,
      captured,
      confidence: deriveConfidence(captured, parsed.confidence),
      source: 'screenshot',
      ocrRaw: ocr.text || '',
      index: index + 1,
    });

    parseStatus.textContent = `Parsed ${index + 1}/${files.length} screenshot(s)...`;
    renderEntries();
  }

  parseStatus.textContent = `Done. Parsed ${files.length} screenshot(s). Review before saving.`;
});

saveSnapshotBtn.addEventListener('click', () => {
  const normalized = extractedEntries
    .filter((entry) => Number.isInteger(entry.dexNumber) && entry.dexNumber > 0)
    .map((entry) => ({
      dexNumber: entry.dexNumber,
      name: entry.name || null,
      captured: Boolean(entry.captured),
      confidence: entry.confidence,
      source: entry.source,
    }));

  if (!normalized.length) {
    parseStatus.textContent = 'Nothing to save. Add entries with valid Dex numbers.';
    return;
  }

  latestSnapshot = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    entries: normalized,
  };

  localStorage.setItem('pokedexport.latestSnapshot', JSON.stringify(latestSnapshot));
  parseStatus.textContent = `Saved snapshot with ${normalized.length} entries.`;
});

generateShareBtn.addEventListener('click', () => {
  if (!latestSnapshot) {
    shareLink.value = '';
    parseStatus.textContent = 'Save a snapshot first.';
    return;
  }

  const payload = encodeURIComponent(btoa(JSON.stringify(latestSnapshot)));
  const url = new URL(window.location.href);
  url.searchParams.set('sharedSnapshot', payload);
  shareLink.value = url.toString();
});

copyShareBtn.addEventListener('click', async () => {
  if (!shareLink.value) return;
  await navigator.clipboard.writeText(shareLink.value);
});

runCompareBtn.addEventListener('click', () => {
  if (!latestSnapshot) {
    compareOutput.innerHTML = '<p>Save your own snapshot before comparing.</p>';
    return;
  }

  let theirSnapshot;
  try {
    const url = new URL(compareLink.value);
    const encoded = url.searchParams.get('sharedSnapshot');
    if (!encoded) throw new Error('No sharedSnapshot parameter found.');
    theirSnapshot = JSON.parse(atob(decodeURIComponent(encoded)));
  } catch (error) {
    compareOutput.innerHTML = `<p>Could not parse link: ${error.message}</p>`;
    return;
  }

  const mineMap = buildCapturedMap(latestSnapshot.entries);
  const theirsMap = buildCapturedMap(theirSnapshot.entries || []);
  const allDex = new Set([...mineMap.keys(), ...theirsMap.keys()]);

  const mineOnly = [];
  const theirsOnly = [];
  const bothHave = [];
  const bothMissing = [];

  for (const dex of [...allDex].sort((a, b) => a - b)) {
    const mine = mineMap.get(dex) || false;
    const theirs = theirsMap.get(dex) || false;

    if (mine && !theirs) mineOnly.push(dex);
    else if (!mine && theirs) theirsOnly.push(dex);
    else if (mine && theirs) bothHave.push(dex);
    else bothMissing.push(dex);
  }

  renderComparison({ mineOnly, theirsOnly, bothHave, bothMissing });
});

function renderEntries() {
  reviewBody.innerHTML = '';
  extractedEntries.forEach((entry) => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td><img class="thumb" src="${entry.previewUrl}" alt="Screenshot preview ${entry.index}" /></td>
      <td><input type="number" min="1" max="2000" value="${entry.dexNumber ?? ''}" data-id="${entry.id}" data-field="dexNumber" /></td>
      <td><input type="text" value="${entry.name ?? ''}" data-id="${entry.id}" data-field="name" /></td>
      <td>
        <select data-id="${entry.id}" data-field="captured">
          <option value="true" ${entry.captured ? 'selected' : ''}>Captured</option>
          <option value="false" ${!entry.captured ? 'selected' : ''}>Missing</option>
        </select>
      </td>
      <td>${Math.round(entry.confidence * 100)}%</td>
    `;

    reviewBody.appendChild(row);
  });

  reviewBody.querySelectorAll('input, select').forEach((el) => {
    el.addEventListener('change', onReviewEdit);
  });
}

function onReviewEdit(event) {
  const { id, field } = event.target.dataset;
  const entry = extractedEntries.find((item) => item.id === id);
  if (!entry) return;

  if (field === 'dexNumber') {
    entry.dexNumber = Number(event.target.value) || null;
  } else if (field === 'name') {
    entry.name = event.target.value.trim() || null;
  } else if (field === 'captured') {
    entry.captured = event.target.value === 'true';
  }
}

async function detectCapturedState(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const maxWidth = 300;
  const scale = Math.min(1, maxWidth / bitmap.width);
  canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
  canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  let saturationTotal = 0;
  let sampled = 0;
  for (let i = 0; i < data.length; i += 40) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    saturationTotal += sat;
    sampled += 1;
  }

  const avgSaturation = saturationTotal / Math.max(sampled, 1);
  return avgSaturation >= 0.2;
}

async function runOCR(file) {
  if (!window.Tesseract) {
    return { text: '' };
  }

  try {
    const result = await window.Tesseract.recognize(file, 'eng', {
      logger: () => {},
    });
    return { text: result?.data?.text || '' };
  } catch {
    return { text: '' };
  }
}

function parseDexText(text) {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const numberMatch = cleaned.match(/\b(\d{1,4})\b/);
  const dexNumber = numberMatch ? Number(numberMatch[1]) : null;

  const nameMatch = cleaned.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/);
  const name = nameMatch ? nameMatch[1] : null;

  const confidence = Number(dexNumber ? 0.65 : 0.35) + Number(name ? 0.25 : 0.05);
  return { dexNumber, name, confidence: Math.min(0.95, confidence) };
}

function deriveConfidence(captured, ocrConfidence) {
  const capturedConfidence = 0.7;
  const blended = (capturedConfidence + ocrConfidence) / 2;
  return captured ? blended : Math.max(0.45, blended - 0.1);
}

function loadLatestSnapshot() {
  const raw = localStorage.getItem('pokedexport.latestSnapshot');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildCapturedMap(entries) {
  const map = new Map();
  for (const entry of entries) {
    if (!Number.isInteger(entry.dexNumber)) continue;
    map.set(entry.dexNumber, Boolean(entry.captured));
  }
  return map;
}

function renderComparison({ mineOnly, theirsOnly, bothHave, bothMissing }) {
  compareOutput.innerHTML = `
    ${renderCompareCard('Only I have', mineOnly)}
    ${renderCompareCard('Only they have', theirsOnly)}
    ${renderCompareCard('Both have', bothHave)}
    ${renderCompareCard('Both missing', bothMissing)}
  `;
}

function renderCompareCard(title, entries) {
  if (!entries.length) {
    return `<div class="compare-card"><strong>${title}</strong><p>None</p></div>`;
  }

  const items = entries.slice(0, 80).map((dex) => `<li>#${dex}</li>`).join('');
  const remainder = entries.length > 80 ? `<li>...and ${entries.length - 80} more</li>` : '';
  return `<div class="compare-card"><strong>${title} (${entries.length})</strong><ul>${items}${remainder}</ul></div>`;
}
