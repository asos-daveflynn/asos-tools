import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

// ── Types ────────────────────────────────────────────────────────────────────
interface Entry { participant: string; task: string; response: string; }
interface Study { id: number; name: string; type: string; date: string; participants: number; report: Report; }
interface Insight { title: string; description: string; type: string; severity: "critical" | "major" | "minor"; quotes: string[]; }
interface WorkedItem { finding: string; quote?: string; impact?: string; }
interface DidntWorkItem { finding: string; quote?: string; severity?: string; }
interface Recommendation { recommendation: string; rationale: string; priority: "high" | "medium" | "low"; effort: "low" | "medium" | "high"; }
interface RecommendedTest { testType: string; objective: string; howToRun: string; participants: string; estimatedTime: string; }
interface Report {
  executiveSummary: string; overallSentiment: "positive" | "mixed" | "negative";
  confidenceScore: number; keyInsights: Insight[];
  whatWorked: WorkedItem[]; whatDidntWork: DidntWorkItem[];
  designRecommendations: Recommendation[];
  nextSteps: { furtherTestingNeeded: boolean; rationale: string; recommendedTests: RecommendedTest[]; };
  crossStudyPatterns?: string;
}

// ── XLSX Parser ───────────────────────────────────────────────────────────────
async function parseUserTestingXLSX(file: File): Promise<{ studyTitle: string; participants: unknown[]; entries: Entry[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /session/i.test(n)) || wb.SheetNames[0];
  const data = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, defval: null });
  const studyTitle = String((data[0] as unknown[])?.[0] || "").trim();
  const usernameRow = data.find((r) => String((r as unknown[])[0] || "").toLowerCase() === "username") as unknown[] | undefined;
  const usernames = usernameRow ? usernameRow.slice(1).filter((v) => v != null && String(v).trim() !== "") : [];
  if (usernames.length === 0) throw new Error("Could not find participant usernames. Please check this is a UserTesting XLSX export.");
  const tasks: { task: string; question: string; responses: string[] }[] = [];
  for (let i = 0; i < data.length; i++) {
    const label = String((data[i] as unknown[])?.[0] || "").trim();
    if (/^Task \d+/i.test(label) && i + 1 < data.length) {
      const nextRow = data[i + 1] as unknown[];
      const question = String(nextRow?.[0] || "").trim();
      const responses = usernames.map((_, pIdx) => { const v = nextRow?.[pIdx + 1]; return v != null ? String(v).trim() : ""; });
      tasks.push({ task: label, question, responses });
    }
  }
  const entries: Entry[] = [];
  usernames.forEach((username, pIdx) => {
    tasks.forEach((t) => { const r = t.responses[pIdx]; if (r && r.length > 5) entries.push({ participant: String(username), task: t.question || t.task, response: r }); });
  });
  return { studyTitle, participants: usernames, entries };
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((line) => {
    const vals: string[] = []; let cur = "", inQ = false;
    for (const ch of line) { if (ch === '"') { inQ = !inQ; continue; } if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; continue; } cur += ch; }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || ""]));
  });
}

// ── AI Analysis (via proxy) ───────────────────────────────────────────────────
const PROXY_URL = "https://research-buddy-proxy.vercel.app/api/analyse";

async function analyseWithAI(studyName: string, studyType: string, entries: Entry[], allStudies: Study[]): Promise<Report> {
  const summary = entries.slice(0, 40).map((e) => `[${e.participant} – ${e.task.slice(0, 60)}]: ${e.response.slice(0, 200)}`).join("\n");
  const cx = allStudies.length > 0 ? `\nPrior studies: ${allStudies.map((s) => s.name).join(", ")}.` : "";

  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ studyName, studyType, summary, priorStudies: cx }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error("Analysis failed (" + res.status + "): " + errText.slice(0, 200));
  }

  const data = await res.json() as { report?: Report; error?: string };
  if (data.error) throw new Error(data.error);
  if (!data.report) throw new Error("No report returned from analysis service.");
  return data.report;
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Cormorant+Garamond:wght@600;700&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --black:#0a0a0a;--asos-red:#e61e4d;--asos-red-dark:#c01540;
    --surface:#141414;--surface2:#1e1e1e;--border:rgba(255,255,255,0.08);
    --border-strong:rgba(255,255,255,0.15);--text-primary:#f0ede8;
    --text-secondary:#9a9590;--text-muted:#5c5856;
    --positive:#22c55e;--negative:#ef4444;--neutral:#f59e0b;
  }
  body{background:var(--black);color:var(--text-primary);font-family:'DM Sans',sans-serif}
  .app{min-height:100vh;display:flex;flex-direction:column}
  .nav{display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem;height:56px;border-bottom:1px solid var(--border);background:rgba(10,10,10,0.97);position:sticky;top:0;z-index:100}
  .nav-logo{display:flex;align-items:center;gap:10px}
  .nav-mark{width:30px;height:30px;background:var(--asos-red);display:flex;align-items:center;justify-content:center;font-family:'Cormorant Garamond',serif;font-weight:700;font-size:15px;color:white;flex-shrink:0}
  .nav-name{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
  .nav-sub{font-size:10px;color:var(--text-muted)}
  .nav-tabs{display:flex;gap:2px}
  .nav-tab{padding:5px 14px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border:none;background:transparent;color:var(--text-secondary);cursor:pointer;border-radius:3px;transition:all .15s}
  .nav-tab:hover{color:var(--text-primary);background:var(--surface2)}
  .nav-tab.active{color:var(--text-primary);background:var(--surface2);border-bottom:2px solid var(--asos-red);border-radius:3px 3px 0 0}
  .upload-wrap{flex:1;display:flex;align-items:center;justify-content:center;padding:3rem 1.5rem}
  .upload-card{width:100%;max-width:540px;background:var(--surface);border:1px solid var(--border);padding:2.5rem}
  .eyebrow{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--asos-red);font-weight:600;margin-bottom:.75rem}
  .big-head{font-family:'Cormorant Garamond',serif;font-size:2.2rem;font-weight:700;line-height:1.1;margin-bottom:.5rem}
  .sub{font-size:13px;color:var(--text-secondary);margin-bottom:2rem;line-height:1.6}
  .field{margin-bottom:1.1rem}
  .label{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-secondary);display:block;margin-bottom:7px}
  .inp{width:100%;background:var(--surface2);border:1px solid var(--border-strong);color:var(--text-primary);padding:9px 13px;font-size:13px;font-family:'DM Sans',sans-serif;outline:none;transition:border-color .15s}
  .inp:focus{border-color:var(--asos-red)}
  .drop{border:1.5px dashed var(--border-strong);padding:2rem;text-align:center;cursor:pointer;transition:all .2s;background:var(--surface2)}
  .drop:hover,.drop.drag{border-color:var(--asos-red);background:rgba(230,30,77,.04)}
  .drop-icon{font-size:1.8rem;margin-bottom:.6rem}
  .drop-txt{font-size:13px;color:var(--text-secondary)}
  .drop-txt strong{color:var(--asos-red)}
  .drop-note{font-size:11px;color:var(--text-muted);margin-top:5px}
  .file-ok{font-size:12px;color:var(--positive);margin-top:7px;font-weight:500}
  .btn{width:100%;padding:12px;background:var(--asos-red);color:white;border:none;font-family:'DM Sans',sans-serif;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;margin-top:1.25rem;transition:background .15s;display:flex;align-items:center;justify-content:center;gap:8px}
  .btn:hover:not(:disabled){background:var(--asos-red-dark)}
  .btn:disabled{opacity:.45;cursor:not-allowed}
  .btn-sm{padding:7px 14px;background:transparent;color:var(--text-secondary);border:1px solid var(--border-strong);font-family:'DM Sans',sans-serif;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;transition:all .15s}
  .btn-sm:hover{color:var(--text-primary);border-color:var(--text-muted)}
  .err{font-size:12px;color:var(--negative);margin-top:10px;padding:10px 13px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);line-height:1.5}
  .overlay{position:fixed;inset:0;background:rgba(10,10,10,.93);z-index:200;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.2rem}
  .spinner{width:40px;height:40px;border:2px solid var(--border-strong);border-top-color:var(--asos-red);border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .loading-txt{font-size:13px;color:var(--text-secondary)}
  .loading-step{font-size:11px;color:var(--text-muted);max-width:300px;text-align:center;line-height:1.5}
  .lib-wrap{flex:1;padding:2rem 1.5rem;max-width:1100px;margin:0 auto;width:100%}
  .lib-hd{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:1.75rem}
  .lib-title{font-family:'Cormorant Garamond',serif;font-size:1.9rem;font-weight:700}
  .lib-ct{font-size:11px;color:var(--text-muted);margin-top:3px}
  .s-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1px;background:var(--border)}
  .s-card{background:var(--surface);padding:1.25rem;cursor:pointer;transition:background .15s;position:relative;overflow:hidden}
  .s-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--asos-red);transform:scaleY(0);transition:transform .2s}
  .s-card:hover{background:var(--surface2)}
  .s-card:hover::before{transform:scaleY(1)}
  .s-type{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--asos-red);font-weight:600;margin-bottom:.4rem}
  .s-name{font-size:14px;font-weight:600;margin-bottom:.4rem;line-height:1.3}
  .s-date{font-size:11px;color:var(--text-muted)}
  .s-meta{display:flex;gap:8px;margin-top:.9rem;flex-wrap:wrap}
  .spill{font-size:10px;padding:2px 9px;border-radius:100px;font-weight:600;letter-spacing:.03em;text-transform:uppercase}
  .s-pos{background:rgba(34,197,94,.12);color:var(--positive)}
  .s-mix{background:rgba(245,158,11,.12);color:var(--neutral)}
  .s-neg{background:rgba(239,68,68,.12);color:var(--negative)}
  .spill-gray{background:var(--surface2);color:var(--text-muted)}
  .empty-lib{text-align:center;padding:5rem 2rem;color:var(--text-muted)}
  .patterns{background:linear-gradient(135deg,rgba(230,30,77,.08),rgba(230,30,77,.02));border:1px solid rgba(230,30,77,.2);padding:1rem 1.25rem;margin-bottom:1.75rem}
  .patterns-lbl{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--asos-red);font-weight:600;margin-bottom:5px}
  .patterns-txt{font-size:13px;color:var(--text-secondary);line-height:1.6}
  .rep-wrap{flex:1;padding:2rem 1.5rem;max-width:900px;margin:0 auto;width:100%}
  .back-btn{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--text-muted);cursor:pointer;margin-bottom:1.75rem;text-transform:uppercase;letter-spacing:.08em;font-weight:600;background:none;border:none;transition:color .15s}
  .back-btn:hover{color:var(--text-primary)}
  .rep-hd{margin-bottom:2.5rem;padding-bottom:1.75rem;border-bottom:1px solid var(--border)}
  .rep-type{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--asos-red);font-weight:600;margin-bottom:.6rem}
  .rep-title{font-family:'Cormorant Garamond',serif;font-size:2.4rem;font-weight:700;line-height:1.1;margin-bottom:.75rem}
  .rep-date{font-size:11px;color:var(--text-muted)}
  .meta-bar{display:flex;gap:1.75rem;margin-top:1.25rem;flex-wrap:wrap}
  .meta-lbl{font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em;font-weight:600;margin-bottom:3px}
  .meta-val{font-size:18px;font-weight:700}
  .conf-bar{width:110px;height:3px;background:var(--surface2);margin-top:7px}
  .conf-fill{height:100%;background:var(--asos-red)}
  .rep-sum{font-size:14px;color:var(--text-secondary);line-height:1.7;margin-top:.9rem;max-width:640px}
  .sec{margin-bottom:2.5rem}
  .sec-title{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:1rem;display:flex;align-items:center;gap:10px}
  .sec-title::after{content:'';flex:1;height:1px;background:var(--border)}
  .ins-grid{display:flex;flex-direction:column;gap:1px;background:var(--border)}
  .ins-card{background:var(--surface);padding:1.25rem}
  .ins-hd{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:.6rem;gap:1rem}
  .ins-ttl{font-size:14px;font-weight:600;line-height:1.3}
  .ins-desc{font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:.9rem}
  .ins-quotes{display:flex;flex-direction:column;gap:7px}
  .ins-q{border-left:2px solid var(--border-strong);padding:7px 13px;font-size:12px;color:var(--text-muted);font-style:italic;line-height:1.5}
  .bpill{font-size:9px;padding:3px 9px;border-radius:2px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;flex-shrink:0}
  .p-crit{background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
  .p-maj{background:rgba(249,115,22,.12);color:#f97316;border:1px solid rgba(249,115,22,.2)}
  .p-min{background:rgba(234,179,8,.12);color:#eab308;border:1px solid rgba(234,179,8,.2)}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)}
  .worked{background:var(--surface);padding:1.25rem}
  .worked-hd{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-bottom:.9rem;display:flex;align-items:center;gap:7px}
  .dot-p{width:7px;height:7px;border-radius:50%;background:var(--positive);flex-shrink:0}
  .dot-n{width:7px;height:7px;border-radius:50%;background:var(--negative);flex-shrink:0}
  .w-items{display:flex;flex-direction:column;gap:.9rem}
  .w-find{font-size:13px;font-weight:600;margin-bottom:3px}
  .w-impact{font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:5px}
  .w-q{font-size:11px;color:var(--text-muted);font-style:italic;border-left:2px solid var(--border-strong);padding-left:9px;line-height:1.4}
  .rec-list{display:flex;flex-direction:column;gap:1px;background:var(--border)}
  .rec-item{background:var(--surface);padding:1.1rem 1.25rem;display:flex;gap:1.25rem;align-items:flex-start}
  .rec-num{font-family:'Cormorant Garamond',serif;font-size:1.8rem;font-weight:700;color:var(--border-strong);line-height:1;flex-shrink:0;width:28px}
  .rec-reco{font-size:13px;font-weight:600;margin-bottom:5px;line-height:1.4}
  .rec-rat{font-size:12px;color:var(--text-secondary);line-height:1.5;margin-bottom:8px}
  .rec-pills{display:flex;gap:7px;flex-wrap:wrap}
  .pp-h{background:rgba(239,68,68,.1);color:#ef4444;font-size:9px;padding:2px 7px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .pp-m{background:rgba(249,115,22,.1);color:#f97316;font-size:9px;padding:2px 7px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .pp-l{background:rgba(34,197,94,.1);color:#22c55e;font-size:9px;padding:2px 7px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .pp-e{background:var(--surface2);color:var(--text-muted);font-size:9px;padding:2px 7px;font-weight:600;text-transform:uppercase;letter-spacing:.06em}
  .ns-intro{font-size:13px;color:var(--text-secondary);line-height:1.6;margin-bottom:1.25rem;background:var(--surface);padding:1.1rem 1.25rem;border-left:3px solid var(--asos-red)}
  .test-cards{display:flex;flex-direction:column;gap:1px;background:var(--border)}
  .test-card{background:var(--surface);padding:1.25rem}
  .test-hd{display:flex;align-items:center;gap:10px;margin-bottom:.9rem;flex-wrap:wrap}
  .test-type{font-size:13px;font-weight:700}
  .test-badge{font-size:9px;padding:3px 9px;background:rgba(230,30,77,.1);color:var(--asos-red);font-weight:700;text-transform:uppercase;letter-spacing:.06em}
  .test-grid{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
  .test-grid label{font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);display:block;margin-bottom:4px}
  .test-grid p{font-size:12px;color:var(--text-secondary);line-height:1.5}
  .test-full{grid-column:1/-1}
  .share-bar{position:sticky;bottom:0;background:rgba(10,10,10,.96);border-top:1px solid var(--border);padding:.9rem 1.5rem;display:flex;align-items:center;justify-content:space-between}
  .share-txt{font-size:11px;color:var(--text-muted)}
  .share-acts{display:flex;gap:7px}
  @media(max-width:580px){.two,.test-grid{grid-template-columns:1fr}.rep-title{font-size:1.8rem}}
`;

const STUDY_TYPES = ["Usability Testing (Task-based)", "Concept Testing (Early Ideas)", "A/B Test Feedback", "Mixed Methods"];

function sevClass(s: string) { return s === "critical" ? "p-crit" : s === "major" ? "p-maj" : "p-min"; }
function priClass(p: string) { return p === "high" ? "pp-h" : p === "medium" ? "pp-m" : "pp-l"; }
function sentClass(s: string) { return s === "positive" ? "s-pos" : s === "negative" ? "s-neg" : "s-mix"; }
function sentColor(s: string) { return s === "positive" ? "var(--positive)" : s === "negative" ? "var(--negative)" : "var(--neutral)"; }

export default function App() {
  const [view, setView] = useState<"upload" | "library" | "report">("upload");
  const [studies, setStudies] = useState<Study[]>([]);
  const [active, setActive] = useState<Study | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [studyName, setStudyName] = useState("");
  const [studyType, setStudyType] = useState(STUDY_TYPES[0]);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleAnalyse = useCallback(async () => {
    if (!file || !studyName.trim()) { setError("Please name your study and upload a file."); return; }
    setError(""); setLoading(true);
    try {
      setLoadingStep("Reading transcript data…");
      let entries: Entry[] = [];
      const isXLSX = /\.xlsx?$/i.test(file.name);
      if (isXLSX) {
        const p = await parseUserTestingXLSX(file);
        entries = p.entries;
        if (!entries.length) throw new Error("No transcript responses found. Please check it's a UserTesting XLSX export.");
      } else {
        const text = await file.text();
        const rows = parseCSV(text);
        if (!rows.length) throw new Error("Could not parse the file.");
        const keys = Object.keys(rows[0] || {});
        const tKey = keys.find((k) => /transcript|response|answer|note|comment/i.test(k)) || keys[keys.length - 1];
        const qKey = keys.find((k) => /task|question|scenario/i.test(k)) || keys[0];
        const pKey = keys.find((k) => /participant|user|tester|id/i.test(k));
        entries = rows.map((r) => ({ participant: pKey ? r[pKey] : "Unknown", task: r[qKey] || "", response: r[tKey] || "" }));
      }
      const pCount = [...new Set(entries.map((e) => e.participant))].length;
      setLoadingStep(`Found ${entries.length} responses from ${pCount} participants. Analysing with AI…`);
      const report = await analyseWithAI(studyName.trim(), studyType, entries, studies);
      const study: Study = { id: Date.now(), name: studyName.trim(), type: studyType, date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }), participants: pCount, report };
      setStudies((prev) => [study, ...prev]);
      setActive(study); setView("report");
      setFile(null); setStudyName(""); setStudyType(STUDY_TYPES[0]);
    } catch (e) { setError((e as Error).message || "Something went wrong. Please try again."); }
    finally { setLoading(false); setLoadingStep(""); }
  }, [file, studyName, studyType, studies]);

  const copyReport = () => {
    if (!active) return;
    const r = active.report;
    navigator.clipboard.writeText(`ASOS Research Report: ${active.name}\n${active.date}\n\n${r.executiveSummary}\n\nKey Insights:\n${r.keyInsights?.map((i) => `- ${i.title}: ${i.description}`).join("\n")}\n\nRecommendations:\n${r.designRecommendations?.map((d, i) => `${i + 1}. ${d.recommendation}`).join("\n")}`).catch(() => {});
  };

  return (
    <>
      <style>{styles}</style>
      {loading && (<div className="overlay"><div className="spinner" /><div className="loading-txt">Analysing your research</div><div className="loading-step">{loadingStep}</div></div>)}
      <div className="app">
        <nav className="nav">
          <div className="nav-logo">
            <div className="nav-mark">R</div>
            <div><div className="nav-name">Research Buddy</div><div className="nav-sub">by ASOS Design</div></div>
          </div>
          <div className="nav-tabs">
            <button className={`nav-tab ${view === "upload" ? "active" : ""}`} onClick={() => setView("upload")}>New Study</button>
            <button className={`nav-tab ${view !== "upload" ? "active" : ""}`} onClick={() => setView("library")}>Library {studies.length > 0 && `(${studies.length})`}</button>
          </div>
        </nav>

        {view === "upload" && (
          <div className="upload-wrap">
            <div className="upload-card">
              <div className="eyebrow">New Research Study</div>
              <h1 className="big-head">Upload your<br />UserTesting export</h1>
              <p className="sub">Upload your XLSX or CSV and we'll synthesise insights, quotes, recommendations and next steps — ready to share with stakeholders.</p>
              <div className="field"><label className="label">Study Name</label><input className="inp" placeholder="e.g. Checkout Flow Usability — March 2026" value={studyName} onChange={(e) => setStudyName(e.target.value)} /></div>
              <div className="field"><label className="label">Study Type</label><select className="inp" style={{ appearance: "none", cursor: "pointer" }} value={studyType} onChange={(e) => setStudyType(e.target.value)}>{STUDY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field">
                <label className="label">Transcript File</label>
                <div className={`drop ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }} onClick={() => fileRef.current?.click()}>
                  <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
                  <div className="drop-icon">📂</div>
                  <div className="drop-txt"><strong>Drop your file here</strong> or click to browse</div>
                  <div className="drop-note">XLSX or CSV exports from UserTesting.com</div>
                  {file && <div className="file-ok">✓ {file.name}</div>}
                </div>
              </div>
              {error && <div className="err">{error}</div>}
              <button className="btn" onClick={handleAnalyse} disabled={loading || !file || !studyName.trim()}>Analyse Study →</button>
            </div>
          </div>
        )}

        {view === "library" && (
          <div className="lib-wrap">
            <div className="lib-hd">
              <div><div className="lib-title">Study Library</div><div className="lib-ct">{studies.length} {studies.length === 1 ? "study" : "studies"} analysed</div></div>
              <button className="btn-sm" onClick={() => setView("upload")}>+ New Study</button>
            </div>
            {studies.length > 1 && (() => { const p = studies.find((s) => s.report?.crossStudyPatterns && s.report.crossStudyPatterns !== "null")?.report.crossStudyPatterns; return p ? <div className="patterns"><div className="patterns-lbl">Cross-Study Pattern</div><div className="patterns-txt">{p}</div></div> : null; })()}
            {studies.length === 0 ? (<div className="empty-lib"><div style={{ fontSize: "2.5rem", opacity: 0.3, marginBottom: "1rem" }}>🔬</div><div style={{ fontSize: 13 }}>No studies yet — upload your first transcript to get started.</div></div>) : (
              <div className="s-grid">
                {studies.map((s) => (
                  <div key={s.id} className="s-card" onClick={() => { setActive(s); setView("report"); }}>
                    <div className="s-type">{s.type}</div>
                    <div className="s-name">{s.name}</div>
                    <div className="s-date">{s.date} · {s.participants} participants</div>
                    <div className="s-meta">
                      <span className={`spill ${sentClass(s.report?.overallSentiment)}`}>{s.report?.overallSentiment}</span>
                      <span className="spill spill-gray">{s.report?.keyInsights?.length || 0} insights</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "report" && active && (() => {
          const r = active.report;
          return (<>
            <div className="rep-wrap">
              <button className="back-btn" onClick={() => setView("library")}>← Back to Library</button>
              <div className="rep-hd">
                <div className="rep-type">{active.type}</div>
                <h1 className="rep-title">{active.name}</h1>
                <div className="rep-date">{active.date} · {active.participants} participants</div>
                <div className="meta-bar">
                  <div><div className="meta-lbl">Sentiment</div><div style={{ fontSize: 13, fontWeight: 700, textTransform: "capitalize", paddingTop: 5, color: sentColor(r.overallSentiment) }}>{r.overallSentiment}</div></div>
                  <div><div className="meta-lbl">Confidence</div><div className="meta-val">{r.confidenceScore}<span style={{ fontSize: 11, color: "var(--text-muted)" }}>%</span></div><div className="conf-bar"><div className="conf-fill" style={{ width: `${r.confidenceScore}%` }} /></div></div>
                  <div><div className="meta-lbl">Key Insights</div><div className="meta-val">{r.keyInsights?.length || 0}</div></div>
                  <div><div className="meta-lbl">Recommendations</div><div className="meta-val">{r.designRecommendations?.length || 0}</div></div>
                </div>
                <p className="rep-sum">{r.executiveSummary}</p>
              </div>

              <div className="sec">
                <div className="sec-title">Key Insights</div>
                <div className="ins-grid">
                  {r.keyInsights?.map((ins, i) => (<div key={i} className="ins-card">
                    <div className="ins-hd"><div className="ins-ttl">{ins.title}</div><span className={`bpill ${sevClass(ins.severity)}`}>{ins.severity}</span></div>
                    <div className="ins-desc">{ins.description}</div>
                    {ins.quotes?.length > 0 && <div className="ins-quotes">{ins.quotes.map((q, qi) => <div key={qi} className="ins-q">"{q}"</div>)}</div>}
                  </div>))}
                </div>
              </div>

              <div className="sec">
                <div className="sec-title">What Worked & What Didn't</div>
                <div className="two">
                  <div className="worked">
                    <div className="worked-hd"><span className="dot-p" /> What Worked</div>
                    <div className="w-items">{r.whatWorked?.map((w, i) => (<div key={i}><div className="w-find">{w.finding}</div>{w.impact && <div className="w-impact">{w.impact}</div>}{w.quote && <div className="w-q">"{w.quote}"</div>}</div>))}</div>
                  </div>
                  <div className="worked">
                    <div className="worked-hd"><span className="dot-n" /> What Didn't Work</div>
                    <div className="w-items">{r.whatDidntWork?.map((w, i) => (<div key={i}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}><div className="w-find">{w.finding}</div>{w.severity && <span className={`bpill ${sevClass(w.severity)}`}>{w.severity}</span>}</div>{w.quote && <div className="w-q" style={{ marginTop: 5 }}>"{w.quote}"</div>}</div>))}</div>
                  </div>
                </div>
              </div>

              <div className="sec">
                <div className="sec-title">Design Recommendations</div>
                <div className="rec-list">
                  {r.designRecommendations?.map((rec, i) => (<div key={i} className="rec-item">
                    <div className="rec-num">{String(i + 1).padStart(2, "0")}</div>
                    <div><div className="rec-reco">{rec.recommendation}</div><div className="rec-rat">{rec.rationale}</div><div className="rec-pills"><span className={priClass(rec.priority)}>Priority: {rec.priority}</span><span className="pp-e">Effort: {rec.effort}</span></div></div>
                  </div>))}
                </div>
              </div>

              <div className="sec">
                <div className="sec-title">Next Steps & Recommended Tests</div>
                <div className="ns-intro">{r.nextSteps?.rationale}</div>
                {r.nextSteps?.furtherTestingNeeded && (
                  <div className="test-cards">
                    {r.nextSteps?.recommendedTests?.map((t, i) => (<div key={i} className="test-card">
                      <div className="test-hd"><div className="test-type">{t.testType}</div><span className="test-badge">Recommended</span>{t.estimatedTime && <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: "auto" }}>~{t.estimatedTime}</span>}</div>
                      <div className="test-grid">
                        <div><label>Objective</label><p>{t.objective}</p></div>
                        <div><label>Participants</label><p>{t.participants}</p></div>
                        <div className="test-full"><label>How to Run This Test</label><p>{t.howToRun}</p></div>
                      </div>
                    </div>))}
                  </div>
                )}
              </div>

              {r.crossStudyPatterns && r.crossStudyPatterns !== "null" && (
                <div className="sec"><div className="sec-title">Cross-Study Patterns</div><div className="ns-intro">{r.crossStudyPatterns}</div></div>
              )}
            </div>
            <div className="share-bar">
              <div className="share-txt">Ready to share with your team</div>
              <div className="share-acts"><button className="btn-sm" onClick={copyReport}>Copy Report</button><button className="btn-sm" onClick={() => window.print()}>Print / PDF</button></div>
            </div>
          </>);
        })()}
      </div>
    </>
  );
}
