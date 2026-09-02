# Issue #27 Cloudflare完全統合 実装・移行記録

作成日: 2026-09-02  
対象: `stepkobetsu-hub/invoice-pdf`  
本番基盤: Worker `step-invoice-api` / D1 `step-invoice-db` / 非公開R2 `step-invoice-pdfs`

## 安全状態

- `PRODUCTION_SEND_APPROVED=false`
- `TEST_SEND_APPROVED=false`
- `EMERGENCY_STOP`、公開PDF停止、PDF upload停止、管理API停止の既存ゲートを維持
- 本番保護者メールへの送信は未実施
- 秘密値・個人情報・opaque tokenはコード、テスト、ログ、本文へ記録していない
- 新しいCloudflareアカウント、D1、R2、Supabaseは作成していない

## 事前棚卸し

### 画面

`index.html` は請求書作成、請求書一覧、領収書一覧、取引先、配信履歴、基本設定、メール設定を提供する。Issue #27で同じ画面へ「料金特別調整」を追加した。既存の「請求書配信・PDF作成システム」の名称とURLは維持する。

### Worker API

既存: health、スタッフ用請求書dashboard/CRUD/入金/論理削除、Apps Script互換proxy、PDF upload、配信URL発行・更新・失効、公開PDF取得、メールprovider webhook、移行用請求書import。  
追加: D1取引先取得・保存・論理取消、D1設定取得・保存、料金調整CRUD、読取専用migration dry-runとmigration run記録。

### Apps Script actionと使用Sheet

旧 `apps-script/Code.gs` のactionは `getDashboard`、`getSupportData`、`importPartners`、`deletePartner`、`findStudentForPartner`、`savePdf`、請求書・領収書保存、入金、配信queue、再送、診断、設定保存など。使用Sheetは以下の12個。

- 取引先マスタ
- 基本設定
- メール定型文
- 請求書データ
- 請求書明細
- 請求書配信履歴
- ダウンロード履歴
- 操作ログ
- ユーザー権限
- 送信キュー
- 領収書データ
- 領収書明細

請求画面の取引先と設定はD1 APIへ切替済み。生徒マスタ参照は共通外部マスタなので互換proxyを維持する。メールprovider送信は、安全なWorker側job consumerと本番承認が揃うまで既存互換経路を残すが、請求業務データの正本とはしない。

### D1 migration

既存 `0001`〜`0007` を保持し、`0008_complete_invoice_integration.sql` を追加した。追加・拡張対象:

- `partners` の請求実務列と論理削除
- `billing_adjustments`
- `receipts` / `receipt_items`
- `delivery_jobs` / `delivery_job_items`
- `delivery_events`
- `migration_runs`
- 月、取引先、支払期限、入金状態、未適用調整、配信job、再試行、migration履歴用index

全削除・全投入は行わない。自然キー／idempotency keyのupsertとmigration runで安全に再実行する。

## 料金調整

対象年月、顧客コード、調整種別、符号付き金額、数量、税率、摘要、操作者、作成・更新時刻、適用請求書、取消状態をD1へ保存する。未適用検索用indexを持ち、`applied_invoice_id` により一度適用した調整を判別する。取消は物理削除しない。

## PDFと配信

既存A4ブラウザー生成を維持し、PDF本体は非公開R2、請求内容snapshotと状態はD1に保存する。公開URLはopaque tokenのみを含み、D1にはhashだけを保存する。R2 keyはWorkerが乱数から作成する。メールはD1のjob/item/event構造で冪等性、進捗、retry、provider id、最終エラーを保持できるようにした。送信フラグは両方falseのため、通常テストで送信されない。

## 検証結果

- Wrangler 4.127.1
- ローカルD1へ `0001`〜`0008` を順番に適用: 成功
- 既存テスト: 全ファイル成功
- 追加 `complete-integration.test.mjs`: 成功
- `node --check` 対象全JS: 成功
- `git diff --check`: 成功
- 本番 `/health`: `ok=true`, service=`step-invoice-api`, storage=`cloudflare-r2`

## 本番移行前に残る確認

ローカル実行環境にはCloudflare API tokenが渡されていないため、リモートD1のexport、件数・金額集計、migration適用は実施していない。GitHub ActionsはPRではテストだけを実行し、mainへのpush時だけD1 export（非公開artifact、7日保持）→migration適用→Worker deployの順で実行するよう更新した。PRマージ前後の保護された工程で次を行う。

1. D1 exportを非公開artifactへ保存
2. Google Sheetを管理者権限でバックアップ
3. 各Sheetの件数、自然キー重複、空欄、金額合計を秘密値を出さず集計
4. D1の同じ集計と照合
5. `0008` を適用し、dry-run、冪等import、代表レコード照合
6. ダミー取引先・ダミー請求だけで書込・PDF・取消を確認
7. 本番メール送信はfalseのまま拒否されることを再確認

## ロールバック

WorkerはCloudflareの直前versionへrollbackする。D1は事前exportから復元し、画面は直前Git commitへ戻す。Google Sheetは照合・一時mirrorとして残しているため、D1データを削除せず読取切替で復旧する。本番メール送信は別承認まで有効化しない。
