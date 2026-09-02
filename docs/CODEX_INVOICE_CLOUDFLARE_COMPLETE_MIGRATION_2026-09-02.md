# 2つの請求システムをCloudflareへ完全統合する実装指示（2026-09-02）

## 目的

次の2システムを、1つの「請求システム」としてCloudflareへ統合する。

1. 請求管理システム（料金特別調整、請求データ、入金管理）
2. 請求書配信・PDF作成システム（請求書／領収書作成、PDF保存、メール配信、開封・取得状態）

成績管理・フォレスタ進捗管理のSupabase移行には触れない。

## 対象リポジトリ

### 統合先・正本

- `stepkobetsu-hub/invoice-pdf`
- 本番画面: `https://stepkobetsu-hub.github.io/invoice-pdf/`

### 現在の料金特別調整入口

- `stepkobetsu-hub/seiseki-kanri/billing_adjustment.html`
- 現在は Apps Script の `?page=adjustments` を iframe で表示
- 既存URLを壊さず、統合後は新しいCloudflare対応画面へ転送または互換表示する

### 資産管理台帳

- `stepkobetsu-hub/step-system-registry`
- 「請求システム」カードに最終構成・保存先・復旧方法を反映する

## 既に存在するCloudflare本番基盤

新規Cloudflareアカウントや新規Supabase projectを作らない。次を継続使用する。

- Worker: `step-invoice-api`
- Worker URL: `https://step-invoice-api.stepkobetsu.workers.dev`
- D1: `step-invoice-db`
- D1 database id: `e92d6d76-04d2-40de-9ddf-8804850402c8`
- R2: `step-invoice-pdfs`
- Wrangler: `cloudflare/wrangler.jsonc`
- GitHub Actions: `.github/workflows/deploy-cloudflare-worker.yml`
- health: `/health`

GitHub ActionsからCloudflareへの自動公開は接続確認済み。APIトークンや秘密値はGitHub、Issue、PR、ログへ書かない。

## 現状

### Cloudflareへ移行済みの部分

- 請求書一覧・保存・編集・入金状態・論理削除のD1処理
- PDFのR2保存・取得
- ランダムトークンによる保護URL
- メール開封／URL開封／PDF取得状態
- 監査ログ、レート制限、緊急停止フラグ
- スタッフセッション確認後の `/api/app/*`
- GitHub Actionsによるテスト・Worker公開

### Apps Script／Google側に残っている部分

Workerの `/api/app/apps-script` が現在中継している以下を棚卸しする。

- 取引先取得・取込・削除・生徒からの取引先作成
- 設定保存
- PDF作成の既存オーケストレーション
- 請求書・領収書の旧保存
- メールキュー、再送、配信診断
- 料金特別調整
- Google Sheetの既存請求・調整データ

スタッフ共通認証は共有基盤なので、今回の「請求データ完全移行」後も外部認証として利用してよい。ただし請求業務データの正本をGASへ残さない。

## 最終構成

| 役割 | 最終保存先・処理 |
|---|---|
| 請求書、明細、料金調整、割引、教材費、入金状態 | D1 |
| 取引先、請求設定、送信先、配信履歴、監査ログ | D1 |
| 請求書PDF・領収書PDF | 非公開R2 |
| API、権限確認、保存、配信制御 | Worker `step-invoice-api` |
| PDF生成 | ブラウザー生成＋Workerへ安全にアップロード、または既存品質を保てるCloudflare側方式 |
| メール配信 | Workerからメール提供事業者へ。大量送信は非同期キュー化 |
| 画面 | GitHub Pages |
| Google Sheet | 移行確認期間中だけバックアップ／照合／ロールバック用 |

D1とR2は二重保存ではない。D1は文字・数字・状態、R2はPDFファイルを保存する。

## 必須の事前調査

実装前に次を行い、PR本文へ結果を書く。

1. `invoice-pdf` の全画面・全API action・全D1 migrationを一覧化
2. Apps Script側の請求、領収書、取引先、設定、配信キュー、料金調整の正本コードと使用Sheetを特定
3. 料金特別調整 Apps Script の正本リポジトリ／プロジェクトを特定
4. 現在のGoogle Sheet各シートの件数・自然キー・重複・空欄を読み取り専用で集計
5. D1の現行件数、schema、migration適用状態を確認
6. 現在のメール提供事業者、送信元、Webhook、テンプレート、再送仕様を秘密値を表示せず確認
7. 既存PDFのレイアウト、複数ページ、負数明細、領収書、ファイル名を確認
8. 既存利用URLと台帳リンクを確認

正本が特定できない項目を推測で作らない。Issueへ「要確認」と報告する。

## D1データ設計

既存migrationを壊さず、追加migrationとして実装する。最低限、次の概念を一貫して扱う。

- partners
- invoices
- invoice_items
- billing_adjustments
- receipts
- invoice_pdfs / files
- deliveries
- delivery_events
- delivery_jobs
- settings
- operation_logs
- migration_runs

### 料金調整

- 対象年月
- 生徒／取引先コード
- 調整種別
- 金額（割引は負数可）
- 数量
- 税率
- 摘要
- 登録日時・更新日時・登録者
- 適用済み請求書番号
- 取消状態

同じ調整が複数請求書へ重複適用されない制約を設ける。年月と生徒を選ぶと請求書作成画面へ自動反映できるようにする。

### インデックス

一覧、対象月、取引先、支払期限、入金状態、配信状態、更新日時、調整未適用検索に必要なインデックスを追加する。全表走査を繰り返さない。

## 認証・権限

- ブラウザーへ `ADMIN_API_KEY`、メールAPIキー、トークンpepper等を渡さない
- 既存STEP共通スタッフセッショントークンをWorkerで検証
- 読取・編集・送信・設定変更・移行実行の権限を分離
- 設定変更、移行、本番送信は管理者だけ
- CORSは既存の固定GitHub Pages originを維持
- SQLはprepared statementsを使用
- PDFのR2 bucketは公開しない
- 公開ダウンロードはopaque tokenのhashのみD1へ保存
- 不明・期限切れ・失効トークンは同一応答にする
- 個人情報、秘密値、トークン、メールAPI応答本文細をログへ残さない
- 監査ログには操作者、操作、対象番号、時刻、結果だけを安全に記録

## PDF

- 現行A4レイアウトを変えない
- 複数ページ請求書、ページ番号、負数明細、税率別集計、振込先、備考を維持
- 請求書と領収書を区別
- 保存前にinvoice内容のsnapshotとPDFの対応を保証
- 同じ請求書番号の再生成はversion管理または明確な置換履歴を残す
- R2 keyを利用者入力から直接組み立てない
- PDF取得回数、期限、失効、再発行を維持
- Google Driveを本番PDF保存先にしない

## メール配信

### 最重要安全条件

本番メール送信を、実装・migration・通常テストの一部として実行しない。

- `PRODUCTION_SEND_APPROVED=false`
- `TEST_SEND_APPROVED=false`
- `EMERGENCY_STOP` 等の既存安全装置を維持
- 本番送信有効化は、PRマージ・データ照合・管理者の明示承認後の別工程
- 実在の保護者メールアドレスをテスト送信先にしない
- APIキーをGitHubへ書かない

### 実装要件

- 一括送信を1リクエスト内で完結させず、非同期jobとして処理
- D1 outbox＋Cron、または利用可能なCloudflare Queueを使用
- 新たな有料契約が必要な構成は、作成前に費用と必要性をIssueへ報告して承認を待つ
- 冪等キーで二重送信を防止
- retry回数、次回時刻、最終エラー、provider message idを保存
- 100件送信時の進捗、成功、失敗、再送対象を画面表示
- Webhook署名を検証
- delivered、bounced、opened、clicked等をD1へ記録
- 無効化・再送・リンク再発行の履歴を残す
- 送信直前に対象件数、宛先欠損、PDF有無、金額異常をpreflight確認

## 移行方法

1. Google SheetとD1をバックアップ
2. 追加migrationをローカル試験
3. 読取専用import dry-run
4. 件数・自然キー・重複・金額合計を比較
5. 冪等importを実行
6. 代表レコードを照合
7. D1読取へ切替
8. テストデータのみで書込確認
9. Google Sheetへの互換mirrorを一定期間維持
10. 1〜2回の実請求運用後、問題がなければGoogle側を正本から外す

全削除→全投入を行わない。途中失敗後に安全に再実行できるcheckpointとmigration run記録を持たせる。

## 画面統合

最終的に1つの「請求システム」内で次を明確に分ける。

### 請求管理

- 対象年月選択
- 料金調整の追加・編集・取消
- 請求データ作成
- 入金状態
- 月別一覧・検索

### 請求書配信・PDF作成

- 請求書／領収書作成
- PDFプレビュー・保存
- 配信対象確認
- 送信・再送
- 配信・開封・取得状態

既存入口の名称を維持する。

- 「請求管理システムを開く」
- 「請求書配信・PDF作成システムを開く」

料金特別調整の既存URLは急に削除せず、新Cloudflare画面への互換導線を残す。

## テスト

最低限、以下を自動化する。

1. 未認証・権限不足を拒否
2. CORS origin制限
3. 請求書CRUD
4. 負数明細・税計算
5. 料金調整CRUDと重複適用防止
6. 調整→請求書への反映
7. 入金更新
8. 論理削除・復元／リンク失効
9. PDF upload/download/期限/回数制限
10. 請求書・領収書の複数ページ
11. 配信jobの冪等性
12. retryと失敗記録
13. Webhook署名
14. 本番送信flagがfalseなら必ず送信拒否
15. migration dry-runと再実行
16. Google SheetとD1の件数・金額合計照合
17. 既存 `npm test` と `npm run check`
18. GitHub Actions deploy
19. 公開 `/health` の正常応答
20. 既存画面の主要操作

## 作業手順

1. mainを最新化
2. 専用branchを作成
3. 調査結果と移行表をdocsへ追加
4. D1追加migration
5. Worker API
6. 画面統合
7. dry-run import
8. 自動テスト
9. ダミーデータE2E
10. PR作成
11. PR本文にバックアップ、移行件数、差分、未確認事項、ロールバック方法、送信flag状態を記載
12. mainへは自動マージしない
13. 本番メール送信を有効化しない

## 完了条件

- 2つの請求システムの業務データ正本がD1に統一される
- PDF正本が非公開R2に統一される
- 日常操作で請求GAS／Google Sheetを正本として待たない
- 生徒・取引先・料金調整・請求書・領収書・入金・配信状態が一貫する
- 既存URLから新画面へ到達できる
- データ照合と全テストが成功する
- Google側はバックアップ／ロールバックとして残る
- 本番送信は無効のまま
- PRが作成され、管理者確認待ちになっている
