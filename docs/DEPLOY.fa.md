<div dir="rtl">

# راهنمای انتشار Open NPV روی GitHub Pages

این راهنما از صفر تا آدرس نهایی سایت است. همه‌چیز در مخزن آماده است؛ فقط **کامیت و پوش** لازم دارد.

---

## قدم ۱ — ساخت مخزن

1. وارد <https://github.com/new> شوید.
2. نام مخزن: **`open-npv`**
3. حالت: **Public**
4. هیچ‌کدام از گزینه‌های «Add a README»، «.gitignore» و «license» را تیک نزنید (مخزن باید خالی باشد).
5. `Create repository`.

## قدم ۲ — استخراج زیپ

فایل **`open-npv-main.zip`** را بگیرید و در یک پوشه به نام `open-npv` استخراج کنید.

ساختار درست بعد از استخراج:

```
open-npv/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── docs/
├── public/
├── scripts/
├── src/
├── tests/
├── vendor/
├── .gitattributes
├── .gitignore
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── NOTICE
├── README.md
├── SECURITY.md
├── package-lock.json
├── package.json
├── tsconfig.json
└── tsconfig.test.json
```

> اگر بعد از استخراج یک پوشهٔ تودرتو مثل `open-npv/open-npv/...` دیدید، محتویات پوشهٔ داخلی را یک سطح بالا بیاورید. فایل `package.json` باید مستقیماً داخل پوشهٔ مخزن باشد.

**داخل زیپ نیست و نباید هم باشد:** `node_modules`، `site/`، `release/`، `.test-build/` و هر فایل نمونهٔ خصوصی. این‌ها در `.gitignore` هم هستند.

## قدم ۳ — تنظیم Pages

در مخزن:

`Settings` → `Pages` → بخش `Build and deployment` → گزینهٔ `Source` را روی **GitHub Actions** بگذارید.

این کار فقط یک بار انجام می‌شود.

## قدم ۴ — کامیت و پوش

داخل پوشهٔ پروژه:

```bash
git init
git add .
git commit -m "feat: Open NPV 0.2.0 — local NPVT/NPVS extractor"
git branch -M main
git remote add origin https://github.com/kourosh242/open-npv.git
git push -u origin main
```

اگر Git از شما نام و ایمیل خواست:

```bash
git config user.name "Kourosh"
git config user.email "YOUR_GITHUB_EMAIL@example.com"
```

برای پوش، به‌جای رمز عبور باید **Personal Access Token** بدهید (GitHub رمز عبور را قبول نمی‌کند):
`Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token` با دسترسی `repo`.

## قدم ۵ — تمام

به تب `Actions` بروید. ورک‌فلوی **Test and deploy Open NPV** اجرا می‌شود:

1. `npm ci`
2. تایپ‌چک، ۱۹ تست واحد و build
3. `npm audit`
4. نصب Chromium و تست کامل مرورگر/آفلاین/حریم خصوصی
5. آپلود پوشهٔ `site/`
6. دیپلوی روی Pages

بعد از سبز شدن، آدرس سایت:

```
https://kourosh242.github.io/open-npv/
```

**از این به بعد هر بار `git push` به `main`، سایت خودکار به‌روز می‌شود.** روی Pull Request فقط تست‌ها اجرا می‌شوند و چیزی منتشر نمی‌شود.

---

## به‌روزرسانی‌های بعدی

```bash
# تغییرات را انجام دهید
npm run verify          # اختیاری ولی توصیه‌شده
git add .
git commit -m "fix: توضیح کوتاه تغییر"
git push
```

کاربرانی که سایت را قبلاً باز کرده‌اند، پیام «نسخهٔ جدید آماده است» می‌بینند و هر وقت خودشان بخواهند به‌روزرسانی می‌کنند. این عمدی است تا وسط کار کسی، نتایجش از دست نرود.

---

## عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| ورک‌فلو اجرا نمی‌شود | فایل باید دقیقاً `.github/workflows/deploy.yml` باشد و پوش به `main` انجام شده باشد. |
| خطای `Get Pages site failed` | در `Settings → Pages` گزینهٔ Source روی **GitHub Actions** نیست. |
| خطای `Resource not accessible by integration` | در `Settings → Actions → General → Workflow permissions` گزینهٔ **Read and write** را انتخاب کنید. |
| سایت بالا می‌آید ولی استایل ندارد | معمولاً یعنی خروجی build نشده منتشر شده. باید پوشهٔ `site/` منتشر شود، نه ریشهٔ سورس. ورک‌فلوی آماده این کار را درست انجام می‌دهد. |
| صفحهٔ ۴۰۴ | یکی دو دقیقه صبر کنید؛ اولین دیپلوی کمی طول می‌کشد. آدرس باید `/open-npv/` باشد. |
| پیام «کش آفلاین فعال نشد» | سایت باید روی HTTPS باز شود (Pages هست). در حالت خصوصی مرورگر ممکن است کش محدود باشد. |
| تست مرورگر در Actions شکست خورد | لاگ مرحلهٔ `Browser, offline and privacy tests` را ببینید؛ نام مرحله مشخص می‌کند کدام رفتار خراب شده. |

## انتشار دستی (بدون Actions)

اگر روزی خواستید دستی منتشر کنید:

```bash
npm ci
npm run build
```

محتویات پوشهٔ `site/` را در شاخهٔ `gh-pages` یا هر هاست استاتیکی قرار دهید. فایل `.nojekyll` از قبل داخل خروجی هست.

## نکات مهم

- نام مخزن در کد **هاردکد نشده**؛ همهٔ مسیرها نسبی‌اند. اگر نام مخزن چیز دیگری باشد، سایت روی `/THAT-NAME/` هم درست کار می‌کند.
- پروانه **AGPL-3.0-only** است. اگر سایت را عمومی منتشر می‌کنید، باید سورس همان نسخه در دسترس باشد؛ به همین دلیل `source.zip` کنار خود سایت منتشر می‌شود.
- هیچ فایل واقعی، رمز یا کانفیگ شخصی را داخل مخزن کامیت نکنید.

</div>
