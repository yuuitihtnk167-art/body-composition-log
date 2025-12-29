const DB_NAME = "bodylog-db";
const DB_VER = 1;
const STORE = "entries";
const $ = (id) => document.getElementById(id);

const state = { sortDesc: true, rangeDays: 30, chart: null, pendingInstallPrompt: null };

function pad2(n){ return String(n).padStart(2,"0"); }

function toISODate(s){
  if(!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(s)) { const [y,m,d]=s.split("/"); return `${y}-${m}-${d}`; }
  const d = new Date(s);
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
      if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "date" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(entry){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}
async function dbDelete(date){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).delete(date);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
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

function withinRange(dateISO){
  if(state.rangeDays === "all") return true;
  const days = Number(state.rangeDays);
  const d = new Date(dateISO+"T00:00:00");
  const now = new Date();
  const diff = (now - d) / (1000*60*60*24);
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
  const latest = entries.reduce((p,c)=> p.date > c.date ? p : c);
  $("kpiDate").textContent = latest.date;

  const latestDate = new Date(latest.date+"T00:00:00");
  const last7 = entries.filter(e=>{
    const d = new Date(e.date+"T00:00:00");
    const diff = (latestDate - d)/(1000*60*60*24);
    return diff>=0 && diff<=6;
  });
  const w7 = calcAvg(last7,"weight");
  $("kpiW7").textContent = (w7===null) ? "-" : `${w7.toFixed(1)} kg`;

  const prev7 = entries.filter(e=>{
    const d = new Date(e.date+"T00:00:00");
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
}

function renderTable(entries){
  const tbody = $("tbl").querySelector("tbody");
  tbody.innerHTML = "";
  const rows = entries.filter(e=>withinRange(e.date));
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

function renderChart(entries){
  if(!window.Chart) return;
  const rows = entries.filter(e=>withinRange(e.date)).sort((a,b)=>a.date.localeCompare(b.date));
  const labels = rows.map(e=>e.date);

  const ds = [];
  const showMA = $("cMA").checked;
  function addSeries(label, key){
    ds.push({ label, data: rows.map(e=>Number.isFinite(e[key]) ? e[key] : null), tension:.25, spanGaps:true });
    if(showMA) ds.push({ label: `${label} (7日平均)`, data: movingAvg(rows,key,7), tension:.25, spanGaps:true, borderDash:[6,6] });
  }
  if($("cW").checked) addSeries("体重","weight");
  if($("cF").checked) addSeries("体脂肪率","fat");
  if($("cM").checked) addSeries("筋肉量","muscle");

  const ctx = $("chart").getContext("2d");
  if(state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type:"line",
    data:{ labels, datasets: ds },
    options:{
      responsive:true, maintainAspectRatio:false,
      interaction:{ mode:"index", intersect:false },
      plugins:{ legend:{ labels:{ color:"#e6edf6" } } },
      scales:{
        x:{ ticks:{ color:"#a6b3c5" }, grid:{ color:"rgba(255,255,255,.06)" } },
        y:{ ticks:{ color:"#a6b3c5" }, grid:{ color:"rgba(255,255,255,.06)" } },
      }
    }
  });
}

async function refreshUI(){
  const all = await dbGetAll();
  renderDashboard(all);
  renderTable(all);
  renderChart(all);
  setHints(await getPreviousEntry(toISODate($("fDate").value)));
}

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

async function doImportCSV(file){
  const resultEl = $("importResult");
  resultEl.textContent = "";
  if(!file){ resultEl.textContent="CSVファイルを選択してください。"; return; }

  const {header, rows} = parseCSV(await file.text());
  const expected = ["日付","体重","BMI","体脂肪率","筋肉量","内臓脂肪","基礎代謝量","体内年齢"];
  const idx = {}; expected.forEach(h=>idx[h]=header.indexOf(h));
  const missing = expected.filter(h=>idx[h]===-1);
  if(missing.length){ resultEl.textContent = `ヘッダ不一致。不足: ${missing.join(" / ")}`; return; }

  let added=0, updated=0, skipped=0, errors=0;
  const errLines=[];
  for(let i=0;i<rows.length;i++){
    try{
      const r = rows[i];
      const date = toISODate(r[idx["日付"]]);
      if(!date) throw new Error("日付形式が不正");
      const entry = {
        date,
        weight:numOrNull(r[idx["体重"]]),
        bmi:numOrNull(r[idx["BMI"]]),
        fat:numOrNull(r[idx["体脂肪率"]]),
        muscle:numOrNull(r[idx["筋肉量"]]),
        visceral:numOrNull(r[idx["内臓脂肪"]]),
        bmr:numOrNull(r[idx["基礎代謝量"]]),
        age:numOrNull(r[idx["体内年齢"]]),
        memo:"",
        updatedAt:Date.now()
      };
      const existing = await dbGet(date);
      if(existing){
        const ok = confirm(`日付 ${date} は既にあります。上書きしますか？\nOK=上書き / キャンセル=スキップ`);
        if(ok){ await dbPut({...existing, ...entry}); updated++; }
        else skipped++;
      }else{ await dbPut(entry); added++; }
    }catch(e){
      errors++; errLines.push(`行${i+2}: ${e.message}`);
    }
  }
  resultEl.textContent =
    `インポート結果: 追加 ${added} / 更新 ${updated} / スキップ ${skipped} / エラー ${errors}` +
    (errLines.length ? `\n${errLines.slice(0,20).join("\n")}` : "");
  await refreshUI();
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
async function exportJSON(){
  const all = await dbGetAll();
  download("bodylog_backup.json", JSON.stringify({version:1, exportedAt:new Date().toISOString(), entries:all}, null, 2), "application/json");
}
async function importJSON(file){
  const resultEl = $("importResult");
  resultEl.textContent = "";
  if(!file){ resultEl.textContent="JSONファイルを選択してください。"; return; }
  try{
    const obj = JSON.parse(await file.text());
    if(!obj || !Array.isArray(obj.entries)) throw new Error("形式が不正");
    let count=0;
    for(const e of obj.entries){
      if(e?.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)){ await dbPut({...e, updatedAt:Date.now()}); count++; }
    }
    resultEl.textContent = `JSON復元: ${count}件取り込みました。`;
    await refreshUI();
  }catch(err){
    resultEl.textContent = `JSON復元に失敗: ${err.message}`;
  }
}

function setupInstallUI(){
  const btn = $("installBtn");
  window.addEventListener("beforeinstallprompt", (e)=>{
    e.preventDefault(); state.pendingInstallPrompt = e; btn.hidden = false;
  });
  btn.addEventListener("click", async ()=>{
    if(!state.pendingInstallPrompt) return;
    state.pendingInstallPrompt.prompt();
    await state.pendingInstallPrompt.userChoice;
    state.pendingInstallPrompt = null;
    btn.hidden = true;
  });
}

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
      const map = { weight:"fWeight", fat:"fFat", muscle:"fMuscle" };
      const id = map[el.dataset.step];
      const delta = Number(el.dataset.delta);
      const cur = numOrNull($(id).value) ?? 0;
      const next = Math.round((cur + delta) * 10) / 10;
      $(id).value = next.toFixed(1);
    });
  });

  $("importBtn").addEventListener("click", async ()=> doImportCSV($("csvFile").files?.[0]));
  $("exportCsvBtn").addEventListener("click", exportCSV);
  $("exportJsonBtn").addEventListener("click", exportJSON);
  $("importJsonBtn").addEventListener("click", ()=> $("jsonFile").click());
  $("jsonFile").addEventListener("change", async ()=>{
    await importJSON($("jsonFile").files?.[0]);
    $("jsonFile").value = "";
  });

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
}

async function init(){
  setTodayDefault();

  // SW（オフライン化）
  if("serviceWorker" in navigator){
    try{ await navigator.serviceWorker.register("/service-worker.js", { scope: "/" }); }
    catch(e){ console.warn("SW register failed", e); }
  }

  setupInstallUI();
  setupEvents();
  await refreshUI();
}
init();
