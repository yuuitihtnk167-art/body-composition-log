import { useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import {
  CategoryScale,
  Chart,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import {
  auth,
  db,
  isFirebaseConfigured,
  logOut,
  missingConfigKeys,
  signInWithGoogle,
} from "./firebase.js";

Chart.register(
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend
);

const text = {
  input: "\u5165\u529b",
  data: "\u30c7\u30fc\u30bf",
  list: "\u4e00\u89a7",
  chart: "\u30b0\u30e9\u30d5",
  bodyLogSubtitle: "\u4f53\u7d44\u6210\u30ed\u30b0",
  install: "\u30a4\u30f3\u30b9\u30c8\u30fc\u30eb",
  signInRequired: "\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059",
  signInHint: "Google\u30ed\u30b0\u30a4\u30f3\u5f8c\u306b\u3001\u5165\u529b\u30fb\u4e00\u89a7\u30fb\u30b0\u30e9\u30d5\u3092\u5229\u7528\u3067\u304d\u307e\u3059\u3002",
  approvalWaitingTitle: "\u627f\u8a8d\u5f85\u3061\u3067\u3059",
  approvalWaitingHint: "\u3053\u306e\u30a2\u30ab\u30a6\u30f3\u30c8\u306f\u307e\u3060\u627f\u8a8d\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002\u7ba1\u7406\u8005\u304cFirestore\u306e users \u30c9\u30ad\u30e5\u30e1\u30f3\u30c8\u3067 approved \u3092 true \u306b\u3059\u308b\u3068\u5229\u7528\u3067\u304d\u307e\u3059\u3002",
  approvalChecking: "\u627f\u8a8d\u72b6\u614b\u3092\u78ba\u8a8d\u4e2d...",
  googleSignInTitle: "Google\u3067\u30ed\u30b0\u30a4\u30f3",
  googleSignInHint: "Firebase Authentication\u3067\u30ed\u30b0\u30a4\u30f3\u3057\u307e\u3059\u3002",
  googleSignIn: "Google\u30ed\u30b0\u30a4\u30f3",
  checking: "\u78ba\u8a8d\u4e2d...",
  logout: "\u30ed\u30b0\u30a2\u30a6\u30c8",
  noName: "\u540d\u524d\u672a\u8a2d\u5b9a",
  noEmail: "\u30e1\u30fc\u30eb\u672a\u8a2d\u5b9a",
  date: "\u65e5\u4ed8",
  weight: "\u4f53\u91cd",
  bmi: "BMI",
  fat: "\u4f53\u8102\u80aa\u7387",
  muscle: "\u7b4b\u8089\u91cf",
  visceral: "\u5185\u81d3\u8102\u80aa",
  bmr: "\u57fa\u790e\u4ee3\u8b1d",
  bodyAge: "\u4f53\u5185\u5e74\u9f62",
  save: "\u4fdd\u5b58",
  delete: "\u524a\u9664",
  reset: "\u30ea\u30bb\u30c3\u30c8",
  importExport: "\u30a4\u30f3\u30dd\u30fc\u30c8 / \u30a8\u30af\u30b9\u30dd\u30fc\u30c8",
  chooseCsv: "CSV\u30d5\u30a1\u30a4\u30eb",
  importCsv: "CSV\u30a4\u30f3\u30dd\u30fc\u30c8",
  exportCsv: "CSV\u30a8\u30af\u30b9\u30dd\u30fc\u30c8",
  csvFormat: "CSV\u5f62\u5f0f",
  csvHint: "\u65e5\u4ed8\u306f YYYY-MM-DD \u307e\u305f\u306f YYYY/MM/DD \u306b\u5bfe\u5fdc\u3057\u307e\u3059\u3002",
  last7: "\u76f4\u8fd17\u65e5",
  last30: "\u76f4\u8fd130\u65e5",
  last90: "\u76f4\u8fd190\u65e5",
  all: "\u5168\u671f\u9593",
  desc: "\u964d\u9806",
  asc: "\u6607\u9806",
  rowHint: "\u884c\u3092\u9078\u629e\u3059\u308b\u3068\u7de8\u96c6\u3067\u304d\u307e\u3059\u3002",
  movingAverage: "7\u65e5\u5e73\u5747",
  example: "\u4f8b",
};

function buildUserProfile(authUser) {
  return {
    uid: authUser.uid,
    email: authUser.email || "",
    displayName: authUser.displayName || "",
    photoURL: authUser.photoURL || "",
    approved: false,
    role: "user",
    createdAt: serverTimestamp(),
  };
}

async function ensureUserProfile(authUser) {
  if (!db) {
    throw new Error("Firestore is not configured.");
  }

  const userRef = doc(db, "users", authUser.uid);
  const snapshot = await getDoc(userRef);

  if (!snapshot.exists()) {
    const profile = buildUserProfile(authUser);
    await setDoc(userRef, profile);
    return profile;
  }

  const existingProfile = snapshot.data();
  const safeProfileUpdate = {
    uid: authUser.uid,
    email: authUser.email || "",
    displayName: authUser.displayName || "",
    photoURL: authUser.photoURL || "",
  };

  await setDoc(userRef, safeProfileUpdate, { merge: true });

  return {
    uid: authUser.uid,
    ...existingProfile,
    ...safeProfileUpdate,
  };
}

const tabs = [
  { id: "input", label: text.input },
  { id: "import", label: text.data },
  { id: "list", label: text.list },
  { id: "chart", label: text.chart },
];

const fields = [
  { key: "weight", label: text.weight, unit: "kg", step: 0.1, inputMode: "decimal", placeholder: "55.0" },
  { key: "bmi", label: text.bmi, unit: "", step: 0.1, inputMode: "decimal", placeholder: "19.8" },
  { key: "fat", label: text.fat, unit: "%", step: 0.1, inputMode: "decimal", placeholder: "16.5" },
  { key: "muscle", label: text.muscle, unit: "kg", step: 0.1, inputMode: "decimal", placeholder: "43.5" },
  { key: "visceral", label: text.visceral, unit: "", step: 0.1, inputMode: "decimal", placeholder: "8.5" },
  { key: "bmr", label: text.bmr, unit: "kcal", step: 1, inputMode: "numeric", placeholder: "1230" },
  { key: "age", label: text.bodyAge, unit: "", step: 1, inputMode: "numeric", placeholder: "44" },
];

const csvHeaders = ["date", "weight", "bmi", "fat", "muscle", "visceral", "bmr", "age"];
const csvHeaderAliases = {
  date: ["date", "\u65e5\u4ed8"],
  weight: ["weight", "\u4f53\u91cd"],
  bmi: ["bmi", "BMI"],
  fat: ["fat", "body fat", "\u4f53\u8102\u80aa\u7387"],
  muscle: ["muscle", "\u7b4b\u8089\u91cf"],
  visceral: ["visceral", "visceral fat", "\u5185\u81d3\u8102\u80aa"],
  bmr: ["bmr", "\u57fa\u790e\u4ee3\u8b1d", "\u57fa\u790e\u4ee3\u8b1d\u91cf"],
  age: ["age", "body age", "\u4f53\u5185\u5e74\u9f62"],
};

const chartColors = {
  weight: "#38bdf8",
  bmi: "#facc15",
  fat: "#fb7185",
  muscle: "#34d399",
};

function pad2(value) {
  return String(value).padStart(2, "0");
}

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function emptyForm(date = todayISO()) {
  return {
    date,
    weight: "",
    bmi: "",
    fat: "",
    muscle: "",
    visceral: "",
    bmr: "",
    age: "",
  };
}

function dateFromISO(dateISO) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO || "")) return null;
  const [year, month, day] = dateISO.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISODate(value) {
  const rawText = String(value || "").trim();
  const textValue = rawText.replace(/^\uFEFF/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(textValue)) return textValue;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(textValue)) {
    const [year, month, day] = textValue.split("/");
    return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
  }

  const date = new Date(textValue);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function numberOrNull(value) {
  const textValue = String(value ?? "").trim();
  if (!textValue) return null;
  const number = Number(textValue);
  return Number.isFinite(number) ? number : null;
}

function formatStepValue(value, step) {
  return Number.isInteger(step) ? String(Math.round(value)) : value.toFixed(1);
}

function entriesCollectionRef(uid) {
  return collection(db, "users", uid, "entries");
}

function entryDocRef(uid, date) {
  return doc(db, "users", uid, "entries", date);
}

async function saveEntry(uid, entry) {
  await setDoc(entryDocRef(uid, entry.date), entry, { merge: true });
}

async function saveEntries(uid, entries) {
  const chunkSize = 500;

  for (let index = 0; index < entries.length; index += chunkSize) {
    const batch = writeBatch(db);
    entries.slice(index, index + chunkSize).forEach((entry) => {
      batch.set(entryDocRef(uid, entry.date), entry, { merge: true });
    });
    await batch.commit();
  }
}

async function deleteEntry(uid, date) {
  await deleteDoc(entryDocRef(uid, date));
}

async function getEntries(uid) {
  const snapshot = await getDocs(query(entriesCollectionRef(uid), orderBy("date")));
  return snapshot.docs.map((entrySnapshot) => ({
    date: entrySnapshot.id,
    ...entrySnapshot.data(),
  }));
}

function entryToForm(entry, fallbackDate = todayISO()) {
  if (!entry) return emptyForm(fallbackDate);

  return {
    date: entry.date,
    weight: entry.weight ?? "",
    bmi: entry.bmi ?? "",
    fat: entry.fat ?? "",
    muscle: entry.muscle ?? "",
    visceral: entry.visceral ?? "",
    bmr: entry.bmr ?? "",
    age: entry.age ?? "",
  };
}

function formToEntry(form) {
  return {
    date: toISODate(form.date),
    weight: numberOrNull(form.weight),
    bmi: numberOrNull(form.bmi),
    fat: numberOrNull(form.fat),
    muscle: numberOrNull(form.muscle),
    visceral: numberOrNull(form.visceral),
    bmr: numberOrNull(form.bmr),
    age: numberOrNull(form.age),
    updatedAt: Date.now(),
  };
}

function findPreviousEntry(entries, date) {
  return [...entries]
    .filter((entry) => entry.date < date)
    .sort((a, b) => b.date.localeCompare(a.date))[0] || null;
}

function withinRange(dateISO, latestISO, rangeDays) {
  if (rangeDays === "all" || !latestISO) return true;

  const date = dateFromISO(dateISO);
  const latest = dateFromISO(latestISO);
  if (!date || !latest) return true;

  const diffDays = (latest - date) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= Number(rangeDays);
}

function normalizeHeader(headerName) {
  return String(headerName || "").trim().replace(/^\uFEFF/, "").toLowerCase();
}

function getCSVColumnIndex(header, key) {
  const aliases = csvHeaderAliases[key] || [key];
  return aliases
    .map(normalizeHeader)
    .map((alias) => header.indexOf(alias))
    .find((index) => index !== -1) ?? -1;
}

function parseCSV(csvText) {
  const lines = csvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim());

  if (lines.length === 0) return { header: [], rows: [] };

  const parseLine = (line) => {
    const values = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    values.push(current);
    return values.map((value) => value.trim());
  };

  return {
    header: parseLine(lines[0]).map(normalizeHeader),
    rows: lines.slice(1).map(parseLine),
  };
}

function download(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function axisMinMax(values, { minPad = 1, padRatio = 0.15 } = {}) {
  const numbers = values.filter(Number.isFinite);
  if (numbers.length === 0) return { min: undefined, max: undefined };

  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  if (min === max) {
    const pad = Math.max(minPad, Math.abs(min) * 0.05, 0.5);
    return { min: min - pad, max: max + pad };
  }

  const pad = Math.max(minPad, (max - min) * padRatio);
  return { min: min - pad, max: max + pad };
}

function movingAverage(points, key, windowSize = 7) {
  return points.map((_, index) => {
    const slice = points
      .slice(Math.max(0, index - windowSize + 1), index + 1)
      .map((point) => point[key])
      .filter(Number.isFinite);

    return slice.length > 0 ? slice.reduce((sum, value) => sum + value, 0) / slice.length : null;
  });
}

function getFirebaseErrorMessage(error) {
  switch (error?.code) {
    case "auth/popup-closed-by-user":
      return "\u30ed\u30b0\u30a4\u30f3\u753b\u9762\u304c\u9589\u3058\u3089\u308c\u307e\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002";
    case "auth/popup-blocked":
      return "\u30dd\u30c3\u30d7\u30a2\u30c3\u30d7\u304c\u30d6\u30ed\u30c3\u30af\u3055\u308c\u307e\u3057\u305f\u3002\u30d6\u30e9\u30a6\u30b6\u8a2d\u5b9a\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
    case "auth/unauthorized-domain":
      return "\u3053\u306e\u30c9\u30e1\u30a4\u30f3\u306fFirebase Authentication\u3067\u8a31\u53ef\u3055\u308c\u3066\u3044\u307e\u305b\u3093\u3002";
    case "auth/invalid-api-key":
      return "Firebase API Key\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u3002.env\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
    default:
      return error?.message || "\u8a8d\u8a3c\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f\u3002";
  }
}

function getDataErrorMessage(action, error) {
  if (error?.code === "permission-denied") {
    return `${action}\u306b\u5931\u6557\u3057\u307e\u3057\u305f: Firestore\u306e\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093\u3002Firebase Console\u3067Firestore Rules\u3092\u6700\u65b0\u306b\u53cd\u6620\u3057\u3001users/${auth?.currentUser?.uid || "{uid}"} \u306e approved \u304c true \u306b\u306a\u3063\u3066\u3044\u308b\u304b\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002`;
  }

  return `${action}\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`;
}

function getImportErrorMessage(error) {
  if (error?.code === "permission-denied") {
    return "CSV\u30a4\u30f3\u30dd\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f: Firestore\u306e\u6a29\u9650\u304c\u3042\u308a\u307e\u305b\u3093\u3002Firebase Console\u3067Firestore Rules\u3092\u6700\u65b0\u306b\u53cd\u6620\u3057\u3001\u30ed\u30b0\u30a4\u30f3\u4e2d\u306e users/{uid}.approved \u304c true \u306b\u306a\u3063\u3066\u3044\u308b\u304b\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
  }

  return `CSV\u30a4\u30f3\u30dd\u30fc\u30c8\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`;
}

function ChartPanel({ entries, rangeDays, series }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return undefined;

    const latestISO = entries.length > 0
      ? entries.reduce((latest, entry) => (latest > entry.date ? latest : entry.date), entries[0].date)
      : null;
    const rows = entries
      .filter((entry) => withinRange(entry.date, latestISO, rangeDays))
      .sort((a, b) => a.date.localeCompare(b.date));

    const labels = rows.map((entry) => entry.date);
    const datasets = [];

    const addSeries = (label, key, yAxisID) => {
      const color = chartColors[key] || "#e6edf6";

      datasets.push({
        label,
        data: rows.map((entry) => (Number.isFinite(entry[key]) ? entry[key] : null)),
        tension: 0.25,
        spanGaps: true,
        yAxisID,
        borderColor: color,
        backgroundColor: color,
        pointBackgroundColor: color,
        pointBorderColor: "#0b1220",
        pointBorderWidth: 1.5,
        borderWidth: 2,
        pointRadius: 2.75,
        pointHoverRadius: 5,
        pointHitRadius: 12,
      });

      if (series.movingAverage) {
        datasets.push({
          label: `${label} (${text.movingAverage})`,
          data: movingAverage(rows, key, 7),
          tension: 0.25,
          spanGaps: true,
          yAxisID,
          borderColor: color,
          backgroundColor: color,
          pointBackgroundColor: color,
          pointBorderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          borderDash: [6, 6],
        });
      }
    };

    if (series.weight) addSeries(text.weight, "weight", "yKg");
    if (series.bmi) addSeries(text.bmi, "bmi", "yBmi");
    if (series.muscle) addSeries(text.muscle, "muscle", "yKg");
    if (series.fat) addSeries(text.fat, "fat", "yPct");

    const kgValues = [];
    if (series.weight) kgValues.push(...rows.map((entry) => entry.weight));
    if (series.muscle) kgValues.push(...rows.map((entry) => entry.muscle));

    const kgRange = axisMinMax(kgValues, { minPad: 0.8, padRatio: 0.18 });
    const bmiRange = axisMinMax(series.bmi ? rows.map((entry) => entry.bmi) : [], { minPad: 0.8, padRatio: 0.18 });
    const pctRange = axisMinMax(series.fat ? rows.map((entry) => entry.fat) : [], { minPad: 1.2, padRatio: 0.22 });

    chartRef.current?.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: {
              color: "#e6edf6",
              usePointStyle: true,
              boxWidth: 10,
              boxHeight: 10,
            },
          },
          tooltip: {
            backgroundColor: "rgba(11,18,32,.96)",
            borderColor: "rgba(255,255,255,.18)",
            borderWidth: 1,
            titleColor: "#f8fafc",
            bodyColor: "#e6edf6",
          },
        },
        scales: {
          x: {
            ticks: {
              color: "#a6b3c5",
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 7,
              callback: (value, index) => labels[index]?.slice(5) || "",
            },
            grid: { color: "rgba(255,255,255,.06)" },
          },
          yKg: {
            position: "left",
            ticks: { color: "#a6b3c5" },
            grid: { color: "rgba(255,255,255,.06)" },
            title: { display: true, text: "kg", color: "#a6b3c5" },
            min: kgRange.min,
            max: kgRange.max,
          },
          yPct: {
            position: "right",
            ticks: { color: "#a6b3c5" },
            grid: { drawOnChartArea: false },
            title: { display: true, text: "%", color: "#a6b3c5" },
            min: pctRange.min,
            max: pctRange.max,
          },
          yBmi: {
            position: "right",
            ticks: { color: "#a6b3c5" },
            grid: { drawOnChartArea: false },
            title: { display: true, text: "BMI", color: "#a6b3c5" },
            min: bmiRange.min,
            max: bmiRange.max,
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [entries, rangeDays, series]);

  return (
    <div className="chartWrap">
      <canvas ref={canvasRef} />
    </div>
  );
}

function UserPanel({ user, onSignIn, onSignOut, loading, error }) {
  return (
    <section className="authPanel">
      {user ? (
        <div className="userSummary">
          <img className="avatar" src={user.photoURL || "./icons/icon-180.png"} alt="" />
          <div className="userText">
            <strong>{user.displayName || text.noName}</strong>
            <span>{user.email || text.noEmail}</span>
          </div>
          <button className="btn ghost" type="button" onClick={onSignOut}>
            {text.logout}
          </button>
        </div>
      ) : (
        <div className="loginBox">
          <div>
            <strong>{text.googleSignInTitle}</strong>
            <p className="small">{text.googleSignInHint}</p>
          </div>
          <button className="btn" type="button" onClick={onSignIn} disabled={loading}>
            {loading ? text.checking : text.googleSignIn}
          </button>
        </div>
      )}
      {error && <p className="errorText">{error}</p>}
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState("input");
  const [entries, setEntries] = useState([]);
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [form, setForm] = useState(() => emptyForm());
  const [rangeDays, setRangeDays] = useState(30);
  const [sortDesc, setSortDesc] = useState(true);
  const [message, setMessage] = useState("");
  const [appError, setAppError] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  const csvFileInputRef = useRef(null);
  const initialEntryLoadedRef = useRef(false);
  const entriesRequestIdRef = useRef(0);
  const stepHoldRef = useRef({ timerId: null, repeatDelay: 180 });
  const [series, setSeries] = useState({
    weight: true,
    bmi: true,
    fat: true,
    muscle: true,
    movingAverage: false,
  });

  const currentEntry = useMemo(
    () => entries.find((entry) => entry.date === form.date) || null,
    [entries, form.date]
  );

  const latestISO = useMemo(
    () => (entries.length > 0 ? entries.reduce((latest, entry) => (latest > entry.date ? latest : entry.date), entries[0].date) : null),
    [entries]
  );

  const visibleEntries = useMemo(() => {
    const rows = entries.filter((entry) => withinRange(entry.date, latestISO, rangeDays));
    return [...rows].sort((a, b) => (sortDesc ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)));
  }, [entries, latestISO, rangeDays, sortDesc]);

  async function refreshEntries() {
    if (!user?.uid) {
      setEntries([]);
      setEntriesLoaded(true);
      return;
    }

    const requestId = entriesRequestIdRef.current + 1;
    entriesRequestIdRef.current = requestId;
    const all = await getEntries(user.uid);
    if (entriesRequestIdRef.current !== requestId) return;

    setEntries(all);
    setEntriesLoaded(true);
    setAppError("");
  }

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      entriesRequestIdRef.current += 1;
      setUser(nextUser);
      setUserProfile(null);
      setEntries([]);
      setEntriesLoaded(false);
      setForm(emptyForm());
      initialEntryLoadedRef.current = false;
      setMessage("");
      setAppError("");
      setAuthLoading(false);
      setAuthError("");
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) {
      setApprovalLoading(false);
      setUserProfile(null);
      return;
    }

    setApprovalLoading(true);
    ensureUserProfile(user)
      .then((profile) => {
        setUserProfile(profile);
        setAuthError("");
      })
      .catch((error) => {
        setAuthError(`\u627f\u8a8d\u60c5\u5831\u306e\u78ba\u8a8d\u306b\u5931\u6557\u3057\u307e\u3057\u305f: ${error.message}`);
        setUserProfile(null);
      })
      .finally(() => {
        setApprovalLoading(false);
      });
  }, [user]);

  useEffect(() => {
    if (!user || userProfile?.approved !== true) return;

    setEntriesLoaded(false);
    initialEntryLoadedRef.current = false;
    refreshEntries().catch((error) => {
      setAppError(getDataErrorMessage("\u30c7\u30fc\u30bf\u306e\u8aad\u307f\u8fbc\u307f", error));
      setEntriesLoaded(true);
    });
  }, [user, userProfile?.approved]);

  useEffect(() => {
    if (!user || !entriesLoaded || initialEntryLoadedRef.current) return;

    const date = toISODate(form.date);
    if (!date) return;

    const existing = entries.find((entry) => entry.date === date);
    if (existing) {
      setForm(entryToForm(existing));
      initialEntryLoadedRef.current = true;
      return;
    }

    const previous = findPreviousEntry(entries, date);
    if (previous) {
      setForm({
        ...entryToForm(previous, date),
        date,
      });
    }

    initialEntryLoadedRef.current = true;
  }, [entries, entriesLoaded, form.date, user]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (import.meta.env.DEV) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
        .catch((error) => console.warn("Service Worker cleanup failed", error));

      caches
        ?.keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch((error) => console.warn("Cache cleanup failed", error));
      return;
    }

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register("./service-worker.js")
      .then((registration) => registration.update())
      .catch((error) => console.warn("Service Worker registration failed", error));
  }, []);

  useEffect(() => stopStepHold, []);

  async function handleSignIn() {
    setAuthError("");
    setAuthLoading(true);

    try {
      await signInWithGoogle();
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleSignOut() {
    setAuthError("");

    try {
      await logOut();
      setEntries([]);
      setEntriesLoaded(false);
      setUserProfile(null);
      setForm(emptyForm());
      initialEntryLoadedRef.current = false;
      setMessage("");
    } catch (error) {
      setAuthError(getFirebaseErrorMessage(error));
    }
  }

  function handleDateChange(date) {
    const isoDate = toISODate(date);
    if (!isoDate) {
      setForm((current) => ({ ...current, date }));
      return;
    }

    const existing = entries.find((entry) => entry.date === isoDate);
    if (existing) {
      setForm(entryToForm(existing));
      setMessage("\u65e2\u5b58\u30c7\u30fc\u30bf\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f\u3002");
      return;
    }

    const previous = findPreviousEntry(entries, isoDate);
    setForm({
      ...entryToForm(previous, isoDate),
      date: isoDate,
    });
    setMessage("");
  }

  function updateFormField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function stepField(key, step) {
    setForm((currentForm) => {
      const current = numberOrNull(currentForm[key]) ?? 0;
      const factor = Number.isInteger(step) ? 1 : 10;
      const next = Math.round((current + step) * factor) / factor;
      return {
        ...currentForm,
        [key]: formatStepValue(next, step),
      };
    });
  }

  function stopStepHold() {
    if (!stepHoldRef.current.timerId) return;

    clearTimeout(stepHoldRef.current.timerId);
    stepHoldRef.current.timerId = null;
  }

  function repeatStep(key, step) {
    stepField(key, step);
    stepHoldRef.current.repeatDelay = Math.max(45, Math.round(stepHoldRef.current.repeatDelay * 0.82));
    stepHoldRef.current.timerId = window.setTimeout(
      () => repeatStep(key, step),
      stepHoldRef.current.repeatDelay
    );
  }

  function startStepHold(event, key, step) {
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    stopStepHold();
    stepHoldRef.current.repeatDelay = 180;
    stepField(key, step);
    stepHoldRef.current.timerId = window.setTimeout(() => repeatStep(key, step), 420);
  }

  function handleStepClick(event, key, step) {
    if (event.detail !== 0) return;
    stepField(key, step);
  }

  async function handleSave(event) {
    event.preventDefault();
    setAppError("");

    if (!user?.uid) {
      setAppError("\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002");
      return;
    }

    const entry = formToEntry(form);
    if (!entry.date) {
      setAppError("\u65e5\u4ed8\u304c\u6b63\u3057\u304f\u3042\u308a\u307e\u305b\u3093\u3002");
      return;
    }

    try {
      await saveEntry(user.uid, entry);
      await refreshEntries();
      setMessage("\u4fdd\u5b58\u3057\u307e\u3057\u305f\u3002");
    } catch (error) {
      setAppError(getDataErrorMessage("\u4fdd\u5b58", error));
    }
  }

  async function handleDelete() {
    if (!form.date) return;
    if (!user?.uid) {
      setAppError("\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002");
      return;
    }
    if (!window.confirm(`${form.date} \u306e\u30c7\u30fc\u30bf\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f`)) return;

    try {
      await deleteEntry(user.uid, form.date);
      await refreshEntries();
      setForm(emptyForm(form.date));
      setMessage("\u524a\u9664\u3057\u307e\u3057\u305f\u3002");
    } catch (error) {
      setAppError(getDataErrorMessage("\u524a\u9664", error));
    }
  }

  function handleReset() {
    const latestEntry = [...entries].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
    setForm(entryToForm(latestEntry, toISODate(form.date) || todayISO()));
    setMessage("");
  }

  function handleRowClick(entry) {
    setForm(entryToForm(entry));
    setActiveTab("input");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function handleExportCSV() {
    const lines = [csvHeaders.join(",")];
    [...entries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((entry) => {
        lines.push([
          entry.date,
          entry.weight ?? "",
          entry.bmi ?? "",
          entry.fat ?? "",
          entry.muscle ?? "",
          entry.visceral ?? "",
          entry.bmr ?? "",
          entry.age ?? "",
        ].join(","));
      });

    download("bodylog_export.csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  async function handleImportCSV() {
    const selectedCsvFile = csvFileInputRef.current?.files?.[0] || null;

    if (!user?.uid) {
      setAppError("\u30ed\u30b0\u30a4\u30f3\u304c\u5fc5\u8981\u3067\u3059\u3002");
      return;
    }

    if (!selectedCsvFile) {
      setAppError("CSV\u30d5\u30a1\u30a4\u30eb\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002");
      return;
    }

    try {
      const { header, rows } = parseCSV(await selectedCsvFile.text());
      const index = Object.fromEntries(csvHeaders.map((name) => [name, getCSVColumnIndex(header, name)]));
      const missingHeaders = csvHeaders.filter((name) => index[name] === -1);

      if (missingHeaders.length > 0) {
        const labels = missingHeaders.map((name) => fields.find((field) => field.key === name)?.label || text.date);
        setAppError(`CSV\u30d8\u30c3\u30c0\u30fc\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059: ${labels.join(" / ")}`);
        return;
      }

      const incoming = rows.map((row) => {
        const date = toISODate(row[index.date]);
        if (!date) throw new Error("\u65e5\u4ed8\u5f62\u5f0f\u304c\u6b63\u3057\u304f\u306a\u3044\u884c\u304c\u3042\u308a\u307e\u3059\u3002");

        return {
          date,
          weight: numberOrNull(row[index.weight]),
          bmi: numberOrNull(row[index.bmi]),
          fat: numberOrNull(row[index.fat]),
          muscle: numberOrNull(row[index.muscle]),
          visceral: numberOrNull(row[index.visceral]),
          bmr: numberOrNull(row[index.bmr]),
          age: numberOrNull(row[index.age]),
          updatedAt: Date.now(),
        };
      });

      const existingDates = new Set(entries.map((entry) => entry.date));
      const conflictCount = incoming.filter((entry) => existingDates.has(entry.date)).length;
      if (conflictCount > 0 && !window.confirm(`${conflictCount}\u4ef6\u306e\u65e2\u5b58\u30c7\u30fc\u30bf\u3092\u4e0a\u66f8\u304d\u3057\u307e\u3059\u304b\uff1f`)) {
        setMessage("\u30a4\u30f3\u30dd\u30fc\u30c8\u3092\u30ad\u30e3\u30f3\u30bb\u30eb\u3057\u307e\u3057\u305f\u3002");
        return;
      }

      await saveEntries(user.uid, incoming);
      await refreshEntries();
      setMessage(`${incoming.length}\u4ef6\u30a4\u30f3\u30dd\u30fc\u30c8\u3057\u307e\u3057\u305f\u3002`);
      setAppError("");
      if (csvFileInputRef.current) {
        csvFileInputRef.current.value = "";
      }
    } catch (error) {
      setAppError(getImportErrorMessage(error));
    }
  }

  async function handleInstall() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="./icons/icon-180.png" alt="" aria-hidden="true" />
          <div>
            <div className="title">BodyLog</div>
            <div className="subtitle">{text.bodyLogSubtitle}</div>
          </div>
        </div>
        {installPrompt && (
          <button className="btn ghost" type="button" onClick={handleInstall}>
            {text.install}
          </button>
        )}
      </header>

      <nav className="tabs" role="tablist" aria-label="BodyLog view switcher">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="container">
        <UserPanel
          user={user}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
          loading={authLoading}
          error={
            authError ||
            (!isFirebaseConfigured
              ? `Firebase\u8a2d\u5b9a\u304c\u4e0d\u8db3\u3057\u3066\u3044\u307e\u3059: ${missingConfigKeys.join(", ")}`
              : "")
          }
        />

        {!user ? (
          <section className="card">
            <h2>{text.signInRequired}</h2>
            <p className="small">{text.signInHint}</p>
          </section>
        ) : approvalLoading ? (
          <section className="card">
            <h2>{text.approvalChecking}</h2>
            <p className="small">{user.email}</p>
          </section>
        ) : userProfile?.approved !== true ? (
          <section className="card">
            <h2>{text.approvalWaitingTitle}</h2>
            <p className="small">{text.approvalWaitingHint}</p>
          </section>
        ) : (
          <>
            {activeTab === "input" && (
              <section className="card">
                <form className="form" onSubmit={handleSave}>
                  <div className="row">
                    <label htmlFor="date">{text.date}</label>
                    <input
                      id="date"
                      type="date"
                      required
                      value={form.date}
                      onChange={(event) => handleDateChange(event.target.value)}
                    />
                  </div>

                  {fields.map((field) => (
                    <div className="row" key={field.key}>
                      <label htmlFor={field.key}>
                        {field.label}{field.unit ? ` (${field.unit})` : ""}
                      </label>
                      <div className="withStepper">
                        <button
                          className="step"
                          type="button"
                          onPointerDown={(event) => startStepHold(event, field.key, -field.step)}
                          onPointerUp={stopStepHold}
                          onPointerCancel={stopStepHold}
                          onPointerLeave={stopStepHold}
                          onLostPointerCapture={stopStepHold}
                          onClick={(event) => handleStepClick(event, field.key, -field.step)}
                        >
                          -
                        </button>
                        <input
                          id={field.key}
                          inputMode={field.inputMode}
                          placeholder={`${text.example}: ${field.placeholder}`}
                          value={form[field.key]}
                          onChange={(event) => updateFormField(field.key, event.target.value)}
                        />
                        <button
                          className="step"
                          type="button"
                          onPointerDown={(event) => startStepHold(event, field.key, field.step)}
                          onPointerUp={stopStepHold}
                          onPointerCancel={stopStepHold}
                          onPointerLeave={stopStepHold}
                          onLostPointerCapture={stopStepHold}
                          onClick={(event) => handleStepClick(event, field.key, field.step)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="actions">
                    <button className="btn" type="submit">{text.save}</button>
                    <button className="btn danger" type="button" onClick={handleDelete} disabled={!currentEntry}>
                      {text.delete}
                    </button>
                    <button className="btn ghost" type="button" onClick={handleReset}>
                      {text.reset}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {activeTab === "import" && (
              <section className="card">
                <h2>{text.importExport}</h2>
                <div className="importBox">
                  <label htmlFor="csvFile">{text.chooseCsv}</label>
                  <input
                    id="csvFile"
                    ref={csvFileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      if (event.target.files?.[0]) {
                        setMessage(`${event.target.files[0].name} \u3092\u9078\u629e\u3057\u307e\u3057\u305f\u3002`);
                      } else {
                        setMessage("");
                      }
                      setAppError("");
                    }}
                  />
                  <div className="importActions">
                    <button className="btn" type="button" onClick={handleImportCSV}>
                      {text.importCsv}
                    </button>
                    <button className="btn ghost" type="button" onClick={handleExportCSV}>
                      {text.exportCsv}
                    </button>
                  </div>
                  <details className="noteBox">
                    <summary>{text.csvFormat}</summary>
                    <pre>{csvHeaders.join(",")}</pre>
                    <p className="small">{text.csvHint}</p>
                    <p className="small">
                      {"\u65e5\u672c\u8a9e\u30d8\u30c3\u30c0\u30fc\uff08\u65e5\u4ed8,\u4f53\u91cd,BMI,\u4f53\u8102\u80aa\u7387,\u7b4b\u8089\u91cf,\u5185\u81d3\u8102\u80aa,\u57fa\u790e\u4ee3\u8b1d,\u4f53\u5185\u5e74\u9f62\uff09\u306b\u3082\u5bfe\u5fdc\u3057\u307e\u3059\u3002"}
                    </p>
                  </details>
                </div>
              </section>
            )}

            {activeTab === "list" && (
              <section className="card">
                <h2>{text.list}</h2>
                <div className="toolbar">
                  <select value={rangeDays} onChange={(event) => setRangeDays(event.target.value === "all" ? "all" : Number(event.target.value))}>
                    <option value="7">{text.last7}</option>
                    <option value="30">{text.last30}</option>
                    <option value="90">{text.last90}</option>
                    <option value="all">{text.all}</option>
                  </select>
                  <button className="btn ghost" type="button" onClick={() => setSortDesc((current) => !current)}>
                    {text.date} {sortDesc ? text.desc : text.asc}
                  </button>
                </div>
                <div className="tableWrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{text.date}</th>
                        {fields.map((field) => <th key={field.key}>{field.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleEntries.map((entry) => (
                        <tr key={entry.date} onClick={() => handleRowClick(entry)}>
                          <td>{entry.date}</td>
                          {fields.map((field) => <td key={field.key}>{entry[field.key] ?? ""}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small">{text.rowHint}</p>
              </section>
            )}

            {activeTab === "chart" && (
              <section className="card">
                <h2>{text.chart}</h2>
                <div className="toolbar">
                  {[
                    ["weight", text.weight],
                    ["bmi", text.bmi],
                    ["fat", text.fat],
                    ["muscle", text.muscle],
                    ["movingAverage", text.movingAverage],
                  ].map(([key, label]) => (
                    <label className="chk" key={key}>
                      <input
                        type="checkbox"
                        checked={series[key]}
                        onChange={(event) => setSeries((current) => ({ ...current, [key]: event.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <ChartPanel entries={entries} rangeDays={rangeDays} series={series} />
              </section>
            )}
          </>
        )}

        {(message || appError) && (
          <section className="statusArea">
            {message && <p className="note">{message}</p>}
            {appError && <p className="errorText">{appError}</p>}
          </section>
        )}
      </main>
    </>
  );
}
