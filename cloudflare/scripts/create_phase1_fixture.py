from __future__ import annotations

import base64
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[2]
PDF_PATH = ROOT / "output" / "pdf" / "cloudflare-r2-phase1-test.pdf"
JSON_PATH = ROOT / "cloudflare" / ".private-test-fixture.json"
SQL_PATH = ROOT / "cloudflare" / ".private-test-seed.sql"


def sql(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def create_pdf() -> None:
    PDF_PATH.parent.mkdir(parents=True, exist_ok=True)
    font_path = Path(r"C:\Windows\Fonts\NotoSansJP-VF.ttf")
    pdfmetrics.registerFont(TTFont("NotoSansJP", str(font_path)))

    styles = getSampleStyleSheet()
    title = ParagraphStyle("TitleJP", parent=styles["Title"], fontName="NotoSansJP", fontSize=22, leading=30, textColor=colors.HexColor("#173E6B"), alignment=TA_CENTER)
    body = ParagraphStyle("BodyJP", parent=styles["BodyText"], fontName="NotoSansJP", fontSize=11, leading=18, textColor=colors.HexColor("#24364B"))
    small = ParagraphStyle("SmallJP", parent=body, fontSize=9, leading=14, textColor=colors.HexColor("#52677F"))

    doc = SimpleDocTemplate(str(PDF_PATH), pagesize=A4, rightMargin=22 * mm, leftMargin=22 * mm, topMargin=22 * mm, bottomMargin=22 * mm, title="STEP Cloudflare R2 Phase 1 Test")
    story = [
        Paragraph("個別指導ステップ", title),
        Spacer(1, 8 * mm),
        Paragraph("Cloudflare R2 配信基盤 - 第1段階テストPDF", body),
        Spacer(1, 5 * mm),
        Table(
            [
                ["テスト種別", "架空データによるWorker経由取得"],
                ["請求書番号", "CF-TEST-0001"],
                ["宛名", "架空テスト保護者 様"],
                ["保存先", "非公開R2バケット"],
                ["メール送信", "実施しない"],
            ],
            colWidths=[42 * mm, 104 * mm],
            style=TableStyle([
                ("FONTNAME", (0, 0), (-1, -1), "NotoSansJP"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EAF1F8")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#24364B")),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#B8C7D9")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
            ]),
        ),
        Spacer(1, 8 * mm),
        Paragraph("このPDFには実在する顧客の氏名、住所、メールアドレス、請求金額を含みません。Google Drive、Google Apps Script、R2の公開URLを使用せず、Cloudflare Workerからのみ取得する検証用です。", small),
    ]
    doc.build(story)


def create_fixture() -> None:
    create_pdf()
    pdf_bytes = PDF_PATH.read_bytes()
    token = base64.urlsafe_b64encode(secrets.token_bytes(48)).rstrip(b"=").decode("ascii")
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expires = now + timedelta(days=60)
    values = {
        "token": token,
        "masked_token": f"{token[:4]}...{token[-4:]}",
        "token_hash": token_hash,
        "object_key": f"invoices/2026/08/{secrets.token_hex(24)}.pdf",
        "pdf_path": str(PDF_PATH),
        "pdf_sha256": pdf_hash,
        "pdf_size": len(pdf_bytes),
        "issued_at": now.isoformat().replace("+00:00", "Z"),
        "expires_at": expires.isoformat().replace("+00:00", "Z"),
    }
    JSON_PATH.write_text(json.dumps(values, ensure_ascii=False, indent=2), encoding="utf-8")

    statements = [
        "PRAGMA foreign_keys = ON",
        "DELETE FROM download_events WHERE delivery_id = 'delivery-cf-test-0001'",
        "DELETE FROM deliveries WHERE delivery_id = 'delivery-cf-test-0001'",
        "DELETE FROM invoice_items WHERE invoice_id = 'invoice-cf-test-0001'",
        "DELETE FROM invoices WHERE invoice_id = 'invoice-cf-test-0001'",
        "DELETE FROM partners WHERE partner_id = 'partner-cf-test-0001'",
        "INSERT INTO partners(partner_id, customer_code, name, honorific, email, delivery_suspended, created_at, updated_at) VALUES ('partner-cf-test-0001', 'CF-TEST-001', '架空テスト保護者', '様', 'noreply@example.invalid', 0, datetime('now'), datetime('now'))",
        f"INSERT INTO invoices(invoice_id, invoice_number, partner_id, issue_date, subtotal, tax, total, status, r2_object_key, pdf_sha256, pdf_size, created_at, updated_at) VALUES ('invoice-cf-test-0001', 'CF-TEST-0001', 'partner-cf-test-0001', date('now'), 10000, 1000, 11000, 'pdf_ready', {sql(values['object_key'])}, {sql(pdf_hash)}, {len(pdf_bytes)}, datetime('now'), datetime('now'))",
        "INSERT INTO invoice_items(item_id, invoice_id, line_number, description, unit_price, quantity, unit, amount, tax_rate) VALUES ('item-cf-test-0001', 'invoice-cf-test-0001', 1, '架空テスト授業料', 10000, 1, '式', 10000, 0.10)",
        f"INSERT INTO deliveries(delivery_id, invoice_id, recipient_email, token_hash, issued_at, expires_at, status, created_by, created_at, updated_at) VALUES ('delivery-cf-test-0001', 'invoice-cf-test-0001', 'noreply@example.invalid', {sql(token_hash)}, {sql(values['issued_at'])}, {sql(values['expires_at'])}, 'sent', 'phase1-fixture', datetime('now'), datetime('now'))",
        f"INSERT OR REPLACE INTO managed_files(file_id, module_id, storage_binding, object_key, media_type, byte_size, content_sha256, visibility, created_by, created_at) VALUES ('file-cf-test-0001', 'module-invoice', 'PDFS', {sql(values['object_key'])}, 'application/pdf', {len(pdf_bytes)}, {sql(pdf_hash)}, 'private', 'phase1-fixture', datetime('now'))",
        f"INSERT OR REPLACE INTO access_tokens(access_token_id, module_id, resource_type, resource_id, token_hash, issued_at, expires_at, created_by) VALUES ('token-cf-test-0001', 'module-invoice', 'invoice_delivery', 'delivery-cf-test-0001', {sql(token_hash)}, {sql(values['issued_at'])}, {sql(values['expires_at'])}, 'phase1-fixture')",
    ]
    SQL_PATH.write_text(";\n".join(statements) + ";\n", encoding="utf-8")


if __name__ == "__main__":
    create_fixture()
