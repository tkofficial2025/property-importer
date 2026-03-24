// POST /api/orchestrate
// 毎日の自動実行: ブログ生成 → QAチェック → メール通知

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
const NOTIFY_EMAILS = (process.env.NOTIFY_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
const RESEND_API_KEY = process.env.RESEND_API_KEY;

async function callApi(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json() };
}

async function sendEmail({ subject, html }) {
  if (!RESEND_API_KEY || NOTIFY_EMAILS.length === 0) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'TK Official Blog <onboarding@resend.dev>',
      to: NOTIFY_EMAILS,
      subject,
      html,
    }),
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const log = [];
  const startTime = Date.now();
  const today = new Date().toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });

  log.push(`🚀 オーケストレーター開始 (${today})`);

  // ── Step 1: ブログ記事生成 ──────────────────────────────
  log.push('📝 Step 1: ブログ記事を生成中...');
  const { ok: genOk, data: genData } = await callApi('/api/blog-generate', {
    customTopic: req.body?.customTopic || '',
  });

  if (!genOk) {
    log.push(`❌ 生成失敗: ${genData.error}`);
    await sendEmail({
      subject: `[TK Blog] ❌ 自動生成失敗 (${today})`,
      html: buildEmail({ today, log, status: 'error', elapsed: Date.now() - startTime }),
    });
    return res.status(500).json({ success: false, log });
  }

  const draft = genData.draft;
  log.push(`✅ 記事生成完了: "${draft.title}"`);
  log.push(`   カテゴリ: ${draft.category} | キーワード: ${draft.trending_topic || 'なし'}`);

  // ── Step 2: QAチェック ──────────────────────────────────
  log.push('🔍 Step 2: QAチェック中...');
  const { ok: qaOk, data: qaData } = await callApi('/api/blog-qa', { id: draft.id });

  let qaStatus = 'unknown';
  let qaChecks = [];
  if (qaOk) {
    qaStatus = qaData.overall;
    qaChecks = qaData.checks || [];
    const failCount = qaChecks.filter(c => c.status === 'fail').length;
    const warnCount = qaChecks.filter(c => c.status === 'warn').length;
    log.push(`${qaStatus === 'pass' ? '✅' : '⚠️'} QA結果: ${qaStatus} (❌${failCount}件 / ⚠️${warnCount}件)`);
    if (qaData.summary) log.push(`   ${qaData.summary}`);
  } else {
    log.push(`⚠️ QAチェック失敗: ${qaData.error}`);
  }

  // ── Step 3: メール通知 ─────────────────────────────────
  log.push('📧 Step 3: メール通知を送信中...');
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  await sendEmail({
    subject: `[TK Blog] ${qaStatus === 'pass' ? '✅' : '⚠️'} 新しい記事: ${draft.title}`,
    html: buildEmail({ today, log, status: qaStatus, draft, qaChecks, elapsed }),
  });

  log.push(`✅ 完了 (${elapsed}秒)`);

  return res.status(200).json({ success: true, log, draft, qaStatus });
}

function buildEmail({ today, log, status, draft, qaChecks = [], elapsed }) {
  const statusColor  = status === 'pass' ? '#2d7a4f' : status === 'error' ? '#991b1b' : '#92400e';
  const statusBg     = status === 'pass' ? '#f0fdf4' : status === 'error' ? '#fef2f2' : '#fffbeb';
  const statusLabel  = status === 'pass' ? '✅ QA通過' : status === 'error' ? '❌ エラー' : '⚠️ 要確認';

  const checksHtml = qaChecks.length > 0 ? `
    <table style="width:100%;border-collapse:collapse;margin-top:12px;">
      ${qaChecks.map(c => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            ${c.status === 'pass' ? '✅' : c.status === 'warn' ? '⚠️' : '❌'}
            <strong>${c.label}</strong>
          </td>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:12px;color:#555;">${c.message}</td>
        </tr>
      `).join('')}
    </table>` : '';

  return `<!DOCTYPE html>
    <html><head><meta charset="utf-8"><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head>
    <body>
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <div style="background:#1a1a1a;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:18px;">🤖 TK Blog 自動レポート</h1>
        <p style="color:#888;margin:4px 0 0;font-size:13px;">${today}</p>
      </div>

      <div style="background:${statusBg};border:1px solid #e5e5e5;border-top:none;padding:16px 24px;">
        <span style="background:${statusColor};color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600;">${statusLabel}</span>
      </div>

      ${draft ? `
      <div style="border:1px solid #e5e5e5;border-top:none;padding:20px 24px;">
        <h2 style="margin:0 0 8px;font-size:16px;">${draft.title}</h2>
        <p style="margin:0;font-size:13px;color:#555;">カテゴリ: ${draft.category}</p>
        ${draft.trending_topic ? `<p style="margin:4px 0 0;font-size:12px;color:#888;">トレンドキーワード: ${draft.trending_topic}</p>` : ''}
        ${draft.excerpt ? `<p style="margin:12px 0 0;font-size:13px;color:#333;line-height:1.6;">${draft.excerpt}</p>` : ''}
        ${checksHtml}
      </div>` : ''}

      <div style="border:1px solid #e5e5e5;border-top:none;padding:16px 24px;background:#f9f9f9;">
        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#555;">実行ログ</p>
        ${log.map(l => `<p style="margin:2px 0;font-size:12px;color:#444;font-family:monospace;">${l}</p>`).join('')}
        ${elapsed ? `<p style="margin:8px 0 0;font-size:11px;color:#aaa;">実行時間: ${elapsed}秒</p>` : ''}
      </div>

      <div style="border:1px solid #e5e5e5;border-top:none;padding:16px 24px;text-align:center;">
        <a href="http://localhost:3000" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">
          Review Article → localhost:3000
        </a>
      </div>
    </div></body></html>`;
}
