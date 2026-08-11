# STEP請求書システム 管理台帳

最終確認日: 2026-08-12

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
| Cloudflare Worker | PDFの保護配信・管理API・請求CSV一時受け渡しAPI | https://step-invoice-api.stepkobetsu.workers.dev |
| Cloudflare D1 | 請求書配信管理DB | `step-invoice-db` / `e92d6d76-04d2-40de-9ddf-8804850402c8` |
| Cloudflare R2 | PDFの非公開保管 | `step-invoice-pdfs` |

## 2. 連携する請求管理システム

| 区分 | 正式名称・用途 | URL / 識別子 |
|---|---|---|
| Apps Scriptプロジェクト | **請求システム2026NEW**（請求計算・CSV生成側の正本） | Project ID: `1FQElz87j5yB-FNwuDE9LJ3_nD8rzF_vIGTTWKDr15KDygGxXnZLlXhIp` |
| Apps Script編集画面 | 請求管理システム正本 | https://script.google.com/home/projects/1FQElz87j5yB-FNwuDE9LJ3_nD8rzF_vIGTTWKDr15KDygGxXnZLlXhIp/edit |
| Apps Script Webアプリ | 請求管理画面 | https://script.google.com/macros/s/AKfycbxzkE1tQRyB_Ca4bfPKYWIkpTukIVPMWKf2ETE7yN7qROJk0VyOlvxaJ9GGI5p-6pGb/exec |
| デプロイID | 既存URLを維持する対象 | `AKfycbxzkE1tQRyB_Ca4bfPKYWIkpTukIVPMWKf2ETE7yN7qROJk0VyOlvxaJ9GGI5p-6pGb` |
| 現行バージョン | 外部通信権限修正を含む | バージョン67（2026-08-12） |
| CSV生成関数 | PDFシステム用CSVの正本処理 | `billingImpl_exportInvoiceDeliveryCsvDataFromPanel_()` |

CSV自動受け渡しでは、既存CSV生成関数を直接呼びます。CSV列、文字コード、並び順、値加工を別実装へ複製しません。

## 3. 関連するが、請求書本体とは別のもの

| 区分 | URL / 識別子 | 注意 |
|---|---|---|
| 生徒マスタ | https://docs.google.com/spreadsheets/d/1CIJkTlYUcUkbb8jBdFc6L8D5ubTGsxwNxFv01ten-Zk/edit | `☆マスタ`シートを取引先取込で参照するだけ。請求書の保存先ではありません。 |
| スタッフ認証API | `apps-script/Code.gs` の `STEP.AUTH_API` | スタッフログイン確認用です。請求書機能の更新先ではありません。 |
| スタッフ用入口 | https://stepkobetsu-hub.github.io/seiseki-kanri/ | 管理画面へ入るための認証入口です。請求書本体とは別リポジトリです。 |

## 4. 混同禁止

- Project ID `1aeBIJZEvMuh7fvJNj64hvK-Udq764L0GUO6rlMNP8vZPYukegnA8ItVF`
  - 2026-08-12時点の「請求システム2026NEW」正本ではありません。
  - 請求管理側を変更するときは、必ず上記のProject ID `1FQElz87j5yB-FNwuDE9LJ3_nD8rzF_vIGTTWKDr15KDygGxXnZLlXhIp` を使用します。
- PDFシステム側Apps ScriptのProject IDは `1SnTqPE8bSQKLkiJI6rPo-7WGQDZoqGpwY7LAAox3FFsj3sGstnHf41X1` です。請求管理側Project IDと取り違えません。
- `STEP配信システム`、`過去問保管DB`なども別システムです。
- Apps Scriptの一覧画面から名前だけで探さず、この台帳の編集URLを使用します。

## 5. どの変更をどこへ反映するか

| 変更内容 | リポジトリ・プロジェクト内の場所 | 本番反映先 |
|---|---|---|
| 画面、ボタン、検索、入力、請求書・領収書プレビュー | `index.html`, `assets/` | GitHub Pages |
| Spreadsheet保存、メール送信、取引先・生徒検索、設定保存 | `apps-script/Code.gs` | PDFシステム側Apps Script |
| 顧客向けダウンロード画面 | `cloudflare/src/index.js` | Cloudflare Worker |
| PDF保護配信、D1/R2操作、CSV受け渡しAPI | `cloudflare/` | Cloudflare Worker / D1 / R2 |
| 請求内容作成、PDF用CSV生成、自動受け渡しボタン | `コード.gs`, `BillingV31_Auth.gs`, `BillingV31_Index.html`, `appsscript.json` | 請求管理側Apps Script |

## 6. 請求CSV自動受け渡し

### 操作フロー

1. 請求管理システムで次月分の請求内容を完成させる。
2. 「請求書PDF作成・配信へ進む」を押す。
3. 既存の「STEP請求書PDF作成・配信システム用CSV」と同じ内容をWorkerへ短期保存する。
4. URLには受け渡しIDだけを付けてPDFシステムを開く。
5. PDFシステムが受け渡しIDに一致するCSVを1回だけ取得する。
6. 既存の `parseCsv()` → `parseInvoiceRows()` → 請求書保存処理へ渡す。
7. 「YYYY年M月分・N件を請求管理システムから受け取りました」と表示する。

### 保存・安全仕様

- D1テーブル: `invoice_transfers`
- マイグレーション: `cloudflare/migrations/0005_invoice_transfers.sql`
- 保存項目: 受け渡しID、対象年月、作成日時、件数、CSV本体、有効期限、取込日時
- 有効期限: 30分
- GAS保存API: `POST /api/transfers`
- PDF側1回取得API: `GET /api/app/transfers/:transferId`
- GAS保存APIはWorker secret `TRANSFER_INGEST_SECRET` で保護する。値は台帳・GitHubへ記載しない。
- PDF側取得APIは既存スタッフ認証を使用する。
- 同一IDはD1の条件付き更新により1回だけ取得でき、2回目はHTTP 410で拒否する。
- 取込前に受け渡しID、対象年月、作成日時、件数、CSV件名の年月を検証する。
- 既存の手動「CSV一括追加」は残す。
- リコーリースCSVは変更しない。

## 7. 本番反映の順番

1. ローカルテストを実行する: `npm test` と `npm run check`
2. D1変更がある場合はマイグレーションを先に適用する。
3. Worker secretを変更する場合、請求管理側Script Propertiesと同じ値へ同期する。秘密値はログやGitHubへ出さない。
4. Cloudflare対象に変更がある場合、`cloudflare/` でWorkerをデプロイする。
5. GitHubへ反映し、GitHub Pagesを更新する。
6. 請求管理側Apps Scriptを保存し、「デプロイを管理」から既存デプロイの新バージョンとして更新する。新規デプロイを作らない。
7. 請求管理画面、CSV保存、PDFシステム自動取込、件数・対象月、二重取込拒否、手動CSV取込の順に本番確認する。

## 8. Apps Scriptの権限

請求管理側は `UrlFetchApp.fetch` でWorkerへ送信するため、`appsscript.json` の `oauthScopes` に次を含めます。

- `https://www.googleapis.com/auth/script.external_request`

既存機能に必要なSpreadsheet、Document、Drive、Gmail送信、コンテナUI、ユーザー情報のスコープも同時に維持します。
このスコープがない状態では、許可画面を繰り返した後に「UrlFetchApp.fetch を呼び出す権限がありません」と表示されます。2026-08-12にマニフェストへ明示し、バージョン67へ更新済みです。

## 9. 現在の安全設定

- PDF保存先はGoogle Driveではなく、非公開Cloudflare R2です。
- 顧客向けPDFリンクはCloudflare Workerです。
- ダウンロード期限は `PARENT_LINK_TTL_DAYS=180`（180日）です。
- `PRODUCTION_SEND_APPROVED=false` の間、本番宛先への送信は承認されません。
- `TEST_SEND_APPROVED=false` の間、テスト送信も承認されません。
- `ADMIN_API_KEY`、`TOKEN_PEPPER`、`TRANSFER_INGEST_SECRET`、Apps Scriptの管理APIキーは秘密情報のため、この台帳やGitHubへ記載しません。

## 10. 2026-08-12反映記録

- GitHub PR: https://github.com/stepkobetsu-hub/invoice-pdf/pull/23
- マージSHA: `0b641203efb219608dd6860cfe38afdc007ae339`
- Worker: `step-invoice-api`
- D1マイグレーション `0005_invoice_transfers.sql`: 適用済み
- 請求管理側Apps Script: 既存デプロイIDを維持してバージョン67へ更新
- 本番ダミーCSV 1件で、CSV選択なしの自動取込、年月・件数表示、同一IDの再取込拒否、手動CSV取込の残存を確認
- 検証用ダミー請求書は確認後に削除済み

## 11. 作業開始時の確認

作業前に、次の4点を確認します。

1. PDFシステムのGitHubは `stepkobetsu-hub/invoice-pdf` か。
2. PDFシステム側Apps ScriptはProject ID `1SnTqPE8bSQKLkiJI6rPo-7WGQDZoqGpwY7LAAox3FFsj3sGstnHf41X1` か。
3. 請求管理側Apps ScriptはProject ID `1FQElz87j5yB-FNwuDE9LJ3_nD8rzF_vIGTTWKDr15KDygGxXnZLlXhIp` か。
4. Cloudflare Workerは `step-invoice-api` か。

1つでも違う場合は、その画面では更新作業を進めません。
