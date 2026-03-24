// POST /api/blog-refetch-photo
// 写真をPexelsから再取得 → Supabase更新
// 公開済みの場合: GitHubのMarkdownとローカルファイルのfeaturedImageも同時更新

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const GITHUB_OWNER  = 'tkofficial2025';
const GITHUB_REPO   = 'th';
const GITHUB_BRANCH = 'master';
const BLOG_DIR      = 'content/blog';
const LOCAL_BLOG_PATH = process.env.LOCAL_BLOG_PATH;

// Claudeで記事タイトルに合ったPexels検索クエリを生成
async function generatePhotoQuery(title) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Generate a short Pexels photo search query (3-5 words, English) for this blog article title: "${title}"
The query should return a photo that visually matches the article content.
Return ONLY the search query, nothing else. Examples: "tokyo apartment interior", "japan cherry blossom street", "modern japanese office building"`,
      }],
    });
    return msg.content[0].text.trim().replace(/^["']|["']$/g, '');
  } catch (e) {
    console.error('[PhotoQuery] エラー:', e.message);
    return 'tokyo japan real estate';
  }
}

// GitHubのMarkdownファイルのfeaturedImageを更新
async function updateGitHubFile(filename, newImageUrl, newCredit) {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) { console.log('[GitHub] GITHUB_TOKEN未設定 → スキップ'); return; }

  const filePath = `${BLOG_DIR}/${filename}`;
  const apiUrl   = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
  const headers  = {
    'Authorization': `Bearer ${githubToken}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // 既存ファイルを取得
  const getRes = await fetch(`${apiUrl}?ref=${GITHUB_BRANCH}`, { headers });
  if (!getRes.ok) { console.log(`[GitHub] ファイル未発見: ${filename}`); return; }

  const existing = await getRes.json();
  const oldContent = Buffer.from(existing.content, 'base64').toString('utf-8');

  // featuredImage行を置換
  let newContent = oldContent.replace(
    /^featuredImage:.*$/m,
    `featuredImage: "${newImageUrl}"`
  );
  if (newCredit) {
    newContent = newContent.replace(
      /^photoCredit:.*$/m,
      `photoCredit: "${newCredit}"`
    );
  }

  const contentBase64 = Buffer.from(newContent, 'utf-8').toString('base64');

  const putRes = await fetch(apiUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `blog: update featured image for "${filename}"`,
      content: contentBase64,
      branch: GITHUB_BRANCH,
      sha: existing.sha,
    }),
  });

  if (putRes.ok) {
    console.log(`[GitHub] 画像URL更新完了: ${filename}`);
  } else {
    const err = await putRes.json();
    console.error('[GitHub] 更新失敗:', err.message);
  }
}

// ローカルMarkdownファイルのfeaturedImageを更新
function updateLocalFile(filename, newImageUrl, newCredit) {
  if (!LOCAL_BLOG_PATH) return;
  const filePath = path.join(LOCAL_BLOG_PATH, filename);
  if (!fs.existsSync(filePath)) { console.log(`[Local] ファイル未発見: ${filePath}`); return; }

  let content = fs.readFileSync(filePath, 'utf-8');
  content = content.replace(/^featuredImage:.*$/m, `featuredImage: "${newImageUrl}"`);
  if (newCredit) {
    content = content.replace(/^photoCredit:.*$/m, `photoCredit: "${newCredit}"`);
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`[Local] 画像URL更新完了: ${filePath}`);
}

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const pexelsKey = process.env.PEXELS_API_KEY;
  if (!pexelsKey) return res.status(500).json({ error: 'PEXELS_API_KEY が設定されていません' });

  // 1. ドラフト取得（status・slug・published_atも取得）
  const { data: draft, error: fetchErr } = await supabase
    .from('blog_drafts')
    .select('id, title, category, status, slug, published_at')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  // 2. Claudeで検索クエリ生成
  const query = await generatePhotoQuery(draft.title);
  console.log(`[RefetchPhoto] Pexels検索クエリ: "${query}"`);

  try {
    // 3. Pexelsから写真取得
    const page = Math.floor(Math.random() * 5) + 1;
    const url  = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&page=${page}&orientation=landscape`;
    const pRes = await fetch(url, { headers: { Authorization: pexelsKey }, signal: AbortSignal.timeout(8000) });
    if (!pRes.ok) throw new Error(`Pexels error: ${pRes.status}`);

    const photos = (await pRes.json()).photos || [];
    if (photos.length === 0) throw new Error('写真が見つかりませんでした');

    const photo         = photos[Math.floor(Math.random() * photos.length)];
    const featuredImage = photo.src.large2x || photo.src.large;
    const photoCredit   = `Photo by ${photo.photographer} on Pexels`;

    // 4. Supabase更新
    const { error: updateErr } = await supabase
      .from('blog_drafts')
      .update({ featured_image: featuredImage, photo_credit: photoCredit })
      .eq('id', id);
    if (updateErr) throw updateErr;

    // 5. 公開済みならMarkdownファイルも更新
    const updatedFiles = [];
    if (draft.status === 'published') {
      const publishedDate = draft.published_at
        ? new Date(draft.published_at).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0];
      const slug     = draft.slug || toSlug(draft.title);
      const filename = `${publishedDate}-${slug}.md`;

      await updateGitHubFile(filename, featuredImage, photoCredit);
      updateLocalFile(filename, featuredImage, photoCredit);
      updatedFiles.push(filename);
    }

    return res.status(200).json({
      success: true,
      featured_image: featuredImage,
      photo_credit: photoCredit,
      updated_files: updatedFiles,
      message: draft.status === 'published'
        ? '写真を更新してMarkdownファイルも更新しました（Vercelが自動デプロイされます）'
        : '写真を更新しました（下書きのみ）',
    });

  } catch (e) {
    console.error('[Refetch Photo]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
