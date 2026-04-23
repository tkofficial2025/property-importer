// GET    /api/jp-blog-drafts        → 下書き一覧
// GET    /api/jp-blog-drafts?id=xxx → 特定の下書き
// PATCH  /api/jp-blog-drafts       → 内容編集・ステータス変更
// DELETE /api/jp-blog-drafts?id=xxx → 削除

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { id } = req.query;

    if (id) {
      const { data, error } = await supabase
        .from('jp_blog_posts')
        .select('*')
        .eq('id', id)
        .single();
      if (error) return res.status(404).json({ error: error.message });
      return res.status(200).json(data);
    }

    const { data, error } = await supabase
      .from('jp_blog_posts')
      .select('id, title, category, status, created_at, excerpt, slug, qa_status')
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { id, title, content, excerpt, category, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const updates = {};
    if (title !== undefined)   updates.title   = title;
    if (content !== undefined) updates.content = content;
    if (excerpt !== undefined) updates.excerpt = excerpt;
    if (category !== undefined) updates.category = category;
    if (status !== undefined)  updates.status  = status;

    const { data, error } = await supabase
      .from('jp_blog_posts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const { error } = await supabase
      .from('jp_blog_posts')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
