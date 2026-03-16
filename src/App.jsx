import { useState, useCallback, useMemo } from "react";
import { Moon, Sun } from "lucide-react";
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip as RT, Legend, ResponsiveContainer
} from "recharts";

// ─── CSV ──────────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const raw = text.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const parseLine = line => {
    const vals = []; let cur = "", inQ = false;
    for (const c of line) {
      if (c === '"') { inQ = !inQ; continue; }
      if (c === "," && !inQ) { vals.push(cur); cur = ""; continue; }
      cur += c;
    }
    vals.push(cur); return vals;
  };
  const headers = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (vals[i] || "").trim(); });
    return obj;
  });
}

function processMUSP(rows) {
  return rows.flatMap(r => {
    const ic        = (r["ISP (Cluster information from SFDC)"] || "").trim();
    const doctor    = (r["Doctor's Name"] || "").trim().replace(/^'+/, "");
    const date      = (r[""] || "").trim().slice(0, 7);
    const treatment = (r["By Treatment"] || "").trim();
    const val       = parseInt(r["1. MUSP (Monthly Unique Scanned Patients)"] || "0") || 0;
    return (ic && doctor && date && treatment && !BLOCKED_ICS.includes(ic)) ? [{ ic, doctor, date, treatment, val }] : [];
  });
}

function processPS(rows) {
  return rows.flatMap(r => {
    const ic        = (r["ISP (Cluster information from SFDC)"] || "").trim();
    const doctor    = (r["Doctor's Name"] || "").trim().replace(/^'+/, "");
    const date      = (r[""] || "").trim().slice(0, 7);
    const treatment = (r["By Treatment"] || "").trim();
    const val       = parseInt(r["2. First Scanned Patients"] || "0") || 0;
    return (doctor && date && treatment && !BLOCKED_ICS.includes(ic)) ? [{ ic, doctor, date, treatment, val }] : [];
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TREATMENTS = ["Aligners", "Braces", "Pre-Treatment", "Post-Treatment", "Others"];
const TC = { Aligners:"#3b82f6", Braces:"#8b5cf6", "Pre-Treatment":"#06b6d4", "Post-Treatment":"#10b981", Others:"#f59e0b" };
const BLOCKED_ICS = ["Cory Lawing", "Niki Talma", "Bronie Shvarts", "Bronie"];
const DARK  = { bg:"#020817", surface:"#0c1525", border:"#1a2744", text:"#e2e8f0", muted:"#64748b", accent:"#3b82f6", green:"#10b981", red:"#ef4444", amber:"#f59e0b", purple:"#a78bfa", psColor:"#10b981" };
const LIGHT = { bg:"#f0f4fa", surface:"#ffffff", border:"#dde3ef", text:"#0f172a", muted:"#64748b", accent:"#2563eb", green:"#059669", red:"#dc2626", amber:"#d97706", purple:"#7c3aed", psColor:"#059669" };
let C = DARK; // mutable ref updated before each render

const MODES = {
  musp: { key:"musp", label:"MUSP",           color:"#3b82f6", unit:"scans" },
  ps:   { key:"ps",   label:"Patients Start", color:"#10b981", unit:"starts" },
};

const SIZE_BUCKETS = [
  { label:"All",   min:0,   max:Infinity },
  { label:"< 10",  min:0,   max:9.99 },
  { label:"10-49", min:10,  max:49.99 },
  { label:"50-99", min:50,  max:99.99 },
  { label:"100+",  min:100, max:Infinity },
];

const STATUS = {
  growing:  { label:"GROWING",   color:"#10b981", bg:"#10b98115", arrow:"\u25b2" },
  declining:{ label:"DECLINING", color:"#ef4444", bg:"#ef444415", arrow:"\u25bc" },
  stable:   { label:"STABLE",    color:"#f59e0b", bg:"#f59e0b15", arrow:"\u2192" },
};

const TT = {
  contentStyle:{ background:"var(--tt-bg,#0c1525)", border:"1px solid var(--tt-border,#1a2744)", borderRadius:8, fontSize:12 },
  labelStyle:{ color:"#e2e8f0" }, itemStyle:{ color:"#94a3b8" },
};

const makeCss = (dark) => `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:${dark?"#020817":"#f0f4fa"}}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:${dark?"#0c1525":"#e2e8f0"}}
::-webkit-scrollbar-thumb{background:${dark?"#1a2744":"#cbd5e1"};border-radius:2px}
.rh:hover{background:${dark?"#0c1525":"#f0f4fa"}!important}
select option{background:${dark?"#0c1525":"#ffffff"}}
.tipw{position:relative;display:inline-flex;align-items:center;cursor:help}
.range-thumb::-webkit-slider-thumb{
  -webkit-appearance:none;appearance:none;
  width:16px;height:16px;border-radius:50%;
  background:#3b82f6;border:2px solid ${dark?"#020817":"#f0f4fa"};
  cursor:pointer;transition:transform .1s,box-shadow .1s;
}
.range-thumb::-webkit-slider-thumb:hover{transform:scale(1.25);box-shadow:0 0 0 4px #3b82f630;}
.range-thumb::-moz-range-thumb{
  width:16px;height:16px;border-radius:50%;
  background:#3b82f6;border:2px solid ${dark?"#020817":"#f0f4fa"};cursor:pointer;
}
.tipw .tip{
  display:none;position:fixed;
  background:${dark?"#0c1525":"#ffffff"};border:1px solid ${dark?"#2d4a7a":"#dde3ef"};border-radius:8px;
  padding:10px 12px;font-size:11px;color:${dark?"#94a3b8":"#475569"};width:220px;
  z-index:99999;line-height:1.6;pointer-events:none;
  box-shadow:0 8px 32px #00000033;
}
.tipw:hover .tip{display:block}
`;

// ─── Math ─────────────────────────────────────────────────────────────────────
const fmtM = m => {
  if (!m) return "";
  const mo = parseInt(m.split("-")[1]) - 1;
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][mo] + " " + m.slice(2,4);
};

// Linear regression slope — the core signal. Works on raw monthly values (no avg).
const calcSlope = (byMonth, months) => {
  const vals = months.map(m => byMonth[m] || 0);
  const n = vals.length; if (n < 2) return 0;
  const xm = (n-1)/2;
  const ym = vals.reduce((a,b) => a+b, 0) / n;
  let num = 0, den = 0;
  vals.forEach((y, x) => { num += (x-xm)*(y-ym); den += (x-xm)*(x-xm); });
  return den === 0 ? 0 : num/den;
};

// Total over period — used instead of avg for PS to avoid "avg of sparse months" problem
const totalOver = (byMonth, months) => months.reduce((s,m) => s+(byMonth[m]||0), 0);

// Avg MUSP/mo — used for MUSP sizing buckets
const avgOver = (byMonth, months) => months.length ? totalOver(byMonth, months)/months.length : 0;

// Compound monthly growth rate — first to last, over n-1 intervals
const cagr = (byMonth, months) => {
  if (months.length < 2) return null;
  const vals = months.map(m => byMonth[m]||0);
  const first = vals[0], last = vals[vals.length-1];
  if (first === 0) return null;
  return (Math.pow(last/first, 1/(months.length-1)) - 1) * 100;
};

const perfStatus = sl => sl >= 1 ? "growing" : sl <= -1 ? "declining" : "stable";

const fmt  = (v, d) => { const dp=d===undefined?1:d; return (v===null||v===undefined)?"–":(v>0?"+":"")+v.toFixed(dp); };
const fmtV = v => v===null||v===undefined ? "–" : v.toLocaleString();
const gc   = g => g===null ? C.muted : g>=0 ? C.green : C.red;
const sc   = s => s>=1 ? C.green : s<=-1 ? C.red : C.amber;

// ─── Build doctor stats — unified for MUSP and PS ─────────────────────────────
// Returns array of doctor objects with byMonth, byTreatment, slope, total, status
function buildDoctorStats(rows, months, sizeBuckets, sortDir, sortKey, applySize) {
  const map = {};
  rows.forEach(r => {
    if (!map[r.doctor]) map[r.doctor] = { doctor:r.doctor, ic:r.ic, byMonth:{}, byTreatment:{}, mbt:{}, total:0 };
    const s = map[r.doctor];
    s.byMonth[r.date]          = (s.byMonth[r.date]||0) + r.val;
    s.byTreatment[r.treatment] = (s.byTreatment[r.treatment]||0) + r.val;
    if (!s.mbt[r.date]) s.mbt[r.date] = {};
    s.mbt[r.date][r.treatment] = (s.mbt[r.date][r.treatment]||0) + r.val;
    s.total += r.val;
  });
  // Multi-select: pass if avg falls in ANY selected bucket (or no filter)
  const activeBuckets = applySize && sizeBuckets.length > 0
    ? sizeBuckets.map(i => SIZE_BUCKETS[i])
    : [SIZE_BUCKETS[0]]; // "All"
  return Object.values(map).map(s => {
    const vals   = months.map(m => s.byMonth[m]||0);
    const slope  = calcSlope(s.byMonth, months);
    const total  = totalOver(s.byMonth, months);
    const avg    = avgOver(s.byMonth, months);
    const growth = cagr(s.byMonth, months);
    return { ...s, vals, slope, total, avg, growth, status:perfStatus(slope) };
  })
  .filter(d => activeBuckets.some(b => d.avg >= b.min && d.avg <= b.max))
  .sort((a,b) => {
    const key = sortKey === "total" ? "total" : "slope";
    return sortDir==="asc" ? a[key]-b[key] : b[key]-a[key];
  });
}

// Build full-history slopes from raw data (all months, no filters)
function buildFullSlopes(data, allMonths) {
  if (!data || allMonths.length < 2) return {};
  const map = {};
  data.forEach(r => {
    if (!map[r.doctor]) map[r.doctor] = {};
    map[r.doctor][r.date] = (map[r.doctor][r.date]||0) + r.val;
  });
  const result = {};
  Object.entries(map).forEach(([doc, byM]) => { result[doc] = calcSlope(byM, allMonths); });
  return result;
}

// Build per-doctor conversion map: { doctor: { month: rate%, byTreatment: {...} } }
function buildConvStats(muspData, psData, months, sizeBucket, sortDir, applySize) {
  // Merge musp and ps by doctor+month+treatment
  const muspMap = {}, psMap = {};
  muspData.forEach(r => {
    if (!muspMap[r.doctor]) muspMap[r.doctor] = { ic:r.ic, byMonth:{}, byTreatment:{}, mbt:{} };
    const s = muspMap[r.doctor];
    s.byMonth[r.date]          = (s.byMonth[r.date]||0) + r.val;
    s.byTreatment[r.treatment] = (s.byTreatment[r.treatment]||0) + r.val;
    if (!s.mbt[r.date]) s.mbt[r.date] = {};
    s.mbt[r.date][r.treatment] = (s.mbt[r.date][r.treatment]||0) + r.val;
  });
  (psData||[]).forEach(r => {
    if (!psMap[r.doctor]) psMap[r.doctor] = { byMonth:{}, byTreatment:{}, mbt:{} };
    const s = psMap[r.doctor];
    s.byMonth[r.date]          = (s.byMonth[r.date]||0) + r.val;
    s.byTreatment[r.treatment] = (s.byTreatment[r.treatment]||0) + r.val;
    if (!s.mbt[r.date]) s.mbt[r.date] = {};
    s.mbt[r.date][r.treatment] = (s.mbt[r.date][r.treatment]||0) + r.val;
  });

  const bucket = SIZE_BUCKETS[applySize ? sizeBucket : 0];
  const doctors = Object.keys(muspMap).filter(doc => psMap[doc]);
  return doctors.map(doc => {
    const m = muspMap[doc], p = psMap[doc];
    const totalMusp = totalOver(m.byMonth, months);
    const totalPs   = totalOver(p.byMonth, months);
    const convRate  = totalMusp > 0 ? (totalPs/totalMusp*100) : null;
    const avgMusp   = avgOver(m.byMonth, months);

    // Conv rate by month as a time series
    const convByMonth = {};
    months.forEach(mo => {
      const mu = m.byMonth[mo]||0, ps = p.byMonth[mo]||0;
      convByMonth[mo] = mu > 0 ? (ps/mu*100) : 0;
    });
    const slope  = calcSlope(convByMonth, months);
    const vals   = months.map(mo => convByMonth[mo]);

    // Conv rate by treatment
    const convByTreatment = {};
    TREATMENTS.forEach(t => {
      const mu = m.byTreatment[t]||0, ps = p.byTreatment[t]||0;
      convByTreatment[t] = mu > 0 ? (ps/mu*100) : null;
    });

    return {
      doctor:doc, ic:m.ic,
      totalMusp, totalPs, convRate,
      byMonth:convByMonth, byTreatment:convByTreatment,
      muspByTreatment:m.byTreatment, psByTreatment:p.byTreatment,
      muspByMonth:m.byMonth, psByMonth:p.byMonth,
      mbt:m.mbt, pmbt:p.mbt,
      vals, slope, avg:avgMusp, status:perfStatus(slope),
    };
  })
  .filter(d => d.avg >= bucket.min && d.avg <= bucket.max)
  .sort((a,b) => sortDir==="asc" ? a.slope-b.slope : b.slope-a.slope);
}

// ─── Tiny components ──────────────────────────────────────────────────────────
const Tip = ({ text, children }) => (
  <span className="tipw">
    {children}
    <span className="tip">{text}</span>
  </span>
);

const Tag = ({ status }) => {
  const s = STATUS[status] || STATUS.stable;
  return (
    <span style={{ background:s.bg, color:s.color, border:"1px solid "+s.color+"30", borderRadius:4, padding:"2px 7px", fontSize:10, fontWeight:700, letterSpacing:.8, whiteSpace:"nowrap" }}>
      {s.arrow} {s.label}
    </span>
  );
};

const SparkLine = ({ vals, color }) => {
  const n = (vals||[]).length;
  if (n < 2) return null;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const range = max - min || 1;
  const h = 22, w = 100, pad = 2; // pad prevents clipping at edges
  const pts = vals.map((v,i) => `${pad + (i/(n-1))*(w-pad*2)},${pad + (h-pad*2) - ((v-min)/range)*(h-pad*2)}`).join(" ");
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display:"block", marginTop:4 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity={0.85}/>
    </svg>
  );
};

// ─── Theme Toggle pill ────────────────────────────────────────────────────────
const ThemeToggle = ({ darkMode, setDarkMode }) => (
  <div
    onClick={() => setDarkMode(!darkMode)}
    role="button" tabIndex={0}
    onKeyDown={e => e.key === "Enter" && setDarkMode(!darkMode)}
    style={{
      display:"flex", alignItems:"center", justifyContent:"space-between",
      width:56, height:28, padding:"0 3px",
      borderRadius:999, cursor:"pointer",
      background: darkMode ? "#09090b" : "#ffffff",
      border: "1px solid " + (darkMode ? "#27272a" : "#e4e4e7"),
      transition:"background .3s, border-color .3s",
      flexShrink:0,
    }}
  >
    {/* Left pill — active in dark mode */}
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"center",
      width:22, height:22, borderRadius:"50%",
      background: darkMode ? "#3f3f46" : "transparent",
      transform: darkMode ? "translateX(0)" : "translateX(28px)",
      transition:"transform .3s, background .3s",
      flexShrink:0,
    }}>
      {darkMode
        ? <Moon size={13} strokeWidth={1.5} color="#ffffff"/>
        : <Sun  size={13} strokeWidth={1.5} color="#6b7280"/>
      }
    </div>
    {/* Right pill — active in light mode */}
    <div style={{
      display:"flex", alignItems:"center", justifyContent:"center",
      width:22, height:22, borderRadius:"50%",
      background: darkMode ? "transparent" : "#e4e4e7",
      transform: darkMode ? "translateX(0)" : "translateX(-28px)",
      transition:"transform .3s, background .3s",
      flexShrink:0,
    }}>
      {darkMode
        ? <Sun  size={13} strokeWidth={1.5} color="#71717a"/>
        : <Moon size={13} strokeWidth={1.5} color="#111111"/>
      }
    </div>
  </div>
);

const ModeSwitch = ({ mode, setMode, hasPS, darkMode, setDarkMode }) => (
  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
    <div style={{ display:"flex", background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:3, gap:2 }}>
      {Object.values(MODES).filter(m => m.key !== "ps" || hasPS).map(m => (
        <button key={m.key} onClick={() => setMode(m.key)}
          style={{ padding:"5px 16px", borderRadius:7, border:"none", background:mode===m.key?m.color+"20":"transparent", color:mode===m.key?m.color:C.muted, fontSize:12, fontWeight:mode===m.key?700:400, cursor:"pointer", transition:"all .15s", fontFamily:"inherit" }}>
          {m.label}
        </button>
      ))}
    </div>
    <ThemeToggle darkMode={darkMode} setDarkMode={setDarkMode}/>
  </div>
);

// ─── Doctor list item ─────────────────────────────────────────────────────────
const DocListItem = ({ d, mode, modeColor, isSelected, onClick, activeMonths }) => {
  const s = STATUS[d.status];
  const metricLabel = fmtV(d.total);
  const slopeLabel  = fmt(d.slope,1)+"/mo";
  return (
    <div className="rh" onClick={onClick}
      style={{ padding:"9px 12px", borderBottom:"1px solid "+C.border, cursor:"pointer", background:isSelected?C.border:"transparent", borderLeft:"3px solid "+(isSelected?s.color:"transparent"), transition:"all .1s" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:5 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.doctor}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>{d.ic.split(" ")[0]}</div>
        </div>
        <div style={{ textAlign:"right", marginLeft:6, flexShrink:0 }}>
          <div style={{ fontSize:12, fontWeight:700, fontFamily:"DM Mono,monospace", color:sc(d.slope) }}>{slopeLabel}</div>
          <div style={{ fontSize:10, color:C.muted }}>{metricLabel}</div>
        </div>
      </div>
      <SparkLine vals={d.vals} color={s.color}/>
    </div>
  );
};

// ─── Doctor detail — adapts to mode ───────────────────────────────────────────
function DocDetail({ selDoc, doctorStats, allDoctorStats, activeMonths, allMonths, fullSlopes, mode, muspData, psData }) {
  const [localTreatF, setLocalTreatF] = useState("All"); // resets on remount (new doctor)

  const d = doctorStats.find(x=>x.doctor===selDoc) || allDoctorStats.find(x=>x.doctor===selDoc);
  if (!d) return <div style={{ padding:24, color:C.muted, fontSize:13 }}>Not visible with current filters.</div>;

  const modeInfo = MODES[mode];
  const fullSl   = (allMonths.length > activeMonths.length && fullSlopes) ? (fullSlopes[d.doctor]??null) : null;
  const slopeDiff= fullSl!==null ? d.slope-fullSl : null;

  // Divergence banner
  const showDivergence = slopeDiff!==null && Math.abs(slopeDiff)>=1.5;
  const divDown = slopeDiff<=(-1.5);

  // Months filtered by local treatment selection
  const filteredMonths = activeMonths; // period unchanged, only chart lines filtered

  // Chart data — when a treatment is selected, show only that treatment line + Total
  const lineData = filteredMonths.map(m => {
    const row = { month:fmtM(m), Total:d.byMonth[m]||0 };
    TREATMENTS.forEach(t => { row[t] = d.mbt&&d.mbt[m] ? (d.mbt[m][t]||0) : 0; });
    return row;
  });
  const chartLines = localTreatF === "All"
    ? [
        { key:"Total", color:modeInfo.color, width:2.5, dashed:false },
        ...TREATMENTS.filter(t => (d.byTreatment[t]||0)>0).map(t => ({ key:t, color:TC[t], width:1.5, dashed:true })),
      ]
    : [
        { key:"Total", color:modeInfo.color, width:2, dashed:true },
        { key:localTreatF, color:TC[localTreatF], width:2.5, dashed:false },
      ];

  // KPIs — adapt to local filter
  const kpiByMonth = localTreatF === "All"
    ? d.byMonth
    : Object.fromEntries(activeMonths.map(m => [m, d.mbt&&d.mbt[m]?(d.mbt[m][localTreatF]||0):0]));
  const kpiSlope  = calcSlope(kpiByMonth, activeMonths);
  const kpiTotal  = totalOver(kpiByMonth, activeMonths);
  const kpiGrowth = cagr(kpiByMonth, activeMonths);
  const kpis = [
    { label:"Slope",   value:fmt(kpiSlope,1)+"/mo",  color:sc(kpiSlope),   tip:"Linear regression slope on raw monthly values. >=+1 = Growing." },
    { label:"Growth",  value:fmt(kpiGrowth,1)+"%",   color:gc(kpiGrowth),  tip:"Compound monthly growth rate (first to last month)." },
    { label:localTreatF==="All"?"Total":localTreatF, value:fmtV(kpiTotal), color:localTreatF==="All"?modeInfo.color:TC[localTreatF], tip:"Total "+modeInfo.label+(localTreatF!=="All"?" · "+localTreatF:"")+" over the selected period." },
  ];

  // Treatment table — sorted by volume descending
  const treatRows = TREATMENTS.map(t => {
    const v = d.byTreatment[t]||0;
    if (v===0) return null;
    const tByM={};
    activeMonths.forEach(m => { tByM[m]=d.mbt&&d.mbt[m]?(d.mbt[m][t]||0):0; });
    const tSl=calcSlope(tByM,activeMonths);
    return { t, primary:fmtV(v), secondary:fmt(tSl,1)+"/mo", color:sc(tSl), bg:TC[t], total:v };
  }).filter(Boolean);

  const maxTreat = Math.max(...treatRows.map(r=>parseFloat(r.primary)||0), 1);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {showDivergence && (
        <div style={{ padding:"10px 16px", borderRadius:10, border:"1px solid "+(divDown?C.red:C.green)+"50", background:divDown?"#ef444410":"#10b98110", display:"flex", alignItems:"center", gap:10 }}>
          <span style={{ fontSize:15 }}>{divDown?"🔴":"✅"}</span>
          <div style={{ fontSize:12, color:C.muted, lineHeight:1.6 }}>
            <span style={{ fontWeight:700, color:divDown?C.red:C.green }}>
              {divDown?"Period much worse than full history":"Period outperforming full history"}
            </span>
            {" — Full history: "}
            <span style={{ fontFamily:"DM Mono,monospace", color:sc(fullSl) }}>{fmt(fullSl,1)}/mo</span>
            {" · Period: "}
            <span style={{ fontFamily:"DM Mono,monospace", color:sc(d.slope) }}>{fmt(d.slope,1)}/mo</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:20 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div>
            <h2 style={{ fontSize:17, fontWeight:700, marginBottom:3 }}>{d.doctor}</h2>
            <div style={{ fontSize:11, color:C.muted }}>IC: {d.ic}</div>
          </div>
          <Tag status={d.status}/>
        </div>
        <div style={{ display:"flex", background:C.bg, borderRadius:10, border:"1px solid "+C.border }}>
          {kpis.map(({ label, value, color, tip }, i, a) => (
            <div key={label} style={{ flex:1, padding:"10px 14px", borderRight:i<a.length-1?"1px solid "+C.border:"none" }}>
              <Tip text={tip}>
                <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:.7, marginBottom:5, borderBottom:"1px dashed "+C.border, paddingBottom:2, display:"inline-block" }}>{label}</div>
              </Tip>
              <div style={{ fontSize:17, fontWeight:700, color, fontFamily:"DM Mono,monospace" }}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:20 }}>
        <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:14, fontWeight:600 }}>
          {fmtM(activeMonths[0])} to {fmtM(activeMonths[activeMonths.length-1])}
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={lineData} margin={{top:10,right:20,left:-10,bottom:0}}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
            <XAxis dataKey="month" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false}/>
            <RT {...TT}/>
            <Legend wrapperStyle={{fontSize:10,paddingTop:6}}/>
            {chartLines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={l.width}
                strokeDasharray={l.dashed?"5 3":"none"} dot={!l.dashed?{r:3,fill:l.color}:false}/>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Treatment breakdown + monthly table */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:20 }}>
          <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:14, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span>By Treatment <span style={{ fontWeight:400, opacity:.6 }}>· click to isolate</span></span>
            {localTreatF!=="All" && (
              <button onClick={()=>setLocalTreatF("All")}
                style={{ fontSize:9, color:C.muted, background:"transparent", border:"1px solid "+C.border, borderRadius:4, padding:"2px 7px", cursor:"pointer", fontFamily:"inherit" }}>
                ✕ All
              </button>
            )}
          </div>
          {treatRows.sort((a,b)=>(b.total||0)-(a.total||0)).map(r => {
            const isActive = localTreatF === r.t;
            const isDimmed = localTreatF !== "All" && !isActive;
            return (
              <div key={r.t} className="rh" onClick={()=>setLocalTreatF(isActive ? "All" : r.t)}
                style={{ marginBottom:10, padding:"8px 10px", borderRadius:8, cursor:"pointer", background:isActive?r.bg+"25":"transparent", border:"1px solid "+(isActive?r.bg+"80":C.border), transition:"all .15s", opacity:isDimmed?0.4:1 }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <div style={{ width:7, height:7, borderRadius:"50%", background:r.bg }}/>
                    <span style={{ fontSize:12, color:isActive?r.bg:C.text, fontWeight:isActive?600:400 }}>{r.t}</span>
                  </div>
                  <div style={{ fontFamily:"DM Mono,monospace" }}>
                    <span style={{ fontSize:13, fontWeight:700, color:r.color }}>{r.primary}</span>
                    <span style={{ fontSize:10, color:C.muted, marginLeft:8 }}>{r.secondary}</span>
                  </div>
                </div>
                <div style={{ height:3, background:C.border, borderRadius:2 }}>
                  <div style={{ height:"100%", width:Math.min(100,(r.total/Math.max(...treatRows.map(x=>x.total||0),1))*100)+"%", background:r.bg, borderRadius:2 }}/>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:20 }}>
          <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10, fontWeight:600 }}>
            Monthly detail{localTreatF!=="All" && <span style={{ color:TC[localTreatF], marginLeft:6 }}>· {localTreatF}</span>}
          </div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:13 }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>Month</th>
                <th style={{ textAlign:"right", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>Value</th>
                <th style={{ textAlign:"right", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>MoM</th>
              </tr>
            </thead>
            <tbody>
              {activeMonths.map((m, mi) => {
                const v    = localTreatF==="All" ? (d.byMonth[m]||0) : (d.mbt&&d.mbt[m]?(d.mbt[m][localTreatF]||0):0);
                const vPrev= mi>0 ? (localTreatF==="All" ? (d.byMonth[activeMonths[mi-1]]||0) : (d.mbt&&d.mbt[activeMonths[mi-1]]?(d.mbt[activeMonths[mi-1]][localTreatF]||0):0)) : null;
                const mom  = vPrev!==null && vPrev>0 ? ((v-vPrev)/vPrev*100) : null;
                const lineColor = localTreatF==="All" ? modeInfo.color : TC[localTreatF];
                return (
                  <tr key={m} style={{ borderTop:"1px solid "+C.border }}>
                    <td style={{ padding:"5px 0", color:C.text }}>{fmtM(m)}</td>
                    <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", color:lineColor }}>{v.toLocaleString()}</td>
                    <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", fontSize:10, color:mom===null?C.muted:mom>=0?C.green:C.red }}>
                      {mom===null?"–":(mom>0?"+":"")+mom.toFixed(0)+"%"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Recommendations ──────────────────────────────────────────────────────────
function buildRecs(doctorStats, icStats, activeMonths, allMonths, selIC, treatF, fullSlopes, mode) {
  const n = activeMonths.length;
  const ctx = (selIC!=="All"?" [IC: "+selIC.split(" ")[0]+"]":"") + (treatF!=="All"?" ["+treatF+"]":"");
  const docRecs = [];

  doctorStats.forEach(d => {
    const name = d.doctor.split(" ").slice(0,2).join(" ");
    const fullSl = fullSlopes?.[d.doctor]??null;
    const candidates = [];
    const unit = mode==="musp"?"MUSP":"PS";

      // Period vs history divergence
      if (fullSl!==null && allMonths.length>activeMonths.length) {
        const diff = d.slope-fullSl;
        if (diff<=-1.5 && fullSl>=-0.5) {
          candidates.push({ type:"warning", priority:Math.abs(diff)*2,
            title:name+" — recent acceleration downward",
            body:"Full-period slope "+fmt(fullSl,1)+" "+unit+"/mo, last "+n+" months: "+fmt(d.slope,1)+" "+unit+"/mo. Deteriorating faster. IC: "+d.ic.split(" ")[0]+"."+ctx });
        }
      }

      // MoM deception
      if (n>=3 && d.slope<=-1) {
        const last=d.byMonth[activeMonths[activeMonths.length-1]]||0;
        const prev=d.byMonth[activeMonths[activeMonths.length-2]]||0;
        const mom=prev>0?((last-prev)/prev*100):null;
        if (mom!==null && mom>5) {
          candidates.push({ type:"warning", priority:Math.abs(d.slope)*1.8,
            title:name+" — last month masks decline",
            body:"MoM +"+mom.toFixed(0)+"% but slope "+fmt(d.slope,1)+" "+unit+"/mo over "+n+" months. Structural decline ongoing. IC: "+d.ic.split(" ")[0]+"."+ctx });
        }
      }

      // Steep decline
      if (d.slope<=-2) {
        candidates.push({ type:"alert", priority:Math.abs(d.slope)*1.5,
          title:name+" — losing ground",
          body:"Slope "+fmt(d.slope,1)+" "+unit+"/mo over "+n+" months. IC "+d.ic.split(" ")[0]+" needs to engage."+ctx });
      }

      // Strong growth
      if (d.slope>=2 && d.total>=10) {
        candidates.push({ type:"success", priority:d.slope,
          title:name+" — strong growth",
          body:"Slope +"+fmt(d.slope,1)+" "+unit+"/mo. Total "+fmtV(d.total)+" "+unit+". IC: "+d.ic.split(" ")[0]+". Prioritize for upsell."+ctx });
      }

      // Treatment signals (MUSP/PS modes only, not when filtered)
      if (treatF==="All") {
        TREATMENTS.forEach(t => {
          const tByM={};
          activeMonths.forEach(m => { tByM[m]=d.mbt&&d.mbt[m]?(d.mbt[m][t]||0):0; });
          const tTotal=totalOver(tByM,activeMonths);
          if (tTotal<5) return;
          const tSl=calcSlope(tByM,activeMonths);
          if (tSl<=-1.5) candidates.push({ type:"alert", priority:Math.abs(tSl)*tTotal*0.5,
            title:name+" — "+t+" declining",
            body:t+": slope "+fmt(tSl,1)+" "+unit+"/mo. Total "+tTotal+" over "+n+" months. IC: "+d.ic.split(" ")[0]+"." });
        });
      }

    if (candidates.length>0) {
      candidates.sort((a,b)=>b.priority-a.priority);
      docRecs.push({ ...candidates[0], doctor:d.doctor, ic:d.ic });
    }
  });

  // IC recs
  const icRecs=[];
  if (selIC==="All") {
    icStats.forEach(s=>{
      const name=s.ic.split(" ")[0];
      const declining=icStats.filter ? undefined : undefined; // icStats here is already computed
      if (s.slope<=-2 && s.doctorCount>=2) {
        icRecs.push({ type:"alert", priority:Math.abs(s.slope)*s.doctorCount*20, ic:s.ic,
          title:"IC "+name+" — portfolio declining",
          body:"Slope "+fmt(s.slope,1)+" /mo across "+s.doctorCount+" doctors. Immediate review needed." });
      }
      if (s.slope>=2 && s.doctorCount>=2) {
        icRecs.push({ type:"success", priority:s.slope*s.doctorCount*10, ic:s.ic,
          title:"IC "+name+" — strong portfolio",
          body:"Slope +"+fmt(s.slope,1)+" /mo across "+s.doctorCount+" doctors. Use as playbook." });
      }
    });
  }

  return [
    ...icRecs.sort((a,b)=>b.priority-a.priority),
    ...docRecs.sort((a,b)=>b.priority-a.priority),
  ].slice(0,25);
}

// ─── Upload screen ────────────────────────────────────────────────────────────
function UploadZone({ id, label, sublabel, onFile, loaded, color }) {
  const [drag, setDrag] = useState(false);
  return (
    <div onDrop={e=>{e.preventDefault();setDrag(false);onFile(e.dataTransfer.files[0]);}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onClick={()=>document.getElementById(id).click()}
      style={{ flex:1, minHeight:150, border:"2px dashed "+(drag?color:loaded?"#1a274480":C.border), borderRadius:14, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", gap:8, transition:"all .2s", background:loaded?color+"10":drag?color+"08":C.surface }}>
      <div style={{ fontSize:26 }}>{loaded?"✅":"📂"}</div>
      <div style={{ fontSize:13, color:loaded?color:C.text, fontWeight:600 }}>{label}</div>
      <div style={{ fontSize:11, color:C.muted }}>{loaded?"Loaded — click to replace":sublabel}</div>
      <input id={id} type="file" accept=".csv" style={{ display:"none" }} onChange={e=>onFile(e.target.files[0])}/>
    </div>
  );
}

function UploadScreen({ onMUSP, onPS, muspLoaded, psLoaded, canStart, onStart, darkMode, setDarkMode }) {
  C = darkMode ? DARK : LIGHT;
  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"DM Sans,sans-serif", color:C.text }}>
      <style>{makeCss(darkMode)}</style>
      {/* Dark/light toggle top-right */}
      <div style={{ position:"fixed", top:16, right:20 }}>
        <ThemeToggle darkMode={darkMode} setDarkMode={setDarkMode}/>
      </div>
      <div style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{ fontSize:10, letterSpacing:4, color:C.accent, textTransform:"uppercase", marginBottom:14, fontWeight:600 }}>Performance Dashboard</div>
        <h1 style={{ fontSize:36, fontWeight:700, letterSpacing:-1.5, lineHeight:1.15 }}>
          MUSP <span style={{ color:C.muted, fontWeight:300 }}>+</span> <span style={{ color:C.green }}>Patients Start</span>
        </h1>
        <p style={{ color:C.muted, marginTop:10, fontSize:13 }}>Upload your exports. Patients Start is optional.</p>
      </div>
      <div style={{ display:"flex", gap:14, width:"100%", maxWidth:520, marginBottom:20 }}>
        <UploadZone id="fi-musp" label="MUSP" sublabel="Required" onFile={onMUSP} loaded={muspLoaded} color={C.accent}/>
        <UploadZone id="fi-ps" label="Patients Start" sublabel="Optional" onFile={onPS} loaded={psLoaded} color={C.green}/>
      </div>
      <button onClick={onStart} disabled={!canStart}
        style={{ background:canStart?C.accent:C.border, color:canStart?C.bg:C.muted, border:"none", borderRadius:10, padding:"12px 36px", fontSize:14, fontWeight:700, cursor:canStart?"pointer":"default", transition:"all .2s" }}>
        {canStart?"Launch Dashboard  →":"Upload MUSP to continue"}
      </button>
      {/* Footer */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, borderTop:"1px solid "+C.border, padding:"10px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", background:C.bg }}>
        <span style={{ fontSize:11, color:C.muted }}>v2.1.0</span>
        <span style={{ fontSize:11, color:C.muted }}>Made with 🤙 by Antoine Heritier</span>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
// ─── Period Slider — custom drag-based, no overlapping inputs ────────────────
function PeriodSlider({ allMonths, safeStart, safeEnd, setStartIdx, setEndIdx, darkMode }) {
  const [ref, setRef] = useState(null);
  const dragging = useState(null); // "start" | "end" | null
  const [drag, setDrag] = dragging;
  const n = allMonths.length;

  const posToIdx = useCallback((clientX) => {
    if (!ref) return 0;
    const rect = ref.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (n - 1));
  }, [ref, n]);

  const onMouseDown = useCallback((e, thumb) => {
    e.preventDefault();
    setDrag(thumb);
  }, []);

  const onMouseMove = useCallback((e) => {
    if (!drag) return;
    const idx = posToIdx(e.clientX);
    if (drag === "start" && idx <= safeEnd) setStartIdx(idx);
    if (drag === "end"   && idx >= safeStart) setEndIdx(idx === n-1 ? null : idx);
  }, [drag, safeStart, safeEnd, posToIdx, n]);

  const onMouseUp = useCallback(() => setDrag(null), []);

  // Touch support
  const onTouchMove = useCallback((e) => {
    if (!drag) return;
    const idx = posToIdx(e.touches[0].clientX);
    if (drag === "start" && idx <= safeEnd) setStartIdx(idx);
    if (drag === "end"   && idx >= safeStart) setEndIdx(idx === n-1 ? null : idx);
  }, [drag, safeStart, safeEnd, posToIdx, n]);

  const startPct = safeStart / (n-1) * 100;
  const endPct   = safeEnd   / (n-1) * 100;

  return (
    <div
      style={{ position:"sticky", top:54, zIndex:199, background:darkMode?"#020817f0":"#f0f4faf8", backdropFilter:"blur(12px)", borderBottom:"1px solid "+C.border, padding:"10px 24px", display:"flex", alignItems:"center", gap:16, userSelect:"none" }}
      onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      onTouchMove={onTouchMove} onTouchEnd={onMouseUp}
    >
      <span style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:.8, whiteSpace:"nowrap", fontWeight:600 }}>Period</span>

      {/* Track */}
      <div ref={setRef} style={{ flex:1, position:"relative", height:20, display:"flex", alignItems:"center", cursor:"pointer" }}>
        {/* bg track */}
        <div style={{ position:"absolute", left:0, right:0, height:3, background:C.border, borderRadius:2 }}/>
        {/* active fill */}
        <div style={{ position:"absolute", left:startPct+"%", width:(endPct-startPct)+"%", height:3, background:C.accent, borderRadius:2 }}/>
        {/* ticks */}
        {allMonths.map((_,i) => (
          <div key={i} style={{ position:"absolute", left:(i/(n-1)*100)+"%", transform:"translateX(-50%)", width:1, height:5, background:i>=safeStart&&i<=safeEnd?C.accent:C.border, top:"50%", marginTop:-2.5 }}/>
        ))}
        {/* start thumb */}
        <div
          onMouseDown={e=>onMouseDown(e,"start")}
          onTouchStart={e=>{ e.preventDefault(); setDrag("start"); }}
          style={{ position:"absolute", left:startPct+"%", transform:"translateX(-50%)", width:16, height:16, borderRadius:"50%", background:C.accent, border:"2px solid "+C.bg, cursor:"grab", zIndex:drag==="start"?10:2, boxShadow:drag==="start"?"0 0 0 4px #3b82f630":"none", transition:"box-shadow .1s", touchAction:"none" }}
        />
        {/* end thumb */}
        <div
          onMouseDown={e=>onMouseDown(e,"end")}
          onTouchStart={e=>{ e.preventDefault(); setDrag("end"); }}
          style={{ position:"absolute", left:endPct+"%", transform:"translateX(-50%)", width:16, height:16, borderRadius:"50%", background:C.accent, border:"2px solid "+C.bg, cursor:"grab", zIndex:drag==="end"?10:2, boxShadow:drag==="end"?"0 0 0 4px #3b82f630":"none", transition:"box-shadow .1s", touchAction:"none" }}
        />
      </div>

      {/* Labels */}
      <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
        <span style={{ fontSize:12, fontWeight:700, color:C.accent, fontFamily:"DM Mono,monospace", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"3px 8px" }}>{fmtM(allMonths[safeStart])}</span>
        <span style={{ fontSize:10, color:C.muted }}>→</span>
        <span style={{ fontSize:12, fontWeight:700, color:C.accent, fontFamily:"DM Mono,monospace", background:C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"3px 8px" }}>{fmtM(allMonths[safeEnd])}</span>
        {(safeStart!==0||safeEnd!==n-1) && (
          <button onClick={()=>{ setStartIdx(0); setEndIdx(null); }}
            style={{ fontSize:10, color:C.muted, background:"transparent", border:"1px solid "+C.border, borderRadius:6, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit" }}>
            All
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [muspData,   setMuspData]   = useState(null);
  const [psData,     setPsData]     = useState(null);
  const [launched,   setLaunched]   = useState(false);
  const [mode,       setMode]       = useState("musp");     // "musp" | "ps"
  const [view,       setView]       = useState("overview"); // "overview" | "doctors" | "recommendations"
  const [selIC,      setSelIC]      = useState("All");
  const [treatF,     setTreatF]     = useState("All");
  const [startIdx,   setStartIdx]   = useState(0);
  const [endIdx,     setEndIdx]     = useState(null); // null = last available month
  const [selDoc,     setSelDoc]     = useState(null);
  const [docSearch,  setDocSearch]  = useState("");
  const [statusTab,  setStatusTab]  = useState("all");
  const [sizeBuckets, setSizeBuckets] = useState([]); // empty = All
  const [sortDir,    setSortDir]    = useState("asc");
  const [sortKey,    setSortKey]    = useState("slope"); // "slope" | "total"
  const [expandedTreatment, setExpandedTreatment] = useState(null);
  const [darkMode,   setDarkMode]   = useState(true);

  // Update global C before every render
  C = darkMode ? DARK : LIGHT;

  const handleMUSP  = useCallback(f => { if(!f)return; const r=new FileReader(); r.onload=e=>setMuspData(processMUSP(parseCSV(e.target.result))); r.readAsText(f,"UTF-8"); },[]);
  const handlePS    = useCallback(f => { if(!f)return; const r=new FileReader(); r.onload=e=>setPsData(processPS(parseCSV(e.target.result))); r.readAsText(f,"UTF-8"); },[]);
  const handleStart = useCallback(() => { if(muspData){setLaunched(true);setSelIC("All");setStartIdx(0);setEndIdx(null);setSelDoc(null);} },[muspData]);
  const handleReset = useCallback(() => { setMuspData(null);setPsData(null);setLaunched(false);setSelDoc(null);setMode("musp");setStartIdx(0);setEndIdx(null); },[]);

  const hasPS = !!(psData && psData.length > 0);

  // When PS is removed, fall back to musp
  const effectiveMode = mode==="ps" && !hasPS ? "musp" : mode;

  const allMonths    = useMemo(()=>muspData?[...new Set(muspData.map(r=>r.date))].sort():[], [muspData]);
  const ics          = useMemo(()=>muspData?[...new Set(muspData.map(r=>r.ic))].sort():[], [muspData]);

  const safeStart    = Math.min(startIdx, Math.max(0, allMonths.length-1));
  const safeEnd      = endIdx===null ? allMonths.length-1 : Math.min(endIdx, allMonths.length-1);
  const activeMonths = useMemo(()=>allMonths.slice(safeStart, safeEnd+1), [allMonths, safeStart, safeEnd]);

  const activeData = useMemo(()=>{
    const src = effectiveMode==="ps" ? psData : muspData;
    if (!src) return [];
    return src.filter(r =>
      activeMonths.includes(r.date) &&
      (selIC==="All"||r.ic===selIC) &&
      (treatF==="All"||r.treatment===treatF)
    );
  },[muspData,psData,effectiveMode,activeMonths,selIC,treatF]);

  // Also need full (all-period) MUSP filtered for IC filter but not period
  const muspFiltered = useMemo(()=>{
    if (!muspData) return [];
    return muspData.filter(r=>activeMonths.includes(r.date)&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF));
  },[muspData,activeMonths,selIC,treatF]);

  // Doctor stats
  const doctorStats = useMemo(()=>
    buildDoctorStats(activeData, activeMonths, sizeBuckets, sortDir, sortKey, true),
    [activeData, activeMonths, sizeBuckets, sortDir, sortKey]);

  const allDoctorStats = useMemo(()=>
    buildDoctorStats(activeData, activeMonths, [], sortDir, sortKey, false),
    [activeData, activeMonths, sortDir, sortKey]);

  // Full-history slopes (for divergence detection) — always on MUSP
  const fullSlopes = useMemo(()=>buildFullSlopes(
    effectiveMode==="ps"?psData:muspData,
    allMonths
  ),[muspData,psData,effectiveMode,allMonths]);

  // IC stats — on activeData
  const icStats = useMemo(()=>{
    const src = effectiveMode==="ps" ? (psData||[]).filter(r=>activeMonths.includes(r.date)&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF)) : muspFiltered;
    if (!src.length) return [];
    const map={};
    src.forEach(r=>{
      if (!map[r.ic]) map[r.ic]={ic:r.ic,byMonth:{},total:0,doctors:new Set()};
      const s=map[r.ic];
      s.byMonth[r.date]=(s.byMonth[r.date]||0)+r.val;
      s.total+=r.val; s.doctors.add(r.doctor);
    });
    return Object.values(map).map(s=>{
      const sl=calcSlope(s.byMonth,activeMonths);
      return {...s,slope:sl,doctorCount:s.doctors.size,status:perfStatus(sl)};
    }).sort((a,b)=>b.total-a.total);
  },[muspFiltered,psData,effectiveMode,activeMonths,selIC,treatF]);

  // Global KPIs
  const kpis = useMemo(()=>{
    if (!muspFiltered.length || !activeMonths.length) return null;
    const muspByMonth={};
    muspFiltered.forEach(r=>{ muspByMonth[r.date]=(muspByMonth[r.date]||0)+r.val; });
    const muspTotal  = totalOver(muspByMonth,activeMonths);
    const muspSlope  = calcSlope(muspByMonth,activeMonths);
    const muspGrowth = cagr(muspByMonth,activeMonths);

    // Full-history slope for divergence banner
    const allMuspByMonth={};
    (muspData||[]).filter(r=>(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF))
      .forEach(r=>{ allMuspByMonth[r.date]=(allMuspByMonth[r.date]||0)+r.val; });
    const fullSl = allMonths.length>activeMonths.length ? calcSlope(allMuspByMonth,allMonths) : null;

    let psTotal=null, convRate=null, psSlope=null;
    if (hasPS) {
      const psFilt=(psData||[]).filter(r=>activeMonths.includes(r.date)&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF));
      const psByMonth={};
      psFilt.forEach(r=>{ psByMonth[r.date]=(psByMonth[r.date]||0)+r.val; });
      psTotal   = totalOver(psByMonth,activeMonths);
      convRate  = muspTotal>0?(psTotal/muspTotal*100):null;
      psSlope   = calcSlope(psByMonth,activeMonths);
    }

    return {
      muspTotal, muspSlope, muspGrowth, fullSlope:fullSl,
      psTotal, convRate, psSlope,
      growing:  doctorStats.filter(d=>d.status==="growing").length,
      declining:doctorStats.filter(d=>d.status==="declining").length,
      stable:   doctorStats.filter(d=>d.status==="stable").length,
    };
  },[muspFiltered,activeMonths,muspData,psData,selIC,treatF,allMonths,hasPS,doctorStats]);

  // Timeline
  const timeline = useMemo(()=>activeMonths.map(m=>{
    const obj={month:fmtM(m)};
    TREATMENTS.forEach(t=>{ obj[t]=muspFiltered.filter(r=>r.date===m&&r.treatment===t).reduce((s,r)=>s+r.val,0); });
    obj["MUSP"]=muspFiltered.filter(r=>r.date===m).reduce((s,r)=>s+r.val,0);
    if (hasPS) {
      const psFilt=(psData||[]).filter(r=>r.date===m&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF));
      obj["Pat. Start"]=psFilt.reduce((s,r)=>s+r.val,0);
      TREATMENTS.forEach(t=>{ obj["ps_"+t]=psFilt.filter(r=>r.treatment===t).reduce((s,r)=>s+r.val,0); });
    }
    return obj;
  }),[muspFiltered,psData,hasPS,activeMonths,selIC,treatF]);

  // Treatments sorted by total volume descending — biggest first (bottom of stack)
  const sortedTreatments = useMemo(()=>{
    const totals={};
    TREATMENTS.forEach(t=>{ totals[t]=timeline.reduce((s,row)=>s+(row[t]||0),0); });
    return [...TREATMENTS].sort((a,b)=>totals[b]-totals[a]);
  },[timeline]);

  const sortedPsTreatments = useMemo(()=>{
    const totals={};
    TREATMENTS.forEach(t=>{ totals[t]=timeline.reduce((s,row)=>s+(row["ps_"+t]||0),0); });
    return [...TREATMENTS].sort((a,b)=>totals[b]-totals[a]);
  },[timeline]);

  const visibleDocs = useMemo(()=>doctorStats.filter(d=>{
    if (statusTab!=="all"&&d.status!==statusTab) return false;
    const q=docSearch.toLowerCase();
    if (q&&!d.doctor.toLowerCase().includes(q)&&!d.ic.toLowerCase().includes(q)) return false;
    return true;
  }),[doctorStats,docSearch,statusTab]);

  if (!launched) return <UploadScreen onMUSP={handleMUSP} onPS={handlePS} muspLoaded={!!muspData} psLoaded={hasPS} canStart={!!muspData} onStart={handleStart} darkMode={darkMode} setDarkMode={setDarkMode}/>;

  const modeInfo    = MODES[effectiveMode];
  const periodLabel = activeMonths.length>=2 ? fmtM(activeMonths[0])+" → "+fmtM(activeMonths[activeMonths.length-1]) : fmtM(activeMonths[0]);
  const periodDiv   = kpis&&kpis.fullSlope!==null ? kpis.muspSlope-kpis.fullSlope : null;
  const showAlert   = effectiveMode==="musp" && periodDiv!==null && periodDiv<=-2;
  const showPos     = effectiveMode==="musp" && periodDiv!==null && periodDiv>=2;

  // KPI strip content depends on mode
  const psCol = C.green;
  const kpiItems = !kpis ? [] : effectiveMode==="musp" ? [
    { label:"Total MUSP",    value:fmtV(kpis.muspTotal),                   color:C.accent,       tip:"Total MUSP in the selected period." },
    { label:"Slope",         value:fmt(kpis.muspSlope)+"/mo", sub:kpis.fullSlope!==null?"Full history: "+fmt(kpis.fullSlope)+"/mo":undefined, color:sc(kpis.muspSlope), tip:"Linear regression slope on monthly MUSP." },
    { label:"Growth",        value:fmt(kpis.muspGrowth)+"%",               color:gc(kpis.muspGrowth), tip:"Compound monthly growth rate." },
    { label:"Growing",       value:kpis.growing,   color:C.green, sub:"slope >=+1/mo",  tip:"Doctors gaining >=1 MUSP/month." },
    { label:"Declining",     value:kpis.declining, color:C.red,   sub:"slope <=-1/mo",  tip:"Doctors losing >=1 MUSP/month." },
    { label:"Stable",        value:kpis.stable,    color:C.amber, sub:"-1 < slope < +1",tip:"Doctors roughly flat." },
  ] : [
    { label:"Total PS",      value:fmtV(kpis.psTotal),    color:psCol,  tip:"Total Patients Start in the selected period." },
    { label:"PS Slope",      value:fmt(kpis.psSlope)+"/mo", color:sc(kpis.psSlope||0), tip:"Linear regression slope on monthly PS." },
    { label:"Growing",       value:kpis.growing,   color:C.green, sub:"slope >=+1/mo",  tip:"Doctors with growing PS." },
    { label:"Declining",     value:kpis.declining, color:C.red,   sub:"slope <=-1/mo",  tip:"Doctors with declining PS." },
    { label:"Stable",        value:kpis.stable,    color:C.amber, sub:"-1 < slope < +1",tip:"Doctors with stable PS." },
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"DM Sans,sans-serif" }}>
      <style>{makeCss(darkMode)}</style>

      {/* ── Header ── */}
      <header style={{ position:"sticky", top:0, zIndex:200, background:darkMode?"#020817f0":"#f0f4faf5", backdropFilter:"blur(12px)", borderBottom:"1px solid "+C.border, height:54, display:"flex", alignItems:"center", padding:"0 24px", gap:16 }}>
        <nav style={{ display:"flex", gap:2 }}>
          {[["overview","Overview"],["doctors","Doctors"]].map(([id,label])=>(
            <button key={id} onClick={()=>setView(id)}
              style={{ background:view===id?C.border:"transparent", color:view===id?C.text:C.muted, border:"none", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:500, fontFamily:"inherit", transition:"all .15s" }}>
              {label}
            </button>
          ))}
        </nav>

        {/* Mode switcher — center */}
        <div style={{ flex:1, display:"flex", justifyContent:"center" }}>
          <ModeSwitch mode={effectiveMode} setMode={m=>{ setMode(m); setSelDoc(null); }} hasPS={hasPS} darkMode={darkMode} setDarkMode={setDarkMode}/>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <select value={selIC} onChange={e=>{setSelIC(e.target.value);setSelDoc(null);}}
            style={{ background:C.surface, border:"1px solid "+C.border, color:C.text, borderRadius:8, padding:"5px 10px", fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>
            <option value="All">All ICs</option>
            {ics.map(i=><option key={i} value={i}>{i}</option>)}
          </select>
          <select value={treatF} onChange={e=>setTreatF(e.target.value)}
            style={{ background:C.surface, border:"1px solid "+C.border, color:C.text, borderRadius:8, padding:"5px 10px", fontSize:12, fontFamily:"inherit", cursor:"pointer" }}>
            <option value="All">All Treatments</option>
            {TREATMENTS.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={handleReset} style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:8, padding:"5px 10px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>Reset</button>
        </div>
      </header>

      {/* ── Period slider bar ── */}
      {allMonths.length > 1 && (
        <PeriodSlider
          allMonths={allMonths}
          safeStart={safeStart}
          safeEnd={safeEnd}
          setStartIdx={setStartIdx}
          setEndIdx={setEndIdx}
          darkMode={darkMode}
        />
      )}

      <main style={{ padding:"16px 24px 60px", maxWidth:1400, margin:"0 auto" }}>

        {/* Period divergence banner — MUSP mode only */}
        {(showAlert||showPos) && (
          <div style={{ marginBottom:12, padding:"10px 16px", borderRadius:10, border:"1px solid "+(showAlert?C.red:C.green)+"50", background:showAlert?"#ef444410":"#10b98110", display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:16 }}>{showAlert?"🔴":"✅"}</span>
            <div>
              <span style={{ fontWeight:700, color:showAlert?C.red:C.green, fontSize:13 }}>
                {showAlert?"Recent period worse than full history":"Recent period outperforming full history"}
              </span>
              <span style={{ fontSize:12, color:C.muted, marginLeft:10 }}>
                {"Full history: "+fmt(kpis.fullSlope)+"/mo  ·  Period: "+fmt(kpis.muspSlope)+"/mo"}
              </span>
            </div>
          </div>
        )}

        {/* Context chips */}
        <div style={{ display:"flex", gap:6, marginBottom:14, alignItems:"center", flexWrap:"wrap" }}>
          <span style={{ fontSize:11, color:C.muted }}>Showing</span>
          <span style={{ fontSize:11, color:modeInfo.color, fontWeight:700, background:modeInfo.color+"15", border:"1px solid "+modeInfo.color+"30", borderRadius:5, padding:"1px 8px" }}>{modeInfo.label}</span>
          <span style={{ fontSize:11, color:C.accent, fontWeight:600, background:"#3b82f615", border:"1px solid #3b82f630", borderRadius:5, padding:"1px 8px" }}>{periodLabel}</span>
          {selIC!=="All"&&<span style={{ fontSize:11, color:C.amber, fontWeight:600, background:"#f59e0b15", border:"1px solid #f59e0b30", borderRadius:5, padding:"1px 8px" }}>{selIC}</span>}
          {treatF!=="All"&&<span style={{ fontSize:11, color:TC[treatF], fontWeight:600, background:TC[treatF]+"15", border:"1px solid "+TC[treatF]+"30", borderRadius:5, padding:"1px 8px" }}>{treatF}</span>}
          {view==="doctors" && sizeBuckets.length>0&&<span style={{ fontSize:11, color:C.amber, fontWeight:600, background:"#f59e0b15", border:"1px solid #f59e0b30", borderRadius:5, padding:"1px 8px" }}>{sizeBuckets.map(i=>SIZE_BUCKETS[i].label).join(", ")}</span>}
        </div>

        {/* KPI strip */}
        {kpis && (
          <div style={{ display:"flex", background:C.surface, border:"1px solid "+C.border, borderRadius:12, overflow:"hidden", marginBottom:18 }}>
            {kpiItems.map(({ label, value, color, sub, tip }, i, a) => (
              <div key={label} style={{ flex:1, padding:"14px 16px", borderRight:i<a.length-1?"1px solid "+C.border:"none" }}>
                <Tip text={tip}>
                  <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:6, borderBottom:"1px dashed "+C.border, paddingBottom:2, display:"inline-block" }}>{label}</div>
                </Tip>
                <div style={{ fontSize:20, fontWeight:700, color, fontFamily:"DM Mono,monospace" }}>{value}</div>
                {sub&&<div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ══ OVERVIEW ══ */}
        {view==="overview" && (
          <div style={{ display:"flex", flexDirection:"column", gap:18 }}>

            {/* ── Small multiples — full width for MUSP and PS ── */}
            <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:22 }}>
              <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:16, fontWeight:600 }}>
                {effectiveMode==="musp" ? "MUSP by Treatment" : "Patients Start by Treatment"}
              </div>

              {effectiveMode==="musp" ? (
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
                  {sortedTreatments.map(t => {
                    const tData = timeline.map(row => ({ month: row.month, v: row[t]||0 }));
                    const total = tData.reduce((s,r)=>s+r.v, 0);
                    const slope = calcSlope(Object.fromEntries(tData.map((r,i)=>[i,r.v])), tData.map((_,i)=>i));
                    return (
                      <div key={t} onClick={()=>setExpandedTreatment({ t, isPS: false })}
                        className="rh"
                        style={{ background:darkMode?"#020817":C.bg, borderRadius:10, padding:"14px 14px 10px", border:"1px solid "+C.border, cursor:"pointer", transition:"border-color .15s", position:"relative" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:TC[t], flexShrink:0 }}/>
                          <span style={{ fontSize:10, color:C.muted, fontWeight:600 }}>{t}</span>
                          <span style={{ marginLeft:"auto", fontSize:9, color:C.muted, opacity:.5 }}>↗</span>
                        </div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:"DM Mono,monospace", color:TC[t], marginBottom:2 }}>{total.toLocaleString()}</div>
                        <div style={{ fontSize:10, color:sc(slope), fontFamily:"DM Mono,monospace", marginBottom:10 }}>{fmt(slope,1)}/mo</div>
                        <ResponsiveContainer width="100%" height={70}>
                          <LineChart data={tData} margin={{top:4,right:2,left:-40,bottom:0}}>
                            <YAxis domain={['auto','auto']} tick={false} axisLine={false} tickLine={false}/>
                            <Line type="monotone" dataKey="v" stroke={TC[t]} strokeWidth={2} dot={false}/>
                            <RT content={({ active, payload }) => {
                              if (!active||!payload?.length) return null;
                              return <div style={{ background:darkMode?"#0c1525":C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"4px 8px", fontSize:11 }}>
                                <span style={{ color:C.muted }}>{payload[0]?.payload?.month} </span>
                                <span style={{ color:TC[t], fontFamily:"DM Mono,monospace", fontWeight:700 }}>{(payload[0]?.value||0).toLocaleString()}</span>
                              </div>;
                            }}/>
                          </LineChart>
                        </ResponsiveContainer>
                        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                          <span style={{ fontSize:8, color:C.muted }}>{tData[0]?.month}</span>
                          <span style={{ fontSize:8, color:C.muted }}>{tData[tData.length-1]?.month}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* PS small multiples */
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:12 }}>
                  {sortedPsTreatments.map(t => {
                    const tData = timeline.map(row => ({ month: row.month, v: row["ps_"+t]||0 }));
                    const total = tData.reduce((s,r)=>s+r.v, 0);
                    const slope = calcSlope(Object.fromEntries(tData.map((r,i)=>[i,r.v])), tData.map((_,i)=>i));
                    return (
                      <div key={t} onClick={()=>setExpandedTreatment({ t, isPS: true })}
                        className="rh"
                        style={{ background:darkMode?"#020817":C.bg, borderRadius:10, padding:"14px 14px 10px", border:"1px solid "+C.border, cursor:"pointer", transition:"border-color .15s" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:8 }}>
                          <div style={{ width:8, height:8, borderRadius:2, background:TC[t], flexShrink:0 }}/>
                          <span style={{ fontSize:10, color:C.muted, fontWeight:600 }}>{t}</span>
                          <span style={{ marginLeft:"auto", fontSize:9, color:C.muted, opacity:.5 }}>↗</span>
                        </div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:"DM Mono,monospace", color:TC[t], marginBottom:2 }}>{total.toLocaleString()}</div>
                        <div style={{ fontSize:10, color:sc(slope), fontFamily:"DM Mono,monospace", marginBottom:10 }}>{fmt(slope,1)}/mo</div>
                        <ResponsiveContainer width="100%" height={70}>
                          <LineChart data={tData} margin={{top:4,right:2,left:-40,bottom:0}}>
                            <YAxis domain={['auto','auto']} tick={false} axisLine={false} tickLine={false}/>
                            <Line type="monotone" dataKey="v" stroke={TC[t]} strokeWidth={2} dot={false}/>
                            <RT content={({ active, payload }) => {
                              if (!active||!payload?.length) return null;
                              return <div style={{ background:darkMode?"#0c1525":C.surface, border:"1px solid "+C.border, borderRadius:6, padding:"4px 8px", fontSize:11 }}>
                                <span style={{ color:C.muted }}>{payload[0]?.payload?.month} </span>
                                <span style={{ color:TC[t], fontFamily:"DM Mono,monospace", fontWeight:700 }}>{(payload[0]?.value||0).toLocaleString()}</span>
                              </div>;
                            }}/>
                          </LineChart>
                        </ResponsiveContainer>
                        <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
                          <span style={{ fontSize:8, color:C.muted }}>{tData[0]?.month}</span>
                          <span style={{ fontSize:8, color:C.muted }}>{tData[tData.length-1]?.month}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── IC list + Top tables ── */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:18 }}>

              {/* IC list */}
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:22 }}>
                <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:16, fontWeight:600 }}>IC Performance</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {icStats.map(s=>(
                    <div key={s.ic} onClick={()=>setSelIC(selIC===s.ic?"All":s.ic)}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:selIC===s.ic?C.border:darkMode?"#020817":C.bg, borderRadius:8, cursor:"pointer", border:"1px solid "+(selIC===s.ic?C.accent:C.border), transition:"all .15s" }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:12, fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.ic.split(" ").slice(0,2).join(" ")}</div>
                        <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>{s.doctorCount} doctors</div>
                      </div>
                      <div style={{ textAlign:"right", flexShrink:0 }}>
                        <div style={{ fontSize:13, fontWeight:700, fontFamily:"DM Mono,monospace", color:sc(s.slope) }}>{fmt(s.slope)}/mo</div>
                      </div>
                      <Tag status={s.status}/>
                    </div>
                  ))}
                </div>
              </div>

              {/* Top Growing + Declining */}
              {[
                { title:"Top Growing",  docs:[...allDoctorStats].filter(d=>d.status==="growing").sort((a,b)=>b.slope-a.slope).slice(0,8),  accent:C.green },
                { title:"Declining",    docs:[...allDoctorStats].filter(d=>d.status==="declining").sort((a,b)=>a.slope-b.slope).slice(0,8), accent:C.red },
              ].map(({ title, docs, accent })=>(
                <div key={title} style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, overflow:"hidden" }}>
                  <div style={{ padding:"11px 16px", borderBottom:"1px solid "+C.border, fontSize:10, color:accent, textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>
                    {title} <span style={{ color:C.muted }}>({docs.length})</span>
                  </div>
                  {docs.length===0
                    ? <div style={{ padding:20, fontSize:12, color:C.muted, textAlign:"center" }}>None</div>
                    : docs.map((d,i)=>(
                      <div key={d.doctor} className="rh"
                        onClick={()=>{ setSelDoc(d.doctor); setStatusTab("all"); setDocSearch(""); setView("doctors"); }}
                        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px", borderBottom:"1px solid "+C.border, cursor:"pointer" }}>
                        <span style={{ fontSize:10, color:C.muted, width:16, textAlign:"right", flexShrink:0 }}>{i+1}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:12, fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{d.doctor}</div>
                          <div style={{ fontSize:10, color:C.muted }}>{d.ic.split(" ")[0]}</div>
                        </div>
                        <div style={{ textAlign:"right", flexShrink:0 }}>
                          <div style={{ fontSize:12, fontWeight:700, color:accent, fontFamily:"DM Mono,monospace" }}>{fmt(d.slope,1)}/mo</div>
                        </div>
                      </div>
                    ))
                  }
                </div>
              ))}
            </div>

          </div>
        )}

        {/* ══ DOCTORS ══ */}
        {view==="doctors" && (
          <div style={{ display:"flex", gap:18, height:"calc(100vh - 200px)", minHeight:500 }}>

            {/* Left panel */}
            <div style={{ width:300, flexShrink:0, background:C.surface, border:"1px solid "+C.border, borderRadius:12, display:"flex", flexDirection:"column", overflow:"hidden" }}>
              <div style={{ padding:12, borderBottom:"1px solid "+C.border, flexShrink:0, display:"flex", flexDirection:"column", gap:8 }}>
                <input value={docSearch} onChange={e=>setDocSearch(e.target.value)} placeholder="Search doctor or IC..."
                  style={{ width:"100%", background:C.bg, border:"1px solid "+C.border, color:C.text, borderRadius:7, padding:"6px 10px", fontSize:12, fontFamily:"inherit", outline:"none" }}/>
                {/* Size filter — multi-select (index 0 = "All" is a special case: selecting it clears others) */}
                <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                  {SIZE_BUCKETS.map((b,i)=>{
                    const isAll = i===0;
                    const active = isAll ? sizeBuckets.length===0 : sizeBuckets.includes(i);
                    return (
                      <button key={i} onClick={()=>{
                        if (isAll) { setSizeBuckets([]); return; }
                        setSizeBuckets(prev => prev.includes(i) ? prev.filter(x=>x!==i) : [...prev, i]);
                      }}
                        style={{ fontSize:10, padding:"3px 7px", borderRadius:5, border:"1px solid "+(active?C.accent:C.border), background:active?"#3b82f620":"transparent", color:active?C.accent:C.muted, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", transition:"all .15s" }}>
                        {b.label}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display:"flex", gap:4, alignItems:"center", flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, color:C.muted }}>Sort:</span>
                  {[["asc","Worst"],["desc","Best"]].map(([dir,label])=>(
                    <button key={dir} onClick={()=>{ setSortDir(dir); setSortKey("slope"); }}
                      style={{ fontSize:10, padding:"3px 8px", borderRadius:5, border:"1px solid "+(sortDir===dir&&sortKey==="slope"?C.accent:C.border), background:sortDir===dir&&sortKey==="slope"?"#3b82f620":"transparent", color:sortDir===dir&&sortKey==="slope"?C.accent:C.muted, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
                      {label}
                    </button>
                  ))}
                  <span style={{ fontSize:10, color:C.border }}>|</span>
                  {[["desc","Vol ↓"],["asc","Vol ↑"]].map(([dir,label])=>(
                    <button key={"vol"+dir} onClick={()=>{ setSortDir(dir); setSortKey("total"); }}
                      style={{ fontSize:10, padding:"3px 8px", borderRadius:5, border:"1px solid "+(sortKey==="total"&&sortDir===dir?C.green:C.border), background:sortKey==="total"&&sortDir===dir?"#10b98120":"transparent", color:sortKey==="total"&&sortDir===dir?C.green:C.muted, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display:"flex", borderBottom:"1px solid "+C.border, flexShrink:0 }}>
                {[["all","All",C.muted],["declining","Decl",C.red],["stable","Stable",C.amber],["growing","Grow",C.green]].map(([key,label,color])=>{
                  const cnt=key==="all"?doctorStats.length:doctorStats.filter(d=>d.status===key).length;
                  return (
                    <button key={key} onClick={()=>setStatusTab(key)}
                      style={{ flex:1, background:statusTab===key?C.border:"transparent", border:"none", borderBottom:"2px solid "+(statusTab===key?color:"transparent"), color, padding:"7px 2px", fontSize:10, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
                      {label}<br/><span style={{ fontSize:13, fontFamily:"DM Mono,monospace", fontWeight:700 }}>{cnt}</span>
                    </button>
                  );
                })}
              </div>

              <div style={{ overflowY:"auto", flex:1 }}>
                {visibleDocs.length===0 && <div style={{ padding:24, textAlign:"center", color:C.muted, fontSize:13 }}>No doctors match</div>}
                {visibleDocs.map(d=>(
                  <DocListItem key={d.doctor} d={d} mode={effectiveMode} modeColor={modeInfo.color}
                    isSelected={selDoc===d.doctor} activeMonths={activeMonths}
                    onClick={()=>setSelDoc(selDoc===d.doctor?null:d.doctor)}/>
                ))}
              </div>
            </div>

            {/* Right panel */}
            <div style={{ flex:1, minWidth:0, overflowY:"auto" }}>
              {!selDoc
                ? <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10, color:C.muted }}>
                    <div style={{ fontSize:30 }}>👆</div>
                    <div style={{ fontSize:14 }}>Select a doctor to see details</div>
                  </div>
                : <DocDetail
                    selDoc={selDoc}
                    doctorStats={doctorStats}
                    allDoctorStats={allDoctorStats}
                    activeMonths={activeMonths}
                    allMonths={allMonths}
                    fullSlopes={fullSlopes}
                    mode={effectiveMode}
                    muspData={muspData}
                    psData={psData}
                  />
              }
            </div>
          </div>
        )}

      </main>

      {/* ── Footer ── */}
      <footer style={{ borderTop:"1px solid "+C.border, padding:"12px 24px", display:"flex", justifyContent:"space-between", alignItems:"center", background:C.bg }}>
        <span style={{ fontSize:11, color:C.muted, fontFamily:"DM Mono,monospace" }}>v2.1.0</span>
        <span style={{ fontSize:11, color:C.muted }}>Made with 🤙 by Antoine Heritier</span>
      </footer>

      {/* ── Treatment expand modal ── */}
      {expandedTreatment && (() => {
        const { t: treatName, isPS } = expandedTreatment;
        const key = isPS ? "ps_"+treatName : treatName;
        const lineColor = TC[treatName];
        const tData = timeline.map(row => ({ month: row.month, v: row[key]||0 }));
        const total = tData.reduce((s,r)=>s+r.v, 0);
        const slope = calcSlope(Object.fromEntries(tData.map((r,i)=>[i,r.v])), tData.map((_,i)=>i));
        return (
          <div onClick={()=>setExpandedTreatment(null)}
            style={{ position:"fixed", inset:0, zIndex:999, background:darkMode?"rgba(2,8,23,0.8)":"rgba(15,23,42,0.5)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div onClick={e=>e.stopPropagation()}
              style={{ background:C.surface, border:"1px solid "+lineColor+"60", borderRadius:16, padding:32, width:"min(760px,90vw)", boxShadow:"0 24px 80px #00000060" }}>
              {/* Header */}
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:24 }}>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                    <div style={{ width:10, height:10, borderRadius:3, background:lineColor }}/>
                    <span style={{ fontSize:11, color:C.muted, fontWeight:600, textTransform:"uppercase", letterSpacing:.8 }}>{treatName}</span>
                    {isPS && <span style={{ fontSize:9, color:TC[treatName], background:TC[treatName]+"15", border:"1px solid "+TC[treatName]+"30", borderRadius:4, padding:"1px 6px", fontWeight:600 }}>Patients Start</span>}
                  </div>
                  <div style={{ fontSize:28, fontWeight:700, fontFamily:"DM Mono,monospace", color:lineColor }}>{total.toLocaleString()}</div>
                  <div style={{ fontSize:13, color:sc(slope), fontFamily:"DM Mono,monospace", marginTop:3 }}>{fmt(slope,1)} /mo · {activeMonths.length} months</div>
                </div>
                <button onClick={()=>setExpandedTreatment(null)}
                  style={{ background:"transparent", border:"1px solid "+C.border, color:C.muted, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", fontFamily:"inherit" }}>✕ Close</button>
              </div>
              {/* Full chart */}
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={tData} margin={{top:4,right:8,left:-10,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                  <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <YAxis tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                  <RT content={({ active, payload }) => {
                    if (!active||!payload?.length) return null;
                    return <div style={{ background:C.bg, border:"1px solid "+C.border, borderRadius:8, padding:"8px 12px", fontSize:12 }}>
                      <div style={{ color:C.muted, marginBottom:2 }}>{payload[0]?.payload?.month}</div>
                      <div style={{ color:lineColor, fontFamily:"DM Mono,monospace", fontWeight:700, fontSize:15 }}>{(payload[0]?.value||0).toLocaleString()}</div>
                    </div>;
                  }}/>
                  <Line type="monotone" dataKey="v" stroke={lineColor} strokeWidth={2.5} dot={{ r:4, fill:lineColor, strokeWidth:0 }} activeDot={{ r:6, fill:lineColor }}/>
                </LineChart>
              </ResponsiveContainer>
              {/* Monthly values */}
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(100px,1fr))", gap:8, marginTop:20 }}>
                {tData.map((row, i) => {
                  const prev = i>0 ? tData[i-1].v : null;
                  const mom  = prev!==null && prev>0 ? ((row.v-prev)/prev*100) : null;
                  return (
                    <div key={row.month} style={{ background:C.bg, borderRadius:8, padding:"8px 10px", border:"1px solid "+C.border }}>
                      <div style={{ fontSize:9, color:C.muted, marginBottom:3 }}>{row.month}</div>
                      <div style={{ fontSize:13, fontWeight:700, fontFamily:"DM Mono,monospace", color:lineColor }}>{row.v.toLocaleString()}</div>
                      {mom!==null && <div style={{ fontSize:9, color:mom>=0?C.green:C.red, marginTop:1 }}>{mom>0?"+":""}{mom.toFixed(0)}%</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
