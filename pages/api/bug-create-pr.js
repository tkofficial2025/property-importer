// POST /api/bug-create-pr
// Claudeの修正案をGitHubブランチに適用してPRを作成

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { issueId, analysis } = req.body;
  if (!issueId || !analysis) return res.status(400).json({ error: 'issueId and analysis are required' });

  const token  = process.env.GITHUB_TOKEN;
  const owner  = 'tkofficial2025';
  const repo   = 'th';
  const base   = 'master';
  const branch = `fix/sentry-${issueId}-${Date.now()}`;

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    // 1. masterのSHAを取得
    const refRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${base}`,
      { headers }
    );
    if (!refRes.ok) throw new Error('masterブランチのSHA取得失敗');
    const { object: { sha: baseSha } } = await refRes.json();

    // 2. 新しいブランチを作成
    const branchRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/refs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
      }
    );
    if (!branchRes.ok) throw new Error('ブランチ作成失敗');

    // 3. 各ファイルを更新
    const updatedFiles = [];
    for (const file of analysis.files || []) {
      if (!file.path || !file.old_code || !file.new_code) continue;

      // 現在のファイル内容を取得
      const getRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`,
        { headers }
      );
      if (!getRes.ok) {
        console.warn(`[BugPR] ファイル取得失敗: ${file.path}`);
        continue;
      }
      const existing = await getRes.json();
      const oldContent = Buffer.from(existing.content, 'base64').toString('utf-8');

      // old_codeをnew_codeで置換（完全一致 → 正規化マッチの順で試みる）
      let newContent = null;
      if (oldContent.includes(file.old_code)) {
        // 完全一致
        newContent = oldContent.replace(file.old_code, file.new_code);
      } else {
        // 空白・改行を正規化して再試行
        const normalize = s => s.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
        const normalizedOld     = normalize(oldContent);
        const normalizedTarget  = normalize(file.old_code);
        if (normalizedOld.includes(normalizedTarget)) {
          // 正規化後に一致した場合、行単位で近い箇所を特定して置換
          const lines    = oldContent.split('\n');
          const targetLines = file.old_code.trim().split('\n');
          const firstLine   = normalize(targetLines[0]);
          const startIdx    = lines.findIndex(l => normalize(l).includes(firstLine.substring(0, 30)));
          if (startIdx >= 0) {
            lines.splice(startIdx, targetLines.length, ...file.new_code.split('\n'));
            newContent = lines.join('\n');
          }
        }
      }

      if (!newContent) {
        console.warn(`[BugPR] old_codeが見つかりません（自動適用不可）: ${file.path}`);
        continue;
      }
      const newBase64  = Buffer.from(newContent, 'utf-8').toString('base64');

      // ファイルを更新
      const putRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/${file.path}`,
        {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `fix: ${file.description || file.path}`,
            content: newBase64,
            branch,
            sha: existing.sha,
          }),
        }
      );
      if (putRes.ok) updatedFiles.push(file.path);
    }

    // 自動適用できなかった場合は手動修正用の説明PRを作成
    const autoApplied = updatedFiles.length > 0;
    const manualBody = analysis.files?.map(f =>
      `### \`${f.path}\`\n${f.description}\n\n**修正前:**\n\`\`\`\n${f.old_code}\n\`\`\`\n\n**修正後:**\n\`\`\`\n${f.new_code}\n\`\`\``
    ).join('\n\n') || '';

    const prBody = autoApplied
      ? (analysis.pr_body || '自動生成されたバグ修正PRです。')
      : `> ⚠️ コードの自動適用ができませんでした。以下を参考に手動で修正してください。\n\n## 原因\n${analysis.root_cause}\n\n## 修正内容\n${analysis.fix_summary}\n\n## 手動修正箇所\n${manualBody}`;

    // 4. Pull Requestを作成
    const prRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/pulls`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: analysis.pr_title || `fix: Sentry issue #${issueId}`,
          body:  prBody,
          head:  branch,
          base,
        }),
      }
    );
    if (!prRes.ok) {
      const err = await prRes.json();
      throw new Error(`PR作成失敗: ${err.message}`);
    }
    const pr = await prRes.json();

    return res.status(200).json({
      success:       true,
      pr_url:        pr.html_url,
      pr_number:     pr.number,
      branch,
      updated_files: updatedFiles,
      auto_applied:  autoApplied,
      message:       autoApplied
        ? `PR #${pr.number} を作成しました（コード自動適用済み）`
        : `PR #${pr.number} を作成しました（手動修正が必要です）`,
    });

  } catch (e) {
    console.error('[BugCreatePR]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
