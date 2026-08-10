# 銀行入金確認・請求書消込

## 現在の状態

機能ブランチ `feature/bank-payment-reconciliation` で実装中。本番には未反映。
2026-08-10提供の実CSVで、CP932、ヘッダーなしの固定レコード形式であることを確認した。

- `1`: 口座ヘッダー
- `2`: 明細（20列）
- `8`: 入出金集計
- `9`: 終端
- 明細5列目: `1` 入金、`2` 出金
- 明細7列目: 金額
- 明細15列目: 振込人名義
- 明細16・17列目: 取扱銀行・支店
- 日付は和暦年 `YYMMDD`（令和8年は2026年）

## 構成

1. SMBC Web21 CSV importer（CP932/UTF-8判定、固定レコード検証）
2. 正規化済み銀行明細API
3. D1の `bank_transactions`
4. `InvoiceMatchingService` 相当の純粋関数（候補順位）
5. 人による承認・取消・対象外処理

銀行APIへ移行する場合は、1だけをAPI importerへ差し替え、2以降を共用する。

## D1 migration

`cloudflare/migrations/0005_bank_payment_reconciliation.sql`

- `bank_import_batches`: CSV取込単位とファイルhash
- `bank_transactions`: 原本摘要、名義、正規化名義、入出金、安定fingerprint、処理状態
- `invoice_payment_matches`: 候補・確定・取消
- `payer_aliases`: 過去に承認した保護者等の名義
- `payment_match_audit_logs`: 確定、取消、対象外、解除の監査履歴

銀行ログイン情報は保存しない。口座識別子はSHA-256 hashだけを保存する。

## 安全条件

- 出金は登録対象外。
- fingerprintとファイルhashの両方で重複を防ぐ。
- 自動で入金済みにしない。
- 第一段階では金額完全一致だけ承認可能。不一致は要確認。
- 取消時も銀行明細と監査ログは削除しない。
- 対象外は物理削除せず、解除可能。
- APIは既存スタッフ認証と `APP_ORIGIN` 制限の内側に置く。
- CSVの内容をlocalStorageへ保存しない。

## 本番反映手順（実CSV確認後）

1. 実CSVの個人情報を必要に応じて伏せた検証用コピーで、ヘッダー・区切り・改行・文字コードを確認する。
2. SMBC importerとfixture試験を追加する。
3. 同一CSV再読込、出金除外、候補順位、承認、取消、対象外、別名学習をステージングD1で試験する。
4. 既存の請求書作成・保存・PDF・メール・一覧・領収書の回帰試験を実施する。
5. D1をバックアップし、migrationを適用する。
6. Worker、管理画面の順に反映し、ヘルスチェックと実画面確認を行う。
7. GitHub正本と `SYSTEM_LEDGER.md` を本番値で更新する。

## 復旧

管理画面を直前コミットへ戻し、Workerを直前デプロイへロールバックする。追加テーブルは既存テーブルを変更しないため、緊急復旧時は残置できる。migrationの逆適用でデータを消さず、必要ならバックアップから別DBへ復元して照合する。
