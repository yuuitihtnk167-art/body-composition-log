/* BodyLog MVP - Static PWA (IndexedDB) */

const APP = {
  dbName: 'bodylog-db',
  storeName: 'records',
  db: null,
  records: new Map(), // date -> record
  sortDesc: true,
  rangeDays: 'all',
  searchText: '',
  chart: null,
  importPending: null, // {parsed, conflicts, additions, errors}
};

const CSV_HEADERS_JA = ['日付','体重','BMI','体脂肪率','筋肉量','内臓脂肪','基礎代謝量','体内年齢'];

const $ = (id) => document.getElementById(id);

function showNotice(msg, kind='info', ttlMs=3000){
  const el = $('notice');
  el.classList.remove('hidden');
  el.textContent = msg;
  window.clearTimeout(showNotice._t);
  showNotice._t = window.setTimeout(() => el.classList.add('hidden'), ttlMs);
}

function fmt1(x){
  if (x === null || x === undefined || x === '') return '—';
  const n = Number(x);
  if (Number.isNaN(n)) return '—';
  return n.toFixed(1);
}
function fmt0(x){
  if (x === null || x === undefined || x === '') return '—';
  const n = Number(x);
  if (Number.isNaN(n)) return '—';
  return String(Math.round(n));
}
function clampStr(s, n=42){
  const t = (s ?? '').toString();
  return t.length > n ? t.slice(0,n-1)+'…' : t;
}

function normalizeDate(input){
  if (!input) return null;
  const s = String(input).trim();
  // yyyy/mm/dd
  const m1 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m1){
    const y = Number(m1[1]);
    const mo = Number(m1[2]);
    const d = Number(m1[3]);
    if (y<1900 || y>2100 || mo<1 || mo>12 || d<1 || d>31) return null;
    const mm = String(mo).padStart(2,'0');
    const dd = String(d).padStart(2,'0');
    return `${y}-${mm}-${dd}`;
  }
  // already yyyy-mm-dd maybe with time
  const m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m2){
    return `${m2[1]}-${m2[2]}-${m2[3]}`;
  }
  return null;
}

function toISODateFromInput(dateInputValue){
  // input type=date returns yyyy-mm-dd
  return normalizeDate(dateInputValue);
}

function parseNumber(val){
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function recordFromForm(){
  const date = toISODateFromInput($('fDate').value);
  if (!date) return null;

  return {
    date,
    weight_kg: parseNumber($('fWeight').value),
    bmi: parseNumber($('fBmi').value),
    body_fat_pct: parseNumber($('fFat').value),
    muscle_kg: parseNumber($('fMuscle').value),
    visceral_fat: parseNumber($('fVisceral').value),
    bmr_kcal: parseNumber($('fBmr').value),
    body_age: parseNumber($('fBodyAge').value),
    memo: ($('fMemo').value || '').trim(),
    updated_at: Date.now(),
  };
}

function fillForm(rec){
  $('fDate').value = rec?.date ?? '';
  $('fWeight').value = rec?.weight_kg ?? '';
  $('fBmi').value = rec?.bmi ?? '';
  $('fFat').value = rec?.body_fat_pct ?? '';
  $('fMuscle').value = rec?.muscle_kg ?? '';
  $('fVisceral').value = rec?.visceral_fat ?? '';
  $('fBmr').value = rec?.bmr_kcal ?? '';
  $('fBodyAge').value = rec?.body_age ?? '';
  $('fMemo').value = rec?.memo ?? '';
  $('btnDelete').classList.toggle('hidden', !rec || !APP.records.has(rec.date));
}

function clearForm(){
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth()+1).padStart(2,'0');
  const dd = String(today.getDate()).padStart(2,'0');
  $('fDate').value = `${yyyy}-${mm}-${dd}`;
  $('fWeight').value = '';
  $('fBmi').value = '';
  $('fFat').value = '';
  $('fMuscle').value = '';
  $('fVisceral').value = '';
  $('fBmr').value = '';
  $('fBodyAge').value = '';
  $('fMemo').value = '';
  $('btnDelete').classList.add('hidden');
}

function setPrevHint(){
  const latest = getSortedRecords(true)[0];
  if (!latest){
    $('prevHint').textContent = '前回値：—';
    return;
  }
  const s = `前回値（${latest.date}）：体重 ${fmt1(latest.weight_kg)} / 体脂肪 ${fmt1(latest.body_fat_pct)} / 筋肉 ${fmt1(latest.muscle_kg)}`;
  $('prevHint').textContent = s;
}

function getSortedRecords(desc = APP.sortDesc){
  const arr = Array.from(APP.records.values());
  arr.sort((a,b) => desc ? (b.date.localeCompare(a.date)) : (a.date.localeCompare(b.date)));
  return arr;
}

function applyRangeFilter(arr){
  if (APP.rangeDays === 'all') return arr;
  const days = Number(APP.rangeDays);
  if (!Number.isFinite(days)) return arr;
  const newest = arr.length ? arr[0].date : null;
  if (!newest) return arr;
  const newestDate = new Date(newest + 'T00:00:00');
  const cutoff = new Date(newestDate.getTime() - (days-1)*24*3600*1000);
  return arr.filter(r => new Date(r.date+'T00:00:00') >= cutoff);
}

function applySearch(arr){
  const q = (APP.searchText || '').trim().toLowerCase();
  if (!q) return arr;
  return arr.filter(r => (r.memo || '').toLowerCase().includes(q));
}

function renderTable(){
  let arr = getSortedRecords(APP.sortDesc);
  arr = applyRangeFilter(arr);
  arr = applySearch(arr);

  const tbody = $('recordsTbody');
  tbody.innerHTML = '';

  if (!arr.length){
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 7;
    td.className = 'muted';
    td.textContent = 'データがありません';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const r of arr){
    const tr = document.createElement('tr');
    tr.dataset.date = r.date;

    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${fmt1(r.weight_kg)}</td>
      <td>${fmt1(r.body_fat_pct)}</td>
      <td>${fmt1(r.muscle_kg)}</td>
      <td>${fmt1(r.visceral_fat)}</td>
      <td>${fmt0(r.bmr_kcal)}</td>
      <td>${fmt0(r.body_age)}</td>
    `;
    tr.addEventListener('click', () => {
      const rec = APP.records.get(r.date);
      if (rec){
        fillForm(rec);
        showNotice(`編集：${rec.date}`, 'info', 1500);
      }
    });

    tbody.appendChild(tr);
  }
}

function computeMovingAverage(values, windowSize=7){
  const out = new Array(values.length).fill(null);
  for (let i=0;i<values.length;i++){
    let sum = 0;
    let cnt = 0;
    for (let j=Math.max(0, i-windowSize+1); j<=i; j++){
      const v = values[j];
      if (v === null || v === undefined || Number.isNaN(v)) continue;
      sum += Number(v);
      cnt += 1;
    }
    out[i] = cnt ? (sum/cnt) : null;
  }
  return out;
}

function renderChart(){
  const wantWeight = $('chkWeight').checked;
  const wantFat = $('chkFat').checked;
  const wantMuscle = $('chkMuscle').checked;
  const wantMA7 = $('chkMA7').checked;

  let arr = getSortedRecords(false); // ascending for chart
  arr = applyRangeFilter(arr);

  const labels = arr.map(r => r.date);
  const w = arr.map(r => r.weight_kg ?? null);
  const f = arr.map(r => r.body_fat_pct ?? null);
  const m = arr.map(r => r.muscle_kg ?? null);

  const datasets = [];
  const pushSet = (label, data, yAxis) => {
    datasets.push({
      label,
      data,
      tension: 0.25,
      spanGaps: true,
      pointRadius: 2.2,
      borderWidth: 2,
      yAxisID: yAxis,
    });
  };

  if (wantWeight) pushSet('体重(kg)', w, 'y');
  if (wantFat) pushSet('体脂肪率(%)', f, 'y1');
  if (wantMuscle) pushSet('筋肉量(kg)', m, 'y');

  if (wantMA7){
    if (wantWeight) pushSet('体重 7日移動平均', computeMovingAverage(w,7), 'y');
    if (wantFat) pushSet('体脂肪 7日移動平均', computeMovingAverage(f,7), 'y1');
    if (wantMuscle) pushSet('筋肉 7日移動平均', computeMovingAverage(m,7), 'y');
  }

  const ctx = $('chart').getContext('2d');
  if (APP.chart){
    APP.chart.destroy();
  }

  APP.chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#a7b3c7' } },
        tooltip: { mode: 'index', intersect: false },
      },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { ticks: { color: '#a7b3c7' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y: { position: 'left', ticks: { color: '#a7b3c7' }, grid: { color: 'rgba(255,255,255,0.06)' } },
        y1: { position: 'right', ticks: { color: '#a7b3c7' }, grid: { drawOnChartArea: false } },
      },
    }
  });
}

function updateDashboard(){
  const desc = getSortedRecords(true);
  if (!desc.length){
    $('latestDate').textContent = '—';
    $('latestSummary').textContent = '—';
    $('avg7Weight').textContent = '—';
    $('avg7WeightDelta').textContent = '—';
    $('factComment').textContent = '—';
    $('prevHint').textContent = '前回値：—';
    return;
  }
  const latest = desc[0];
  $('latestDate').textContent = latest.date;
  $('latestSummary').textContent = `体重 ${fmt1(latest.weight_kg)} / 体脂肪 ${fmt1(latest.body_fat_pct)} / 筋肉 ${fmt1(latest.muscle_kg)}`;

  // avg 7 weight (from last 7 records, not 7 days)
  const last7 = desc.slice(0, 7).filter(r => r.weight_kg != null);
  const avg7 = last7.length ? last7.reduce((s,r)=>s+Number(r.weight_kg),0)/last7.length : null;
  $('avg7Weight').textContent = avg7 == null ? '—' : `${avg7.toFixed(1)} kg`;

  const prev7 = desc.slice(7, 14).filter(r => r.weight_kg != null);
  const avgPrev7 = prev7.length ? prev7.reduce((s,r)=>s+Number(r.weight_kg),0)/prev7.length : null;
  let deltaText = '—';
  if (avg7 != null && avgPrev7 != null){
    const d = avg7 - avgPrev7;
    const sign = d > 0 ? '+' : '';
    deltaText = `前7件平均との差：${sign}${d.toFixed(1)} kg`;
  }
  $('avg7WeightDelta').textContent = deltaText;

  $('factComment').textContent = buildFactComment(desc);

  setPrevHint();
}

function buildFactComment(descRecords){
  // Short, factual, non-judgmental comment
  const last7 = descRecords.slice(0, 7);
  if (last7.length < 3) return '直近データが少ないため、平均は参考値です。';

  const w = last7.map(r => r.weight_kg).filter(v => v != null);
  const f = last7.map(r => r.body_fat_pct).filter(v => v != null);

  const avg = (arr) => arr.length ? arr.reduce((s,v)=>s+Number(v),0)/arr.length : null;
  const min = (arr) => arr.length ? Math.min(...arr.map(Number)) : null;
  const max = (arr) => arr.length ? Math.max(...arr.map(Number)) : null;

  const aw = avg(w), af = avg(f);
  const spanW = (min(w)!=null && max(w)!=null) ? (max(w)-min(w)) : null;
  const spanF = (min(f)!=null && max(f)!=null) ? (max(f)-min(f)) : null;

  const parts = [];
  if (aw != null) parts.push(`直近7件の体重平均は ${aw.toFixed(1)}kg`);
  if (spanW != null) parts.push(`体重の範囲は ${spanW.toFixed(1)}kg`);
  if (af != null) parts.push(`体脂肪率平均は ${af.toFixed(1)}%`);
  if (spanF != null) parts.push(`体脂肪率の範囲は ${spanF.toFixed(1)}%`);
  return parts.join('。') + '。';
}

/* ---------- IndexedDB ---------- */

function openDB(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP.dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(APP.storeName)){
        db.createObjectStore(APP.storeName, { keyPath: 'date' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(mode='readonly'){
  const tx = APP.db.transaction(APP.storeName, mode);
  return tx.objectStore(APP.storeName);
}

function dbGetAll(){
  return new Promise((resolve, reject) => {
    const store = txStore('readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(record){
  return new Promise((resolve, reject) => {
    const store = txStore('readwrite');
    const req = store.put(record);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function dbDelete(date){
  return new Promise((resolve, reject) => {
    const store = txStore('readwrite');
    const req = store.delete(date);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function dbBulkPut(records){
  return new Promise((resolve, reject) => {
    const store = txStore('readwrite');
    let i = 0;
    const putNext = () => {
      if (i >= records.length) return resolve(true);
      const req = store.put(records[i]);
      req.onsuccess = () => { i++; putNext(); };
      req.onerror = () => reject(req.error);
    };
    putNext();
  });
}

/* ---------- CSV Import/Export ---------- */

function splitCSVLineSimple(line){
  // Simple CSV parser supporting quotes (minimal)
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i=0; i<line.length; i++){
    const ch = line[i];
    if (ch === '"'){
      if (inQ && line[i+1] === '"'){ // escaped quote
        cur += '"'; i++;
      } else {
        inQ = !inQ;
      }
    } else if (ch === ',' && !inQ){
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCSVText(text){
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim() !== '');
  if (!lines.length) return { parsed: [], errors: [{line:1, reason:'空のCSVです'}], warnings: [] };

  const header = splitCSVLineSimple(lines[0]).map(s => s.trim());
  const ok = CSV_HEADERS_JA.every((h, idx) => header[idx] === h);

  if (!ok){
    return { parsed: [], errors: [{line:1, reason:'ヘッダが一致しません（期待: 日付,体重,BMI,体脂肪率,筋肉量,内臓脂肪,基礎代謝量,体内年齢）'}], warnings: [] };
  }

  const parsed = [];
  const errors = [];

  for (let i=1; i<lines.length; i++){
    const cols = splitCSVLineSimple(lines[i]).map(s => s.trim());
    if (cols.length < 8){
      errors.push({ line: i+1, reason: `列数不足（${cols.length}列）` });
      continue;
    }

    const date = normalizeDate(cols[0]);
    if (!date){
      errors.push({ line: i+1, reason: `日付が不正: ${cols[0]}` });
      continue;
    }

    const rec = {
      date,
      weight_kg: parseNumber(cols[1]),
      bmi: parseNumber(cols[2]),
      body_fat_pct: parseNumber(cols[3]),
      muscle_kg: parseNumber(cols[4]),
      visceral_fat: parseNumber(cols[5]),
      bmr_kcal: parseNumber(cols[6]),
      body_age: parseNumber(cols[7]),
      memo: '',
      updated_at: Date.now(),
    };

    parsed.push(rec);
  }

  return { parsed, errors, warnings: [] };
}

async function readFileAsTextWithFallback(file){
  const buf = await file.arrayBuffer();
  // Try UTF-8
  try {
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    // Quick header check; if not ok, try Shift-JIS
    const firstLine = utf8.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')[0] || '';
    const header = splitCSVLineSimple(firstLine).map(s => s.trim());
    const ok = CSV_HEADERS_JA.every((h, idx) => header[idx] === h);
    if (ok) return { text: utf8, used: 'utf-8' };
  } catch (_) {}

  // Try Shift-JIS if supported
  try {
    const sjis = new TextDecoder('shift-jis', { fatal: false }).decode(buf);
    return { text: sjis, used: 'shift-jis' };
  } catch (_) {
    // Fallback to UTF-8 anyway
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    return { text: utf8, used: 'utf-8' };
  }
}

function recSummary(r){
  return `体重:${fmt1(r.weight_kg)} BMI:${fmt1(r.bmi)} 脂肪:${fmt1(r.body_fat_pct)} 筋肉:${fmt1(r.muscle_kg)} 内臓:${fmt1(r.visceral_fat)} 基礎:${fmt0(r.bmr_kcal)} 年齢:${fmt0(r.body_age)}`;
}

function showImportResult({added, updated, skipped, errors, encodingUsed}){
  const box = $('importResult');
  box.classList.remove('hidden');

  const errHtml = errors?.length
    ? `<div class="muted small" style="margin-top:8px;"><b>エラー行</b><br>${errors.slice(0, 20).map(e => `L${e.line}: ${e.reason}`).join('<br>')}${errors.length>20 ? '<br>…' : ''}</div>`
    : '';

  box.innerHTML = `
    <div><b>インポート結果</b></div>
    <div class="muted small">文字コード: ${encodingUsed}</div>
    <div>追加: ${added} / 更新: ${updated} / スキップ: ${skipped} / エラー: ${errors?.length ?? 0}</div>
    ${errHtml}
  `;
}

function downloadBlob(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

function exportCSV(){
  const arr = getSortedRecords(false);
  const lines = [];
  lines.push(CSV_HEADERS_JA.join(','));
  for (const r of arr){
    const row = [
      r.date.replace(/-/g,'/'),
      r.weight_kg ?? '',
      r.bmi ?? '',
      r.body_fat_pct ?? '',
      r.muscle_kg ?? '',
      r.visceral_fat ?? '',
      r.bmr_kcal ?? '',
      r.body_age ?? '',
    ].join(',');
    lines.push(row);
  }
  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const ts = new Date();
  const y = ts.getFullYear();
  const m = String(ts.getMonth()+1).padStart(2,'0');
  const d = String(ts.getDate()).padStart(2,'0');
  downloadBlob(blob, `bodylog_${y}${m}${d}.csv`);
}

function exportJSON(){
  const arr = getSortedRecords(false);
  const payload = {
    exported_at: new Date().toISOString(),
    app: 'BodyLog',
    version: 1,
    records: arr,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const ts = new Date();
  const y = ts.getFullYear();
  const m = String(ts.getMonth()+1).padStart(2,'0');
  const d = String(ts.getDate()).padStart(2,'0');
  downloadBlob(blob, `bodylog_${y}${m}${d}.json`);
}

async function importJSON(file){
  const text = await file.text();
  let obj = null;
  try { obj = JSON.parse(text); } catch(_) {}
  if (!obj || !Array.isArray(obj.records)){
    showNotice('JSON形式が不正です', 'info', 3500);
    return;
  }
  // Validate minimal
  const recs = [];
  for (const r of obj.records){
    const date = normalizeDate(r.date);
    if (!date) continue;
    recs.push({
      date,
      weight_kg: parseNumber(r.weight_kg),
      bmi: parseNumber(r.bmi),
      body_fat_pct: parseNumber(r.body_fat_pct),
      muscle_kg: parseNumber(r.muscle_kg),
      visceral_fat: parseNumber(r.visceral_fat),
      bmr_kcal: parseNumber(r.bmr_kcal),
      body_age: parseNumber(r.body_age),
      memo: (r.memo || '').toString(),
      updated_at: Date.now(),
    });
  }
  await dbBulkPut(recs);
  for (const r of recs) APP.records.set(r.date, r);
  refreshAll();
  showNotice(`JSONインポート：${recs.length}件反映`, 'info', 2500);
}

/* ---------- Conflict Resolution UI ---------- */

function openDialog(d){ if (!d.open) d.showModal(); }
function closeDialog(d){ if (d.open) d.close(); }

function buildConflictDialog(conflicts){
  // conflicts: [{existing, incoming, action:'overwrite'|'skip'|'review'}]
  const tbody = $('conflictTbody');
  tbody.innerHTML = '';

  for (const c of conflicts){
    const tr = document.createElement('tr');
    tr.dataset.date = c.incoming.date;

    const existingTxt = recSummary(c.existing);
    const incomingTxt = recSummary(c.incoming);

    tr.innerHTML = `
      <td>${c.incoming.date}</td>
      <td><pre>${existingTxt}</pre></td>
      <td><pre>${incomingTxt}</pre></td>
      <td>
        <select class="confSel">
          <option value="overwrite">上書き</option>
          <option value="skip">スキップ</option>
          <option value="review">差分確認</option>
        </select>
      </td>
    `;
    const sel = tr.querySelector('.confSel');
    sel.value = c.action || 'overwrite';
    sel.addEventListener('change', () => c.action = sel.value);

    tbody.appendChild(tr);
  }
}

/* ---------- App Actions ---------- */

async function saveRecord(rec){
  if (!rec) return;
  // Keep created_at if existing
  const existing = APP.records.get(rec.date);
  const merged = {
    ...(existing || {}),
    ...rec,
    date: rec.date,
    updated_at: Date.now(),
    created_at: existing?.created_at ?? Date.now(),
  };

  await dbPut(merged);
  APP.records.set(merged.date, merged);
  refreshAll();
  showNotice(`保存：${merged.date}`, 'info', 2000);
}

async function deleteRecord(date){
  if (!date) return;
  await dbDelete(date);
  APP.records.delete(date);
  refreshAll();
  showNotice(`削除：${date}`, 'info', 2000);
}

function refreshAll(){
  updateDashboard();
  renderTable();
  renderChart();
  setPrevHint();
}

async function handleCSVImport(file){
  if (!file) return;

  const { text, used } = await readFileAsTextWithFallback(file);
  const { parsed, errors } = parseCSVText(text);

  // If header mismatch after fallback decode, surface that
  if (!parsed.length && errors.length){
    showImportResult({ added:0, updated:0, skipped:0, errors, encodingUsed: used });
    showNotice('CSVのヘッダ/形式を確認してください', 'info', 3500);
    return;
  }

  // Separate: additions vs conflicts
  const additions = [];
  const conflicts = [];
  for (const r of parsed){
    const ex = APP.records.get(r.date);
    if (!ex){
      additions.push(r);
    } else {
      conflicts.push({ existing: ex, incoming: r, action: 'overwrite' });
    }
  }

  APP.importPending = { parsed, additions, conflicts, errors, encodingUsed: used };

  if (conflicts.length){
    buildConflictDialog(conflicts);
    openDialog($('conflictDialog'));
    showNotice(`衝突：${conflicts.length}件。処理を選択してください。`, 'info', 3500);
    return;
  }

  // No conflicts => bulk import
  await dbBulkPut(additions);
  for (const r of additions) APP.records.set(r.date, r);

  refreshAll();
  showImportResult({
    added: additions.length,
    updated: 0,
    skipped: 0,
    errors,
    encodingUsed: used
  });

  showNotice(`CSVインポート：追加 ${additions.length}件`, 'info', 2500);
}

async function resolveConflictsAndImport(){
  const pending = APP.importPending;
  if (!pending) return;

  const { additions, conflicts, errors, encodingUsed } = pending;

  let toUpsert = [...additions];
  let updated = 0;
  let skipped = 0;

  for (const c of conflicts){
    if (c.action === 'skip'){
      skipped++;
      continue;
    }
    if (c.action === 'review'){
      // In this MVP, "review" means keep choice at row-level; user already sees diff here.
      // Treat as overwrite unless changed; user can switch to skip.
      // If still "review", interpret as overwrite (explicit enough).
    }
    // overwrite
    const merged = {
      ...(c.existing || {}),
      ...c.incoming,
      date: c.incoming.date,
      created_at: c.existing?.created_at ?? Date.now(),
      updated_at: Date.now(),
    };
    toUpsert.push(merged);
    updated++;
  }

  await dbBulkPut(toUpsert);
  for (const r of toUpsert) APP.records.set(r.date, r);

  closeDialog($('conflictDialog'));
  APP.importPending = null;

  refreshAll();
  showImportResult({ added: additions.length, updated, skipped, errors, encodingUsed });
  showNotice(`CSVインポート完了（追加 ${additions.length} / 更新 ${updated} / スキップ ${skipped}）`, 'info', 3500);
}

function applyDefaultToAllConflicts(action){
  const pending = APP.importPending;
  if (!pending) return;
  for (const c of pending.conflicts) c.action = action;
  // sync UI
  document.querySelectorAll('#conflictTbody .confSel').forEach(sel => { sel.value = action; });
}

/* ---------- Service Worker ---------- */

async function registerSW(){
  if (!('serviceWorker' in navigator)) return;
  try{
    const reg = await navigator.serviceWorker.register('./service-worker.js');
    // optional: show update notice
    reg.addEventListener('updatefound', () => {
      showNotice('更新があります。再起動で反映されます。', 'info', 3500);
    });
  }catch(e){
    // ignore
  }
}

/* ---------- Init ---------- */

async function init(){
  // dialogs
  $('btnHelp').addEventListener('click', () => openDialog($('helpDialog')));
  $('btnHelpClose').addEventListener('click', () => closeDialog($('helpDialog')));

  $('btnBackup').addEventListener('click', () => openDialog($('backupDialog')));
  $('btnBackupClose').addEventListener('click', () => closeDialog($('backupDialog')));

  $('btnExportCsv').addEventListener('click', exportCSV);
  $('btnExportJson').addEventListener('click', exportJSON);

  $('jsonFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await importJSON(file);
  });

  // CSV import
  $('csvFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) await handleCSVImport(file);
  });

  // conflict dialog
  $('btnConflictClose').addEventListener('click', () => closeDialog($('conflictDialog')));
  $('btnResolve').addEventListener('click', resolveConflictsAndImport);
  $('btnApplyDefault').addEventListener('click', () => {
    const v = $('conflictDefault').value;
    applyDefaultToAllConflicts(v);
  });

  // chart toggles
  ['chkWeight','chkFat','chkMuscle','chkMA7'].forEach(id => {
    $(id).addEventListener('change', renderChart);
  });

  // range select
  $('rangeSelect').addEventListener('change', () => {
    APP.rangeDays = $('rangeSelect').value;
    refreshAll();
  });

  // sort button
  $('btnSort').addEventListener('click', () => {
    APP.sortDesc = !APP.sortDesc;
    $('btnSort').textContent = `日付：${APP.sortDesc ? '降順' : '昇順'}`;
    renderTable();
  });

  // search
  $('searchInput').addEventListener('input', () => {
    APP.searchText = $('searchInput').value;
    renderTable();
  });

  // stepper buttons
  document.querySelectorAll('[data-step-field]').forEach(btn => {
    btn.addEventListener('click', () => {
      const field = btn.dataset.stepField;
      const step = Number(btn.dataset.step);
      if (!Number.isFinite(step)) return;

      const map = {
        weight_kg: $('fWeight'),
        body_fat_pct: $('fFat'),
        muscle_kg: $('fMuscle')
      };
      const el = map[field];
      if (!el) return;
      const cur = parseNumber(el.value) ?? 0;
      const next = Math.round((cur + step) * 10) / 10;
      el.value = next.toFixed(1);
    });
  });

  $('btnClearForm').addEventListener('click', clearForm);

  // form submit
  $('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const rec = recordFromForm();
    if (!rec){
      showNotice('日付を確認してください', 'info', 2500);
      return;
    }
    await saveRecord(rec);
  });

  $('btnDelete').addEventListener('click', async () => {
    const date = toISODateFromInput($('fDate').value);
    if (!date || !APP.records.has(date)) return;
    const ok = confirm(`${date} を削除しますか？`);
    if (!ok) return;
    await deleteRecord(date);
    clearForm();
  });

  // DB init
  APP.db = await openDB();
  $('dbStatus').textContent = '保存先：IndexedDB';
  const all = await dbGetAll();
  for (const r of all){
    const date = normalizeDate(r.date);
    if (!date) continue;
    APP.records.set(date, { ...r, date });
  }

  clearForm();
  refreshAll();
  registerSW();
}

window.addEventListener('load', init);
