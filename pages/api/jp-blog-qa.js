// POST /api/jp-blog-qa
// 日本語SNSブログ記事をClaudeでQAチェックする

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const { data: draft, error: fetchErr } = await supabase
    .from('jp_blog_posts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  const prompt = `あなたは中国SNSマーケティングブログのQAレビュアーです。以下の日本語記事をチェックしてください。

---
タイトル: ${draft.title}
カテゴリ: ${draft.category}
キーワード: ${draft.keywords?.join(', ') || '（未設定）'}
要約: ${draft.excerpt || '（未設定）'}

本文:
${draft.content}
---

以下の項目をチェックし、必ず以下のJSON形式のみで返してください：

{
  "overall": "pass" または "fail",
  "checks": [
    {
      "id": "seo_title",
      "label": "タイトルSEO",
      "status": "pass" または "warn" または "fail",
      "message": "簡潔なフィードバック（日本語）"
    },
    {
      "id": "keywords",
      "label": "キーワード",
      "status": "pass" または "warn" または "fail",
      "message": "キーワードの適切さ"
    },
    {
      "id": "cta",
      "label": "CTA（行動喚起）",
      "status": "pass" または "warn" または "fail",
      "message": "TKのサービス紹介とお問い合わせへの誘導があるか"
    },
    {
      "id": "internal_link",
      "label": "内部リンク",
      "status": "pass" または "warn" または "fail",
      "message": "/company/contact へのリンクが含まれているか"
    },
    {
      "id": "naturalness",
      "label": "日本語の自然さ",
      "status": "pass" または "warn" または "fail",
      "message": "日本語として自然でわかりやすいか"
    },
    {
      "id": "length",
      "label": "記事の長さ",
      "status": "pass" または "warn" または "fail",
      "message": "SEOに十分な文字数か（目標1000字以上）"
    },
    {
      "id": "structure",
      "label": "記事構成",
      "status": "pass" または "warn" または "fail",
      "message": "H2/H3見出し・導入・まとめの構成になっているか"
    },
    {
      "id": "relevance",
      "label": "中国SNS関連性",
      "status": "pass" または "warn" または "fail",
      "message": "中国SNS（RED・抖音・WeChat等）の実践的な内容か"
    },
    {
      "id": "accuracy",
      "label": "情報の正確性",
      "status": "pass" または "warn" または "fail",
      "message": "古い情報・誤りが含まれていないか。疑わしい点があれば列挙してください"
    },
    {
      "id": "practical",
      "label": "実用性",
      "status": "pass" または "warn" または "fail",
      "message": "読者がすぐに活用できる具体的な情報が含まれているか"
    }
  ],
  "summary": "記事全体の品質と改善点の2〜3文のサマリー（日本語）"
}

ルール：
- "fail" = 公開前に必ず修正が必要
- "warn" = 修正推奨だがブロッキングではない
- "pass" = 問題なし
- overall = いずれかのcheckが"fail"なら"fail"、そうでなければ"pass"
- CTAチェックは厳しく：TKのSNS運用代行サービスへの言及とお問い合わせページへのリンク（/company/contact）が必須
- 本日の日付: ${new Date().toISOString().split('T')[0]}`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0].text.trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned invalid JSON');

    const result = JSON.parse(jsonMatch[0]);

    await supabase
      .from('jp_blog_posts')
      .update({
        qa_status: result.overall,
        qa_result: result,
        qa_checked_at: new Date().toISOString(),
      })
      .eq('id', id);

    return res.status(200).json({ success: true, ...result });

  } catch (e) {
    console.error('[JP QA]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
