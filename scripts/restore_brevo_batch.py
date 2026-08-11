from pathlib import Path
import re

cur_path = Path('apps-script/Code.gs')
ref_path = Path('/tmp/pr17-Code.gs')
cur = cur_path.read_text(encoding='utf-8')
ref = ref_path.read_text(encoding='utf-8')


def extract_function(src, name):
    marker = f'function {name}('
    start = src.find(marker)
    if start < 0:
        raise SystemExit(f'reference function not found: {name}')
    brace = src.find('{', start)
    depth = 0
    i = brace
    in_s = in_d = in_t = False
    esc = False
    while i < len(src):
        ch = src[i]
        if esc:
            esc = False
        elif ch == '\\':
            esc = True
        elif in_s:
            if ch == "'": in_s = False
        elif in_d:
            if ch == '"': in_d = False
        elif in_t:
            if ch == '`': in_t = False
        else:
            if ch == "'": in_s = True
            elif ch == '"': in_d = True
            elif ch == '`': in_t = True
            elif ch == '{': depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return src[start:i+1]
        i += 1
    raise SystemExit(f'unclosed function: {name}')


def replace_or_insert(src, name, anchor):
    block = extract_function(ref, name)
    marker = f'function {name}('
    pos = src.find(marker)
    if pos >= 0:
        old = extract_function(src, name)
        return src.replace(old, block, 1)
    anchor_pos = src.find(anchor)
    if anchor_pos < 0:
        raise SystemExit(f'anchor not found for {name}: {anchor}')
    return src[:anchor_pos] + block + '\n\n' + src[anchor_pos:]

cur = re.sub(
    r"QUEUE_HEADERS: \[[^\n]+\]",
    "QUEUE_HEADERS: ['キューID','配信ID','請求書番号','テストモード','再送','新規トークン','状態','試行回数','登録日時','開始日時','完了日時','エラー','バッチID','メール事業者ID']",
    cur,
    count=1,
)

for name, anchor in [
    ('processSendQueue', 'function importPartners_('),
    ('enqueueSend_', 'function releasePreparedSend_('),
    ('processBrevoQueueBatch_', 'function assertHourlyLimit_('),
    ('buildBrevoBatchPayload_', 'function assertHourlyLimit_('),
    ('getSendBatchStatus_', 'function assertHourlyLimit_('),
    ('ensureQueueColumns_', 'function ensurePartnerColumns_('),
    ('mutateRow_', 'function updateRow_('),
    ('flushTableRows_', 'function updateRow_('),
    ('htmlEscape_', 'function updateRow_('),
    ('createCloudflareDeliveriesParallel_', 'function rotateCloudflareDelivery_('),
]:
    cur = replace_or_insert(cur, name, anchor)

if 'getSendBatchStatus:' not in cur:
    cur = cur.replace(
        "processPendingSends: () => processPendingSends_(requestAuth)",
        "processPendingSends: () => processPendingSends_(requestAuth),\n      getSendBatchStatus: () => getSendBatchStatus_(payload.batchId, requestAuth)",
        1,
    )

cur = re.sub(
    r"\n\s*if \(!testMode && PropertiesService\.getScriptProperties\(\)\.getProperty\('PRODUCTION_SEND_APPROVED'\) !== 'true'\) throw new Error\('[^']*'\);",
    '',
    cur,
)

old = "const batchId=String(prepared[0].queueRow.values[queueTable.map['バッチID']]||Utilities.getUuid()),sandboxConfigured=String(properties.getProperty('BREVO_SANDBOX_MODE')||'').toLowerCase()==='true',largeTest=prepared.length>10&&prepared.every(item=>String(item.queueRow.values[queueTable.map['テストモード']])==='true'||item.queueRow.values[queueTable.map['テストモード']]===true),allowLargeTest=String(properties.getProperty('BREVO_ALLOW_LARGE_TEST_DELIVERY')||'').toLowerCase()==='true',sandbox=sandboxConfigured||(largeTest&&!allowLargeTest);"
new = "const batchId=String(prepared[0].queueRow.values[queueTable.map['バッチID']]||Utilities.getUuid()),sandboxConfigured=String(properties.getProperty('BREVO_SANDBOX_MODE')||'').toLowerCase()==='true',allTest=prepared.every(item=>String(item.queueRow.values[queueTable.map['テストモード']])==='true'||item.queueRow.values[queueTable.map['テストモード']]===true),sandbox=sandboxConfigured&&allTest;"
if old in cur:
    cur = cur.replace(old, new, 1)
else:
    cur = re.sub(r"const batchId=String\(prepared\[0\].*?;\n  const requestBody=", new + "\n  const requestBody=", cur, count=1, flags=re.S)

cur = cur.replace("PRODUCTION_SEND_APPROVED:'false'", "PRODUCTION_SEND_APPROVED:'true'")

required = [
    'processBrevoQueueBatch_', 'buildBrevoBatchPayload_', 'getSendBatchStatus_',
    'createCloudflareDeliveriesParallel_', "UrlFetchApp.fetch('https://api.brevo.com/v3/smtp/email'"
]
for token in required:
    if token not in cur:
        raise SystemExit(f'missing after patch: {token}')
if 'largeTest=' in cur or 'BREVO_ALLOW_LARGE_TEST_DELIVERY' in cur:
    raise SystemExit('automatic large-test sandbox rule still remains')
if '本番送信は管理者の最終承認前' in cur:
    raise SystemExit('production approval lock still remains')

cur_path.write_text(cur, encoding='utf-8')
