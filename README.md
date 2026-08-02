# STEP請求書PDF作成・配信システム

個別指導ステップ専用の請求書PDF作成・配信システムです。公開フロントエンドとGoogle Apps Scriptバックエンドを分離し、個人情報入りPDFは非公開のGoogle Driveにだけ保存します。

## 安全上の原則

- PDF・請求書CSV・取引先CSVをGitHubへ保存しない
- Driveファイルを公開共有しない
- 請求書番号や顧客コードをダウンロードURLへ含めない
- トークンはハッシュ化してSpreadsheetへ保存する
- URLアクセスとPDF取得を別々に記録する
- 本番メール送信は `PRODUCTION_SEND_APPROVED=true` になるまで拒否する
- 管理APIはデプロイURLに加えて管理APIキーで認証する

## 構成

- `index.html`, `assets/`: GitHub Pages用管理画面
- `apps-script/`: Apps Script Web App、Spreadsheet、Drive、メールキュー
- `tests/`: CSV解析、10円丸め、照合、送信前集計の単体テスト

## 初期設定

1. Apps Scriptプロジェクトへ `apps-script/Code.gs`、`Download.html`、`appsscript.json` を登録する。
2. エディタから `setupSystem()` を1回実行して権限を承認する。
3. 実行結果のSpreadsheet URL、DriveフォルダID、管理APIキーを安全な場所へ保存する。
4. Webアプリとして「自分として実行」「全員がアクセス可」でデプロイする。ダウンロードページはトークンで保護され、管理APIは別の管理APIキーで保護される。
5. `基本設定` シートの `webAppUrl` をデプロイURLへ更新する。
6. GitHub Pages管理画面の基本設定へデプロイURLと管理APIキーを入力する。

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
