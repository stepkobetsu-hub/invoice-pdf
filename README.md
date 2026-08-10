# STEP請求書PDF作成・配信システム

個別指導ステップ専用の請求書PDF作成・配信システムです。管理画面・Google Apps Script・Cloudflareを分離し、個人情報入りPDFは非公開のCloudflare R2に保存します。保護者向けURLはCloudflare Workerが発行し、Google Driveには接続しません。

## 安全上の原則

- PDF・請求書CSV・取引先CSVをGitHubへ保存しない
- PDFをGoogle Driveへ保存しない
- Cloudflare R2バケットを公開しない
- 請求書番号や顧客コードをダウンロードURLへ含めない
- トークンはハッシュ化してCloudflare D1へ保存する
- URLアクセスとPDF取得を別々に記録する
- 本番メール送信は `PRODUCTION_SEND_APPROVED=true` になるまで拒否する
- 管理APIはデプロイURLに加えて管理APIキーで認証する

## 構成

- `index.html`, `assets/`: GitHub Pages用管理画面
- `apps-script/`: Apps Script Web App、Spreadsheet、メールキュー
- `cloudflare/`: Worker、D1マイグレーション、非公開R2配信
- `tests/`: CSV解析、10円丸め、照合、送信前集計の単体テスト

## 初期設定

1. Apps Scriptプロジェクトへ `apps-script/Code.gs`、`Download.html`、`appsscript.json` を登録する。
2. エディタから `setupSystem()` を1回実行して権限を承認する。
3. Cloudflare WorkerへD1の `DB` とR2の `PDFS` をバインドし、`TOKEN_PEPPER` と `ADMIN_API_KEY` をSecretとして設定する。
4. Apps ScriptのScript Propertiesへ `CLOUDFLARE_API_URL` と、Workerと同じ `CLOUDFLARE_ADMIN_API_KEY` を設定する。
5. Webアプリとして「自分として実行」「全員がアクセス可」でデプロイする。Apps Scriptは管理APIとメール送信を担当し、PDF配信はCloudflareだけが担当する。
6. `基本設定` シートの `webAppUrl` をデプロイURLへ更新する。
7. GitHub Pages管理画面の詳細設定へApps ScriptデプロイURLを入力する。Cloudflareの管理APIキーはブラウザへ入力しない。

請求書一覧・通常の保存・編集・入金更新・削除はCloudflare D1へ直接接続します。Apps Scriptは取引先・設定との互換処理、PDF準備、メールキューに限定しています。本番切替順は `cloudflare/README.md` を参照してください。

## PDF金額ルール

最終合計は10円単位へ四捨五入します。消費税額は `丸め後合計 - 税抜小計` とし、帳票内の小計・税・合計を必ず一致させます。

例：税抜25,045円、税計算2,504.5円の場合は、消費税2,505円、合計27,550円です。

## メール送信

初期値は常にテスト送信です。本番送信を有効にするには、E2Eテスト後に管理者が明示承認し、Script Propertiesの `PRODUCTION_SEND_APPROVED` を `true` に変更する必要があります。

## テスト

```text
npm test
npm run check
```
