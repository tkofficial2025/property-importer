import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 住所から緯度経度を取得する関数（OpenStreetMap Nominatim API使用）
async function geocodeAddress(address) {
  try {
    // 英語表記の住所を日本語に戻すか、そのまま使用
    // OpenStreetMap Nominatim APIは日本語住所も対応
    const encodedAddress = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=1&countrycodes=jp`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PropertyImporter/1.0' // Nominatim APIの利用規約に従う
      }
    });
    
    if (!response.ok) {
      throw new Error(`Geocoding API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data && data.length > 0) {
      return {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon)
      };
    }
    
    return null;
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

const SYSTEM_PROMPT = `あなたは不動産物件PDFを解析するAIです。PDFから以下のフィールドを抽出し、必ずJSONのみを返してください。前置きや説明は不要です。

重要: 以下のフィールドは必ず英語表記で返してください。
- title（物件名）: 日本語の物件名を英語に翻訳してください
- address（住所）: 日本語の住所を英語表記に変換してください（都道府県から）
- station（最寄り駅名）: 日本語の駅名を英語表記に変換してください

抽出フィールド（存在しない場合はnullを使用）:
- title: 物件名（英語表記、必須）
- address: 住所（英語表記、都道府県から、必須）
- price: 賃料（数値、円単位、管理費除く）
- management_fee: 管理費・共益費（数値、円単位）
- beds: 部屋数（数値）
- size: 専有面積（数値、㎡）
- layout: 間取り（例: 1LDK, 2LDK）
- station: 最寄り駅名（英語表記、必須）
- walking_minutes: 徒歩分数（数値）
- floor: 階数（整数のみ、文字列や"3階"などの表記は不可。例: 3, 1, 10。地下の場合は負の整数、例: -1）
- type: "rent"または"buy"
- deposit: 敷金（数値、円単位、月数×賃料で計算。なしは0）
- key_money: 礼金（数値、円単位。なしは0）
- pet_friendly: ペット可（true/false）
- foreign_friendly: 外国人可（true/false）
- elevator: エレベーター有（true/false）
- delivery_box: 宅配ボックス有（true/false）
- balcony: バルコニー有（true/false）
- bicycle_parking: 駐輪場有（true/false）
- south_facing: 南向き（true/false）
- is_featured: false（デフォルト）
- is_new: true（デフォルト）
- category_no_key_money: 礼金なし（true/false）
- category_luxury: 高級物件か（true/false、賃料30万以上など）
- category_pet_friendly: ペット可カテゴリ（pet_friendlyと同じ）
- category_for_students: 学生向けか（true/false）
- category_for_families: ファミリー向けか（true/false）
- category_designers: デザイナーズか（true/false）
- category_high_rise_residence: タワーマンションか（true/false）
- property_information: 物件の特記事項・備考（文字列）
- latitude: 緯度（数値、住所から取得可能な場合）
- longitude: 経度（数値、住所から取得可能な場合）

JSONのみ返すこと。`;

export const config = { api: { bodyParser: { sizeLimit: "20mb" } } };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { base64, filename } = req.body;
  if (!base64) return res.status(400).json({ error: "base64 is required" });

  try {
    const message = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: `ファイル名: ${filename}\nこのPDFから物件情報を抽出してください。` },
          ],
        },
      ],
    });

    const text = message.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // 住所から緯度経度を取得
    if (parsed.address && (!parsed.latitude || !parsed.longitude)) {
      try {
        const geocodeResult = await geocodeAddress(parsed.address);
        if (geocodeResult) {
          parsed.latitude = geocodeResult.latitude;
          parsed.longitude = geocodeResult.longitude;
        }
      } catch (e) {
        console.error("Geocoding error:", e);
        // エラーが発生しても続行
      }
    }

    return res.status(200).json({ data: parsed });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
