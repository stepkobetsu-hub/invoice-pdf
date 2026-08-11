from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
old = '<button id="brandHome" class="brand brand-home" type="button" aria-label="請求書一覧へ戻る"><img src="assets/step-logo.png?v=20260802-logo" alt="個別指導ステップ"><div><strong>STEP請求書</strong><span>PDF作成・配信システム</span></div></button>'
new = '<a id="brandHome" class="brand brand-home" href="./" aria-label="請求書一覧へ戻る"><img src="assets/step-logo.png?v=20260802-logo" alt="個別指導ステップ"><div><strong>STEP請求書</strong><span>PDF作成・配信システム</span></div></a>'
if old not in s:
    raise SystemExit('MISSING:brand-button')
s = s.replace(old, new, 1)
s = s.replace('assets/app.js?v=20260811-invoice-home', 'assets/app.js?v=20260811-brand-link')
p.write_text(s, encoding='utf-8')
print('brand link fixed')
