// POST /api/jp-blog-publish
// 下書きを公開済みにする（Supabaseのstatusを'published'に更新するだけ）
// TKSNSはSupabaseから直接publishedな記事を取得して表示する

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id, unpublish } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data: draft, error: fetchErr } = await supabase
    .from('jp_blog_posts')
    .select('id, title, status')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  // unpublish=true で下書きに戻す
  const newStatus = unpublish ? 'draft' : 'published';
  const now = unpublish ? null : new Date().toISOString();

  const { data, error } = await supabase
    .from('jp_blog_posts')
    .update({
      status: newStatus,
      published_at: now,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    success: true,
    status: newStatus,
    message: unpublish
      ? `「${draft.title}」を下書きに戻しました`
      : `「${draft.title}」を公開しました。TKSNSに即時反映されます。`,
    data,
  });
}
