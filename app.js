// BodyLog v2 - clean rebuild (no JSON backup/restore)
// FIX: latest-record-based range, dual y-axes, timezone-safe date handling
const DB_NAME = "bodylog-db";
const DB_VER = 2;
const STORE = "entries";
const $ = (id) => document.getElementById(id);

const state = {
  sortDesc: true,
  rangeDays: 30, // 7/30/90 or "all"
  chart: null,
  pendingInstallPrompt: null,
  pendingImport: null, // { newOnes:[], conflicts:[{date, existing, incoming, action}], errors, errLines, duplicates }
};

function pad2(n){ return String(n).padStart(2,"0"); }

// Treat YYYY-MM-DD as local date (avoid TZ shift)
function dateFromISO(dateISO){
  if(!dateISO) return null;
  const t = String(dateISO).trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y,m,d] = t.split("-").map(Number);
  return new Date(y, m-1, d);
}

// Accept YYYY-MM-DD, YYYY/MM/DD. Keep internal YYYY-MM-DD.
function toISODate(s){
  if(!s) return "";
  const t = String(s).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

  // allow YYYY/MM/DD and YYYY/M/D
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(t)) {
    const [y,mm,dd] = t.split("/");
    return `${y}-${pad2(Number(mm))}-${pad2(Number(dd))}`;
  }

  // fallback: Date parse (may be locale-dependent)
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function numOrNull(v){
  const t = String(v ?? "").trim();
  if(!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE, { keyPath: "date" });
      }
    };
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}

async function txDo(mode, fn){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    fn(store);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

async function dbPut(entry){
  await txDo("readwrite", (s)=>s.put(entry));
}
async function dbPutMany(entries){
  await txDo("readwrite", (s)=>{ for(const e of entries) s.put(e); });
}
async function dbDelete(date){
  await txDo("readwrite", (s)=>s.delete(date));
}
async function dbGet(date){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,"readonly");
    const req = tx.objectStore(STORE).get(date);
    req.onsuccess = ()=>resolve(req.result || null);
    req.onerror = ()=>reject(req.error);
  });
}
async function dbGetAll(){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,"readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=>resolve(req.result || []);
    req.onerror = ()=>reject(req.error);
  });
}

function setTodayDefault(){
  const d = new Date();
  $("fDate").value = `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

async function getPreviousEntry(date){
  const all = await dbGetAll();
  const older = all.filter(e=>e.date < date).sort((a,b)=>b.date.localeCompare(a.date));
  return older[0] || null;
}

function setHints(prev){
  const map = [
    ["hintWeight", prev?.weight, "kg"], ["hintBmi", prev?.bmi, ""], ["hintFat", prev?.fat, "%"],
    ["hintMuscle", prev?.muscle, "kg"], ["hintVisceral", prev?.visceral, ""], ["hintBmr", prev?.bmr, "kcal"],
    ["hintAge", prev?.age, ""],
  ];
  for(const [id,val,unit] of map){
    $(id).textContent = (val===null||val===undefined) ? "" : `前回: ${val}${unit}`;
  }
}

function fillForm(e){
  $("fWeight").value = e?.weight ?? "";
  $("fBmi").value = e?.bmi ?? "";
  $("fFat").value = e?.fat ?? "";
  $("fMuscle").value = e?.muscle ?? "";
  $("fVisceral").value = e?.visceral ?? "";
  $("fBmr").value = e?.bmr ?? "";
  $("fAge").value = e?.age ?? "";
  $("fMemo").value = e?.memo ?? "";
  $("deleteBtn").disabled = !e?.date;
}

function clearFormKeepDate(){
  const d = $("fDate").value;
  fillForm(null);
  $("fDate").value = d;
  $("deleteBtn").disabled = true;
}

function getFormEntry(){
  const date = toISODate($("fDate").value);
  return {
    date,
    weight: numOrNull($("fWeight").value),
    bmi: numOrNull($("fBmi").value),
    fat: numOrNull($("fFat").value),
    muscle: numOrNull($("fMuscle").value),
    visceral: numOrNull($("fVisceral").value),
    bmr: numOrNull($("fBmr").value),
    age: numOrNull($("fAge").value),
    memo: String($("fMemo").value || "").trim(),
    updatedAt: Date.now(),
  };
}

// Range filter: based on latest record date (not "today")
function withinRange(dateISO, latestISO){
  if(state.rangeDays === "all") return true;
  if(!latestISO) return true;

  const days = Number(state.rangeDays);
  const d = dateFromISO(dateISO);
  const latest = dateFromISO(latestISO);
  if(!d || !latest) return true;

  const diff = (latest - d) / (1000*60*60*24);
  return diff >= 0 && diff <= days;
}

function sortEntries(arr){
  return arr.sort((a,b)=> state.sortDesc ? (b.date.localeCompare(a.date)) : (a.date.localeCompare(b.date)));
}

function calcAvg(arr, key){
  const vals = arr.map(x=>x[key]).filter(v=>Number.isFinite(v));
  if(!vals.length) return null;
  return vals.reduce((p,c)=>p+c,0)/vals.length;
}

function movingAvg(points, key, window=7){
  const out = [];
  for(let i=0;i<points.length;i++){
    const start = Math.max(0, i-window+1);
    const slice = points.slice(start, i+1).map(p=>p[key]).filter(v=>Number.isFinite(v));
    out.push(slice.length ? slice.reduce((p,c)=>p+c,0)/slice.length : null);
  }
  return out;
}

function renderDashboard(entries){
  if(!entries.length){
    $("kpiDate").textContent = "-";
    $("kpiW7").textContent = "-";
    $("dashNote").textContent = "まだデータがありません。CSVインポートか今日の入力から始めてください。";
    return;
  }

  const latestISO = entries.reduce((p,c)=> (p > c.date ? p : c.date), entries[0].date);
  const latestEntry = entries.find(e=>e.date === latestISO) || entries.reduce((p,c)=> p.date > c.date ? p : c);

  $("kpiDate").textContent = latestISO;

  const latestDate = dateFromISO(latestISO);
  const last7 = entries.filter(e=>{
    const d = dateFromISO(e.date);
    if(!d || !latestDate) return false;
    const diff = (latestDate - d)/(1000*60*60*24);
    return diff>=0 && diff<=6;
  });

  const w7 = calcAvg(last7,"weight");
  $("kpiW7").textContent = (w7===null) ? "-" : `${w7.toFixed(1)} kg`;

  const prev7 = entries.filter(e=>{
    const d = dateFromISO(e.date);
    if(!d || !latestDate) return false;
    const diff = (latestDate - d)/(1000*60*60*24);
    return diff>=7 && diff<=13;
  });

  const wPrev = calcAvg(prev7,"weight");

  if(w7!==null && wPrev!==null){
    const delta = w7 - wPrev;
    const sign = delta>0? "+" : "";
    $("dashNote").textContent = `直近7日平均の体重は ${w7.toFixed(1)}kg。前7日平均との差は ${sign}${delta.toFixed(1)}kg。`;
  }else if(w7!==null){
    $("dashNote").textContent = `直近7日平均の体重は ${w7.toFixed(1)}kg。`;
  }else{
    $("dashNote").textContent = "";
  }

  // suppress unused var warning
  void latestEntry;
}

function renderTable(entries, latestISO){
  const tbody = $("tbl").querySelector("tbody");
  tbody.innerHTML = "";
  const rows = entries.filter(e=>withinRange(e.date, latestISO));
  sortEntries(rows);

  for(const e of rows){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${e.date}</td><td>${e.weight ?? ""}</td><td>${e.fat ?? ""}</td><td>${e.muscle ?? ""}</td>
      <td>${e.visceral ?? ""}</td><td>${e.bmr ?? ""}</td><td>${e.age ?? ""}</td>
    `;
    tr.addEventListener("click", async ()=>{
      $("fDate").value = e.date;
      const got = await dbGet(e.date);
      fillForm(got);
      setHints(await getPreviousEntry(e.date));
      window.scrollTo({top:0, behavior:"smooth"});
    });
    tbody.appendChild(tr);
  }
}

function renderChart(entries, latestISO){
  if(!window.Chart) return;

  const rows = entries
    .filter(e=>withinRange(e.date, latestISO))
    .sort((a,b)=>a.date.localeCompare(b.date));

  const labels = rows.map(e=>e.date);

  const ds = [];
  const showMA = $("cMA").checked;

  function addSeries(label, key, yAxisID){
    ds.push({
      label,
      data: rows.map(e=>Number.isFinite(e[key]) ? e[key] : null),
      tension: 0.25,
      spanGaps: true,
      yAxisID
    });
    if(showMA){
      ds.push({
        label: `${label} (7日平均)`,
        data: movingAvg(rows, key, 7),
        tension: 0.25,
        spanGaps: true,
        yAxisID,
        borderDash: [6,6]
      });
    }
  }

  // kg: left axis / %: right axis
  if($("cW").checked) addSeries("体重","weight","yKg");
  if($("cM").checked) addSeries("筋肉量","muscle","yKg");
  if($("cF").checked) addSeries("体脂肪率","fat","yPct");

  const ctx = $("chart").getContext("2d");
  if(state.chart) state.chart.destroy();

  state.chart = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets: ds },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      resizeDelay: 100,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ color:"#e6edf6" } } },
      scales:{
        x:{ ticks:{ color:"#a6b3c5", maxRotation:0, autoSkip:true }, grid:{ color:"rgba(255,255,255,.06)" } },

        yKg:{
          position:"left",
          ticks:{ color:"#a6b3c5" },
          grid:{ color:"rgba(255,255,255,.06)" },
          title:{ display:true, text:"kg", color:"#a6b3c5" }
        },

        yPct:{
          position:"right",
          ticks:{ color:"#a6b3c5" },
          grid:{ drawOnChartArea:false },
          title:{ display:true, text:"%", color:"#a6b3c5" }
        }
      }
    }
  });
}

async function refreshUI(){
  const all = await dbGetAll();
  const latestISO = all.length ? all.reduce((p,c)=> (p > c.date ? p : c.date), all[0].date) : null;

  renderDashboard(all);
  renderTable(all, latestISO);
  renderChart(all, latestISO);
  setHints(await getPreviousEntry(toISODate($("fDate").value)));
}

// --- CSV ---
function parseCSV(text){
  const lines = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n").split("\n").filter(l=>l.trim().length);
  if(!lines.length) return { header:[], rows:[] };

  const parseLine = (line)=>{
    const out=[]; let cur=""; let inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch === '"'){
        if(inQ && line[i+1]==='"'){ cur+='"'; i++; } else inQ=!inQ;
      }else if(ch===',' && !inQ){ out.push(cur); cur=""; }
      else cur+=ch;
    }
    out.push(cur);
    return out.map(s=>s.trim());
  };
  return { header: parseLine(lines[0]), rows: lines.slice(1).map(parseLine) };
}

function download(filename, text, mime="text/plain"){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exportCSV(){
  const all = await dbGetAll();
  const header = ["日付","体重","BMI","体脂肪率","筋肉量","内臓脂肪","基礎代謝量","体内年齢"];
  const lines = [header.join(",")];
  const rows = all.sort((a,b)=>a.date.localeCompare(b.date));
  for(const e of rows){
    lines.push([e.date, e.weight??"", e.bmi??"", e.fat??"", e.muscle??"", e.visceral??"", e.bmr??"", e.age??""].join(","));
  }
  download("bodylog_export.csv", lines.join("\n"), "text/csv");
}

function makeEntryFromRow(date, r, idx){
  return {
    date,
    weight: numOrNull(r[idx["体重"]]),
    bmi: numOrNull(r[idx["BMI"]]),
    fat: numOrNull(r[idx["体脂肪率"]]),
    muscle: numOrNull(r[idx["筋肉量"]]),
    visceral: numOrNull(r[idx["内臓脂肪"]]),
    bmr: numOrNull(r[idx["基礎代謝量"]]),
    age: numOrNull(r[idx["体内年齢"]]),
    memo: "",
    updatedAt: Date.now(),
  };
}

async function startImportCSV(file){
  const resultEl = $("importResult");
  resultEl.textContent = "";
  hideConflicts();

  if(!file){ resultEl.textContent="CSVファイルを選択してください。"; return; }

  const {header, rows} = parseCSV(await file.text());
  const expected = ["日付","体重","BMI","体脂肪率","筋肉量","内臓脂肪","基礎代謝量","体内年齢"];
  const idx = {};
  expected.forEach(h=>idx[h]=header.indexOf(h));
  const missing = expected.filter(h=>idx[h]===-1);
  if(missing.length){ resultEl.textContent = `ヘッダ不一致。不足: ${missing.join(" / ")}`; return; }

  // CSV内の同一日付は「最後の行を採用」して、重複数を報告
  const map = new Map(); // date -> {entry, count, firstLineNo, lastLineNo}
  let errors = 0;
  const errLines = [];

  for(let i=0;i<rows.length;i++){
    const lineNo = i + 2;
    try{
      const r = rows[i];
      const date = toISODate(r[idx["日付"]]);
      if(!date) throw new Error("日付形式が不正");
      const entry = makeEntryFromRow(date, r, idx);
      const prev = map.get(date);
      if(prev){
        map.set(date, { entry, count: prev.count + 1, firstLineNo: prev.firstLineNo, lastLineNo: lineNo });
      }else{
        map.set(date, { entry, count: 1, firstLineNo: lineNo, lastLineNo: lineNo });
      }
    }catch(e){
      errors++;
      errLines.push(`行${lineNo}: ${e.message}`);
    }
  }

  const duplicates = [...map.entries()].filter(([,v])=>v.count>1);
  const incoming = [...map.values()].map(v=>v.entry);

  // 既存データと突き合わせ（ここでは保存しない）
  const existingAll = await dbGetAll();
  const existingByDate = new Map(existingAll.map(e=>[e.date, e]));

  const newOnes = [];
  const conflicts = [];
  for(const e of incoming){
    const ex = existingByDate.get(e.date);
    if(ex) conflicts.push({ date: e.date, existing: ex, incoming: e, action: "overwrite" });
    else newOnes.push(e);
  }

  state.pendingImport = { newOnes, conflicts, errors, errLines, duplicates };

  // 新規だけなら一括保存で終わり
  if(conflicts.length === 0){
    await dbPutMany(newOnes);
    resultEl.textContent =
      `インポート結果: 追加 ${newOnes.length} / 更新 0 / スキップ 0 / エラー ${errors}` +
      (duplicates.length ? `\nCSV内の同一日付重複: ${duplicates.length}日（最後の行を採用）` : "") +
      (errLines.length ? `\n${errLines.slice(0,20).join("\n")}` : "");
    await refreshUI();
    state.pendingImport = null;
    return;
  }

  // 衝突がある場合：衝突解決UIを出す（confirm連発しない）
  showConflicts();
  renderConflictTable(conflicts);

  resultEl.textContent =
    `衝突 ${conflicts.length} 件があります。上の「衝突解決」で処理してください。` +
    `\n（新規 ${newOnes.length} 件、エラー ${errors} 件）` +
    (duplicates.length ? `\nCSV内の同一日付重複: ${duplicates.length}日（最後の行を採用）` : "") +
    (errLines.length ? `\n${errLines.slice(0,10).join("\n")}` : "");
}

function showConflicts(){ $("conflictBox").classList.remove("hidden"); }
function hideConflicts(){ $("conflictBox").classList.add("hidden"); $("conflictTbl").querySelector("tbody").innerHTML=""; }

function renderConflictTable(conflicts){
  const tbody = $("conflictTbl").querySelector("tbody");
  tbody.innerHTML = "";
  for(const c of conflicts){
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.date}</td>
      <td>${c.existing.weight ?? ""}</td>
      <td>${c.incoming.weight ?? ""}</td>
      <td>
        <div class="choice">
          <label><input type="radio" name="act-${c.date}" value="overwrite" checked>上書き</label>
          <label><input type="radio" name="act-${c.date}" value="skip">スキップ</label>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function applyImport(mode){
  const resultEl = $("importResult");
  const pi = state.pendingImport;
  if(!pi){ hideConflicts(); return; }

  // conflicts の action を決める
  if(mode === "overwriteAll"){
    pi.conflicts.forEach(c=>c.action="overwrite");
  }else if(mode === "skipAll"){
    pi.conflicts.forEach(c=>c.action="skip");
  }else if(mode === "selected"){
    for(const c of pi.conflicts){
      const sel = document.querySelector(`input[name="act-${c.date}"]:checked`);
      c.action = sel?.value === "skip" ? "skip" : "overwrite";
    }
  }else if(mode === "cancel"){
    state.pendingImport = null;
    hideConflicts();
    resultEl.textContent = "インポートをキャンセルしました。";
    return;
  }

  const toPut = [...pi.newOnes];
  let updated = 0, skipped = 0;

  for(const c of pi.conflicts){
    if(c.action === "overwrite"){
      // 既存のmemoなどは保持したいなら、ここで merge する
      const merged = { ...c.existing, ...c.incoming, updatedAt: Date.now() };
      toPut.push(merged);
      updated++;
    }else{
      skipped++;
    }
  }

  await dbPutMany(toPut);

  hideConflicts();
  resultEl.textContent =
    `インポート結果: 追加 ${pi.newOnes.length} / 更新 ${updated} / スキップ ${skipped} / エラー ${pi.errors}` +
    (pi.duplicates.length ? `\nCSV内の同一日付重複: ${pi.duplicates.length}日（最後の行を採用）` : "") +
    (pi.errLines.length ? `\n${pi.errLines.slice(0,20).join("\n")}` : "");

  state.pendingImport = null;
  await refreshUI();
}

// --- install UI ---
function setupInstallUI(){
  const btn = $("installBtn");
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault();
    state.pendingInstallPrompt = e;
    btn.hidden = false;
  });
  btn.addEventListener("click", async ()=>{
    if(!state.pendingInstallPrompt) return;
    state.pendingInstallPrompt.prompt();
    await state.pendingInstallPrompt.userChoice;
    state.pendingInstallPrompt = null;
    btn.hidden = true;
  });
}

// --- events ---
function setupEvents(){
  $("entryForm").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const entry = getFormEntry();
    if(!entry.date){ alert("日付が不正です。"); return; }
    await dbPut(entry);
    $("importResult").textContent = "保存しました。";
    $("deleteBtn").disabled = false;
    setHints(await getPreviousEntry(entry.date));
    await refreshUI();
  });

  $("deleteBtn").addEventListener("click", async ()=>{
    const date = toISODate($("fDate").value);
    if(!date) return;
    if(!confirm(`${date} を削除しますか？`)) return;
    await dbDelete(date);
    $("importResult").textContent = "削除しました。";
    clearFormKeepDate();
    await refreshUI();
  });

  $("resetBtn").addEventListener("click", ()=> clearFormKeepDate());

  $("rangeSel").addEventListener("change", async ()=>{
    const v = $("rangeSel").value;
    state.rangeDays = (v==="all") ? "all" : Number(v);
    await refreshUI();
  });

  $("sortBtn").addEventListener("click", async ()=>{
    state.sortDesc = !state.sortDesc;
    $("sortBtn").textContent = `日付: ${state.sortDesc ? "降順" : "昇順"}`;
    await refreshUI();
  });

  document.querySelectorAll(".step").forEach(el=>{
    el.addEventListener("click", ()=>{
      const id = el.dataset.id;
      const delta = Number(el.dataset.delta);
      const cur = numOrNull($(id).value) ?? 0;
      const next = Math.round((cur + delta) * 10) / 10;
      $(id).value = next.toFixed(1);
    });
  });

  $("importBtn").addEventListener("click", async ()=> startImportCSV($("csvFile").files?.[0]));
  $("exportCsvBtn").addEventListener("click", exportCSV);

  ["cW","cF","cM","cMA"].forEach(id=>$(id).addEventListener("change", refreshUI));

  $("fDate").addEventListener("change", async ()=>{
    const date = toISODate($("fDate").value);
    const got = await dbGet(date);
    if(got){
      fillForm(got);
      $("importResult").textContent = "既存データを読み込みました。";
      $("deleteBtn").disabled = false;
    }else{
      $("importResult").textContent = "";
      $("deleteBtn").disabled = true;
      fillForm(null);
    }
    setHints(await getPreviousEntry(date));
  });

  // 衝突解決ボタン
  $("applyOverwriteAll").addEventListener("click", ()=>applyImport("overwriteAll"));
  $("applySkipAll").addEventListener("click", ()=>applyImport("skipAll"));
  $("applySelected").addEventListener("click", ()=>applyImport("selected"));
  $("cancelImport").addEventListener("click", ()=>applyImport("cancel"));
}

async function init(){
  setTodayDefault();

  // SW（オフライン化）
  if("serviceWorker" in navigator){
    try{
      await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
    }catch(e){
      console.warn("SW register failed", e);
    }
  }

  setupInstallUI();
  setupEvents();
  await refreshUI();
}
init();
