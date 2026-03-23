// GET    /api/blog-drafts        → 下書き一覧
// GET    /api/blog-drafts?id=xxx → 特定の下書き
// PATCH  /api/blog-drafts       → ステータス変更・内容編集
// DELETE /api/blog-drafts?id=xxx → 完全削除

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
        .from('blog_drafts')
        .select('*')
        .eq('id', id)
        .single();
      if (error) return res.status(404).json({ error: error.message });
      return res.status(200).json(data);
    }

    // 全件取得（新しい順、rejectを除く）
    const { data, error } = await supabase
      .from('blog_drafts')
      .select('id, title, category, status, created_at, excerpt, slug')
      .neq('status', 'rejected')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    const { id, title, content, excerpt, meta_description, category, status } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (content !== undefined) updates.content = content;
    if (excerpt !== undefined) updates.excerpt = excerpt;
    if (meta_description !== undefined) updates.meta_description = meta_description;
    if (category !== undefined) updates.category = category;
    if (status !== undefined) updates.status = status;

    const { data, error } = await supabase
      .from('blog_drafts')
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
      .from('blog_drafts')
      .delete()
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
