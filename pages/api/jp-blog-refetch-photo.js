// POST /api/jp-blog-refetch-photo
// 指定記事の写真をPexelsから再取得してSupabaseを更新する

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function generatePhotoQuery(title) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Generate a short Pexels photo search query (3-5 words, English) for this Japanese blog article about Chinese SNS marketing: "${title}". Return ONLY the search query. Examples: "chinese social media phone", "digital marketing asia", "japan china business"`,
      }],
    });
    return msg.content[0].text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return 'chinese social media marketing';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'PEXELS_API_KEY が設定されていません' });

  const { data: draft, error: fetchErr } = await supabase
    .from('jp_blog_posts')
    .select('id, title')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  try {
    const query = await generatePhotoQuery(draft.title);
    console.log(`[JP RefetchPhoto] Pexelsクエリ: "${query}"`);

    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
    const photoRes = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!photoRes.ok) throw new Error(`Pexels error: ${photoRes.status}`);

    const data   = await photoRes.json();
    const photos = data.photos || [];
    if (photos.length === 0) return res.status(200).json({ message: '写真が見つかりませんでした', featured_image: null });

    const photo = photos[Math.floor(Math.random() * photos.length)];
    const photoUrl = photo.src.large2x || photo.src.large;
    const credit   = `Photo by ${photo.photographer} on Pexels`;

    await supabase
      .from('jp_blog_posts')
      .update({ featured_image: photoUrl, photo_credit: credit })
      .eq('id', id);

    return res.status(200).json({
      success: true,
      featured_image: photoUrl,
      photo_credit: credit,
      message: `写真を更新しました（クエリ: "${query}"）`,
    });
  } catch (e) {
    console.error('[JP RefetchPhoto]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
