// POST /api/blog-qa
// ブログ記事をClaudeでQAチェックする
// チェック項目: SEO / CTA / リンク / 表現 / 構成

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

  // 1. 記事取得
  const { data: draft, error: fetchErr } = await supabase
    .from('blog_drafts')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchErr || !draft) return res.status(404).json({ error: 'Draft not found' });

  // 2. Claudeでチェック
  const prompt = `You are a QA reviewer for a real estate blog targeting English-speaking foreigners in Japan.

Review the following blog article and check each item carefully.

---
TITLE: ${draft.title}
CATEGORY: ${draft.category}
META DESCRIPTION: ${draft.meta_description || '(not set)'}
KEYWORDS: ${draft.keywords?.join(', ') || '(not set)'}
EXCERPT: ${draft.excerpt || '(not set)'}

CONTENT:
${draft.content}
---

Check the following items and respond in this EXACT JSON format:

{
  "overall": "pass" or "fail",
  "checks": [
    {
      "id": "seo_title",
      "label": "Title SEO",
      "status": "pass" or "warn" or "fail",
      "message": "brief feedback in English"
    },
    {
      "id": "seo_meta",
      "label": "Meta Description",
      "status": "pass" or "warn" or "fail",
      "message": "brief feedback"
    },
    {
      "id": "seo_keywords",
      "label": "Keywords",
      "status": "pass" or "warn" or "fail",
      "message": "brief feedback"
    },
    {
      "id": "cta",
      "label": "CTA (Call to Action)",
      "status": "pass" or "warn" or "fail",
      "message": "Does the article recommend the real estate agency service? Is there a clear CTA to consult or browse listings?"
    },
    {
      "id": "links",
      "label": "Internal Links",
      "status": "pass" or "warn" or "fail",
      "message": "Are there links to /properties or /consultation pages?"
    },
    {
      "id": "naturalness",
      "label": "Natural English",
      "status": "pass" or "warn" or "fail",
      "message": "Is the English natural and fluent for native English speakers?"
    },
    {
      "id": "length",
      "label": "Article Length",
      "status": "pass" or "warn" or "fail",
      "message": "Is the article long enough for SEO? (aim for 1000+ words)"
    },
    {
      "id": "structure",
      "label": "Article Structure",
      "status": "pass" or "warn" or "fail",
      "message": "Does it have proper H2/H3 headings, introduction, and conclusion?"
    },
    {
      "id": "relevance",
      "label": "Japan Real Estate Relevance",
      "status": "pass" or "warn" or "fail",
      "message": "Is it relevant to foreigners looking to rent/buy in Japan?"
    },
    {
      "id": "facts",
      "label": "Fact & Date Check",
      "status": "pass" or "warn" or "fail",
      "message": "List any specific claims that may be outdated or inaccurate. Check: years mentioned (flag if older than current year ${new Date().getFullYear()}), visa rules, tax rates, specific prices, law names, government programs. Format: list each suspicious claim on a new line starting with '• '. If nothing suspicious, write 'No issues found.'"
    }
  ],
  "summary": "2-3 sentence overall summary of the article quality and main issues to fix"
}

Rules:
- "fail" = must fix before publishing
- "warn" = recommended to fix but not blocking
- "pass" = good
- overall = "fail" if ANY check is "fail", otherwise "pass"
- Be strict about CTA: the article MUST recommend the agency service
- For facts check: "warn" if there are claims worth verifying, "fail" if something is clearly wrong or outdated, "pass" if all looks current and accurate
- Today's date is ${new Date().toISOString().split('T')[0]}. Flag any information that references years significantly before this.`;

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = msg.content[0].text.trim();

    // JSONを抽出
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude returned invalid JSON');

    const result = JSON.parse(jsonMatch[0]);

    // 3. QA結果をSupabaseに保存
    await supabase
      .from('blog_drafts')
      .update({
        qa_status: result.overall,
        qa_result: result,
        qa_checked_at: new Date().toISOString(),
      })
      .eq('id', id);

    return res.status(200).json({ success: true, ...result });

  } catch (e) {
    console.error('[QA]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
