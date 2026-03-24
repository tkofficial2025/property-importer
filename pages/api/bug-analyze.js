// POST /api/bug-analyze
// Sentryのエラー詳細を取得 → 関連コードを読む → Claudeで修正案を作成

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const GITHUB_OWNER  = 'tkofficial2025';
const GITHUB_REPO   = 'th';
const GITHUB_BRANCH = 'master';

// Sentryからエラーの詳細（スタックトレース）を取得
async function fetchIssueDetail(issueId) {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const url = `https://sentry.io/api/0/issues/${issueId}/events/latest/`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sentry issue detail error: ${res.status}`);
  return res.json();
}

// GitHubから関連ファイルを取得
async function fetchGitHubFile(filePath) {
  const token = process.env.GITHUB_TOKEN;
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha, path: filePath };
}

// スタックトレースからファイルパスを抽出
function extractFilePaths(event) {
  const paths = new Set();
  const frames = event?.entries?.find(e => e.type === 'exception')
    ?.data?.values?.[0]?.stacktrace?.frames || [];

  for (const frame of frames) {
    if (frame.filename && !frame.filename.includes('node_modules')) {
      // Sentryのパスをリポジトリのパスに変換
      let p = frame.filename
        .replace(/^.*\/src\//, 'src/')
        .replace(/^~\//, '');
      if (p.startsWith('src/')) paths.add(p);
    }
  }
  return [...paths].slice(0, 4); // 最大4ファイル
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { issueId, issueTitle, culprit } = req.body;
  if (!issueId) return res.status(400).json({ error: 'issueId is required' });

  try {
    // 1. Sentryからエラー詳細取得
    const event = await fetchIssueDetail(issueId);
    const errorMessage = event?.entries?.find(e => e.type === 'exception')
      ?.data?.values?.[0]?.value || issueTitle;
    const stacktrace = JSON.stringify(
      event?.entries?.find(e => e.type === 'exception')
        ?.data?.values?.[0]?.stacktrace?.frames?.slice(-5) || [],
      null, 2
    );

    // 2. 関連ファイルをGitHubから取得
    const filePaths = extractFilePaths(event);
    const files = [];
    for (const fp of filePaths) {
      const file = await fetchGitHubFile(fp);
      if (file) files.push(file);
    }

    // 3. Claudeで修正案を生成
    const filesContext = files.length > 0
      ? files.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n')
      : '(関連ファイルを特定できませんでした。エラー内容から推測してください)';

    const prompt = `You are an expert React/TypeScript/Vite developer. Analyze this bug and provide a fix.

## Error
Title: ${issueTitle}
Culprit: ${culprit || 'unknown'}
Error message: ${errorMessage}

## Stack Trace (last 5 frames)
${stacktrace}

## Related Source Files
${filesContext}

## Instructions
1. Identify the root cause of the error
2. Provide a specific code fix
3. Respond in this JSON format:

{
  "root_cause": "Brief explanation of why the error occurs",
  "fix_summary": "What the fix does (1-2 sentences)",
  "files": [
    {
      "path": "src/path/to/file.tsx",
      "description": "What change to make in this file",
      "old_code": "exact code snippet to replace (must match exactly)",
      "new_code": "replacement code"
    }
  ],
  "confidence": "high" | "medium" | "low",
  "pr_title": "fix: [short description under 70 chars]",
  "pr_body": "## Problem\\n...\\n## Solution\\n...\\n## Test\\n- [ ] Verify the error no longer occurs"
}

Be precise with old_code — it must match the actual file content exactly so it can be applied automatically.`;

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned invalid JSON');

    const analysis = JSON.parse(jsonMatch[0]);

    return res.status(200).json({
      success: true,
      issueId,
      errorMessage,
      filePaths,
      analysis,
    });

  } catch (e) {
    console.error('[BugAnalyze]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
