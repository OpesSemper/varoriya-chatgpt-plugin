# คู่มือผู้ดูแลและนักพัฒนา Varoriya Gateway

สถานะ: คู่มือสำหรับ release candidate เอกสารนี้ไม่อนุมัติการ deploy production หรือ publish เข้า ChatGPT directory

## ขอบเขตระบบ

Repository นี้มีสองส่วนที่เกี่ยวข้องกัน:

1. Public Streamable HTTP MCP gateway สำหรับตรวจ identity, authorization, quote, cost, ownership, idempotency, upload และ provider response
2. Codex plugin package ที่กำหนด workflow ให้ค้นหาโมเดล ขอราคา ขอคำยืนยัน ส่งงานครั้งเดียว poll และส่งมอบผลลัพธ์ที่มีวันหมดอายุ

การ publish ใน ChatGPT directory ตรวจ public MCP server ที่ deploy แล้ว ส่วน Codex package ภายใน repository ไม่ได้ทดแทนการ register และ review MCP endpoint

## สิ่งที่ต้องมีก่อน production

- Node.js 24 และ container image แบบ immutable
- HTTPS origin ที่ publisher เป็นเจ้าของและใช้เฉพาะ gateway นี้
- OAuth server พร้อม public JWKS, exact audience validation, short-lived token และ scopes ที่อนุมัติแล้ว
- PostgreSQL ผ่าน TLS พร้อม backup/PITR และ least-privilege account
- ClamAV ที่อยู่ใน private network
- Contract ของ Varoriya API/OAuth และ model allowlist ที่ยืนยันแล้ว
- Ingress, DNS/TLS, egress restriction, WAF/rate limit, logs, metrics, alerts และ secret manager
- Publisher identity/domain, privacy policy, terms, support URL, logo, reviewer account และผู้มีอำนาจ publish

## Build และตรวจสอบ

```bash
cd server
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
cd ..
node scripts/validate-plugin.mjs
node scripts/release/validate-submission.mjs
```

คำสั่งสุดท้ายต้อง fail ขณะที่ข้อมูลของ publisher ยังไม่ครบ นี่คือ release guard ห้ามใส่ข้อมูลที่เดาขึ้นเพื่อให้ผ่าน

## ตั้งค่าฐานข้อมูล

ใช้ระบบ migration ที่อนุมัติเพื่อ apply `server/migrations/001_production_security.up.sql` ก่อนเริ่ม application replica สิทธิ์ runtime ควรมีเฉพาะ DML/read ที่จำเป็นใน schema `varoriya_security` และไม่ควรเป็น owner หรือ migration role

ข้อมูลที่จัดเก็บประกอบด้วย ownership ของไฟล์/งาน, cost reservation, digest ของ quote token พร้อม immutable claims และ fenced idempotency lease/job record ไม่เก็บ quote token แบบ plaintext

ใช้ `server/migrations/cleanup.sql` หลังจากกำหนด retention ด้านกฎหมาย การ reconcile incident และ restore แล้วเท่านั้น ทดสอบ down migration เฉพาะ isolated disposable environment

## Runtime configuration

ใช้ `server/.env.example` เป็นรายการ field เท่านั้น ห้าม commit ไฟล์ environment จริง ใน production ระบบจะไม่ start ถ้า HTTPS/OAuth metadata, PostgreSQL, ClamAV หรือ model policy ไม่ครบ

| กลุ่ม | ตัวแปรสำคัญ |
|---|---|
| Public service | `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_ORIGIN` |
| OAuth | `VARORIYA_AUTH_MODE=oauth`, issuer, audiences, JWKS URI, algorithms, owner claim |
| Provider | API base URL และ timeout; ห้าม static `VARORIYA_API_KEY` ใน production OAuth mode |
| Durable controls | `DATABASE_URL`, pool และ statement timeout |
| Upload safety | ClamAV, MIME และ byte limits |
| Billing safety | currency, per-request/window limit และ window duration |
| Authorization | `VARORIYA_MODEL_POLICIES_JSON` แบบ exact allowlist |
| Operations | health และ shutdown timeout |

ให้คง `VARORIYA_REMOTE_URLS_ENABLED=false` จนกว่า security จะอนุมัติ remote fetch และกำหนด destination hosts แบบ exact match ไฟล์ upload จะผ่าน MIME/size/filename/malware validation ก่อนส่ง provider

JSON upload contract จำกัด decoded media ที่ 10 MiB หากต้องรองรับไฟล์ใหญ่กว่านี้ต้องออกแบบ presigned/streaming upload และผ่าน security review แยก ห้ามเพิ่ม JSON body limit โดยไม่ปรับ tool schema และ validation policy ให้ตรงกัน

ตัวอย่าง model policy:

```json
[
  {
    "model": "publisher-approved-image-model",
    "kinds": ["image"],
    "requiredScopes": ["generation:create"],
    "allowedParameterKeys": ["height", "width", "quality"]
  }
]
```

ใช้เฉพาะ model/parameter ที่ยืนยันจาก Varoriya contract ปัจจุบัน ระบบจะ reject rule ที่ model/kind ซ้ำเพื่อป้องกัน authorization overlap Public discovery แสดงได้เฉพาะ entry ที่ไม่จำกัด `subjects`; ส่วน quote/generate ยังบังคับ `requiredScopes` และโมเดลเฉพาะบุคคลจะไม่ถูกเปิดเผยแบบ public

## Start และ health

```bash
cd server
npm run build
NODE_ENV=production node dist/src/index.js
```

- `/livez` ตรวจ process liveness
- `/readyz` ตรวจ PostgreSQL schema และ ClamAV และคืน 503 เมื่อ dependency ไม่พร้อม
- `/healthz` เป็น shallow compatibility endpoint ห้ามใช้ route production generation traffic
- `/mcp` คือ stateless Streamable HTTP endpoint
- `/.well-known/oauth-protected-resource/mcp` คือ OAuth resource metadata

Ingress ต้อง route traffic จากผล `/readyz` และ shutdown ถูกจำกัดด้วย `SHUTDOWN_TIMEOUT_MS`

## Security invariants

- Public discovery ไม่ส่ง incidental credential ไป Varoriya
- Protected call ตรวจ OAuth issuer, audience, signature algorithm, time claims, subject และ exact scope
- Quote ผูกกับ subject/model/kind/canonical parameters/ราคา/expiry
- งานที่คิดเงินต้องมี `confirm=true` และ subject-scoped idempotency key
- Provider write เกิดหลัง ownership, quote, cost และ idempotency gates เท่านั้น
- เก็บเฉพาะ quote-token digest
- Database/scanner/provider failure ต้อง fail closed และไม่เผย internal detail
- Logs ต้อง redact credential, prompt, media, quote token และ signed URL secret

## Deploy, rollback และ evidence

`deploy/docker-compose.production.example.yml` เป็น reference ไม่ใช่ production platform สำเร็จรูป ต้องบันทึก image digest, source commit, migration/config version, approver และ redacted smoke evidence หากพบ auth bypass, ownership failure, duplicate charge, token leak, readiness loss หรือ high/critical vulnerability ให้ rollback หรือ freeze generation

ดู [production operations](../runbooks/production-operations.md), [release checklist](../quality/release-checklist.md) และ [submission guide](../publishing/SUBMISSION_GUIDE.md) ห้ามใส่ reviewer credential ใน GitHub ให้ส่งผ่าน submission portal หรือช่องทาง secret ที่อนุมัติ

Public support: `[REQUIRED INPUT: ช่องทาง support ของ publisher]`

Security incident contact: `[REQUIRED INPUT: ช่องทาง security ของ publisher]`

Operations escalation/SLA: `[REQUIRED INPUT: นโยบาย operations ของ publisher]`
