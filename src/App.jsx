import { useState, useCallback, useMemo } from "react";
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
    return (ic && doctor && date && treatment) ? [{ ic, doctor, date, treatment, val }] : [];
  });
}

function processPS(rows) {
  return rows.flatMap(r => {
    const ic        = (r["ISP (Cluster information from SFDC)"] || "").trim();
    const doctor    = (r["Doctor's Name"] || "").trim().replace(/^'+/, "");
    const date      = (r[""] || "").trim().slice(0, 7);
    const treatment = (r["By Treatment"] || "").trim();
    const val       = parseInt(r["2. First Scanned Patients"] || "0") || 0;
    return (doctor && date && treatment) ? [{ ic, doctor, date, treatment, val }] : [];
  });
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TREATMENTS = ["Aligners", "Braces", "Pre-Treatment", "Post-Treatment", "Others"];
const TC = { Aligners:"#3b82f6", Braces:"#8b5cf6", "Pre-Treatment":"#06b6d4", "Post-Treatment":"#10b981", Others:"#f59e0b" };
const C  = { bg:"#020817", surface:"#0c1525", border:"#1a2744", text:"#e2e8f0", muted:"#64748b", accent:"#3b82f6", green:"#10b981", red:"#ef4444", amber:"#f59e0b", purple:"#a78bfa" };

const MODES = {
  musp: { key:"musp", label:"MUSP",            color:"#3b82f6", unit:"scans" },
  ps:   { key:"ps",   label:"Patients Start",  color:"#a78bfa", unit:"starts" },
  conv: { key:"conv", label:"Conversion",      color:"#10b981", unit:"%" },
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
  contentStyle:{ background:"#0c1525", border:"1px solid #1a2744", borderRadius:8, fontSize:12 },
  labelStyle:{ color:"#e2e8f0" }, itemStyle:{ color:"#94a3b8" },
};

const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:#020817}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:#0c1525}
::-webkit-scrollbar-thumb{background:#1a2744;border-radius:2px}
.rh:hover{background:#0c1525!important}
select option{background:#0c1525}
.tipw{position:relative;display:inline-flex;align-items:center;cursor:help}
.tipw .tip{
  display:none;position:fixed;
  background:#0c1525;border:1px solid #2d4a7a;border-radius:8px;
  padding:10px 12px;font-size:11px;color:#94a3b8;width:220px;
  z-index:99999;line-height:1.6;pointer-events:none;
  box-shadow:0 8px 32px #00000088;
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

// Conversion rate color: purple gradient
const cc = r => {
  if (r===null||r===undefined) return C.muted;
  if (r >= 30) return C.purple;
  if (r >= 15) return "#7c3aed";
  return C.muted;
};

// ─── Build doctor stats — unified for MUSP and PS ─────────────────────────────
// Returns array of doctor objects with byMonth, byTreatment, slope, total, status
function buildDoctorStats(rows, months, sizeBucket, sortDir, applySize) {
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
  const bucket = SIZE_BUCKETS[applySize ? sizeBucket : 0];
  return Object.values(map).map(s => {
    const vals   = months.map(m => s.byMonth[m]||0);
    const slope  = calcSlope(s.byMonth, months);
    const total  = totalOver(s.byMonth, months);
    const avg    = avgOver(s.byMonth, months);    // only used for MUSP size filtering
    const growth = cagr(s.byMonth, months);
    return { ...s, vals, slope, total, avg, growth, status:perfStatus(slope) };
  })
  .filter(d => d.avg >= bucket.min && d.avg <= bucket.max)
  .sort((a,b) => sortDir==="asc" ? a.slope-b.slope : b.slope-a.slope);
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

const Spark = ({ vals, color }) => {
  const max = Math.max(...(vals||[]), 1);
  return (
    <div style={{ display:"flex", gap:2, alignItems:"flex-end", height:14 }}>
      {(vals||[]).map((v,i) => (
        <div key={i} style={{ flex:1, height:Math.max(2,(v/max)*14), background:color, borderRadius:"1px 1px 0 0", opacity:.8 }}/>
      ))}
    </div>
  );
};

const ModeSwitch = ({ mode, setMode, hasPS }) => (
  <div style={{ display:"flex", background:C.surface, border:"1px solid "+C.border, borderRadius:10, padding:3, gap:2 }}>
    {Object.values(MODES).filter(m => m.key !== "conv" || hasPS).map(m => (
      <button key={m.key} onClick={() => setMode(m.key)}
        style={{ padding:"5px 16px", borderRadius:7, border:"none", background:mode===m.key?m.color+"20":"transparent", color:mode===m.key?m.color:C.muted, fontSize:12, fontWeight:mode===m.key?700:400, cursor:"pointer", transition:"all .15s", fontFamily:"inherit" }}>
        {m.label}
      </button>
    ))}
  </div>
);

// ─── Doctor list item ─────────────────────────────────────────────────────────
const DocListItem = ({ d, mode, modeColor, isSelected, onClick, activeMonths }) => {
  const s = STATUS[d.status];
  const metricLabel = mode==="conv"
    ? (d.convRate!==null ? d.convRate.toFixed(0)+"%" : "–")
    : fmtV(d.total);
  const slopeLabel  = mode==="conv"
    ? fmt(d.slope,1)+" pp/mo"
    : fmt(d.slope,1)+"/mo";
  return (
    <div className="rh" onClick={onClick}
      style={{ padding:"9px 12px", borderBottom:"1px solid "+C.border, cursor:"pointer", background:isSelected?"#1a2744":"transparent", borderLeft:"3px solid "+(isSelected?s.color:"transparent"), transition:"all .1s" }}>
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
      <Spark vals={d.vals} color={s.color}/>
    </div>
  );
};

// ─── Doctor detail — adapts to mode ───────────────────────────────────────────
function DocDetail({ selDoc, doctorStats, allDoctorStats, activeMonths, allMonths, fullSlopes, mode, muspData, psData }) {
  const d = doctorStats.find(x=>x.doctor===selDoc) || allDoctorStats.find(x=>x.doctor===selDoc);
  if (!d) return <div style={{ padding:24, color:C.muted, fontSize:13 }}>Not visible with current filters.</div>;

  const modeInfo = MODES[mode];
  const fullSl   = (allMonths.length > activeMonths.length && fullSlopes) ? (fullSlopes[d.doctor]??null) : null;
  const slopeDiff= fullSl!==null ? d.slope-fullSl : null;

  // Divergence banner
  const showDivergence = slopeDiff!==null && Math.abs(slopeDiff)>=1.5;
  const divDown = slopeDiff<=(-1.5);

  // Chart data
  let lineData, chartLines;
  if (mode === "conv") {
    lineData = activeMonths.map(m => ({
      month:fmtM(m),
      "Conv %": d.byMonth[m]||0,
      MUSP: d.muspByMonth[m]||0,
      "Pat. Start": d.psByMonth[m]||0,
    }));
    chartLines = [
      { key:"Conv %",     color:C.green,  width:2.5, dashed:false },
      { key:"MUSP",       color:C.accent, width:1.5, dashed:true },
      { key:"Pat. Start", color:C.purple, width:1.5, dashed:true },
    ];
  } else {
    lineData = activeMonths.map(m => {
      const row = { month:fmtM(m), Total:d.byMonth[m]||0 };
      TREATMENTS.forEach(t => { row[t] = d.mbt&&d.mbt[m] ? (d.mbt[m][t]||0) : 0; });
      return row;
    });
    chartLines = [
      { key:"Total", color:modeInfo.color, width:2.5, dashed:false },
      ...TREATMENTS.filter(t => (d.byTreatment[t]||0)>0).map(t => ({ key:t, color:TC[t], width:1.5, dashed:true })),
    ];
  }

  // KPI strip
  const kpis = mode==="conv" ? [
    { label:"Conv slope",    value:fmt(d.slope,1)+" pp/mo",              color:sc(d.slope),   tip:"Change in conversion rate per month (percentage points)." },
    { label:"Overall conv",  value:d.convRate!==null?d.convRate.toFixed(1)+"%":"–", color:cc(d.convRate), tip:"Total PS / Total MUSP over the period." },
    { label:"Total MUSP",    value:fmtV(d.totalMusp),                   color:C.accent,      tip:"Total MUSP scans in the period." },
    { label:"Total PS",      value:fmtV(d.totalPs),                     color:C.purple,      tip:"Total Patients Start in the period." },
  ] : [
    { label:"Slope",   value:fmt(d.slope,1)+"/mo",  color:sc(d.slope),   tip:"Linear regression slope on raw monthly values. >=+1 = Growing." },
    { label:"Growth",  value:fmt(d.growth,1)+"%",   color:gc(d.growth),  tip:"Compound monthly growth rate (first to last month)." },
    { label:"Total",   value:fmtV(d.total),         color:modeInfo.color,tip:"Total "+modeInfo.label+" over the selected period." },
  ];

  // Treatment table
  const treatRows = TREATMENTS.map(t => {
    if (mode==="conv") {
      const mu=d.muspByTreatment[t]||0, ps=d.psByTreatment[t]||0;
      const rate=mu>0?(ps/mu*100):null;
      if (mu===0&&ps===0) return null;
      return { t, primary:rate!==null?rate.toFixed(0)+"%":"–", secondary:mu+" MUSP / "+ps+" PS", color:cc(rate), bg:TC[t] };
    } else {
      const v = d.byTreatment[t]||0;
      if (v===0) return null;
      const tByM={};
      activeMonths.forEach(m => { tByM[m]=d.mbt&&d.mbt[m]?(d.mbt[m][t]||0):0; });
      const tSl=calcSlope(tByM,activeMonths);
      return { t, primary:fmtV(v), secondary:fmt(tSl,1)+"/mo", color:sc(tSl), bg:TC[t], total:v };
    }
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
        <div style={{ display:"flex", background:"#020817", borderRadius:10, border:"1px solid "+C.border }}>
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
        <ResponsiveContainer width="100%" height={190}>
          <LineChart data={lineData} margin={{top:0,right:0,left:-10,bottom:0}}>
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
          <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:14, fontWeight:600 }}>
            {mode==="conv"?"Conversion by Treatment":"By Treatment"}
          </div>
          {treatRows.sort((a,b)=>(parseFloat(b.primary)||0)-(parseFloat(a.primary)||0)).map(r => (
            <div key={r.t} style={{ marginBottom:12 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:r.bg }}/>
                  <span style={{ fontSize:12 }}>{r.t}</span>
                </div>
                <div style={{ fontFamily:"DM Mono,monospace" }}>
                  <span style={{ fontSize:13, fontWeight:700, color:r.color }}>{r.primary}</span>
                  <span style={{ fontSize:10, color:C.muted, marginLeft:8 }}>{r.secondary}</span>
                </div>
              </div>
              {mode!=="conv" && r.total && (
                <div style={{ height:3, background:C.border, borderRadius:2 }}>
                  <div style={{ height:"100%", width:Math.min(100,(r.total/Math.max(...treatRows.map(x=>x.total||0),1))*100)+"%", background:r.bg, borderRadius:2 }}/>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:20 }}>
          <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:10, fontWeight:600 }}>Monthly detail</div>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
            <thead>
              <tr>
                <th style={{ textAlign:"left", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>Month</th>
                {mode==="conv" ? <>
                  <th style={{ textAlign:"right", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>MUSP</th>
                  <th style={{ textAlign:"right", color:C.purple, fontWeight:600, fontSize:10, paddingBottom:6 }}>PS</th>
                  <th style={{ textAlign:"right", color:C.green, fontWeight:600, fontSize:10, paddingBottom:6 }}>Conv%</th>
                </> : <>
                  <th style={{ textAlign:"right", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>Value</th>
                  <th style={{ textAlign:"right", color:C.muted, fontWeight:600, fontSize:10, paddingBottom:6 }}>MoM</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {activeMonths.map((m, mi) => {
                if (mode==="conv") {
                  const mu=d.muspByMonth[m]||0, ps=d.psByMonth[m]||0;
                  const cr=mu>0?(ps/mu*100):null;
                  return (
                    <tr key={m} style={{ borderTop:"1px solid "+C.border }}>
                      <td style={{ padding:"5px 0", color:C.text }}>{fmtM(m)}</td>
                      <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", color:C.accent }}>{mu}</td>
                      <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", color:C.purple }}>{ps}</td>
                      <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", color:cc(cr) }}>{cr===null?"–":cr.toFixed(0)+"%"}</td>
                    </tr>
                  );
                }
                const v    = d.byMonth[m]||0;
                const prev = mi>0 ? (d.byMonth[activeMonths[mi-1]]||0) : null;
                const mom  = prev!==null && prev>0 ? ((v-prev)/prev*100) : null;
                return (
                  <tr key={m} style={{ borderTop:"1px solid "+C.border }}>
                    <td style={{ padding:"5px 0", color:C.text }}>{fmtM(m)}</td>
                    <td style={{ padding:"5px 0", textAlign:"right", fontFamily:"DM Mono,monospace", color:modeInfo.color }}>{v}</td>
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

    if (mode==="conv") {
      // Conversion-specific signals
      if (d.convRate!==null && d.convRate < 10 && d.totalMusp >= 20) {
        candidates.push({ type:"warning", priority:d.totalMusp*1.5,
          title:name+" — low conversion",
          body:"Overall conv rate "+d.convRate.toFixed(0)+"% on "+d.totalMusp+" MUSP. Scan volume exists but not converting to starts. IC: "+d.ic.split(" ")[0]+"."+ctx });
      }
      if (d.slope >= 1 && d.convRate!==null && d.convRate >= 20) {
        candidates.push({ type:"success", priority:d.slope*d.totalMusp,
          title:name+" — conversion improving",
          body:"Conv slope +"+fmt(d.slope,1)+" pp/mo. Rate "+d.convRate.toFixed(0)+"%. Getting more starts from existing pipeline. IC: "+d.ic.split(" ")[0]+"."+ctx });
      }
      if (d.slope <= -1.5 && d.convRate!==null && d.convRate < 20) {
        candidates.push({ type:"alert", priority:Math.abs(d.slope)*d.totalMusp,
          title:name+" — conversion declining",
          body:"Conv slope "+fmt(d.slope,1)+" pp/mo. Rate dropping to "+d.convRate.toFixed(0)+"%. Investigate treatment mix or follow-up process. IC: "+d.ic.split(" ")[0]+"."+ctx });
      }
    } else {
      // MUSP or PS signals
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

function UploadScreen({ onMUSP, onPS, muspLoaded, psLoaded, canStart, onStart }) {
  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", fontFamily:"DM Sans,sans-serif", color:C.text }}>
      <style>{css}</style>
      <div style={{ textAlign:"center", marginBottom:40 }}>
        <div style={{ fontSize:10, letterSpacing:4, color:C.accent, textTransform:"uppercase", marginBottom:14, fontWeight:600 }}>Performance Dashboard</div>
        <h1 style={{ fontSize:36, fontWeight:700, letterSpacing:-1.5, lineHeight:1.15 }}>
          MUSP <span style={{ color:C.muted, fontWeight:300 }}>+</span> <span style={{ color:C.purple }}>Patients Start</span>
        </h1>
        <p style={{ color:C.muted, marginTop:10, fontSize:13 }}>Upload your exports. Patients Start is optional.</p>
      </div>
      <div style={{ display:"flex", gap:14, width:"100%", maxWidth:520, marginBottom:20 }}>
        <UploadZone id="fi-musp" label="MUSP" sublabel="Required" onFile={onMUSP} loaded={muspLoaded} color={C.accent}/>
        <UploadZone id="fi-ps" label="Patients Start" sublabel="Optional" onFile={onPS} loaded={psLoaded} color={C.purple}/>
      </div>
      <button onClick={onStart} disabled={!canStart}
        style={{ background:canStart?C.accent:"#1a2744", color:canStart?"#020817":C.muted, border:"none", borderRadius:10, padding:"12px 36px", fontSize:14, fontWeight:700, cursor:canStart?"pointer":"default", transition:"all .2s" }}>
        {canStart?"Launch Dashboard  →":"Upload MUSP to continue"}
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [muspData,   setMuspData]   = useState(null);
  const [psData,     setPsData]     = useState(null);
  const [launched,   setLaunched]   = useState(false);
  const [mode,       setMode]       = useState("musp");     // "musp" | "ps" | "conv"
  const [view,       setView]       = useState("overview"); // "overview" | "doctors" | "recommendations"
  const [selIC,      setSelIC]      = useState("All");
  const [treatF,     setTreatF]     = useState("All");
  const [periodN,    setPeriodN]    = useState(null);
  const [selDoc,     setSelDoc]     = useState(null);
  const [docSearch,  setDocSearch]  = useState("");
  const [statusTab,  setStatusTab]  = useState("all");
  const [sizeBucket, setSizeBucket] = useState(0);
  const [sortDir,    setSortDir]    = useState("asc");

  const handleMUSP  = useCallback(f => { if(!f)return; const r=new FileReader(); r.onload=e=>setMuspData(processMUSP(parseCSV(e.target.result))); r.readAsText(f,"UTF-8"); },[]);
  const handlePS    = useCallback(f => { if(!f)return; const r=new FileReader(); r.onload=e=>setPsData(processPS(parseCSV(e.target.result))); r.readAsText(f,"UTF-8"); },[]);
  const handleStart = useCallback(() => { if(muspData){setLaunched(true);setSelIC("All");setPeriodN(null);setSelDoc(null);} },[muspData]);
  const handleReset = useCallback(() => { setMuspData(null);setPsData(null);setLaunched(false);setSelDoc(null);setMode("musp"); },[]);

  const hasPS = !!(psData && psData.length > 0);

  // When PS is removed, fall back from conv mode
  const effectiveMode = (mode==="conv"||mode==="ps") && !hasPS ? "musp" : mode;

  const allMonths    = useMemo(()=>muspData?[...new Set(muspData.map(r=>r.date))].sort():[], [muspData]);
  const activeMonths = useMemo(()=>{ const n=periodN||allMonths.length; return allMonths.slice(-n); }, [allMonths,periodN]);
  const ics          = useMemo(()=>muspData?[...new Set(muspData.map(r=>r.ic))].sort():[], [muspData]);

  const periodOptions = useMemo(()=>{
    if (!allMonths.length) return [];
    const opts=allMonths.map((_,i)=>({value:i+1,label:i===0?"Last month":"Last "+(i+1)+" months"}));
    opts[opts.length-1]={value:allMonths.length,label:"All "+allMonths.length+" months"};
    return opts;
  },[allMonths]);

  // Active dataset depends on mode
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
  const doctorStats = useMemo(()=>{
    if (effectiveMode==="conv") {
      if (!psData) return [];
      return buildConvStats(muspFiltered, psData.filter(r=>activeMonths.includes(r.date)&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF)), activeMonths, sizeBucket, sortDir, true);
    }
    return buildDoctorStats(activeData, activeMonths, sizeBucket, sortDir, true);
  },[effectiveMode,activeData,muspFiltered,psData,activeMonths,sizeBucket,sortDir,selIC,treatF]);

  const allDoctorStats = useMemo(()=>{
    if (effectiveMode==="conv") {
      if (!psData) return [];
      return buildConvStats(muspFiltered, psData.filter(r=>activeMonths.includes(r.date)&&(selIC==="All"||r.ic===selIC)&&(treatF==="All"||r.treatment===treatF)), activeMonths, sizeBucket, sortDir, false);
    }
    return buildDoctorStats(activeData, activeMonths, sizeBucket, sortDir, false);
  },[effectiveMode,activeData,muspFiltered,psData,activeMonths,sizeBucket,sortDir,selIC,treatF]);

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
      const mu=obj["MUSP"];
      obj["Conv %"]=mu>0?(obj["Pat. Start"]/mu*100):0;
    }
    return obj;
  }),[muspFiltered,psData,hasPS,activeMonths,selIC,treatF]);

  const recommendations = useMemo(()=>
    buildRecs(allDoctorStats,icStats,activeMonths,allMonths,selIC,treatF,fullSlopes,effectiveMode),
    [allDoctorStats,icStats,activeMonths,allMonths,selIC,treatF,fullSlopes,effectiveMode]);

  const visibleDocs = useMemo(()=>doctorStats.filter(d=>{
    if (statusTab!=="all"&&d.status!==statusTab) return false;
    const q=docSearch.toLowerCase();
    if (q&&!d.doctor.toLowerCase().includes(q)&&!d.ic.toLowerCase().includes(q)) return false;
    return true;
  }),[doctorStats,docSearch,statusTab]);

  if (!launched) return <UploadScreen onMUSP={handleMUSP} onPS={handlePS} muspLoaded={!!muspData} psLoaded={hasPS} canStart={!!muspData} onStart={handleStart}/>;

  const modeInfo    = MODES[effectiveMode];
  const periodLabel = activeMonths.length>=2 ? fmtM(activeMonths[0])+" → "+fmtM(activeMonths[activeMonths.length-1]) : fmtM(activeMonths[0]);
  const periodDiv   = kpis&&kpis.fullSlope!==null ? kpis.muspSlope-kpis.fullSlope : null;
  const showAlert   = effectiveMode==="musp" && periodDiv!==null && periodDiv<=-2;
  const showPos     = effectiveMode==="musp" && periodDiv!==null && periodDiv>=2;

  // KPI strip content depends on mode
  const kpiItems = !kpis ? [] : effectiveMode==="musp" ? [
    { label:"Total MUSP",    value:fmtV(kpis.muspTotal),                   color:C.accent,       tip:"Total MUSP in the selected period." },
    { label:"Slope",         value:fmt(kpis.muspSlope)+"/mo", sub:kpis.fullSlope!==null?"Full history: "+fmt(kpis.fullSlope)+"/mo":undefined, color:sc(kpis.muspSlope), tip:"Linear regression slope on monthly MUSP." },
    { label:"Growth",        value:fmt(kpis.muspGrowth)+"%",               color:gc(kpis.muspGrowth), tip:"Compound monthly growth rate." },
    { label:"Growing",       value:kpis.growing,   color:C.green, sub:"slope >=+1/mo",  tip:"Doctors gaining >=1 MUSP/month." },
    { label:"Declining",     value:kpis.declining, color:C.red,   sub:"slope <=-1/mo",  tip:"Doctors losing >=1 MUSP/month." },
    { label:"Stable",        value:kpis.stable,    color:C.amber, sub:"-1 < slope < +1",tip:"Doctors roughly flat." },
  ] : effectiveMode==="ps" ? [
    { label:"Total PS",      value:fmtV(kpis.psTotal),    color:C.purple,  tip:"Total Patients Start in the selected period." },
    { label:"PS Slope",      value:fmt(kpis.psSlope)+"/mo",               color:sc(kpis.psSlope||0), tip:"Linear regression slope on monthly PS." },
    { label:"Growing",       value:kpis.growing,   color:C.green, sub:"slope >=+1/mo",  tip:"Doctors with growing PS." },
    { label:"Declining",     value:kpis.declining, color:C.red,   sub:"slope <=-1/mo",  tip:"Doctors with declining PS." },
    { label:"Stable",        value:kpis.stable,    color:C.amber, sub:"-1 < slope < +1",tip:"Doctors with stable PS." },
  ] : [
    { label:"Conv Rate",     value:kpis.convRate!==null?kpis.convRate.toFixed(1)+"%":"–", color:cc(kpis.convRate), tip:"Total PS / Total MUSP in the period." },
    { label:"Total MUSP",    value:fmtV(kpis.muspTotal),   color:C.accent,  tip:"Total MUSP." },
    { label:"Total PS",      value:fmtV(kpis.psTotal),     color:C.purple,  tip:"Total Patients Start." },
    { label:"Growing",       value:kpis.growing,   color:C.green, sub:"conv slope >=+1",  tip:"Doctors with improving conversion." },
    { label:"Declining",     value:kpis.declining, color:C.red,   sub:"conv slope <=-1",  tip:"Doctors with declining conversion." },
    { label:"Stable",        value:kpis.stable,    color:C.amber, sub:"-1 < slope < +1",  tip:"Doctors with stable conversion." },
  ];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"DM Sans,sans-serif" }}>
      <style>{css}</style>

      {/* ── Header ── */}
      <header style={{ position:"sticky", top:0, zIndex:200, background:"#020817f0", backdropFilter:"blur(12px)", borderBottom:"1px solid "+C.border, height:54, display:"flex", alignItems:"center", padding:"0 24px", gap:16 }}>
        <nav style={{ display:"flex", gap:2 }}>
          {[["overview","Overview"],["doctors","Doctors"],["recommendations","Recs"+(recommendations.length?" ("+recommendations.length+")":"")]].map(([id,label])=>(
            <button key={id} onClick={()=>setView(id)}
              style={{ background:view===id?"#1a2744":"transparent", color:view===id?C.text:C.muted, border:"none", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontSize:12, fontWeight:500, fontFamily:"inherit", transition:"all .15s" }}>
              {label}
            </button>
          ))}
        </nav>

        {/* Mode switcher — center */}
        <div style={{ flex:1, display:"flex", justifyContent:"center" }}>
          <ModeSwitch mode={effectiveMode} setMode={m=>{ setMode(m); setSelDoc(null); }} hasPS={hasPS}/>
        </div>

        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <select value={periodN||allMonths.length} onChange={e=>{const v=+e.target.value;setPeriodN(v===allMonths.length?null:v);}}
            style={{ background:C.surface, border:"1px solid "+C.border, color:C.accent, borderRadius:8, padding:"5px 10px", fontSize:12, fontFamily:"inherit", cursor:"pointer", fontWeight:600 }}>
            {periodOptions.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
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
          {sizeBucket>0&&<span style={{ fontSize:11, color:C.amber, fontWeight:600, background:"#f59e0b15", border:"1px solid #f59e0b30", borderRadius:5, padding:"1px 8px" }}>{SIZE_BUCKETS[sizeBucket].label}</span>}
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
            <div style={{ display:"grid", gridTemplateColumns:"3fr 2fr", gap:18 }}>

              {/* Timeline chart */}
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:22 }}>
                <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:16, fontWeight:600 }}>
                  {effectiveMode==="musp" && "MUSP by Treatment"}
                  {effectiveMode==="ps"   && "Patients Start over Time"}
                  {effectiveMode==="conv" && "Conversion Rate over Time"}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  {effectiveMode==="conv" ? (
                    <LineChart data={timeline} margin={{top:0,right:0,left:-10,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false} unit="%"/>
                      <RT {...TT}/>
                      <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
                      <Line type="monotone" dataKey="Conv %" stroke={C.green} strokeWidth={2.5} dot={{r:3,fill:C.green}}/>
                    </LineChart>
                  ) : effectiveMode==="ps" ? (
                    <LineChart data={timeline} margin={{top:0,right:0,left:-10,bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                      <RT {...TT}/>
                      <Line type="monotone" dataKey="Pat. Start" stroke={C.purple} strokeWidth={2.5} dot={{r:3,fill:C.purple}}/>
                    </LineChart>
                  ) : (
                    <AreaChart data={timeline} margin={{top:0,right:0,left:-10,bottom:0}}>
                      <defs>
                        {TREATMENTS.map(t=>(
                          <linearGradient key={t} id={"g"+t.replace(/\W/g,"")} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={TC[t]} stopOpacity={0.4}/>
                            <stop offset="95%" stopColor={TC[t]} stopOpacity={0}/>
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.border}/>
                      <XAxis dataKey="month" tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                      <YAxis tick={{fill:C.muted,fontSize:11}} axisLine={false} tickLine={false}/>
                      <RT {...TT}/>
                      <Legend wrapperStyle={{fontSize:11,paddingTop:8}}/>
                      {TREATMENTS.map(t=>(
                        <Area key={t} type="monotone" dataKey={t} stackId="1" stroke={TC[t]} fill={"url(#g"+t.replace(/\W/g,"")+")"} strokeWidth={1.5}/>
                      ))}
                    </AreaChart>
                  )}
                </ResponsiveContainer>
              </div>

              {/* IC list */}
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:22 }}>
                <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, marginBottom:16, fontWeight:600 }}>IC Performance</div>
                <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                  {icStats.map(s=>(
                    <div key={s.ic} onClick={()=>setSelIC(selIC===s.ic?"All":s.ic)}
                      style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:selIC===s.ic?"#1a2744":"#020817", borderRadius:8, cursor:"pointer", border:"1px solid "+(selIC===s.ic?C.accent:C.border), transition:"all .15s" }}>
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
            </div>

            {/* Top tables */}
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:18 }}>
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
                          {effectiveMode==="conv" && d.convRate!==null && (
                            <div style={{ fontSize:10, color:cc(d.convRate) }}>{d.convRate.toFixed(0)}% conv</div>
                          )}
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
                  style={{ width:"100%", background:"#020817", border:"1px solid "+C.border, color:C.text, borderRadius:7, padding:"6px 10px", fontSize:12, fontFamily:"inherit", outline:"none" }}/>
                <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
                  {SIZE_BUCKETS.map((b,i)=>(
                    <button key={i} onClick={()=>setSizeBucket(i)}
                      style={{ fontSize:10, padding:"3px 7px", borderRadius:5, border:"1px solid "+(sizeBucket===i?C.accent:C.border), background:sizeBucket===i?"#3b82f620":"transparent", color:sizeBucket===i?C.accent:C.muted, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", transition:"all .15s" }}>
                      {b.label}
                    </button>
                  ))}
                </div>
                <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                  <span style={{ fontSize:10, color:C.muted }}>Sort:</span>
                  {[["asc","Worst first"],["desc","Best first"]].map(([dir,label])=>(
                    <button key={dir} onClick={()=>setSortDir(dir)}
                      style={{ fontSize:10, padding:"3px 8px", borderRadius:5, border:"1px solid "+(sortDir===dir?C.accent:C.border), background:sortDir===dir?"#3b82f620":"transparent", color:sortDir===dir?C.accent:C.muted, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
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
                      style={{ flex:1, background:statusTab===key?"#1a2744":"transparent", border:"none", borderBottom:"2px solid "+(statusTab===key?color:"transparent"), color, padding:"7px 2px", fontSize:10, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
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

        {/* ══ RECOMMENDATIONS ══ */}
        {view==="recommendations" && (
          <div style={{ maxWidth:820, display:"flex", flexDirection:"column", gap:10 }}>
            <div style={{ fontSize:13, color:C.muted, marginBottom:6, lineHeight:1.7 }}>
              {"Signals for "+modeInfo.label+" mode — slope, divergence, treatment trends."}
              {" 1 signal per doctor max, sorted by impact."}
              {periodN&&allMonths.length>activeMonths.length&&<span style={{ color:C.amber }}>{" Scoped to last "+activeMonths.length+" months."}</span>}
            </div>
            {recommendations.length===0 && (
              <div style={{ background:C.surface, border:"1px solid "+C.border, borderRadius:12, padding:40, textAlign:"center", color:C.muted, fontSize:14 }}>
                No significant signals for this configuration.
              </div>
            )}
            {recommendations.map((r,i)=>{
              const S={ warning:{bg:"#f59e0b12",border:"#f59e0b35",icon:"⚠️",color:C.amber}, alert:{bg:"#ef444412",border:"#ef444435",icon:"🔴",color:C.red}, success:{bg:"#10b98112",border:"#10b98135",icon:"✅",color:C.green} };
              const s=S[r.type]||S.alert;
              return (
                <div key={i} style={{ background:s.bg, border:"1px solid "+s.border, borderRadius:10, padding:"14px 18px", display:"flex", gap:12, alignItems:"flex-start" }}>
                  <div style={{ fontSize:16, flexShrink:0, marginTop:1 }}>{s.icon}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:13, color:s.color, marginBottom:3 }}>{r.title}</div>
                    <div style={{ fontSize:12, color:C.muted, lineHeight:1.7 }}>{r.body}</div>
                  </div>
                  {r.doctor && (
                    <button onClick={()=>{ setSelDoc(r.doctor); setStatusTab("all"); setDocSearch(""); setView("doctors"); }}
                      style={{ background:"transparent", border:"1px solid "+s.border, color:s.color, borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap", flexShrink:0 }}>
                      View
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
