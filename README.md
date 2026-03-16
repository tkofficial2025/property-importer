# 不動産PDFインポーター

REINS・いえらぶ・ATBBなどの物件PDFをAIで自動解析してSupabaseに保存するツールです。

## セットアップ

### 1. 依存パッケージのインストール

```bash
npm install
```

### 2. 環境変数の設定

`.env.local` を編集して各キーを入力してください：

```
ANTHROPIC_API_KEY=sk-ant-ここにキーを貼る
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJここにキーを貼る
NEXT_PUBLIC_SUPABASE_TABLE=properties
```

- **ANTHROPIC_API_KEY**: https://console.anthropic.com で取得
- **NEXT_PUBLIC_SUPABASE_URL**: Supabase > Project Settings > API > Project URL
- **NEXT_PUBLIC_SUPABASE_ANON_KEY**: Supabase > Project Settings > API > anon public key

### 3. 起動

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開いてください。

## 使い方

1. PDFをドラッグ＆ドロップ（複数可）
2. 「解析開始」をクリック
3. 抽出結果を確認・編集
4. 「Supabaseに保存する」で完了

## 対応フォーマット

- REINS
- いえらぶ
- ATBB
- その他の不動産物件PDF（様式問わず）
