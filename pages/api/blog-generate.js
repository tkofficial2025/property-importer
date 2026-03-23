// POST /api/blog-generate
// US・AUトレンド取得 → 日本語で情報収集 → 英語記事生成 → Supabase保存

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { parseStringPromise } from 'xml2js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 英語の不動産関連キーワード（US・AUトレンドフィルタ用）
const REAL_ESTATE_KEYWORDS_EN = [
  'japan', 'tokyo', 'osaka', 'rent', 'apartment', 'property', 'real estate',
  'housing', 'expat', 'foreigner', 'investment', 'condo', 'mortgage', 'lease',
  'relocation', 'move', 'living in japan', 'buy house', 'home',
];

// フォールバックトピック（US・AU在住者が検索するテーマ）
const FALLBACK_TOPICS = [
  { en: 'How to Rent an Apartment in Tokyo as a Foreigner in 2025', category: 'Guide' },
  { en: 'Japan Real Estate Investment: Why Americans Are Buying Property in Tokyo', category: 'Investment' },
  { en: 'Moving to Japan: Complete Housing Guide for Expats', category: 'Guide' },
  { en: 'Tokyo vs Osaka: Which City is Better for Expat Living?', category: 'Area' },
  { en: 'How Much Does It Really Cost to Rent in Tokyo?', category: 'Rent' },
  { en: 'Japan Property Market 2025: Is Now a Good Time to Buy?', category: 'Market' },
  { en: 'Buying Property in Japan as a Foreigner: What You Need to Know', category: 'Buy' },
  { en: 'Best Neighborhoods in Tokyo for English-Speaking Expats', category: 'Area' },
  { en: 'Understanding Key Money and Agent Fees When Renting in Japan', category: 'Guide' },
  { en: 'Japan Rental Guarantor System: How Foreigners Can Bypass It', category: 'Rent' },
  { en: 'Why Japanese Real Estate is So Cheap Compared to Other Major Cities', category: 'Market' },
  { en: 'Pet-Friendly Apartments in Tokyo: A Guide for Expat Pet Owners', category: 'Lifestyle' },
  { en: 'Remote Work and Living in Japan: Finding the Right Apartment', category: 'Lifestyle' },
  { en: 'Japan Golden Visa and Property Ownership for Investors', category: 'Investment' },
];

// Google Trends RSS (US・AU) からトレンドトピックを取得
async function fetchTrendingTopicEnglish() {
  const geos = ['US', 'AU'];

  for (const geo of geos) {
    try {
      const res = await fetch(
        `https://trends.google.com/trends/trendingsearches/daily/rss?geo=${geo}`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) continue;

      const xml = await res.text();
      const parsed = await parseStringPromise(xml);
      const items = parsed?.rss?.channel?.[0]?.item || [];

      for (const item of items.slice(0, 30)) {
        const title = item.title?.[0]?.toLowerCase() || '';
        const matched = REAL_ESTATE_KEYWORDS_EN.some(kw => title.includes(kw));
        if (matched) {
          const original = item.title?.[0] || '';
          console.log(`[Trends ${geo}] マッチ: ${original}`);
          return { trend: original, geo };
        }
      }
      console.log(`[Trends ${geo}] 不動産関連トレンドなし`);
    } catch (e) {
      console.error(`[Trends ${geo}] エラー:`, e.message);
    }
  }

  return null;
}

// Google Custom Search で日本語情報を収集
async function fetchJapaneseInfo(query) {
  const apiKey = process.env.GOOGLE_API_KEY;
  const cseId  = process.env.GOOGLE_CSE_ID;

  if (!apiKey || !cseId || cseId.includes('ここに')) {
    console.log('[Search] Google CSE未設定 → スキップ');
    return null;
  }

  try {
    const q = encodeURIComponent(query);
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${q}&lr=lang_ja&gl=jp&num=5`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CSE error: ${res.status}`);

    const data = await res.json();
    const snippets = (data.items || [])
      .map((item, i) => `[${i + 1}] ${item.title}\n${item.snippet}`)
      .join('\n\n');

    return snippets || null;
  } catch (e) {
    console.error('[Search] エラー:', e.message);
    return null;
  }
}

// Pexels APIで記事関連のフリー素材写真を取得
async function fetchPhoto(topic, category) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    console.log('[Photo] PEXELS_API_KEY未設定 → スキップ');
    return null;
  }

  // カテゴリ別の検索クエリ
  const queryMap = {
    Investment: 'tokyo skyline city',
    Buy:        'tokyo apartment building',
    Rent:       'japan apartment interior',
    Market:     'tokyo real estate cityscape',
    Area:       'tokyo neighborhood street',
    Lifestyle:  'japan expat living',
    Guide:      'tokyo japan',
  };
  const query = queryMap[category] || 'tokyo japan';

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=10&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Pexels error: ${res.status}`);

    const data = await res.json();
    const photos = data.photos || [];
    if (photos.length === 0) return null;

    // ランダムに1枚選択
    const photo = photos[Math.floor(Math.random() * photos.length)];
    return {
      url: photo.src.large2x || photo.src.large,
      photographer: photo.photographer,
      pexels_url: photo.url,
    };
  } catch (e) {
    console.error('[Photo] エラー:', e.message);
    return null;
  }
}

function toSlug(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 80);
}

function detectCategory(title) {
  const t = title.toLowerCase();
  if (t.includes('invest') || t.includes('yield') || t.includes('return') || t.includes('cheap')) return 'Investment';
  if (t.includes('buy') || t.includes('purchase') || t.includes('ownership')) return 'Buy';
  if (t.includes('rent') || t.includes('lease') || t.includes('tenant') || t.includes('cost')) return 'Rent';
  if (t.includes('market') || t.includes('trend') || t.includes('price')) return 'Market';
  if (t.includes('neighborhood') || t.includes('area') || t.includes('district') || t.includes('vs')) return 'Area';
  if (t.includes('lifestyle') || t.includes('living') || t.includes('remote') || t.includes('pet')) return 'Lifestyle';
  return 'Guide';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. US・AUのトレンド取得
    const trending = await fetchTrendingTopicEnglish();

    let topicEn, category;

    if (trending) {
      // トレンドワードをClaude経由で日本不動産向けSEOタイトルに変換
      const refineMsg = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `A trending search in ${trending.geo} is: "${trending.trend}"

Convert this into a compelling English SEO blog title for a Japan real estate website targeting English-speaking expats and investors. The article must be specifically about Japan real estate. Just return the title, nothing else.`
        }]
      });
      topicEn   = refineMsg.content[0].text.trim().replace(/^["']|["']$/g, '');
      category  = detectCategory(topicEn);
      console.log(`[Generate] トレンドから生成: ${topicEn}`);
    } else {
      // フォールバック：日付ベースでローテーション
      const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
      const fallback  = FALLBACK_TOPICS[dayOfYear % FALLBACK_TOPICS.length];
      topicEn  = fallback.en;
      category = fallback.category;
      console.log(`[Generate] フォールバック: ${topicEn}`);
    }

    // 2. 日本語で詳細情報を収集
    const jaQuery = `${topicEn} 日本 不動産 外国人`;
    const japaneseInfo = await fetchJapaneseInfo(jaQuery);

    // 3. Claude APIで英語記事生成
    const systemPrompt = `You are an expert content writer for a premium Japan real estate website. Your readers are English-speaking expats, investors, and people planning to move to Japan — primarily from the US, Australia, UK, and Canada.

Your articles must be:
- SEO-optimized for Google search in English (targeting US/AU/UK audiences searching about Japan)
- Practical and specific — real numbers, real processes, real costs in JPY and USD
- Based on accurate Japanese real estate practices
- 900-1200 words, with clear H2/H3 structure
- Written to answer the exact question an English speaker would Google

IMPORTANT — Every article must naturally lead readers to use our real estate agency:
- Mention 1-2 times within the article that navigating Japan's real estate market is easier with a bilingual agent who specializes in helping foreigners
- End every article with a dedicated CTA section using this exact format:

## Ready to Find Your Perfect Property in Japan?

Navigating Japan's real estate market as a foreigner can be complex — but it doesn't have to be. Our team of bilingual agents specializes in helping expats and international investors find the right property, handle paperwork, and skip the common pitfalls.

**[Browse Our Listings](/properties)** or **[Book a Free Consultation](/consultation)** — we'll guide you through every step.`;

    const userPrompt = `Write a blog article about: "${topicEn}"

${japaneseInfo ? `Research from Japanese sources (use for accuracy, do NOT translate directly — synthesize into natural English):

${japaneseInfo}

` : ''}Requirements:
- Write in English for a US/Australian audience curious about Japan real estate
- Include Japan-specific terminology with brief explanations (e.g., key money 礼金, shikikin 敷金)
- Use Markdown: # title, ## sections, ### subsections, **bold** key terms
- Include practical tips, real cost ranges, and actionable steps

After the article add:
EXCERPT: [2-3 sentence summary for the blog listing]
META_DESCRIPTION: [max 160 chars, include "Japan" and a main keyword]
KEYWORDS: [5-7 English keywords US/AU users would search]`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const fullOutput = message.content[0].text;

    // 4. パース
    const excerptMatch = fullOutput.match(/EXCERPT:\s*(.+?)(?:\n|META_DESCRIPTION:|$)/s);
    const metaMatch    = fullOutput.match(/META_DESCRIPTION:\s*(.+?)(?:\n|KEYWORDS:|$)/s);
    const kwMatch      = fullOutput.match(/KEYWORDS:\s*(.+?)$/s);

    const excerpt         = excerptMatch ? excerptMatch[1].trim() : '';
    const metaDescription = metaMatch    ? metaMatch[1].trim()    : '';
    const keywords        = kwMatch ? kwMatch[1].trim().split(',').map(k => k.trim()).filter(Boolean) : [];
    const content         = fullOutput.replace(/\nEXCERPT:.*$/s, '').trim();

    // 5. Pexelsで写真取得
    const photo = await fetchPhoto(topicEn, category);

    // 6. Supabaseに保存
    const { data, error } = await supabase
      .from('blog_drafts')
      .insert({
        title: topicEn,
        slug: toSlug(topicEn),
        content,
        excerpt,
        meta_description: metaDescription,
        category,
        keywords,
        trending_topic: trending ? `${trending.trend} (${trending.geo})` : topicEn,
        japanese_sources: japaneseInfo || null,
        featured_image: photo?.url || null,
        photo_credit: photo ? `Photo by ${photo.photographer} on Pexels` : null,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, draft: data });

  } catch (err) {
    console.error('[Generate] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
