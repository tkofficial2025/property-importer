import { useState, useRef, useEffect, useCallback } from "react";
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
        // 既存画像の有無に関係なく、タイトル一致なら常に更新対象にする
        map[r[DRIVE_ENV.titleCol]] = { id: r.id };
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
        const updateData = {
          [DRIVE_ENV.imageCol]: imageUrl,
          // sub画像が0件でも空配列で上書きし、古い残存データを防ぐ
          images: imagesUrls,
        };

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
            このフォルダ直下のサブフォルダ名 = 物件名として照合します（一致した物件は画像を上書き更新）
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

// ─── Orchestrator component ───────────────────────────────────────────────────
function Orchestrator() {
  const [running, setRunning]     = useState(false);
  const [log, setLog]             = useState([]);
  const [result, setResult]       = useState(null);
  const [customTopic, setCustomTopic] = useState('');

  const handleRun = async () => {
    setRunning(true);
    setLog([]);
    setResult(null);
    try {
      const res  = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTopic }),
      });
      const data = await res.json();
      setLog(data.log || []);
      setResult(data);
    } catch (e) {
      setLog(prev => [...prev, `❌ エラー: ${e.message}`]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ background: '#fff', border: '1px solid #e8e8e4', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>🤖 オーケストレーター</div>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
          ブログ生成 → QAチェック → メール通知 を一括実行します<br />
          毎朝9時に自動実行されます（Windowsタスクスケジューラ）
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={customTopic}
            onChange={e => setCustomTopic(e.target.value)}
            placeholder="テーマを指定（空欄=AIが自動選択）"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}
          />
          <button
            onClick={handleRun}
            disabled={running}
            style={{ padding: '8px 20px', borderRadius: 6, border: 'none', background: '#1a1a1a', color: '#fff', fontSize: 13, fontWeight: 600, cursor: running ? 'not-allowed' : 'pointer', opacity: running ? 0.7 : 1 }}
          >
            {running ? '⏳ 実行中...' : '▶ 今すぐ実行'}
          </button>
        </div>
      </div>

      {/* 実行ログ */}
      {log.length > 0 && (
        <div style={{ background: '#1a1a1a', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' }}>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 600 }}>実行ログ</div>
          {log.map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: l.startsWith('❌') ? '#f87171' : l.startsWith('⚠️') ? '#fbbf24' : l.startsWith('✅') ? '#4ade80' : '#e5e7eb', fontFamily: 'monospace', lineHeight: 1.8 }}>
              {l}
            </div>
          ))}
          {running && <div style={{ fontSize: 12, color: '#888', fontFamily: 'monospace', marginTop: 4 }}>⏳ 処理中...</div>}
        </div>
      )}

      {/* 結果サマリー */}
      {result && !running && (
        <div style={{ background: '#fff', border: `1px solid ${result.success ? '#bbf7d0' : '#fecaca'}`, borderRadius: 12, padding: '1.25rem' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: result.success ? '#166534' : '#991b1b', marginBottom: result.draft ? 12 : 0 }}>
            {result.success ? '✅ 完了 — メールを送信しました' : '❌ 失敗'}
          </div>
          {result.draft && (
            <div style={{ fontSize: 13, color: '#555' }}>
              <strong>"{result.draft.title}"</strong> をブログに追加しました<br />
              <span style={{ fontSize: 12, color: '#888' }}>QA: {result.qaStatus === 'pass' ? '✅ 通過' : '⚠️ 要確認'} — ブログタブで確認してください</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Bug Fixer component ──────────────────────────────────────────────────────
const LEVEL_COLORS = { error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };

function BugFixer() {
  const [issues, setIssues]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [selected, setSelected]   = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis]   = useState(null);
  const [creating, setCreating]   = useState(false);
  const [prResult, setPrResult]   = useState(null);
  const [notice, setNotice]       = useState(null);

  const showNotice = (text, error = false, url = null) => {
    setNotice({ text, error, url });
    if (!url) setTimeout(() => setNotice(null), 5000);
  };

  const loadIssues = async () => {
    setLoading(true);
    setIssues([]);
    setSelected(null);
    setAnalysis(null);
    setPrResult(null);
    try {
      const res  = await fetch('/api/bug-list');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setIssues(data.issues || []);
    } catch (e) {
      showNotice(`エラー取得失敗: ${e.message}`, true);
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async (issue) => {
    setSelected(issue);
    setAnalysis(null);
    setPrResult(null);
    setAnalyzing(true);
    try {
      const res  = await fetch('/api/bug-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, issueTitle: issue.title, culprit: issue.culprit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAnalysis(data.analysis);
      showNotice('✅ 修正案を作成しました');
    } catch (e) {
      showNotice(`分析エラー: ${e.message}`, true);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreatePR = async () => {
    if (!confirm(`GitHub PRを作成しますか？\n"${analysis.pr_title}"`)) return;
    setCreating(true);
    try {
      const res  = await fetch('/api/bug-create-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: selected.id, analysis }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPrResult(data);
      showNotice(data.message, !data.auto_applied, data.pr_url);
    } catch (e) {
      showNotice(`PR作成エラー: ${e.message}`, true);
    } finally {
      setCreating(false);
    }
  };

  const bF = {
    card:     { background: '#fff', border: '1px solid #e8e8e4', borderRadius: 12, padding: '1.25rem', marginBottom: '1rem' },
    issue:    { padding: '10px 14px', border: '1px solid #e8e8e4', borderRadius: 8, marginBottom: 8, cursor: 'pointer', background: '#fff', transition: 'box-shadow 0.15s' },
    issueAct: { padding: '10px 14px', border: '1px solid #6366f1', borderRadius: 8, marginBottom: 8, background: '#f5f3ff', cursor: 'pointer' },
    btn:      (bg, color, border) => ({ padding: '7px 16px', borderRadius: 6, border: border || 'none', background: bg, color, fontSize: 13, fontWeight: 500, cursor: 'pointer' }),
    badge:    (level) => ({ background: level === 'error' ? '#fef2f2' : level === 'warning' ? '#fffbeb' : '#eff6ff', color: LEVEL_COLORS[level] || '#555', border: `1px solid ${level === 'error' ? '#fecaca' : level === 'warning' ? '#fde68a' : '#bfdbfe'}`, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }),
  };

  return (
    <div>
      {notice && (
        <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 12, background: notice.error ? '#fef2f2' : '#f0fdf4', color: notice.error ? '#991b1b' : '#166534', border: `1px solid ${notice.error ? '#fecaca' : '#bbf7d0'}`, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{notice.text}</span>
            <button onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16, lineHeight: 1 }}>✕</button>
          </div>
          {notice.url && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, padding: '7px 12px' }}>
              <span style={{ fontSize: 12, color: '#2563eb', flex: 1, wordBreak: 'break-all' }}>{notice.url}</span>
              <button
                onClick={() => { navigator.clipboard.writeText(notice.url); }}
                style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 4, border: '1px solid #d1fae5', background: '#f0fdf4', fontSize: 11, cursor: 'pointer', color: '#166534', fontWeight: 600 }}
              >
                📋 URLをコピー
              </button>
            </div>
          )}
        </div>
      )}

      {/* ヘッダー */}
      <div style={{ ...bF.card, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>🐛 バグフィクサー</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>Sentryのエラーを取得 → Claudeが修正案を作成 → GitHub PRを自動作成</div>
        </div>
        <button onClick={loadIssues} disabled={loading} style={bF.btn('#1a1a1a', '#fff')}>
          {loading ? '⏳ 取得中...' : '🔄 エラーを取得'}
        </button>
      </div>

      {/* エラー一覧 */}
      {issues.length > 0 && (
        <div style={bF.card}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 12 }}>未解決のエラー ({issues.length}件)</div>
          {issues.map(issue => (
            <div
              key={issue.id}
              onClick={() => handleAnalyze(issue)}
              style={selected?.id === issue.id ? bF.issueAct : bF.issue}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={bF.badge(issue.level)}>{issue.level}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{issue.title}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>{issue.culprit}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444' }}>{Number(issue.count).toLocaleString()}回</div>
                  <div style={{ fontSize: 11, color: '#bbb' }}>{new Date(issue.lastSeen).toLocaleDateString('ja-JP')}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {issues.length === 0 && !loading && (
        <div style={{ ...bF.card, textAlign: 'center', color: '#888', padding: '2rem' }}>
          「エラーを取得」を押してSentryのエラー一覧を表示します
        </div>
      )}

      {/* 分析中 */}
      {analyzing && (
        <div style={{ ...bF.card, textAlign: 'center', color: '#6366f1', padding: '2rem' }}>
          ⏳ Claudeがコードを読んで修正案を作成中...
        </div>
      )}

      {/* 修正案 */}
      {analysis && selected && (
        <div style={bF.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>🔧 修正案</div>
              <div style={{ fontSize: 12, color: '#888' }}>{selected.title}</div>
            </div>
            <span style={{ fontSize: 12, background: analysis.confidence === 'high' ? '#f0fdf4' : analysis.confidence === 'medium' ? '#fffbeb' : '#fef2f2', color: analysis.confidence === 'high' ? '#166534' : analysis.confidence === 'medium' ? '#92400e' : '#991b1b', border: '1px solid currentColor', borderRadius: 4, padding: '2px 8px' }}>
              信頼度: {analysis.confidence}
            </span>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>原因</div>
            <div style={{ fontSize: 13, color: '#1a1a1a', background: '#f8f7f4', borderRadius: 6, padding: '8px 12px' }}>{analysis.root_cause}</div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 4 }}>修正内容</div>
            <div style={{ fontSize: 13, color: '#1a1a1a', background: '#f8f7f4', borderRadius: 6, padding: '8px 12px' }}>{analysis.fix_summary}</div>
          </div>

          {analysis.files?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>変更ファイル</div>
              {analysis.files.map((f, i) => (
                <div key={i} style={{ marginBottom: 10, border: '1px solid #e5e5e5', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ background: '#f1f5f9', padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#334155' }}>
                    📄 {f.path}
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: 12, color: '#555' }}>{f.description}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
                    <div style={{ padding: '8px 12px', background: '#fef2f2', borderTop: '1px solid #fecaca' }}>
                      <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600, marginBottom: 4 }}>修正前</div>
                      <pre style={{ fontSize: 11, margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap', color: '#7f1d1d' }}>{f.old_code}</pre>
                    </div>
                    <div style={{ padding: '8px 12px', background: '#f0fdf4', borderTop: '1px solid #bbf7d0', borderLeft: '1px solid #bbf7d0' }}>
                      <div style={{ fontSize: 11, color: '#166534', fontWeight: 600, marginBottom: 4 }}>修正後</div>
                      <pre style={{ fontSize: 11, margin: 0, overflowX: 'auto', whiteSpace: 'pre-wrap', color: '#14532d' }}>{f.new_code}</pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {prResult ? (
            <div style={{ padding: '14px 16px', borderRadius: 6, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#166534', marginBottom: 10 }}>🎉 PR #{prResult.pr_number} を作成しました</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid #bbf7d0', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#2563eb', flex: 1, wordBreak: 'break-all' }}>{prResult.pr_url}</span>
                <button
                  onClick={() => { navigator.clipboard.writeText(prResult.pr_url); showNotice('URLをコピーしました'); }}
                  style={{ flexShrink: 0, padding: '4px 10px', borderRadius: 4, border: '1px solid #d1fae5', background: '#fff', fontSize: 11, cursor: 'pointer', color: '#166534' }}
                >
                  📋 コピー
                </button>
              </div>
              <div style={{ fontSize: 12, color: '#555' }}>変更ファイル: {prResult.updated_files?.join(', ')}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreatePR} disabled={creating} style={bF.btn('#2d7a4f', '#fff')}>
                {creating ? '⏳ PR作成中...' : '🚀 GitHub PRを作成'}
              </button>
              <button onClick={() => { setAnalysis(null); setPrResult(null); }} style={bF.btn('#f1f5f9', '#334155', '1px solid #e2e8f0')}>
                キャンセル
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Blog Writer component ────────────────────────────────────────────────────
const BLOG_CATEGORIES = ['Guide', 'Rent', 'Buy', 'Investment', 'Area', 'Market', 'Lifestyle', 'Tech'];
const BLOG_STATUS_COLORS = { draft: '#f59e0b', published: '#10b981', rejected: '#ef4444' };

function BlogWriter() {
  const [drafts, setDrafts]       = useState([]);
  const [selected, setSelected]   = useState(null);
  const [editing, setEditing]     = useState(false);
  const [editData, setEditData]   = useState({});
  const [loading, setLoading]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishingLocal, setPublishingLocal] = useState(false);
  const [refetchingPhoto, setRefetchingPhoto] = useState(false);
  const [qaChecking, setQaChecking] = useState(false);
  const [qaResult, setQaResult]   = useState(null);
  const [notice, setNotice]       = useState(null);

  const showNotice = (text, error = false) => {
    setNotice({ text, error });
    setTimeout(() => setNotice(null), 4000);
  };

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/blog-drafts');
    const data = await res.json();
    setDrafts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const selectDraft = async (id) => {
    const res = await fetch(`/api/blog-drafts?id=${id}`);
    const data = await res.json();
    setSelected(data);
    setEditing(false);
    setEditData({ title: data.title, content: data.content, excerpt: data.excerpt, meta_description: data.meta_description, category: data.category });
  };

  const handleGenerate = async () => {
    const topicLabel = customTopic.trim() ? `「${customTopic.trim()}」` : 'AIが自動選択';
    if (!confirm(`新しい記事を生成しますか？\nテーマ: ${topicLabel}\n（30〜60秒かかります）`)) return;
    setGenerating(true);
    showNotice(customTopic.trim() ? `「${customTopic.trim()}」で記事を生成中...` : '記事を生成中... Google Trends → 日本語検索 → Claude API');
    try {
      const res = await fetch('/api/blog-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTopic: customTopic.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`生成完了: "${data.draft.title}"`);
      await loadDrafts();
      selectDraft(data.draft.id);
    } catch (e) {
      showNotice(`エラー: ${e.message}`, true);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdit = async () => {
    const res = await fetch('/api/blog-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, ...editData }),
    });
    const data = await res.json();
    if (!res.ok) { showNotice(`保存エラー: ${data.error}`, true); return; }
    setSelected(data);
    setEditing(false);
    await loadDrafts();
    showNotice('保存しました');
  };

  const handlePublish = async () => {
    if (!confirm(`"${selected.title}" をVercelに公開しますか？\nGitHubにコミット → 自動デプロイされます。`)) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/blog-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`✅ Vercel公開完了: ${data.filename}`);
      setSelected({ ...selected, status: 'published' });
      await loadDrafts();
    } catch (e) {
      showNotice(`公開エラー: ${e.message}`, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleRepublish = async () => {
    if (!confirm(`"${selected.title}" をVercelに再公開しますか？\n最新の内容・写真でGitHubを上書きします。`)) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/blog-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, force: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`🔄 Vercel再公開完了: ${data.filename}`);
      await loadDrafts();
    } catch (e) {
      showNotice(`再公開エラー: ${e.message}`, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleQA = async () => {
    setQaChecking(true);
    setQaResult(null);
    try {
      const res = await fetch('/api/blog-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQaResult(data);
      showNotice(data.overall === 'pass' ? '✅ QAチェック完了: 問題なし' : '⚠️ QAチェック完了: 修正が必要な項目があります');
    } catch (e) {
      showNotice(`QAエラー: ${e.message}`, true);
    } finally {
      setQaChecking(false);
    }
  };

  const handlePublishLocal = async () => {
    if (!confirm(`"${selected.title}" をローカルに書き出しますか？\nPremium Real Estate Website の content/blog/ に保存されます。`)) return;
    setPublishingLocal(true);
    try {
      const res = await fetch('/api/blog-publish-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`💾 ローカル保存完了: ${data.filename}`);
    } catch (e) {
      showNotice(`ローカル保存エラー: ${e.message}`, true);
    } finally {
      setPublishingLocal(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('この下書きを却下しますか？')) return;
    await fetch('/api/blog-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, status: 'rejected' }),
    });
    setSelected(null);
    await loadDrafts();
    showNotice('却下しました');
  };

  const handleRefetchPhoto = async () => {
    setRefetchingPhoto(true);
    showNotice('Pexelsから写真を再取得中...');
    try {
      const res  = await fetch('/api/blog-refetch-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(prev => ({ ...prev, featured_image: data.featured_image, photo_credit: data.photo_credit }));
      showNotice(data.message || '写真を更新しました');
    } catch (e) {
      showNotice(`エラー: ${e.message}`, true);
    } finally {
      setRefetchingPhoto(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`"${selected.title}" を完全に削除しますか？\nこの操作は元に戻せません。`)) return;
    const res = await fetch(`/api/blog-drafts?id=${selected.id}`, { method: 'DELETE' });
    if (!res.ok) { showNotice('削除に失敗しました', true); return; }
    setSelected(null);
    await loadDrafts();
    showNotice('削除しました');
  };

  const bS = {
    wrap:       { display: 'flex', gap: 16, height: 'calc(100vh - 220px)', minHeight: 500 },
    sidebar:    { width: 280, border: '1px solid #e5e5e5', borderRadius: 10, background: '#fff', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' },
    sHead:      { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '10px 10px 0 0' },
    item:       { padding: '12px 14px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
    itemActive: { background: '#f0f7ff', borderLeft: '3px solid #1a1a1a' },
    iTitle:     { fontSize: 12, fontWeight: 500, color: '#1a1a1a', lineHeight: 1.4, marginBottom: 5 },
    iMeta:      { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    badge:      (s) => ({ fontSize: 10, padding: '2px 7px', borderRadius: 999, fontWeight: 600, background: BLOG_STATUS_COLORS[s] + '22', color: BLOG_STATUS_COLORS[s], border: `1px solid ${BLOG_STATUS_COLORS[s]}44` }),
    iCat:       { fontSize: 10, color: '#888' },
    iDate:      { fontSize: 10, color: '#bbb', marginLeft: 'auto' },
    main:       { flex: 1, border: '1px solid #e5e5e5', borderRadius: 10, background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
    actions:    { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '10px 10px 0 0', flexShrink: 0 },
    metaBox:    { padding: '16px 18px', borderBottom: '1px solid #f5f5f5', flexShrink: 0 },
    artTitle:   { margin: '0 0 10px', fontSize: 17, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4 },
    metaRow:    { fontSize: 12, color: '#888', marginBottom: 6 },
    metaDesc:   { fontSize: 12, color: '#555', marginTop: 5, lineHeight: 1.5 },
    trendBadge: { display: 'inline-block', marginTop: 6, padding: '2px 9px', background: '#fffbeb', color: '#92400e', borderRadius: 999, fontSize: 11, border: '1px solid #fde68a' },
    code:       { background: '#f5f5f5', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 },
    body:       { flex: 1, padding: '16px 18px', overflowY: 'auto' },
    pre:        { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#374151', lineHeight: 1.7, background: '#f8f7f4', padding: '16px', borderRadius: 8 },
    label:      { display: 'block', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
    input:      { width: '100%', padding: '7px 9px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 10 },
    btn:        (bg, color, border) => ({ padding: '7px 14px', background: bg, color, border: border || 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }),
    empty:      { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 },
    notice:     (err) => ({ marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid', background: err ? '#fef2f2' : '#f0fdf4', borderColor: err ? '#fca5a5' : '#86efac', color: err ? '#991b1b' : '#166534' }),
  };

  return (
    <div>
      {/* テーマ入力欄 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>テーマを指定（空欄でAIが自動選択）</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={customTopic}
            onChange={e => setCustomTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !generating && handleGenerate()}
            placeholder="例: How Foreigners Can Buy a House in Tokyo"
            disabled={generating}
            style={{ ...bS.input, marginBottom: 0, flex: 1 }}
          />
          <button onClick={handleGenerate} disabled={generating} style={bS.btn('#1a1a1a', '#fff')}>
            {generating ? '⏳ 生成中...' : '✨ 生成'}
          </button>
        </div>
      </div>
      {/* 下書き件数 */}
      <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>下書き {loading ? '...' : `${drafts.length}件`}</div>
      {notice && <div style={bS.notice(notice.error)}>{notice.text}</div>}

      <div style={bS.wrap}>
        {/* サイドバー */}
        <div style={bS.sidebar}>
          <div style={bS.sHead}>下書き一覧</div>
          {drafts.length === 0 && !loading && (
            <div style={{ padding: '20px 14px', fontSize: 12, color: '#bbb', textAlign: 'center', lineHeight: 1.8 }}>
              下書きがありません<br />「新しい記事を生成」を押してください
            </div>
          )}
          {drafts.map(d => (
            <div
              key={d.id}
              onClick={() => selectDraft(d.id)}
              style={{ ...bS.item, ...(selected?.id === d.id ? bS.itemActive : {}) }}
            >
              <div style={bS.iTitle}>{d.title}</div>
              <div style={bS.iMeta}>
                <span style={bS.badge(d.status)}>{d.status === 'draft' ? '下書き' : d.status === 'published' ? '公開済' : '却下'}</span>
                <span style={bS.iCat}>{d.category}</span>
                <span style={bS.iDate}>{new Date(d.created_at).toLocaleDateString('ja-JP')}</span>
              </div>
            </div>
          ))}
        </div>

        {/* メイン */}
        <div style={bS.main}>
          {!selected ? (
            <div style={bS.empty}>左の一覧から記事を選択してください</div>
          ) : (
            <>
              {/* アクションバー */}
              <div style={bS.actions}>
                {!editing ? (
                  <>
                    <button onClick={() => setEditing(true)} style={bS.btn('#f1f5f9', '#334155', '1px solid #e2e8f0')}>編集</button>
                    <button onClick={handleQA} disabled={qaChecking} style={bS.btn('#7c3aed', '#fff')}>
                      {qaChecking ? '⏳ チェック中...' : '🔍 QAチェック'}
                    </button>
                    {selected.status === 'draft' && (
                      <>
                        <button onClick={handlePublishLocal} disabled={publishingLocal} style={bS.btn('#1d4ed8', '#fff')}>
                          {publishingLocal ? '保存中...' : '💾 ローカルで確認'}
                        </button>
                        <button onClick={handlePublish} disabled={publishing} style={bS.btn('#2d7a4f', '#fff')}>
                          {publishing ? '公開中...' : '🚀 Vercelに公開'}
                        </button>
                        <button onClick={handleReject} style={bS.btn('#fff', '#ef4444', '1px solid #fca5a5')}>却下</button>
                      </>
                    )}
                    {selected.status === 'published' && (
                      <>
                        <span style={{ fontSize: 12, color: '#2d7a4f', fontWeight: 600 }}>✅ 公開済み</span>
                        <button onClick={handlePublishLocal} disabled={publishingLocal} style={bS.btn('#1d4ed8', '#fff')}>
                          {publishingLocal ? '更新中...' : '💾 ローカル再公開'}
                        </button>
                        <button onClick={handleRepublish} disabled={publishing} style={bS.btn('#2d7a4f', '#fff')}>
                          {publishing ? '更新中...' : '🔄 Vercel再公開'}
                        </button>
                      </>
                    )}
                    <button onClick={handleDelete} style={{ ...bS.btn('#7f1d1d', '#fff'), marginLeft: 'auto' }}>削除</button>
                  </>
                ) : (
                  <>
                    <button onClick={handleSaveEdit} style={bS.btn('#2d7a4f', '#fff')}>保存</button>
                    <button onClick={() => setEditing(false)} style={bS.btn('#f1f5f9', '#334155', '1px solid #e2e8f0')}>キャンセル</button>
                  </>
                )}
              </div>

              {/* メタ情報 */}
              <div style={bS.metaBox}>
                {!editing ? (
                  <>
                    <h2 style={bS.artTitle}>{selected.title}</h2>
                    <div style={bS.metaRow}>カテゴリ: <strong>{selected.category}</strong> &nbsp;|&nbsp; スラッグ: <code style={bS.code}>{selected.slug}</code></div>
                    {selected.meta_description && <div style={bS.metaDesc}><strong>Meta:</strong> {selected.meta_description} <span style={{ color: selected.meta_description.length > 160 ? '#ef4444' : '#bbb', fontSize: 11 }}>({selected.meta_description.length}/160)</span></div>}
                    {selected.excerpt && <div style={bS.metaDesc}><strong>Excerpt:</strong> {selected.excerpt}</div>}
                    {selected.trending_topic && <span style={bS.trendBadge}>Trend: {selected.trending_topic}</span>}

                    {/* 写真プレビュー */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#888' }}>アイキャッチ画像</span>
                        <button
                          onClick={handleRefetchPhoto}
                          disabled={refetchingPhoto}
                          style={{ ...bS.btn('#6366f1', '#fff'), fontSize: 11, padding: '3px 10px' }}
                        >
                          {refetchingPhoto ? '⏳' : '🔄 写真を再取得'}
                        </button>
                      </div>
                      {selected.featured_image ? (
                        <div>
                          <img
                            src={selected.featured_image}
                            alt="featured"
                            style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e5e5' }}
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                          />
                          <div style={{ display: 'none', padding: '12px', background: '#fef2f2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
                            ⚠️ 画像を読み込めませんでした。「写真を再取得」を押してください。
                          </div>
                          {selected.photo_credit && (
                            <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{selected.photo_credit}</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: '12px', background: '#f9fafb', borderRadius: 6, fontSize: 12, color: '#888', border: '1px dashed #e5e5e5' }}>
                          写真なし — 「🔄 写真を再取得」で追加できます
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <label style={bS.label}>タイトル</label>
                    <input value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} style={bS.input} />
                    <label style={bS.label}>カテゴリ</label>
                    <select value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })} style={bS.input}>
                      {BLOG_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <label style={bS.label}>Meta Description (160字以内)</label>
                    <textarea value={editData.meta_description || ''} onChange={e => setEditData({ ...editData, meta_description: e.target.value })} style={{ ...bS.input, height: 60 }} />
                    <label style={bS.label}>Excerpt</label>
                    <textarea value={editData.excerpt || ''} onChange={e => setEditData({ ...editData, excerpt: e.target.value })} style={{ ...bS.input, height: 60 }} />
                  </div>
                )}
              </div>

              {/* QA結果パネル */}
              {qaResult && (
                <div style={{ margin: '0 0 12px', padding: '14px 16px', borderRadius: 8, border: `1px solid ${qaResult.overall === 'pass' ? '#bbf7d0' : '#fecaca'}`, background: qaResult.overall === 'pass' ? '#f0fdf4' : '#fff7f7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <strong style={{ fontSize: 13, color: qaResult.overall === 'pass' ? '#166534' : '#991b1b' }}>
                      {qaResult.overall === 'pass' ? '✅ QA通過' : '⚠️ QA要修正'}
                    </strong>
                    <button onClick={() => setQaResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16 }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 10 }}>
                    {qaResult.checks?.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12 }}>
                        <span style={{ flexShrink: 0, marginTop: 1 }}>
                          {c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}
                        </span>
                        <div>
                          <span style={{ fontWeight: 600, color: '#333' }}>{c.label}: </span>
                          <span style={{ color: '#555' }}>{c.message}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {qaResult.summary && (
                    <div style={{ fontSize: 12, color: '#555', borderTop: '1px solid #e5e5e5', paddingTop: 8 }}>
                      <strong>Summary:</strong> {qaResult.summary}
                    </div>
                  )}
                </div>
              )}

              {/* 本文 */}
              <div style={bS.body}>
                {editing ? (
                  <>
                    <label style={bS.label}>本文 (Markdown)</label>
                    <textarea value={editData.content} onChange={e => setEditData({ ...editData, content: e.target.value })} style={{ ...bS.input, height: 400, fontFamily: 'monospace', fontSize: 12 }} />
                  </>
                ) : (
                  <pre style={bS.pre}>{selected.content}</pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
// ─── JP Blog categories ───────────────────────────────────────────────────────
const JP_BLOG_CATEGORIES = ['RED', '抖音', 'WeChat', 'KOL', '越境EC', 'インバウンド', '戦略'];

function JpBlogWriter() {
  const [drafts, setDrafts]           = useState([]);
  const [selected, setSelected]       = useState(null);
  const [editing, setEditing]         = useState(false);
  const [editData, setEditData]       = useState({});
  const [loading, setLoading]         = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [customTopic, setCustomTopic] = useState('');
  const [publishing, setPublishing]   = useState(false);
  const [refetchingPhoto, setRefetchingPhoto] = useState(false);
  const [qaChecking, setQaChecking]   = useState(false);
  const [qaResult, setQaResult]       = useState(null);
  const [notice, setNotice]           = useState(null);

  const showNotice = (text, error = false) => {
    setNotice({ text, error });
    setTimeout(() => setNotice(null), 4000);
  };

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/jp-blog-drafts');
    const data = await res.json();
    setDrafts(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  useEffect(() => { loadDrafts(); }, [loadDrafts]);

  const selectDraft = async (id) => {
    const res = await fetch(`/api/jp-blog-drafts?id=${id}`);
    const data = await res.json();
    setSelected(data);
    setEditing(false);
    setEditData({ title: data.title, content: data.content, excerpt: data.excerpt, category: data.category });
    setQaResult(null);
  };

  const handleGenerate = async () => {
    const topicLabel = customTopic.trim() ? `「${customTopic.trim()}」` : 'AIが自動選択';
    if (!confirm(`新しい記事を生成しますか？\nテーマ: ${topicLabel}\n（30〜60秒かかります）`)) return;
    setGenerating(true);
    showNotice(customTopic.trim() ? `「${customTopic.trim()}」で記事を生成中...` : '記事を生成中... Google Trends → Claude API');
    try {
      const res = await fetch('/api/jp-blog-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customTopic: customTopic.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`生成完了: "${data.draft.title}"`);
      await loadDrafts();
      selectDraft(data.draft.id);
    } catch (e) {
      showNotice(`エラー: ${e.message}`, true);
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdit = async () => {
    const res = await fetch('/api/jp-blog-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, ...editData }),
    });
    const data = await res.json();
    if (!res.ok) { showNotice(`保存エラー: ${data.error}`, true); return; }
    setSelected(data);
    setEditing(false);
    await loadDrafts();
    showNotice('保存しました');
  };

  const handlePublish = async () => {
    if (!confirm(`"${selected.title}" をTKSNSサイトに公開しますか？\n公開するとサイトに即時反映されます。`)) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/jp-blog-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice(`✅ 公開完了: TKSNSサイトに即時反映されます`);
      setSelected({ ...selected, status: 'published' });
      await loadDrafts();
    } catch (e) {
      showNotice(`公開エラー: ${e.message}`, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm(`"${selected.title}" を下書きに戻しますか？\nTKSNSサイトから非表示になります。`)) return;
    setPublishing(true);
    try {
      const res = await fetch('/api/jp-blog-publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, unpublish: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showNotice('下書きに戻しました');
      setSelected({ ...selected, status: 'draft' });
      await loadDrafts();
    } catch (e) {
      showNotice(`エラー: ${e.message}`, true);
    } finally {
      setPublishing(false);
    }
  };

  const handleQA = async () => {
    setQaChecking(true);
    setQaResult(null);
    try {
      const res = await fetch('/api/jp-blog-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setQaResult(data);
      showNotice(data.overall === 'pass' ? '✅ QAチェック完了: 問題なし' : '⚠️ QAチェック完了: 修正が必要な項目があります');
    } catch (e) {
      showNotice(`QAエラー: ${e.message}`, true);
    } finally {
      setQaChecking(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('この下書きを却下しますか？')) return;
    await fetch('/api/jp-blog-drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: selected.id, status: 'rejected' }),
    });
    setSelected(null);
    await loadDrafts();
    showNotice('却下しました');
  };

  const handleRefetchPhoto = async () => {
    setRefetchingPhoto(true);
    showNotice('Pexelsから写真を再取得中...');
    try {
      const res = await fetch('/api/jp-blog-refetch-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSelected(prev => ({ ...prev, featured_image: data.featured_image, photo_credit: data.photo_credit }));
      showNotice(data.message || '写真を更新しました');
    } catch (e) {
      showNotice(`エラー: ${e.message}`, true);
    } finally {
      setRefetchingPhoto(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`"${selected.title}" を完全に削除しますか？\nこの操作は元に戻せません。`)) return;
    const res = await fetch(`/api/jp-blog-drafts?id=${selected.id}`, { method: 'DELETE' });
    if (!res.ok) { showNotice('削除に失敗しました', true); return; }
    setSelected(null);
    await loadDrafts();
    showNotice('削除しました');
  };

  const bS = {
    wrap:       { display: 'flex', gap: 16, height: 'calc(100vh - 220px)', minHeight: 500 },
    sidebar:    { width: 280, border: '1px solid #e5e5e5', borderRadius: 10, background: '#fff', overflowY: 'auto', flexShrink: 0, display: 'flex', flexDirection: 'column' },
    sHead:      { padding: '10px 14px', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '10px 10px 0 0' },
    item:       { padding: '12px 14px', borderBottom: '1px solid #f5f5f5', cursor: 'pointer' },
    itemActive: { background: '#f0f7ff', borderLeft: '3px solid #1a1a1a' },
    iTitle:     { fontSize: 12, fontWeight: 500, color: '#1a1a1a', lineHeight: 1.4, marginBottom: 5 },
    iMeta:      { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    badge:      (s) => ({ fontSize: 10, padding: '2px 7px', borderRadius: 999, fontWeight: 600, background: BLOG_STATUS_COLORS[s] + '22', color: BLOG_STATUS_COLORS[s], border: `1px solid ${BLOG_STATUS_COLORS[s]}44` }),
    iCat:       { fontSize: 10, color: '#888' },
    iDate:      { fontSize: 10, color: '#bbb', marginLeft: 'auto' },
    main:       { flex: 1, border: '1px solid #e5e5e5', borderRadius: 10, background: '#fff', overflowY: 'auto', display: 'flex', flexDirection: 'column' },
    actions:    { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '10px 10px 0 0', flexShrink: 0, flexWrap: 'wrap' },
    metaBox:    { padding: '16px 18px', borderBottom: '1px solid #f5f5f5', flexShrink: 0 },
    artTitle:   { margin: '0 0 10px', fontSize: 17, fontWeight: 600, color: '#1a1a1a', lineHeight: 1.4 },
    metaRow:    { fontSize: 12, color: '#888', marginBottom: 6 },
    metaDesc:   { fontSize: 12, color: '#555', marginTop: 5, lineHeight: 1.5 },
    trendBadge: { display: 'inline-block', marginTop: 6, padding: '2px 9px', background: '#fffbeb', color: '#92400e', borderRadius: 999, fontSize: 11, border: '1px solid #fde68a' },
    code:       { background: '#f5f5f5', padding: '1px 5px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 },
    body:       { flex: 1, padding: '16px 18px', overflowY: 'auto' },
    pre:        { whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, color: '#374151', lineHeight: 1.7, background: '#f8f7f4', padding: '16px', borderRadius: 8 },
    label:      { display: 'block', fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 },
    input:      { width: '100%', padding: '7px 9px', border: '1px solid #e5e5e5', borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 10 },
    btn:        (bg, color, border) => ({ padding: '7px 14px', background: bg, color, border: border || 'none', borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: 'pointer' }),
    empty:      { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 },
    notice:     (err) => ({ marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, border: '1px solid', background: err ? '#fef2f2' : '#f0fdf4', borderColor: err ? '#fca5a5' : '#86efac', color: err ? '#991b1b' : '#166534' }),
  };

  return (
    <div>
      {/* テーマ入力 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>テーマを指定（空欄でAIが自動選択）</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={customTopic}
            onChange={e => setCustomTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !generating && handleGenerate()}
            placeholder="例: 小红書で日本コスメブランドを売る方法"
            disabled={generating}
            style={{ ...bS.input, marginBottom: 0, flex: 1 }}
          />
          <button onClick={handleGenerate} disabled={generating} style={bS.btn('#1a1a1a', '#fff')}>
            {generating ? '⏳ 生成中...' : '✨ 生成'}
          </button>
        </div>
      </div>
      <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>下書き {loading ? '...' : `${drafts.length}件`}</div>
      {notice && <div style={bS.notice(notice.error)}>{notice.text}</div>}

      <div style={bS.wrap}>
        {/* サイドバー */}
        <div style={bS.sidebar}>
          <div style={bS.sHead}>下書き一覧</div>
          {drafts.length === 0 && !loading && (
            <div style={{ padding: '20px 14px', fontSize: 12, color: '#bbb', textAlign: 'center', lineHeight: 1.8 }}>
              下書きがありません<br />「生成」ボタンで記事を作成してください
            </div>
          )}
          {drafts.map(d => (
            <div
              key={d.id}
              onClick={() => selectDraft(d.id)}
              style={{ ...bS.item, ...(selected?.id === d.id ? bS.itemActive : {}) }}
            >
              <div style={bS.iTitle}>{d.title}</div>
              <div style={bS.iMeta}>
                <span style={bS.badge(d.status)}>{d.status === 'draft' ? '下書き' : d.status === 'published' ? '公開済' : '却下'}</span>
                <span style={bS.iCat}>{d.category}</span>
                {d.qa_status && (
                  <span style={{ fontSize: 10, color: d.qa_status === 'pass' ? '#166534' : '#991b1b' }}>
                    {d.qa_status === 'pass' ? '✅QA' : '⚠️QA'}
                  </span>
                )}
                <span style={bS.iDate}>{new Date(d.created_at).toLocaleDateString('ja-JP')}</span>
              </div>
            </div>
          ))}
        </div>

        {/* メインパネル */}
        <div style={bS.main}>
          {!selected ? (
            <div style={bS.empty}>左の一覧から記事を選択してください</div>
          ) : (
            <>
              {/* アクションバー */}
              <div style={bS.actions}>
                {!editing ? (
                  <>
                    <button onClick={() => setEditing(true)} style={bS.btn('#f1f5f9', '#334155', '1px solid #e2e8f0')}>編集</button>
                    <button onClick={handleQA} disabled={qaChecking} style={bS.btn('#7c3aed', '#fff')}>
                      {qaChecking ? '⏳ チェック中...' : '🔍 QAチェック'}
                    </button>
                    {selected.status === 'draft' && (
                      <>
                        <button onClick={handlePublish} disabled={publishing} style={bS.btn('#2d7a4f', '#fff')}>
                          {publishing ? '処理中...' : '🚀 TKSNSに公開'}
                        </button>
                        <button onClick={handleReject} style={bS.btn('#fff', '#ef4444', '1px solid #fca5a5')}>却下</button>
                      </>
                    )}
                    {selected.status === 'published' && (
                      <>
                        <span style={{ fontSize: 12, color: '#2d7a4f', fontWeight: 600 }}>✅ 公開済み（サイト反映中）</span>
                        <button onClick={handleUnpublish} disabled={publishing} style={bS.btn('#92400e', '#fff')}>
                          {publishing ? '処理中...' : '↩️ 下書きに戻す'}
                        </button>
                      </>
                    )}
                    <button onClick={handleDelete} style={{ ...bS.btn('#7f1d1d', '#fff'), marginLeft: 'auto' }}>削除</button>
                  </>
                ) : (
                  <>
                    <button onClick={handleSaveEdit} style={bS.btn('#2d7a4f', '#fff')}>保存</button>
                    <button onClick={() => setEditing(false)} style={bS.btn('#f1f5f9', '#334155', '1px solid #e2e8f0')}>キャンセル</button>
                  </>
                )}
              </div>

              {/* メタ情報 */}
              <div style={bS.metaBox}>
                {!editing ? (
                  <>
                    <h2 style={bS.artTitle}>{selected.title}</h2>
                    <div style={bS.metaRow}>カテゴリ: <strong>{selected.category}</strong> &nbsp;|&nbsp; スラッグ: <code style={bS.code}>{selected.slug}</code></div>
                    {selected.excerpt && <div style={bS.metaDesc}><strong>要約:</strong> {selected.excerpt}</div>}
                    {selected.trending_topic && <span style={bS.trendBadge}>Trend: {selected.trending_topic}</span>}
                    {selected.keywords?.length > 0 && (
                      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {selected.keywords.map(k => (
                          <span key={k} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: '#f0f0f0', color: '#555' }}>{k}</span>
                        ))}
                      </div>
                    )}
                    {/* 写真プレビュー */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#888' }}>アイキャッチ画像</span>
                        <button
                          onClick={handleRefetchPhoto}
                          disabled={refetchingPhoto}
                          style={{ ...bS.btn('#6366f1', '#fff'), fontSize: 11, padding: '3px 10px' }}
                        >
                          {refetchingPhoto ? '⏳' : '🔄 写真を再取得'}
                        </button>
                      </div>
                      {selected.featured_image ? (
                        <div>
                          <img
                            src={selected.featured_image}
                            alt="featured"
                            style={{ width: '100%', maxHeight: 180, objectFit: 'cover', borderRadius: 6, border: '1px solid #e5e5e5' }}
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'block'; }}
                          />
                          <div style={{ display: 'none', padding: '12px', background: '#fef2f2', borderRadius: 6, fontSize: 12, color: '#991b1b' }}>
                            ⚠️ 画像を読み込めませんでした
                          </div>
                          {selected.photo_credit && (
                            <div style={{ fontSize: 11, color: '#bbb', marginTop: 3 }}>{selected.photo_credit}</div>
                          )}
                        </div>
                      ) : (
                        <div style={{ padding: '12px', background: '#f9fafb', borderRadius: 6, fontSize: 12, color: '#888', border: '1px dashed #e5e5e5' }}>
                          写真なし — 「🔄 写真を再取得」で追加できます
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div>
                    <label style={bS.label}>タイトル</label>
                    <input value={editData.title} onChange={e => setEditData({ ...editData, title: e.target.value })} style={bS.input} />
                    <label style={bS.label}>カテゴリ</label>
                    <select value={editData.category} onChange={e => setEditData({ ...editData, category: e.target.value })} style={bS.input}>
                      {JP_BLOG_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                    <label style={bS.label}>要約</label>
                    <textarea value={editData.excerpt || ''} onChange={e => setEditData({ ...editData, excerpt: e.target.value })} style={{ ...bS.input, height: 60 }} />
                  </div>
                )}
              </div>

              {/* QA結果 */}
              {qaResult && (
                <div style={{ margin: '0 18px 12px', padding: '14px 16px', borderRadius: 8, border: `1px solid ${qaResult.overall === 'pass' ? '#bbf7d0' : '#fecaca'}`, background: qaResult.overall === 'pass' ? '#f0fdf4' : '#fff7f7' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <strong style={{ fontSize: 13, color: qaResult.overall === 'pass' ? '#166534' : '#991b1b' }}>
                      {qaResult.overall === 'pass' ? '✅ QA通過' : '⚠️ QA要修正'}
                    </strong>
                    <button onClick={() => setQaResult(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#999', fontSize: 16 }}>✕</button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', marginBottom: 10 }}>
                    {qaResult.checks?.map(c => (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12 }}>
                        <span style={{ flexShrink: 0 }}>{c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}</span>
                        <div><span style={{ fontWeight: 600, color: '#333' }}>{c.label}: </span><span style={{ color: '#555' }}>{c.message}</span></div>
                      </div>
                    ))}
                  </div>
                  {qaResult.summary && (
                    <div style={{ fontSize: 12, color: '#555', borderTop: '1px solid #e5e5e5', paddingTop: 8 }}>
                      <strong>サマリー:</strong> {qaResult.summary}
                    </div>
                  )}
                </div>
              )}

              {/* 本文 */}
              <div style={bS.body}>
                {editing ? (
                  <>
                    <label style={bS.label}>本文 (Markdown)</label>
                    <textarea value={editData.content} onChange={e => setEditData({ ...editData, content: e.target.value })} style={{ ...bS.input, height: 400, fontFamily: 'monospace', fontSize: 12 }} />
                  </>
                ) : (
                  <pre style={bS.pre}>{selected.content}</pre>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

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
        parsed.push({ filename: f.name, data: json.data, warnings: json.warnings || [], error: null });
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
              ["blog",       "ブログ(EN)"],
              ["jp-blog",    "SNSブログ(JP)"],
              ["orchestrate","🤖 自動化"],
              ["bugs",       "🐛 バグ"],
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
                    <div style={{ fontSize: 13, fontWeight: 500, color: "#555", marginBottom: 8 }}>
                      📄 {r.filename}
                      {r.warnings?.some(w => w.level === 'error') && (
                        <span style={{ marginLeft: 8, background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                          ❌ 要確認 {r.warnings.filter(w => w.level === 'error').length}件
                        </span>
                      )}
                      {r.warnings?.some(w => w.level === 'warn') && !r.warnings?.some(w => w.level === 'error') && (
                        <span style={{ marginLeft: 8, background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>
                          ⚠️ 警告 {r.warnings.filter(w => w.level === 'warn').length}件
                        </span>
                      )}
                    </div>
                    {r.warnings?.length > 0 && (
                      <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 6, background: r.warnings.some(w => w.level === 'error') ? '#fef2f2' : '#fffbeb', border: `1px solid ${r.warnings.some(w => w.level === 'error') ? '#fecaca' : '#fde68a'}` }}>
                        {r.warnings.map((w, wi) => (
                          <div key={wi} style={{ fontSize: 12, color: w.level === 'error' ? '#991b1b' : '#92400e', marginBottom: wi < r.warnings.length - 1 ? 3 : 0 }}>
                            {w.level === 'error' ? '❌' : '⚠️'} <strong>{w.field}:</strong> {w.message}
                          </div>
                        ))}
                      </div>
                    )}
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

          {/* Blog tab (English) */}
          {tab === "blog" && (
            <div style={cardStyle}>
              <div style={{ marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", margin: "0 0 4px" }}>ブログ記事管理（英語・不動産）</h2>
                <p style={{ fontSize: 13, color: "#888", margin: 0 }}>AI が Google Trends + 日本語検索をもとに英語記事を自動生成します。レビュー後に公開してください。</p>
              </div>
              <BlogWriter />
            </div>
          )}

          {/* JP Blog tab (Japanese SNS) */}
          {tab === "jp-blog" && (
            <div style={cardStyle}>
              <div style={{ marginBottom: "1.25rem" }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, color: "#1a1a1a", margin: "0 0 4px" }}>SNSブログ記事管理（日本語・中国SNS）</h2>
                <p style={{ fontSize: 13, color: "#888", margin: 0 }}>AI が中国SNS（RED・抖音・WeChat）に関する日本語記事を生成します。公開するとTKSNSサイトに即時反映されます。</p>
              </div>
              <JpBlogWriter />
            </div>
          )}

          {/* Orchestrator tab */}
          {tab === "orchestrate" && (
            <div style={{ maxWidth: 860 }}>
              <Orchestrator />
            </div>
          )}

          {/* Bug Fixer tab */}
          {tab === "bugs" && (
            <div style={{ maxWidth: 860 }}>
              <BugFixer />
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
