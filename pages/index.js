import { useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import Head from "next/head";

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

export default function Home() {
  const [tab, setTab] = useState("import");
  const [files, setFiles] = useState([]);
  const [results, setResults] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, label: "" });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [history, setHistory] = useState([]);
  const [dragging, setDragging] = useState(false);
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
      r.onload = () => resolve(r.result.split(",")[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const analyzeFiles = async () => {
    setAnalyzing(true);
    setResults([]);
    setSaveMsg("");
    const total = files.length;
    const parsed = [];
    for (let i = 0; i < total; i++) {
      const f = files[i];
      setProgress({ current: i + 1, total, label: `解析中: ${f.name} (${i + 1}/${total})` });
      try {
        const base64 = await fileToBase64(f);
        const res = await fetch("/api/analyze", {
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
    const records = results.filter((r) => r.data).map((r) => r.data);
    const { error } = await supabase
      .from(process.env.NEXT_PUBLIC_SUPABASE_TABLE || "properties")
      .insert(records);
    if (error) {
      setSaveMsg("❌ 保存失敗: " + error.message);
    } else {
      setSaveMsg(`✅ ${records.length}件を保存しました`);
      setHistory((prev) => [
        { time: new Date().toLocaleString("ja-JP"), files: files.map((f) => f.name), count: records.length },
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
            {[["import", "PDFインポート"], ["history", "履歴"]].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} style={{
                padding: "8px 16px", fontSize: 13, cursor: "pointer", border: "none",
                background: "none", color: tab === id ? "#1a1a1a" : "#888",
                borderBottom: tab === id ? "2px solid #1a1a1a" : "2px solid transparent",
                fontWeight: tab === id ? 500 : 400, marginBottom: -1,
              }}>{label}</button>
            ))}
          </div>

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
                                          if (e.target.value === "") {
                                            v = null;
                                          } else if (c.key === "floor") {
                                            v = parseInt(e.target.value, 10) || null;
                                          } else {
                                            v = parseFloat(e.target.value) || null;
                                          }
                                        } else {
                                          v = e.target.value;
                                        }
                                        updateField(ri, c.key, v);
                                      }}
                                      style={{ background: "transparent", border: "none", outline: "none", width: "100%", fontSize: 13, fontFamily: "inherit", color: "#1a1a1a", padding: "2px 4px", borderRadius: 4 }}
                                      onFocus={(e) => e.target.style.background = "#f2f1ed"}
                                      onBlur={(e) => e.target.style.background = "transparent"} />
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

const cardStyle = {
  background: "#fff", border: "1px solid #e8e8e4", borderRadius: 12,
  padding: "1.25rem", marginBottom: "1rem",
};
const errStyle = {
  fontSize: 13, padding: "8px 12px", borderRadius: 8,
  background: "#fdf0ef", color: "#c0392b", marginTop: 8,
};

function StepHeader({ num, title }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "1rem" }}>
      <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#e8f0fe", color: "#1a56db", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>{num}</div>
      <span style={{ fontSize: 15, fontWeight: 500, color: "#1a1a1a" }}>{title}</span>
    </div>
  );
}
