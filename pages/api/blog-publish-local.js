// POST /api/blog-publish-local
// Supabaseの下書きをローカルの Premium Real Estate Website の content/blog/ に書き出す
// → ローカルの npm run dev で即確認できる

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// .env.local に LOCAL_BLOG_PATH を設定
// 例: LOCAL_BLOG_PATH=C:\Users\user\Dropbox\My PC (DESKTOP-Q5M3N18)\Desktop\Premium Real Estate Website\content\blog
const LOCAL_BLOG_PATH = process.env.LOCAL_BLOG_PATH;

// Premium Real Estate Website のルートディレクトリ（content/blog の2つ上）
// LOCAL_BLOG_PATH = .../Premium Real Estate Website/content/blog
// dirname x1    = .../Premium Real Estate Website/content
// dirname x2    = .../Premium Real Estate Website  ← ここが正しいroot
const LOCAL_SITE_ROOT = LOCAL_BLOG_PATH ? path.dirname(path.dirname(LOCAL_BLOG_PATH)) : null;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  if (!LOCAL_BLOG_PATH) {
    return res.status(500).json({ error: 'LOCAL_BLOG_PATH が .env.local に設定されていません' });
  }

  // 1. 下書きを取得
  const { data: draft, error: fetchErr } = await supabase
    .from('blog_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  // 2. Markdownを生成
  const today = new Date().toISOString().split('T')[0];
  const slug = draft.slug || toSlug(draft.title);
  const filename = `${today}-${slug}.md`;
  const filePath = path.join(LOCAL_BLOG_PATH, filename);

  const frontmatter = [
    '---',
    `title: "${draft.title.replace(/"/g, '\\"')}"`,
    `date: "${today}"`,
    `category: "${draft.category || 'Guide'}"`,
    draft.excerpt          ? `excerpt: "${draft.excerpt.replace(/"/g, '\\"')}"` : null,
    draft.meta_description ? `metaDescription: "${draft.meta_description.replace(/"/g, '\\"')}"` : null,
    draft.keywords?.length ? `keywords: [${draft.keywords.map(k => `"${k}"`).join(', ')}]` : null,
    `featuredImage: "${draft.featured_image || '/tokyo.jpg'}"`,
    draft.photo_credit     ? `photoCredit: "${draft.photo_credit}"` : null,
    '---',
    '',
  ].filter(l => l !== null).join('\n');

  const markdown = frontmatter + draft.content;

  // 3. ローカルに書き出し
  try {
    if (!fs.existsSync(LOCAL_BLOG_PATH)) {
      fs.mkdirSync(LOCAL_BLOG_PATH, { recursive: true });
    }

    // 同じslugを持つ既存ファイルを削除（日付違いの重複を防ぐ）
    const existingFiles = fs.readdirSync(LOCAL_BLOG_PATH).filter(
      f => f.endsWith(`-${slug}.md`) && f !== 'README.md'
    );
    for (const old of existingFiles) {
      fs.unlinkSync(path.join(LOCAL_BLOG_PATH, old));
      console.log(`[LocalPublish] 旧ファイル削除: ${old}`);
    }

    fs.writeFileSync(filePath, markdown, 'utf-8');
    console.log(`[LocalPublish] 書き出し完了: ${filePath}`);
  } catch (e) {
    return res.status(500).json({ error: `ファイル書き出しエラー: ${e.message}` });
  }

  // 4. generate-blog-posts.js を実行して blog-posts.json を再生成
  // → Viteのローカルサーバーがホットリロードして即反映される
  let generateLog = '';
  try {
    const generateScript = path.join(LOCAL_SITE_ROOT, 'scripts', 'generate-blog-posts.js');
    if (fs.existsSync(generateScript)) {
      execSync(`node "${generateScript}"`, { cwd: LOCAL_SITE_ROOT, timeout: 15000 });
      generateLog = ' → blog-posts.json を再生成しました';
      console.log(`[LocalPublish] generate-blog-posts.js 実行完了`);
    } else {
      generateLog = ' (generate-blog-posts.js が見つかりませんでした)';
    }
  } catch (e) {
    console.error('[LocalPublish] JSON再生成エラー:', e.message);
    generateLog = ` (JSON再生成エラー: ${e.message})`;
  }

  return res.status(200).json({
    success: true,
    filename,
    filePath,
    message: `ローカルに保存しました: ${filename}${generateLog}`,
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
