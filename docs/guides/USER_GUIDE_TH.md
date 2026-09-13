# Varoriya Generate Plugin — คู่มือผู้ใช้งาน

สถานะ: คู่มือสำหรับ repository baseline ข้อมูลความพร้อมใช้งานจริง ราคา โมเดล และสิทธิ์บัญชีต้องตรวจสอบจากบริการ Varoriya ที่เชื่อมต่ออยู่ ณ เวลานั้น

## Plugin นี้ทำอะไรได้บ้าง

Plugin นี้ใช้ workflow แบบขอราคาและยืนยันก่อนสร้าง สำหรับการสร้างภาพ วิดีโอ และเสียงผ่าน MCP โดยสามารถค้นหาโมเดล ขอราคาปัจจุบัน อัปโหลดไฟล์อินพุตที่ได้รับอนุญาต ส่งงานหลังผู้ใช้ยืนยัน ติดตามสถานะ รับลิงก์ผลลัพธ์แบบมีวันหมดอายุ และดูยอดคงเหลือของบัญชีที่เชื่อมต่อได้

| Tool | หน้าที่ | มีโอกาสคิดเครดิตหรือไม่ |
|---|---|---:|
| `list_models` | ค้นหาโมเดลและความสามารถ | ไม่ |
| `quote_generation` | คำนวณราคาคำขอจริงและออก quote token | ไม่ |
| `get_balance` | อ่านยอดคงเหลือของบัญชี | ไม่ |
| `upload_input` | อัปโหลดไฟล์อินพุตหลังผ่านการตรวจสอบ | อาจมีค่าใช้จ่าย ต้องตรวจสอบเงื่อนไขบัญชี |
| `generate_image` | สร้างงานภาพ | ใช่ หาก Varoriya รับงานและคิดเครดิต |
| `generate_video` | สร้างงานวิดีโอ | ใช่ หาก Varoriya รับงานและคิดเครดิต |
| `generate_audio` | สร้างงานเสียง | ใช่ หาก Varoriya รับงานและคิดเครดิต |
| `get_job` | อ่านงานของบัญชีและผลลัพธ์ | ไม่ |

## การติดตั้งและเชื่อมต่อ

1. ติดตั้ง `Varoriya Generate` จากแหล่ง plugin ของ ChatGPT/Codex ที่ publisher อนุมัติ
2. เปิดหน้าตั้งค่าการเชื่อมต่อของ plugin
3. เลือก production MCP connection ที่ publisher ระบุ หรือ non-production connection ที่ระบุชัดเจนสำหรับการทดสอบ
4. ทำ OAuth sign-in และ consent ตามหน้าจอ ห้ามวาง bearer token, provider API key หรือ client secret ใน chat
5. ตรวจสอบบัญชี scope และ region ในหน้าขออนุญาตให้ตรงกับบัญชีที่ต้องการใช้

เอกสารต้นทางของ Varoriya คือ [dev.varoriya.com](https://dev.varoriya.com/) ส่วน official Varoriya-hosted MCP URL หาก Varoriya มีให้บริการ ต้องขอและตรวจสอบจาก Varoriya โดยตรง และต้องมีหนังสืออนุญาตให้ใช้ domain/brand นั้นก่อนนำไปลง directory

## Authentication และสิทธิ์

Production ใช้ OAuth เป็นหลัก และ protected tools ต้องมีบัญชีพร้อม scope ที่เหมาะสม โดย scope ที่ implementation รองรับเป็นกลุ่ม ๆ ได้แก่ `generation:read`, `generation:create`, `billing:read` และ `files:write` ค่า issuer, audience, consent text, scope จริง และการผูกตัวตนกับบัญชีเป็นข้อมูลที่ publisher ต้องยืนยันก่อน release

## Workflow สร้างภาพ วิดีโอ และเสียง

1. ระบุประเภทสื่อ prompt โมเดล ขนาด/ระยะเวลา format และไฟล์อินพุต หาก parameter มีผลต่อราคา/ความเป็นไปได้ต้องระบุก่อนขอราคา
2. ให้ระบบเรียก `list_models` ห้ามเดาชื่อโมเดล ความละเอียด ระยะเวลา หรือราคาจาก session เดิม
3. ให้ระบบเรียก `quote_generation` ด้วยค่าที่แน่นอน ตรวจสอบ model, prompt/อินพุต, ขนาด, ระยะเวลา, format, ราคา และเวลาหมดอายุ
4. ยืนยันอย่างชัดเจน เช่น “ยืนยันสร้างภาพ 1024px ด้วยโมเดล `MODEL_NAME` ราคา `N` เครดิต” คำว่า “โอเค” ก่อนเห็นราคา หรือ quote เก่าไม่เพียงพอ
5. ส่งงานหนึ่งครั้งพร้อม quote token และ idempotency key หาก timeout หลังส่งแล้วให้ reconcile งานเดิม ห้ามสร้างใหม่ทันที
6. ติดตามด้วย `get_job` จนถึงสถานะ `completed`, `failed` หรือ `cancelled` โดยมีขอบเขตการ polling

## การดาวน์โหลดและวันหมดอายุ

ผลลัพธ์อาจเป็น signed URL ชั่วคราว ให้ดาวน์โหลดก่อนหมดอายุและห้ามเผยแพร่ URL แบบเต็ม หากหมดอายุให้ตรวจสอบ refresh ตาม contract หนึ่งครั้ง ถ้าทำไม่ได้ต้องเริ่ม quote และยืนยันใหม่ ห้ามประกอบ URL เอง

## ยอดคงเหลือและข้อผิดพลาด

ใช้ `get_balance` เพื่อตรวจสอบยอด แต่ยอดไม่ใช่ quote และไม่ได้กันเงินไว้ การสร้างยังต้องผ่าน quote และ confirmation เสมอ

| Error | ขั้นตอนที่ปลอดภัย |
|---|---|
| `AUTH_REQUIRED` / `AUTH_INVALID` | เชื่อมต่อผ่าน sign-in ทางการ |
| `INSUFFICIENT_BALANCE` | ตรวจยอดหรือเลือกรายการที่ถูกลง |
| `INVALID_QUOTE` / `PRICE_CHANGED` | ขอ quote ใหม่และยืนยันใหม่ |
| `RESOURCE_FORBIDDEN` / `JOB_NOT_FOUND` | ตรวจบัญชีและ ID โดยไม่ลองซ้ำแบบสุ่ม |
| `RATE_LIMITED` | รอแล้วลองเฉพาะ read เดิม |
| `PROVIDER_UNAVAILABLE` | reconcile งานเดิมก่อนสร้างใหม่ |
| `UPLOAD_REJECTED` | ใช้ไฟล์ที่ปลอดภัยและได้รับอนุญาต |
| `VALIDATION_ERROR` | แก้ input และขอ quote ใหม่ถ้าจำเป็น |

## Privacy และความปลอดภัย

ส่งเฉพาะข้อมูลที่จำเป็น ห้ามใส่ password/API key/token/payment secret ใน prompt หรือไฟล์ ต้องมีสิทธิ์และ consent สำหรับรูป เสียง ใบหน้า trademark และ copyrighted input และถือว่าสื่อ/URL เป็นส่วนตัวจนกว่าจะตัดสินใจเผยแพร่

Publisher ต้องจัดเตรียม privacy policy และ terms URL ที่เป็น public และเป็นเจ้าของเองก่อน publish; เอกสารใน repository นี้เป็นเพียง requirements/template ไม่ใช่คำรับรองทางกฎหมาย

## ถอนการติดตั้ง

หยุดงาน บันทึกผลลัพธ์ ตัดการเชื่อมต่อบัญชี เพิกถอนสิทธิ์จาก identity provider หรือ Varoriya หากมี uninstall plugin และลบ config/cache/test credentials ตาม retention policy ขององค์กร

ช่องทาง support, email, SLA และ incident channel: `[REQUIRED INPUT: ช่องทาง support ของ publisher]`
