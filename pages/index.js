import { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Head from "next/head";

// ─── Property columns ──────────────────────────────────────────────────────────
const COLUMNS = [
  { key: "title", label: "物件名", type: "text" },
  { key: "address", label: "住所", type: "text" },
  { key: "latitude", label: "緯度", type: "number" },
  { key: "longitude", label: "経度", type: "number" },
  { key: "price", label: "賃料（円）", type: "number" },
  { key: "management_fee", label: "管理費（円）", type: "number" },
  { key: "beds", label: "部屋数", type: "number" },
  { key: "size", label: "専有面積（㎡）", type: "number" },
  { key: "layout", label: "間取り", type: "text" },
  { key: "station", label: "最寄り駅", type: "text" },
  { key: "walking_minutes", label: "徒歩（分）", type: "number" },
  { key: "floor", label: "階数", type: "number" },
  { key: "type", label: "種別", type: "text" },
  { key: "deposit", label: "敷金", type: "number" },
  { key: "key_money", label: "礼金", type: "number" },
  { key: "pet_friendly", label: "ペット可", type: "bool" },
  { key: "foreign_friendly", label: "外国人可", type: "bool" },
  { key: "elevator", label: "エレベーター", type: "bool" },
  { key: "delivery_box", label: "宅配ボックス", type: "bool" },
  { key: "balcony", label: "バルコニー", type: "bool" },
  { key: "bicycle_parking", label: "駐輪場", type: "bool" },
  { key: "south_facing", label: "南向き", type: "bool" },
  { key: "is_featured", label: "おすすめ", type: "bool" },
  { key: "is_new", label: "新着", type: "bool" },
  { key: "category_no_key_money", label: "礼金なし", type: "bool" },
  { key: "category_luxury", label: "高級", type: "bool" },
  { key: "category_pet_friendly", label: "ペット可カテゴリ", type: "bool" },
  { key: "category_for_students", label: "学生向け", type: "bool" },
  { key: "category_for_families", label: "ファミリー向け", type: "bool" },
  { key: "category_designers", label: "デザイナーズ", type: "bool" },
  { key: "category_high_rise_residence", label: "タワーマンション", type: "bool" },
  { key: "property_information", label: "特記事項", type: "text" },
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

// ─── Drive Sync helpers ────────────────────────────────────────────────────────
const DRIVE_ENV = {
  apiKey:    process.env.NEXT_PUBLIC_GOOGLE_API_KEY     || "",
  supaUrl:   process.env.NEXT_PUBLIC_SUPABASE_URL       || "",
  supaKey:   process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY  || "",
  tableName: process.env.NEXT_PUBLIC_TABLE_NAME         || process.env.NEXT_PUBLIC_SUPABASE_TABLE || "properties",
  titleCol:  process.env.NEXT_PUBLIC_TITLE_COL          || "title",
  imageCol:  process.env.NEXT_PUBLIC_IMAGE_COL          || "image",
};

const DEFAULT_FOLDER_URL = "https://drive.google.com/drive/u/1/folders/1ViJaQjpaP9lc6LFK59zCG8VBozwMnD2g";

function sortImageFiles(files) {
  const main = [], sub = [], other = [];
  for (const f of files) {
    const l = f.name.toLowerCase();
    if (l.includes("main")) main.push(f);
    else if (l.includes("sub")) sub.push(f);
    else other.push(f);
  }
  const byName = (arr) => arr.sort((x, y) => x.name.localeCompare(y.name, "ja"));
  return [...byName(main), ...byName(sub), ...byName(other)];
}

async function driveList(parentId, apiKey, mime) {
  let files = [], pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+mimeType='${mime}'&fields=nextPageToken,files(id,name)&key=${apiKey}&pageSize=100`;
    if (pageToken) url += "&pageToken=" + pageToken;
    const res = await fetch(url);
    if (!res.ok) { const e = await res.json(); throw new Error(e.error?.message ?? "Drive API error"); }
    const data = await res.json();
    files = files.concat(data.files ?? []);
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);
  return files;
}

async function driveImages(parentId, apiKey) {
  let files = [], pageToken = null;
  do {
    let url = `https://www.googleapis.com/drive/v3/files?q='${parentId}'+in+parents+and+mimeType+contains+'image/'&fields=nextPageToken,files(id,name)&key=${apiKey}&pageSize=100`;
    if (pageToken) url += "&pageToken=" + pageToken;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Drive image fetch error");
    const data = await res.json();
    files = files.concat(data.files ?? []);
    pageToken = data.nextPageToken ?? null;
  } while (pageToken);
  return files;
}

// ─── Drive Sync component ─────────────────────────────────────────────────────
function DriveSync() {
  const [folderUrl, setFolderUrl]   = useState("");
  const [phase, setPhase]           = useState("idle");
  const [preview, setPreview]       = useState([]);
  const [logs, setLogs]             = useState([]);
  const [step, setStep]             = useState(1);
  const [progress, setProgress]     = useState({ done: 0, total: 0 });
  const [metrics, setMetrics]       = useState({ folders: 0, matched: 0, updated: 0, missed: 0 });
  const logRef = useRef(null);

  const addLog = (msg, type = "") => {
    setLogs((prev) => [...prev, { msg, type }]);
    setTimeout(() => { logRef.current?.scrollTo(0, logRef.current.scrollHeight); }, 50);
  };

  const getFolderId = () => {
    const m = folderUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    return m?.[1] ?? null;
  };

  const handlePreview = async () => {
    if (!folderUrl) { alert("フォルダURLを入力してください"); return; }
    const folderId = getFolderId();
    if (!folderId) { alert("フォルダURLの形式が正しくありません"); return; }
    if (!DRIVE_ENV.apiKey || !DRIVE_ENV.supaUrl || !DRIVE_ENV.supaKey) {
      alert(".env.local に NEXT_PUBLIC_GOOGLE_API_KEY / NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください");
      return;
    }
    setPhase("previewing");
    setStep(1);
    try {
      const subFolders = await driveList(folderId, DRIVE_ENV.apiKey, "application/vnd.google-apps.folder");
      if (subFolders.length === 0) { alert("サブフォルダが見つかりませんでした"); setPhase("idle"); return; }

      setStep(2);
      const rows = [];
      for (const folder of subFolders) {
        const raw    = await driveImages(folder.id, DRIVE_ENV.apiKey);
        const sorted = sortImageFiles(raw);
        rows.push({
          folderId:    folder.id,
          folderName:  folder.name,
          sortedFiles: sorted,
          urls:        sorted.map((f) => `https://drive.google.com/file/d/${f.id}/view`),
          matched:     false,
          rowId:       null,
        });
      }

      setStep(3);
      const names = rows.map((r) => r.folderName);
      const res = await fetch(
        `${DRIVE_ENV.supaUrl}/rest/v1/${DRIVE_ENV.tableName}?${DRIVE_ENV.titleCol}=in.(${names.map((n) => `"${n}"`).join(",")})&select=id,${DRIVE_ENV.titleCol},${DRIVE_ENV.imageCol},images`,
        { headers: { apikey: DRIVE_ENV.supaKey, Authorization: "Bearer " + DRIVE_ENV.supaKey } }
      );
      if (!res.ok) throw new Error(await res.text());
      const dbRows = await res.json();
      const map = {};
      dbRows.forEach((r) => {
        const hasImage =
          (r[DRIVE_ENV.imageCol] && r[DRIVE_ENV.imageCol] !== null && r[DRIVE_ENV.imageCol] !== "") ||
          (r.images && Array.isArray(r.images) && r.images.length > 0);
        if (!hasImage) {
          map[r[DRIVE_ENV.titleCol]] = { id: r.id };
        }
      });
      rows.forEach((r) => {
        const match = map[r.folderName];
        r.matched = !!match;
        r.rowId   = match?.id ?? null;
      });

      setPreview(rows);
      setPhase("preview");
    } catch (e) {
      alert("エラー: " + e.message);
      setPhase("idle");
    }
  };

  const handleExecute = async () => {
    setPhase("running");
    setLogs([]);
    const matched = preview.filter((r) => r.matched);
    const missed  = preview.filter((r) => !r.matched);
    setMetrics({ folders: preview.length, matched: matched.length, updated: 0, missed: missed.length });
    setProgress({ done: 0, total: matched.length });
    missed.forEach((r) => addLog(`⚠ 未照合（スキップ）: ${r.folderName}`, "warn"));
    setStep(4);

    let updated = 0;
    for (let i = 0; i < matched.length; i++) {
      const r     = matched[i];
      const mainC = r.sortedFiles.filter((f) => f.name.toLowerCase().includes("main")).length;
      const subC  = r.sortedFiles.filter((f) => f.name.toLowerCase().includes("sub")).length;
      try {
        const imageUrl   = r.urls[0] || null;
        const imagesUrls = r.urls.slice(1);
        const updateData = { [DRIVE_ENV.imageCol]: imageUrl };
        if (imagesUrls.length > 0) updateData.images = imagesUrls;

        const res = await fetch(`${DRIVE_ENV.supaUrl}/rest/v1/${DRIVE_ENV.tableName}?id=eq.${r.rowId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: DRIVE_ENV.supaKey,
            Authorization: "Bearer " + DRIVE_ENV.supaKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(updateData),
        });
        if (!res.ok) throw new Error(await res.text());
        updated++;
        setMetrics((m) => ({ ...m, updated }));
        addLog(`✓ ${r.folderName} — ${r.urls.length}枚 (main:${mainC} sub:${subC} other:${r.urls.length - mainC - subC})`, "ok");
      } catch (e) {
        addLog(`✗ ${r.folderName}: ${e.message}`, "err");
      }
      setProgress({ done: i + 1, total: matched.length });
    }
    addLog(`─── 完了: ${updated}件更新, ${missed.length}件未照合 ───`, updated > 0 ? "ok" : "warn");
    setPhase("done");
  };

  const reset = () => {
    setPhase("idle"); setPreview([]); setLogs([]); setStep(1);
    setProgress({ done: 0, total: 0 });
    setMetrics({ folders: 0, matched: 0, updated: 0, missed: 0 });
  };

  const pct   = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const STEPS = ["サブフォルダ取得", "画像取得・整列", "title照合", "image更新"];

  const logColor = { ok: "#2d7a4f", err: "#c0392b", warn: "#b7791f", info: "#1a56db", "": "#888" };

  return (
    <div>
      {/* ENV status */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "1.5rem" }}>
        {[
          { label: "Google API Key", ok: !!DRIVE_ENV.apiKey },
          { label: "Supabase URL",   ok: !!DRIVE_ENV.supaUrl },
          { label: "Supabase Key",   ok: !!DRIVE_ENV.supaKey },
        ].map((b) => (
          <span key={b.label} style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            fontSize: 12, padding: "4px 12px", borderRadius: 99,
            border: `1px solid ${b.ok ? "#c6f6d5" : "#fed7d7"}`,
            background: b.ok ? "#f0fff4" : "#fff5f5",
            color: b.ok ? "#2d7a4f" : "#c0392b",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: b.ok ? "#2d7a4f" : "#c0392b", display: "inline-block" }} />
            {b.label}
          </span>
        ))}
        <span style={{ fontSize: 12, padding: "4px 12px", borderRadius: 99, border: "1px solid #e5e5e5", color: "#888", background: "#fafafa" }}>
          table: <strong style={{ color: "#1a1a1a" }}>{DRIVE_ENV.tableName}</strong>
        </span>
      </div>

      {/* Stepper */}
      <div style={{ display: "flex", border: "1px solid #e8e8e4", borderRadius: 10, overflow: "hidden", marginBottom: "1.5rem" }}>
        {STEPS.map((s, i) => (
          <div key={s} style={{
            flex: 1, display: "flex", alignItems: "center", gap: 8,
            padding: "10px 14px", fontSize: 12,
            borderRight: i < STEPS.length - 1 ? "1px solid #e8e8e4" : "none",
            color: step === i + 1 ? "#1a56db" : step > i + 1 ? "#2d7a4f" : "#aaa",
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%",
              border: "1px solid currentColor",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, flexShrink: 0,
            }}>{i + 1}</span>
            {s}
          </div>
        ))}
      </div>

      {/* Input */}
      {(phase === "idle" || phase === "previewing") && (
        <div style={cardStyle}>
          <StepHeader num={1} title="親フォルダ URL" />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="https://drive.google.com/drive/folders/..."
              value={folderUrl}
              onChange={(e) => setFolderUrl(e.target.value)}
              disabled={phase === "previewing"}
              style={{
                flex: 1, padding: "10px 14px", fontSize: 14, borderRadius: 8,
                border: "1px solid #e5e5e5", outline: "none",
                background: phase === "previewing" ? "#f8f7f4" : "#fff",
              }}
            />
            <button
              onClick={handlePreview}
              disabled={phase === "previewing"}
              style={{
                padding: "10px 20px", fontSize: 14, fontWeight: 500,
                borderRadius: 8, border: "none", cursor: phase === "previewing" ? "not-allowed" : "pointer",
                background: phase === "previewing" ? "#ccc" : "#1a1a1a", color: "#fff",
                whiteSpace: "nowrap",
              }}
            >
              {phase === "previewing" ? "取得中…" : "プレビュー"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <button
              onClick={() => setFolderUrl(DEFAULT_FOLDER_URL)}
              disabled={phase === "previewing"}
              style={{ fontSize: 12, padding: "4px 10px", borderRadius: 6, border: "1px solid #e5e5e5", background: "#fff", cursor: "pointer", color: "#555" }}
            >
              固定URLを設定
            </button>
            {folderUrl === DEFAULT_FOLDER_URL && (
              <span style={{ fontSize: 12, color: "#2d7a4f" }}>✓ 固定URLが設定されています</span>
            )}
          </div>
          <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
            このフォルダ直下のサブフォルダ名 = 物件名として照合します（画像未設定の物件のみ対象）
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, fontSize: 13, color: "#888", padding: "8px 12px", background: "#f8f7f4", borderRadius: 8, border: "1px solid #e8e8e4" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 99, padding: "2px 10px", fontSize: 12 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#1a56db", color: "#fff", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>1</span>
              main
            </span>
            →
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 99, padding: "2px 10px", fontSize: 12 }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", background: "#1a56db", color: "#fff", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>2</span>
              sub
            </span>
            →
            <span style={{ fontSize: 12, opacity: 0.6 }}>その他（ファイル名順）</span>
          </div>
        </div>
      )}

      {/* Preview table */}
      {phase === "preview" && (
        <div style={cardStyle}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>プレビュー — {preview.length}件</span>
            <div style={{ display: "flex", gap: 12, fontSize: 13 }}>
              <span style={{ color: "#2d7a4f" }}>{preview.filter((r) => r.matched).length} 照合OK</span>
              <span style={{ color: "#b7791f" }}>{preview.filter((r) => !r.matched).length} 未照合</span>
            </div>
          </div>
          <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {["フォルダ名（物件名）", "枚数", "先頭3枚の順序", "照合"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "8px 12px", color: "#888", fontWeight: 500, borderBottom: "1px solid #e8e8e4", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.folderId}>
                    <td style={tdStyle}>{row.folderName}</td>
                    <td style={tdStyle}>{row.urls.length}</td>
                    <td style={tdStyle}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {row.sortedFiles.slice(0, 3).map((f) => {
                          const l   = f.name.toLowerCase();
                          const tag = l.includes("main") ? "main" : l.includes("sub") ? "sub" : "other";
                          const tagColors = { main: { bg: "#ebf8ff", color: "#1a56db" }, sub: { bg: "#e8f5ee", color: "#2d7a4f" }, other: { bg: "#f0f0ec", color: "#888" } };
                          return (
                            <span key={f.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: tagColors[tag].bg, color: tagColors[tag].color }}>
                              {tag}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        fontSize: 11, padding: "3px 9px", borderRadius: 99,
                        background: row.matched ? "#e8f5ee" : "#fffbeb",
                        color: row.matched ? "#2d7a4f" : "#b7791f",
                      }}>
                        {row.matched ? "照合OK" : "未照合"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={handleExecute} style={{ padding: "9px 20px", fontSize: 13, fontWeight: 500, borderRadius: 8, border: "none", background: "#2d7a4f", color: "#fff", cursor: "pointer" }}>
              この内容で登録する
            </button>
            <button onClick={reset} style={{ padding: "9px 20px", fontSize: 13, borderRadius: 8, border: "1px solid #e5e5e5", background: "#fff", color: "#555", cursor: "pointer" }}>
              やり直す
            </button>
          </div>
        </div>
      )}

      {/* Progress + log */}
      {(phase === "running" || phase === "done") && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: "1rem" }}>
            {[
              { label: "物件数",   val: metrics.folders, color: "#1a1a1a" },
              { label: "照合成功", val: metrics.matched,  color: "#2d7a4f" },
              { label: "更新完了", val: metrics.updated,  color: "#1a56db" },
              { label: "未照合",   val: metrics.missed,   color: "#b7791f" },
            ].map((m) => (
              <div key={m.label} style={{ background: "#fff", border: "1px solid #e8e8e4", borderRadius: 10, padding: "1rem" }}>
                <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 26, fontWeight: 600, color: m.color }}>{m.val}</div>
              </div>
            ))}
          </div>
          <div style={{ marginBottom: "1rem" }}>
            <div style={{ height: 4, background: "#e5e5e5", borderRadius: 2, overflow: "hidden", marginBottom: 6 }}>
              <div style={{ height: "100%", background: "#1a1a1a", borderRadius: 2, transition: "width 0.3s ease", width: pct + "%" }} />
            </div>
            <div style={{ fontSize: 12, color: "#888", textAlign: "right" }}>{progress.done} / {progress.total}</div>
          </div>
          <div ref={logRef} style={{ background: "#fff", border: "1px solid #e8e8e4", borderRadius: 10, padding: "1rem", fontFamily: "monospace", fontSize: 12, lineHeight: 2, maxHeight: 260, overflowY: "auto" }}>
            {logs.map((l, i) => (
              <div key={i} style={{ color: logColor[l.type] ?? "#888" }}>{l.msg}</div>
            ))}
          </div>
          {phase === "done" && (
            <button onClick={reset} style={{ marginTop: "1rem", width: "100%", padding: 10, fontSize: 13, borderRadius: 8, border: "1px solid #e5e5e5", background: "#fff", color: "#555", cursor: "pointer" }}>
              最初からやり直す
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  const [tab, setTab]         = useState("import");
  const [files, setFiles]     = useState([]);
  const [results, setResults] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress]   = useState({ current: 0, total: 0, label: "" });
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState("");
  const [history, setHistory]     = useState([]);
  const [dragging, setDragging]   = useState(false);
  const fileRef = useRef();

  const addFiles = (newFiles) => {
    const pdfs = Array.from(newFiles).filter((f) => f.type === "application/pdf");
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...pdfs.filter((f) => !existing.has(f.name + f.size))];
    });
  };

  const removeFile = (i) => setFiles((prev) => prev.filter((_, idx) => idx !== i));

  const fileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload  = () => resolve(r.result.split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const analyzeFiles = async () => {
    setAnalyzing(true);
    setResults([]);
    setSaveMsg("");
    const total  = files.length;
    const parsed = [];
    for (let i = 0; i < total; i++) {
      const f = files[i];
      setProgress({ current: i + 1, total, label: `解析中: ${f.name} (${i + 1}/${total})` });
      try {
        const base64 = await fileToBase64(f);
        const res    = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64, filename: f.name }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || res.status);
        parsed.push({ filename: f.name, data: json.data, error: null });
      } catch (e) {
        parsed.push({ filename: f.name, data: null, error: e.message });
      }
    }
    setProgress({ current: total, total, label: "解析完了" });
    setResults(parsed);
    setAnalyzing(false);
  };

  const updateField = (ri, key, value) => {
    setResults((prev) =>
      prev.map((r, idx) => {
        if (idx !== ri || !r.data) return r;
        return { ...r, data: { ...r.data, [key]: value } };
      })
    );
  };

  const saveToSupabase = async () => {
    setSaving(true);
    setSaveMsg("");
    const records  = results.filter((r) => r.data).map((r) => r.data);
    const tableName = process.env.NEXT_PUBLIC_SUPABASE_TABLE || "properties";

    let inserted = 0, updated = 0;
    const errors = [];

    for (const record of records) {
      try {
        let query = supabase
          .from(tableName)
          .select("id")
          .eq("title", record.title)
          .eq("address", record.address);

        if (record.floor !== null && record.floor !== undefined) {
          query = query.eq("floor", record.floor);
        } else {
          query = query.is("floor", null);
        }

        const { data: existing, error: searchError } = await query.limit(1);
        if (searchError) { errors.push(`検索エラー (${record.title || "不明"}): ${searchError.message}`); continue; }

        if (existing && existing.length > 0) {
          const { error: updateError } = await supabase.from(tableName).update(record).eq("id", existing[0].id);
          if (updateError) { errors.push(`更新エラー (${record.title}): ${updateError.message}`); }
          else updated++;
        } else {
          const { error: insertError } = await supabase.from(tableName).insert(record);
          if (insertError) { errors.push(`挿入エラー (${record.title}): ${insertError.message}`); }
          else inserted++;
        }
      } catch (e) {
        errors.push(`処理エラー (${record.title || "不明"}): ${e.message}`);
      }
    }

    if (errors.length > 0) {
      setSaveMsg(`⚠️ 一部エラー: ${inserted}件新規、${updated}件更新、${errors.length}件エラー`);
      console.error("保存エラー:", errors);
    } else {
      setSaveMsg(`✅ ${inserted}件新規保存、${updated}件更新しました`);
      setHistory((prev) => [
        { time: new Date().toLocaleString("ja-JP"), files: files.map((f) => f.name), count: inserted + updated },
        ...prev,
      ]);
    }
    setSaving(false);
  };

  const hasResults = results.some((r) => r.data);

  return (
    <>
      <Head>
        <title>不動産PDFインポーター</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div style={{ minHeight: "100vh", background: "#f8f7f4", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", padding: "2rem 1rem" }}>

          {/* Header */}
          <div style={{ marginBottom: "1.5rem" }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "#1a1a1a", margin: 0 }}>不動産PDFインポーター</h1>
            <p style={{ fontSize: 13, color: "#888", marginTop: 4 }}>REINS / いえらぶ / ATBB など各種様式に対応</p>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e5e5e5", marginBottom: "1.5rem" }}>
            {[
              ["import",     "PDFインポート"],
              ["drive-sync", "画像同期"],
              ["history",    "履歴"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "8px 16px", fontSize: 13, cursor: "pointer", border: "none",
                background: "none", color: tab === id ? "#1a1a1a" : "#888",
                borderBottom: tab === id ? "2px solid #1a1a1a" : "2px solid transparent",
                fontWeight: tab === id ? 500 : 400, marginBottom: -1,
              }}>{label}</button>
            ))}
          </div>

          {/* PDF Import tab */}
          {tab === "import" && (
            <>
              {/* Step 1 */}
              <div style={cardStyle}>
                <StepHeader num={1} title="PDFをアップロード" />
                <div
                  onClick={() => fileRef.current.click()}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                  style={{
                    border: `1.5px dashed ${dragging ? "#555" : "#ccc"}`,
                    borderRadius: 10, padding: "2rem", textAlign: "center",
                    cursor: "pointer", background: dragging ? "#f0f0ec" : "transparent",
                    transition: "all 0.15s",
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#1a1a1a" }}>クリックまたはドラッグ＆ドロップ</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>複数PDF同時対応</div>
                </div>
                <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                {files.length > 0 && (
                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "#f2f1ed", borderRadius: 8, fontSize: 13 }}>
                        <span>📄</span>
                        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                        <span style={{ color: "#888", fontSize: 11 }}>{(f.size / 1024).toFixed(0)}KB</span>
                        <button onClick={() => removeFile(i)} style={{ background: "none", border: "none", cursor: "pointer", color: "#aaa", fontSize: 16, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step 2 */}
              <div style={cardStyle}>
                <StepHeader num={2} title="AI解析 & プレビュー" />
                <button
                  onClick={analyzeFiles}
                  disabled={!files.length || analyzing}
                  style={{
                    width: "100%", padding: "10px", fontSize: 14, fontWeight: 500,
                    cursor: files.length && !analyzing ? "pointer" : "not-allowed",
                    borderRadius: 8, border: "none",
                    background: files.length && !analyzing ? "#1a1a1a" : "#ccc",
                    color: "#fff", transition: "opacity 0.15s",
                  }}
                >
                  {analyzing ? "解析中..." : "解析開始"}
                </button>

                {(analyzing || results.length > 0) && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: "#888", marginBottom: 4 }}>{progress.label}</div>
                    <div style={{ height: 4, background: "#e5e5e5", borderRadius: 2, overflow: "hidden" }}>
                      <div style={{ height: "100%", background: "#1a1a1a", borderRadius: 2, transition: "width 0.4s", width: progress.total ? `${(progress.current / progress.total) * 100}%` : "0%" }} />
                    </div>
                  </div>
                )}

                {results.map((r, ri) => (
                  <div key={ri} style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#555", marginBottom: 8 }}>📄 {r.filename}</div>
                    {r.error ? (
                      <div style={errStyle}>❌ {r.error}</div>
                    ) : (
                      <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                          <tbody>
                            {COLUMNS.map((c) => (
                              <tr key={c.key}>
                                <td style={{ color: "#888", padding: "5px 8px", borderBottom: "1px solid #f0f0ec", width: 140, whiteSpace: "nowrap" }}>{c.label}</td>
                                <td style={{ padding: "5px 8px", borderBottom: "1px solid #f0f0ec" }}>
                                  {c.type === "bool" ? (
                                    <select value={String(r.data[c.key])} onChange={(e) => updateField(ri, c.key, e.target.value === "true")}
                                      style={{ fontSize: 12, border: "1px solid #e5e5e5", borderRadius: 4, background: "#fff", padding: "2px 4px", fontFamily: "inherit" }}>
                                      <option value="true">true</option>
                                      <option value="false">false</option>
                                    </select>
                                  ) : (
                                    <input
                                      type={c.type === "number" ? "number" : "text"}
                                      value={r.data[c.key] ?? ""}
                                      onChange={(e) => {
                                        let v;
                                        if (c.type === "number") {
                                          if (e.target.value === "") v = null;
                                          else if (c.key === "floor") v = parseInt(e.target.value, 10) || null;
                                          else v = parseFloat(e.target.value) || null;
                                        } else {
                                          v = e.target.value;
                                        }
                                        updateField(ri, c.key, v);
                                      }}
                                      style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, fontFamily: "inherit", color: "#1a1a1a", padding: "2px 4px", borderRadius: 4 }}
                                      onFocus={(e) => (e.target.style.background = "#f2f1ed")}
                                      onBlur={(e) => (e.target.style.background = "transparent")}
                                    />
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Step 3 */}
              {hasResults && (
                <div style={cardStyle}>
                  <StepHeader num={3} title="Supabaseに保存" />
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <button onClick={saveToSupabase} disabled={saving}
                      style={{ padding: "9px 20px", fontSize: 13, fontWeight: 500, cursor: saving ? "not-allowed" : "pointer", borderRadius: 8, border: "none", background: saving ? "#ccc" : "#2d7a4f", color: "#fff" }}>
                      {saving ? "保存中..." : "Supabaseに保存する"}
                    </button>
                    {saveMsg && (
                      <div style={{ fontSize: 13, color: saveMsg.startsWith("✅") ? "#2d7a4f" : "#c0392b" }}>{saveMsg}</div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Drive Sync tab */}
          {tab === "drive-sync" && (
            <div style={cardStyle}>
              <div style={{ marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", margin: "0 0 4px" }}>Google Drive 画像同期</h2>
                <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Drive のサブフォルダ名と物件名を照合し、画像URLを Supabase に登録します</p>
              </div>
              <DriveSync />
            </div>
          )}

          {/* History tab */}
          {tab === "history" && (
            <div style={cardStyle}>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: "1rem" }}>インポート履歴</div>
              {history.length === 0 ? (
                <div style={{ fontSize: 13, color: "#888", textAlign: "center", padding: "2rem 0" }}>まだ履歴はありません</div>
              ) : history.map((h, i) => (
                <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #f0f0ec" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, background: "#e8f5ee", color: "#2d7a4f", padding: "3px 10px", borderRadius: 6, fontWeight: 500 }}>{h.count}件</span>
                    <span style={{ fontSize: 12, color: "#888" }}>{h.time}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>{h.files.join(", ")}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────
const cardStyle = {
  background: "#fff", border: "1px solid #e8e8e4", borderRadius: 12,
  padding: "1.25rem", marginBottom: "1rem",
};
const errStyle = {
  fontSize: 13, padding: "8px 12px", borderRadius: 8,
  background: "#fdf0ef", color: "#c0392b", marginTop: 8,
};
const tdStyle = {
  padding: "10px 12px", borderBottom: "1px solid #e8e8e4",
  color: "#1a1a1a", verticalAlign: "middle",
};

function StepHeader({ num, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#e8f0fe", color: "#1a56db", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{num}</div>
      <span style={{ fontSize: 15, fontWeight: 500, color: "#1a1a1a" }}>{title}</span>
    </div>
  );
}
