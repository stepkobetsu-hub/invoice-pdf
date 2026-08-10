# STEP請求書システム 管理台帳

最終確認日: 2026-08-10

このファイルを、STEP請求書システムの名称・URL・反映先を確認するための唯一の入口とします。
似た名前のGoogle Apps Scriptプロジェクトを推測で開かず、必ずこの台帳のリンクから開いてください。

## 1. 本番システム

| 区分 | 正式名称・用途 | URL / 識別子 |
|---|---|---|
| 管理画面 | STEP請求書PDF作成・配信システム | https://stepkobetsu-hub.github.io/invoice-pdf/ |
| GitHub | 管理画面・Apps Script・Cloudflareのソース保管 | https://github.com/stepkobetsu-hub/invoice-pdf |
| Apps Script編集画面 | **STEP請求書PDF作成・配信システム** | https://script.google.com/d/1SnTqPE8bSQKLkiJI6rPo-7WGQDZoqGpwY7LAAox3FFsj3sGstnHf41X1/edit |
| Apps Script Webアプリ | 管理画面からSpreadsheetを読み書きするAPI | https://script.google.com/macros/s/AKfycbwo1DdSQ2eUVVU35v1TqermHTgIEsT1u4U-M_67KfA50VelbHsh28W_pec56OlyBkxqaw/exec |
| 請求書データ | STEP請求書用Spreadsheet | https://docs.google.com/spreadsheets/d/1NXdr3f_GCQ2CAuyy0i_Ap0dC5w4cKRgNbUAfdolTN0Y/edit |
| Cloudflare Worker | PDFの保護配信・管理API | https://step-invoice-api.stepkobetsu.workers.dev |
| Cloudflare D1 | 請求書配信管理DB | `step-invoice-db` / `e92d6d76-04d2-40de-9ddf-8804850402c8` |
| Cloudflare R2 | PDFの非公開保管 | `step-invoice-pdfs` |

## 2. 関連するが、請求書本体とは別のもの

| 区分 | URL / 識別子 | 注意 |
|---|---|---|
| 生徒マスタ | https://docs.google.com/spreadsheets/d/1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk/edit | `☆マスタ`シートを取引先取込で参照するだけ。請求書の保存先ではありません。 |
| スタッフ認証API | `apps-script/Code.gs` の `STEP.AUTH_API` | スタッフログイン確認用です。請求書機能の更新先ではありません。 |
| スタッフ用入口 | https://stepkobetsu-hub.github.io/seiseki-kanri/ | 管理画面へ入るための認証入口です。請求書本体とは別リポジトリです。 |

## 3. 混同禁止

- `請求システム2026NEW`
  - Apps ScriptプロジェクトID: `1aeBIJZEvMuh7fvJNj64hvK-Udq764L0GUO6rlMNP8vZPYukegnA8ItVF`
  - これは請求計算側の別プロジェクトです。
  - **STEP請求書PDF作成・配信システムのコードを貼り付けたり、請求書本番のデプロイ先にしたりしません。**
- `STEP配信システム`、`過去問保管DB`なども別システムです。
- Apps Scriptの一覧画面から名前を見て探さず、上記「Apps Script編集画面」のURLを使います。

## 4. どの変更をどこへ反映するか

| 変更内容 | リポジトリ内の場所 | 本番反映先 |
|---|---|---|
| 画面、ボタン、検索、入力、請求書・領収書プレビュー | `index.html`, `assets/` | GitHub Pages |
| Spreadsheet保存、メール送信、取引先・生徒検索、設定保存 | `apps-script/Code.gs` | 上記の正しいApps Scriptプロジェクト |
| 顧客向けダウンロード画面 | `cloudflare/src/index.js` | Cloudflare Worker |
| PDF保護配信、D1/R2操作 | `cloudflare/` | Cloudflare Worker / D1 / R2 |

## 5. 本番反映の順番

1. ローカルのテストを実行する: `npm test` と `npm run check`
2. `apps-script/Code.gs` の内容を、正しいApps Scriptプロジェクトのメイン`.gs`ファイルへ反映して保存する。
3. Apps Scriptで「デプロイ」→「デプロイを管理」→鉛筆→「新バージョン」→「デプロイ」を行う。
4. Cloudflare対象に変更がある場合、リポジトリのフォルダで次を実行する。
   `npx.cmd wrangler deploy --config cloudflare/wrangler.jsonc`
5. GitHubへ安全に反映し、GitHub Pagesを更新する。
6. 管理画面、保存、メール、顧客向けダウンロードの順に本番確認する。

## 6. 現在の安全設定

- PDF保存先はGoogle Driveではなく、非公開Cloudflare R2です。
- 顧客向けPDFリンクはCloudflare Workerです。
- ダウンロード期限は `PARENT_LINK_TTL_DAYS=180`（180日）です。
- `PRODUCTION_SEND_APPROVED=false` の間、本番宛先への送信は承認されません。
- `TEST_SEND_APPROVED=false` の間、テスト送信も承認されません。
- `ADMIN_API_KEY`、`TOKEN_PEPPER`、Apps Scriptの管理APIキーは秘密情報のため、この台帳やGitHubへ記載しません。

## 7. 作業開始時の確認

作業前に、次の3点だけを確認します。

1. 対象は `stepkobetsu-hub/invoice-pdf` か。
2. Apps ScriptはプロジェクトID `1SnTqPE8bSQKLkiJI6rPo-7WGQDZoqGpwY7LAAox3FFsj3sGstnHf41X1` か。
3. Cloudflare Workerは `step-invoice-api` か。

1つでも違う場合は、その画面では更新作業を進めません。
