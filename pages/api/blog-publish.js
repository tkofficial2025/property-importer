// POST /api/blog-publish
// Supabaseの下書きをGitHub APIで tkofficial/th の content/blog/ にコミット
// → Vercelが自動デプロイ

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GITHUB_OWNER = 'tkofficial2025';
const GITHUB_REPO  = 'th';
const GITHUB_BRANCH = 'master';
const BLOG_DIR = 'content/blog';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) return res.status(500).json({ error: 'GITHUB_TOKEN が設定されていません' });

  // 1. 下書きを取得
  const { data: draft, error: fetchErr } = await supabase
    .from('blog_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status === 'published') return res.status(400).json({ error: 'Already published' });

  // 2. Markdownを生成
  const today = new Date().toISOString().split('T')[0];
  const slug = draft.slug || toSlug(draft.title);
  const filename = `${today}-${slug}.md`;
  const filePath = `${BLOG_DIR}/${filename}`;

  const frontmatter = [
    '---',
    `title: "${draft.title.replace(/"/g, '\\"')}"`,
    `date: "${today}"`,
    `category: "${draft.category || 'Guide'}"`,
    draft.excerpt         ? `excerpt: "${draft.excerpt.replace(/"/g, '\\"')}"` : null,
    draft.meta_description ? `metaDescription: "${draft.meta_description.replace(/"/g, '\\"')}"` : null,
    draft.keywords?.length ? `keywords: [${draft.keywords.map(k => `"${k}"`).join(', ')}]` : null,
    `featuredImage: "${draft.featured_image || '/tokyo.jpg'}"`,
    draft.photo_credit ? `photoCredit: "${draft.photo_credit}"` : null,
    '---',
    '',
  ].filter(l => l !== null).join('\n');

  const markdown = frontmatter + draft.content;
  const contentBase64 = Buffer.from(markdown, 'utf-8').toString('base64');

  // 3. GitHub APIでコミット
  const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const headers = {
    'Authorization': `Bearer ${githubToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 既存ファイルのSHAを確認（同名ファイルがある場合は上書き）
  let sha;
  try {
    const check = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
    if (check.ok) {
      const existing = await check.json();
      sha = existing.sha;
    }
  } catch (_) {}

  const body = {
    message: `blog: add "${draft.title}"`,
    content: contentBase64,
    branch: GITHUB_BRANCH,
    ...(sha ? { sha } : {}),
  };

  const pushRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });

  if (!pushRes.ok) {
    const err = await pushRes.json();
    return res.status(500).json({ error: `GitHub API エラー: ${err.message}` });
  }

  const pushData = await pushRes.json();
  console.log(`[Publish] GitHubコミット完了: ${filePath}`);

  // 4. Supabaseのステータスを更新
  await supabase
    .from('blog_drafts')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', id);

  return res.status(200).json({
    success: true,
    filename,
    github_url: pushData.content?.html_url,
    message: `公開完了: ${filename} → Vercelが自動デプロイされます`,
  });
}

function toSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}
