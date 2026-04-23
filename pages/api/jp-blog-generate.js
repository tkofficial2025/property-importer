// POST /api/jp-blog-generate
// 日本語の中国SNSブログ記事を自動生成してSupabaseに保存

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { parseStringPromise } from 'xml2js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 中国SNS関連のキーワード（Google Trends JPフィルタ用）
const SNS_KEYWORDS_JP = [
  'RED', '小红书', '抖音', 'TikTok', 'WeChat', '微信', 'KOL', 'KOC',
  '越境EC', '中国', 'インフルエンサー', 'インバウンド', '訪日中国人',
  '中国マーケティング', '中国SNS', '中国向け',
];

// フォールバックトピック（カテゴリ付き）
const FALLBACK_TOPICS = [
  { ja: '小红书（RED）で日本ブランドが成功するための完全ガイド2025年版', category: 'RED' },
  { ja: '抖音（中国版TikTok）マーケティングの始め方【2025年最新版】', category: '抖音' },
  { ja: 'WeChat公式アカウントの開設から運用まで：日本企業向け実践ガイド', category: 'WeChat' },
  { ja: '中国KOLマーケティングとは？費用・選び方・効果を徹底解説', category: 'KOL' },
  { ja: '日本から中国越境ECを始める方法：小红书とタオバオを活用した集客戦略', category: '越境EC' },
  { ja: '訪日中国人向けSNSマーケティング戦略：REDと抖音の最新活用法', category: 'インバウンド' },
  { ja: '小红书のアルゴリズム解説2025：バズる投稿を作るための7つのポイント', category: 'RED' },
  { ja: 'WeChat小程序（ミニプログラム）で日本のサービスを中国市場に届ける方法', category: 'WeChat' },
  { ja: '中国向けライブコマース（直播带货）入門：日本企業の成功事例と始め方', category: '戦略' },
  { ja: '2025年の中国デジタルマーケティングトレンド：押さえておくべき最新動向', category: '戦略' },
  { ja: 'KOCとKOLの違いとは？予算別・目的別のインフルエンサー選定ガイド', category: 'KOL' },
  { ja: '小红书広告（RED Ads）の種類と費用：初心者でもわかる攻略ガイド', category: 'RED' },
  { ja: '抖音ショッピング機能の活用法：日本ブランドが中国で売上を伸ばすには', category: '抖音' },
  { ja: '中国SNS運用代行の選び方：外注前に確認すべき5つのポイント', category: '戦略' },
  { ja: '訪日中国人観光客のSNS消費行動2025：データで見るインバウンドマーケティング', category: 'インバウンド' },
];

// Google Trends RSS（JP）から中国SNS関連トレンドを取得
async function fetchTrendingTopicJP() {
  try {
    const res = await fetch(
      'https://trends.google.com/trends/trendingsearches/daily/rss?geo=JP',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const xml = await res.text();
    const parsed = await parseStringPromise(xml);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    for (const item of items.slice(0, 30)) {
      const title = item.title?.[0]?.toLowerCase() || '';
      const matched = SNS_KEYWORDS_JP.some(kw => title.includes(kw.toLowerCase()));
      if (matched) {
        return item.title?.[0] || null;
      }
    }
    console.log('[Trends JP] 中国SNS関連トレンドなし');
    return null;
  } catch (e) {
    console.error('[Trends JP] エラー:', e.message);
    return null;
  }
}

// トピックに対応する中国語キーワードを返す
function toCnKeyword(topicJa) {
  const keywordMap = [
    ['小红书', '小红书 营销'], ['RED', '小红书 品牌营销'],
    ['抖音', '抖音 品牌营销'], ['TikTok', '抖音 营销攻略'],
    ['WeChat', '微信 公众号运营'], ['微信', '微信营销'],
    ['KOL', 'KOL营销 网红合作'], ['KOC', 'KOC种草营销'],
    ['越境', '跨境电商 日本品牌'], ['ライブコマース', '直播带货'],
    ['インバウンド', '访日中国人 消费'], ['訪日', '访日旅游 购物'],
    ['デザイナー', '中国设计师品牌'], ['ブランド', '中国品牌营销'],
  ];
  for (const [jp, cn] of keywordMap) {
    if (topicJa.includes(jp)) return cn;
  }
  return '中国社交媒体 营销趋势';
}

// 海外からアクセス可能な中国語メディアのRSSフィードから情報を取得
// 36氪・虎嗅・IT之家は国際IPからもアクセス可能
async function fetchChineseMediaNews(topicJa) {
  const cnKeyword = toCnKeyword(topicJa);
  console.log(`[中国メディア] 検索キーワード: "${cnKeyword}"`);

  // 海外からアクセス可能な中国語RSSフィード
  const RSS_FEEDS = [
    { name: '36氪',  url: 'https://36kr.com/feed' },
    { name: '虎嗅',  url: 'https://www.huxiu.com/rss/0.xml' },
    { name: 'IT之家', url: 'https://www.ithome.com/rss/' },
  ];

  // キーワードを分解してフィルタリングに使用
  const filterWords = cnKeyword.split(/\s+/).filter(w => w.length > 1);

  const results = [];

  for (const feed of RSS_FEEDS) {
    try {
      const res = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        console.log(`[${feed.name}] HTTPエラー: ${res.status}`);
        continue;
      }

      const xml = await res.text();
      const parsed = await parseStringPromise(xml);
      const items = parsed?.rss?.channel?.[0]?.item || [];

      // キーワード関連記事をフィルタ
      const matched = items.filter(item => {
        const text = [
          item.title?.[0] || '',
          item.description?.[0] || '',
        ].join(' ');
        return filterWords.some(w => text.includes(w));
      }).slice(0, 3);

      for (const item of matched) {
        const title = item.title?.[0] || '';
        const desc  = (item.description?.[0] || '').replace(/<[^>]*>/g, '').trim().slice(0, 200);
        const date  = item.pubDate?.[0] || '';
        results.push(`【${feed.name}】${title}${date ? ` (${date})` : ''}\n${desc}`);
      }

      console.log(`[${feed.name}] ${matched.length}件マッチ`);
      if (results.length >= 6) break; // 6件集まったら終了
    } catch (e) {
      console.log(`[${feed.name}] エラー: ${e.message}`);
    }
  }

  if (results.length === 0) {
    console.log('[中国メディア] 関連記事なし');
    return null;
  }

  return results.join('\n\n');
}

// 36氪RSSからトレンドトピックを取得（海外アクセス可能）
async function fetchChineseTrending() {
  const cnKeywords = ['小红书', '抖音', '微信', 'KOL', '直播', '跨境', '电商', '营销', '品牌', '种草', '私域'];
  try {
    const res = await fetch('https://36kr.com/feed', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;

    const xml = await res.text();
    const parsed = await parseStringPromise(xml);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    for (const item of items.slice(0, 20)) {
      const title = item.title?.[0] || '';
      if (cnKeywords.some(kw => title.includes(kw))) {
        console.log(`[36氪トレンド] マッチ: ${title}`);
        return title;
      }
    }
    console.log('[36氪トレンド] SNS関連トレンドなし');
    return null;
  } catch (e) {
    console.error('[36氪トレンド] エラー:', e.message);
    return null;
  }
}

// Claudeにトレンドワードを中国SNSブログ向けタイトルに変換させる
async function refineTopic(trend) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 150,
    messages: [{
      role: 'user',
      content: `「${trend}」というトレンドワードをもとに、日本企業・マーケター向けの中国SNS（RED/抖音/WeChat）に関する実践的なブログ記事タイトルを日本語で1つだけ作ってください。タイトルのみ返してください。`,
    }],
  });
  return msg.content[0].text.trim().replace(/^["'「」]|["'「」]$/g, '');
}

// Pexels検索クエリ生成（Claude）
async function generatePhotoQuery(topic) {
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [{
        role: 'user',
        content: `Generate a short Pexels photo search query (3-5 words, English) for this Japanese blog article: "${topic}". The photo should visually represent Chinese social media, digital marketing, or China-Japan business. Return ONLY the search query. Examples: "chinese social media phone", "digital marketing asia", "japan china business meeting"`,
      }],
    });
    return msg.content[0].text.trim().replace(/^["']|["']$/g, '');
  } catch {
    return 'chinese social media marketing';
  }
}

// Pexelsで写真取得
async function fetchPhoto(topic) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return null;

  const query = await generatePhotoQuery(topic);
  console.log(`[Photo] Pexels検索クエリ: "${query}"`);

  try {
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`;
    const res = await fetch(url, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Pexels error: ${res.status}`);

    const data = await res.json();
    const photos = data.photos || [];
    if (photos.length === 0) return null;

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
  // 日本語タイトルからslugを生成（日本語はローマ字に変換できないのでランダムID+連番）
  const clean = title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  const suffix = Date.now().toString(36);
  return clean ? `${clean}-${suffix}` : `jp-sns-blog-${suffix}`;
}

function detectCategory(title) {
  if (/RED|小红书/.test(title)) return 'RED';
  if (/抖音|TikTok/.test(title)) return '抖音';
  if (/WeChat|微信|小程序/.test(title)) return 'WeChat';
  if (/KOL|KOC|インフルエンサー/.test(title)) return 'KOL';
  if (/越境EC|EC|タオバオ|ショッピング/.test(title)) return '越境EC';
  if (/インバウンド|訪日中国人|観光客/.test(title)) return 'インバウンド';
  return '戦略';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { customTopic } = req.body || {};

    let topicJa, category, trending = null;

    if (customTopic && customTopic.trim()) {
      topicJa  = customTopic.trim();
      category = detectCategory(topicJa);
      console.log(`[JP Generate] ユーザー指定: ${topicJa}`);
    } else {
      // 1. 36氪（中国メディア）→ Google Trends JP の順でトレンド取得
      const [cnTrend, googleTrend] = await Promise.all([
        fetchChineseTrending(),
        fetchTrendingTopicJP(),
      ]);

      const trend = cnTrend || googleTrend;

      if (trend) {
        trending = trend;
        topicJa  = await refineTopic(trend);
        category = detectCategory(topicJa);
        console.log(`[JP Generate] トレンドから生成 (${cnTrend ? '36氪' : 'Google'}): ${topicJa}`);
      } else {
        // フォールバック：日付ベースのローテーション
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
        const fallback  = FALLBACK_TOPICS[dayOfYear % FALLBACK_TOPICS.length];
        topicJa  = fallback.ja;
        category = fallback.category;
        console.log(`[JP Generate] フォールバック: ${topicJa}`);
      }
    }

    // 2. 中国語メディア（36氪・虎嗅・IT之家）から現地情報を取得
    const baiduNews = await fetchChineseMediaNews(topicJa);
    if (baiduNews) {
      console.log('[JP Generate] 中国語メディア情報取得成功');
    } else {
      console.log('[JP Generate] 中国語メディア情報なし → Claudeの知識のみで生成');
    }

    // 3. Claude APIで日本語記事生成
    const systemPrompt = `あなたは中国SNSマーケティングの専門家として、日本企業・マーケター向けのブログ記事を執筆するライターです。

読者像：
- 中国市場への進出を検討している日本企業の担当者
- 中国SNS（RED・抖音・WeChat）の運用を検討中のマーケター
- 訪日中国人向けのプロモーションを強化したい事業者

記事の要件：
- 日本語で執筆（専門用語は中国語・英語を適宜カッコ内に補足）
- 実用的・具体的（数字・事例・手順を含む）
- 1000〜1500字程度、H2/H3見出し構成
- 読者が「今日から使える」内容にする

重要：記事の中で必ず1〜2回、当社（合同会社TK）のSNS運用代行サービスを自然に紹介し、
最後に以下のCTAセクションを必ず入れること：

## 中国SNS運用のご相談はTKへ

中国SNSの運用代行・KOLマーケティング・越境EC支援は、合同会社TKにお任せください。中国現地マーケターが、RED・抖音・WeChatを横断してサポートします。

**[無料相談・お問い合わせはこちら](/company/contact)**`;

    const userPrompt = `「${topicJa}」について日本語でブログ記事を書いてください。

${baiduNews ? `以下は36氪・虎嗅などの中国語メディアから取得した最新情報です。内容を参考にして記事の正確性・最新性を高めてください（直訳はせず、日本語読者向けに自然に取り込んでください）：

${baiduNews}

` : ''}要件：
- Markdown形式（# タイトル、## 見出し、**太字**など）
- 実践的な内容（具体的な手順・数字・事例を含む）
- 中国SNSの特性や最新動向を踏まえた正確な情報${baiduNews ? '\n- 上記の百度ニュース情報を自然に活用して記事の信頼性を高める' : ''}

記事の後に以下を追加してください：
EXCERPT: 【記事の2〜3文の要約。日本語で。】
KEYWORDS: 【5〜7個の検索キーワード、カンマ区切り】`;

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const fullOutput = message.content[0].text;

    // 3. パース
    const excerptMatch = fullOutput.match(/EXCERPT:\s*(.+?)(?:\n|KEYWORDS:|$)/s);
    const kwMatch      = fullOutput.match(/KEYWORDS:\s*(.+?)$/s);

    const excerpt  = excerptMatch ? excerptMatch[1].trim() : '';
    const keywords = kwMatch ? kwMatch[1].trim().split(',').map(k => k.trim()).filter(Boolean) : [];
    const content  = fullOutput.replace(/\nEXCERPT:.*$/s, '').trim();

    // 4. Pexelsで写真取得
    const photo = await fetchPhoto(topicJa);

    // 5. Supabaseに保存
    const { data, error } = await supabase
      .from('jp_blog_posts')
      .insert({
        title: topicJa,
        slug: toSlug(topicJa),
        content,
        excerpt,
        category,
        keywords,
        trending_topic: trending || null,
        featured_image: photo?.url || null,
        photo_credit: photo ? `Photo by ${photo.photographer} on Pexels` : null,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, draft: data });

  } catch (err) {
    console.error('[JP Generate] エラー:', err);
    return res.status(500).json({ error: err.message });
  }
}
