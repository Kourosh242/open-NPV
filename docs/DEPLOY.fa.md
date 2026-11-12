<div dir="rtl">

# انتشار خودکار Open NPV روی GitHub Pages

این سند برای نگه‌دارندهٔ پروژه است. سایت روی آدرس زیر در دسترس است و با هر پوش به `main` خودکار به‌روز می‌شود:

```
https://kourosh242.github.io/open-NPV/
```

---

## چطور کار می‌کند؟

فایل `.github/workflows/deploy.yml` مسئول کل مسیر است. با هر پوش یا Pull Request روی `main`:

1. `npm ci` وابستگی‌ها را نصب می‌کند (Node 24).
2. `npm run check` تایپ‌چک، ۲۷ تست واحد و build نهایی را اجرا می‌کند.
3. `npm audit --audit-level=moderate` وابستگی‌ها را ممیزی می‌کند.
4. Chromium نصب و تست مرورگر/آفلاین/حریم خصوصی اجرا می‌شود.
5. مرحلهٔ `Verify the built site` مطمئن می‌شود خروجی `site/` کامل است.
6. فقط در پوش به `main`، پوشهٔ `site/` روی GitHub Pages منتشر می‌شود.

روی Pull Request ها چیزی منتشر نمی‌شود؛ فقط تست‌ها اجرا می‌شوند.

### تنظیم یک‌بارهٔ GitHub Pages (مهم)

در `Settings → Pages → Build and deployment` گزینهٔ `Source` باید روی **GitHub Actions** باشد.

اگر روی `Deploy from a branch` بماند، گیت‌هاب مخزن را به‌صورت سایت Jekyll منتشر می‌کند؛
یعنی صفحهٔ اصلی سایت، همان `README.md` رندرشده می‌شود و اپلیکیشن (که در `public/` است)
هرگز منتشر نمی‌شود. در این حالت ورک‌فلوی ما هم در مرحلهٔ `Deploy` با خطای
`Get Pages site failed` متوقف می‌شود.

بررسی سریع وضعیت با GitHub CLI:

```bash
gh api repos/Kourosh242/open-NPV/pages --jq '{build_type, source, status}'
# build_type باید "workflow" باشد، نه "legacy"
```

و برای تغییر آن به Actions:

```bash
gh api -X PUT repos/Kourosh242/open-NPV/pages \
  -H "Accept: application/vnd.github+json" -f build_type=workflow
```

## به‌روزرسانی‌های بعدی

```bash
# تغییرات را انجام دهید
npm run verify          # اختیاری ولی توصیه‌شده
git add .
git commit -m "fix: توضیح کوتاه تغییر"
git push
```

کاربرانی که سایت را قبلاً باز کرده‌اند، پیام «نسخهٔ جدید آماده است» می‌بینند و هر وقت خودشان بخواهند به‌روز می‌شوند؛ این عمدی است تا وسط کار کسی، نتایجش از دست نرود.

## عیب‌یابی

| مشکل | راه‌حل |
|---|---|
| ورک‌فلو اجرا نمی‌شود | فایل باید دقیقاً `.github/workflows/deploy.yml` باشد و پوش به `main` انجام شده باشد. |
| خطای `Get Pages site failed` | در `Settings → Pages` گزینهٔ Source روی **GitHub Actions** نیست (مقدار `build_type` در API برابر `legacy` است). |
| سایت باز می‌شود ولی متن README را نشان می‌دهد | انتشار از شاخه فعال است، نه از خروجی Actions؛ `Source` را روی **GitHub Actions** بگذارید و یک‌بار روی `main` پوش کنید. |
| خطای `Resource not accessible by integration` | در `Settings → Actions → General → Workflow permissions` گزینهٔ **Read and write** را انتخاب کنید. |
| سایت بالا می‌آید ولی استایل ندارد | خروجی build نشده منتشر شده. پوشهٔ `site/` منتشر می‌شود، نه ریشهٔ سورس؛ ورک‌فلو این کار را درست انجام می‌دهد. |
| صفحهٔ ۴۰۴ | یکی دو دقیقه صبر کنید؛ آدرس باید `/open-NPV/` باشد. |
| پیام «کش آفلاین فعال نشد» | سایت باید روی HTTPS باز شود. در حالت خصوصی مرورگر ممکن است کش محدود باشد. |
| تست مرورگر در Actions شکست خورد | لاگ مرحلهٔ `Browser, offline and privacy tests` را ببینید؛ نام مرحله مشخص می‌کند کدام رفتار خراب شده. اگر خطای `no horizontal overflow on mobile` بود، همان پیام نام دقیق عنصر سرریز و عرض `min-content` آن را می‌گوید. |
| خطای `missing or empty: site/...` | مرحلهٔ `Verify the built site` جلوی انتشار خروجی ناقص را گرفته است؛ لاگ `npm run check` را ببینید. |

## انتشار دستی (بدون Actions)

اگر روزی خواستید دستی منتشر کنید:

```bash
npm ci
npm run build
```

محتویات پوشهٔ `site/` را روی هر هاست استاتیک قرار دهید. فایل `.nojekyll` از قبل داخل خروجی هست.

## نکات مهم

- نام مخزن در کد **هاردکد نشده**؛ همهٔ مسیرها نسبی‌اند.
- پروانه **AGPL-3.0-only** است. اگر سایت را عمومی منتشر می‌کنید، باید سورس همان نسخه در دسترس باشد؛ به همین دلیل `source.zip` کنار خود سایت منتشر می‌شود.
- هیچ فایل واقعی، رمز یا کانفیگ شخصی را داخل مخزن کامیت نکنید.
