import express from "express";
import { chromium } from "playwright";

const VERSION = "3.3.0";
const app = express();
const PORT = Number(process.env.PORT || 10000);

const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S918N) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const BAD_NAME =
  /^(?:naver|네이버|smartstore|스마트스토어|브랜드스토어|네이버 쇼핑|네이버 브랜드 커넥트)$/i;
const BAD_IMAGE =
  /(logo|icon|sprite|badge|profile|avatar|banner|delivery|npay|button|favicon|blank|loading|common\/)/i;

app.disable("x-powered-by");
app.use(express.json({ limit: "512kb" }));

app.use((req, res, next) => {
  const origin = String(req.headers.origin || "");
  const allowed =
    ALLOWED_ORIGINS.includes("*") ||
    !origin ||
    ALLOWED_ORIGINS.includes(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }

  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, X-Request-Id"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function clean(value = "") {
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function validHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    if (!["http:", "https:"].includes(url.protocol)) return null;

    const host = url.hostname.toLowerCase();
    if (
      ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) ||
      host.endsWith(".local")
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function absoluteUrl(value, base = "") {
  try {
    const normalized = String(value || "")
      .replaceAll("\\u002F", "/")
      .replaceAll("\\/", "/")
      .replaceAll("&amp;", "&");

    const url = new URL(normalized, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizePrice(value = "") {
  if (typeof value === "number" && Number.isFinite(value) && value >= 100) {
    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }

  const text = clean(value)
    .replace(/(?:원|₩|KRW)/gi, " ")
    .replace(/\s+/g, " ");

  const candidates = text.match(/\d[\d,]{2,}/g) || [];

  for (const candidate of candidates) {
    const number = Number(candidate.replace(/,/g, ""));
    if (Number.isFinite(number) && number >= 100 && number <= 1_000_000_000) {
      return `${number.toLocaleString("ko-KR")}원`;
    }
  }

  return "";
}

function validName(value = "") {
  let text = clean(value);

  text = text
    .replace(/\s*[|:·-]\s*(?:네이버|NAVER|스마트스토어).*$/i, "")
    .replace(/\s*-\s*네이버\s*쇼핑.*$/i, "")
    .trim();

  if (!text || text.length < 2 || text.length > 200) return "";
  if (BAD_NAME.test(text)) return "";
  if (
    /상품 정보를 확인할 수 없습니다|페이지를 찾을 수 없습니다|접근이 제한|로그인이 필요/i.test(
      text
    )
  ) {
    return "";
  }

  return text;
}

function plausibleImage(value, base = "") {
  const url = absoluteUrl(value, base);
  if (!url || BAD_IMAGE.test(url)) return "";

  if (
    !/\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url) &&
    !/(pstatic|shop-phinf|shopping-phinf|phinf)/i.test(url)
  ) {
    return "";
  }

  return url;
}

function productNoFrom(value = "") {
  const text = String(value || "")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/");

  return (
    text.match(/\/products\/(\d{6,})/i)?.[1] ||
    text.match(/channelProductNo(?:=|%3D|["':\s]+)(\d{6,})/i)?.[1] ||
    text.match(/productNo(?:=|%3D|["':\s]+)(\d{6,})/i)?.[1] ||
    ""
  );
}

function isNaverProductUrl(value = "") {
  try {
    const url = new URL(value);
    return (
      /(?:^|\.)naver\.com$/i.test(url.hostname) &&
      /\/products\/\d{6,}/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function extractProductUrls(raw = "", base = "") {
  const text = String(raw || "")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");

  const absolute =
    text.match(
      /https?:\/\/(?:m\.)?(?:brand|smartstore)\.naver\.com\/[A-Za-z0-9._~-]+\/products\/\d{6,}[^\s"'<>\\]*/gi
    ) || [];

  const relative =
    text.match(
      /\/[A-Za-z0-9._~-]+\/products\/\d{6,}[^\s"'<>\\]*/gi
    ) || [];

  return unique(
    [...absolute, ...relative.map((value) => absoluteUrl(value, base))]
      .map((value) => absoluteUrl(value, base))
      .filter(isNaverProductUrl)
  );
}

function detectCategory(name = "", category = "") {
  const text = `${name} ${category}`.toLowerCase();

  if (
    /(노트북|태블릿|스마트폰|모니터|키보드|마우스|이어폰|헤드폰|카메라|충전기|ssd|메모리|cpu|그래픽|프린터)/i.test(
      text
    )
  ) {
    return "디지털";
  }

  if (
    /(식품|음료|커피|과자|간식|영양|비타민|유산균|즉석|소스|라면|쌀|고기|과일|건강기능식품)/i.test(
      text
    )
  ) {
    return "식품";
  }

  if (
    /(세제|휴지|수납|청소용품|주방용품|욕실|침구|화장지|생활용품|조리도구|물티슈)/i.test(
      text
    )
  ) {
    return "생활용품";
  }

  return "생활가전";
}

function createBucket(source = "") {
  return {
    source,
    names: [],
    prices: [],
    brands: [],
    categories: [],
    images: [],
  };
}

function addCandidate(list, value, score, path = "") {
  if (!value) return;
  list.push({ value, score, path });
}

function best(list) {
  return [...list].sort(
    (a, b) => b.score - a.score || b.value.length - a.value.length
  )[0]?.value || "";
}

function parseJson(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^\)\]\}',?\s*/, "");

  if (!raw || raw.length > 3_000_000) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function scanObject(value, bucket, options = {}) {
  const {
    baseUrl = "",
    targetNo = "",
    path = "$",
    depth = 0,
  } = options;

  if (value == null || depth > 15) return;

  if (Array.isArray(value)) {
    value.slice(0, 800).forEach((item, index) => {
      scanObject(item, bucket, {
        baseUrl,
        targetNo,
        path: `${path}[${index}]`,
        depth: depth + 1,
      });
    });
    return;
  }

  if (typeof value !== "object") return;

  const ownNo = clean(
    value.channelProductNo ||
      value.productNo ||
      value.productId ||
      value.id ||
      ""
  );

  const exactBoost = targetNo && ownNo === targetNo ? 80 : 0;

  for (const [key, raw] of Object.entries(value).slice(0, 1000)) {
    const childPath = `${path}.${key}`;
    const productBoost = /(product|goods|item|channelProduct)/i.test(childPath)
      ? 25
      : 0;

    if (typeof raw === "string" || typeof raw === "number") {
      const text = clean(raw);

      if (
        /^(?:name|productName|goodsName|itemName|title|productTitle)$/i.test(key)
      ) {
        const name = validName(text);
        if (name) {
          addCandidate(
            bucket.names,
            name,
            55 + exactBoost + productBoost,
            childPath
          );
        }
      }

      if (/^(?:brand|brandName|maker|manufacturer)$/i.test(key)) {
        const brand = clean(text);
        if (brand && brand.length <= 80) {
          addCandidate(
            bucket.brands,
            brand,
            40 + exactBoost + productBoost,
            childPath
          );
        }
      }

      if (
        /^(?:salePrice|discountedPrice|discountPrice|mobileDiscountPrice|benefitPrice|finalPrice|price)$/i.test(
          key
        ) &&
        !/(original|delivery|shipping|point|couponMinimum)/i.test(childPath)
      ) {
        const price = normalizePrice(text);
        if (price) {
          addCandidate(
            bucket.prices,
            price,
            50 +
              exactBoost +
              productBoost +
              (/sale|discount|final|benefit/i.test(key) ? 20 : 0),
            childPath
          );
        }
      }

      if (/category(?:Name)?$/i.test(key)) {
        addCandidate(
          bucket.categories,
          text,
          25 + exactBoost,
          childPath
        );
      }

      if (/(?:image|img|photo|thumbnail|represent).*url|^image$/i.test(key)) {
        const image = plausibleImage(text, baseUrl);
        if (image) {
          addCandidate(
            bucket.images,
            image,
            25 + exactBoost + productBoost,
            childPath
          );
        }
      }
    }

    scanObject(raw, bucket, {
      baseUrl,
      targetNo,
      path: childPath,
      depth: depth + 1,
    });
  }
}

async function resolveShortUrl(url) {
  if (!/(^|\.)naver\.me$/i.test(url.hostname)) return url.href;

  try {
    const response = await fetch(url.href, {
      redirect: "follow",
      headers: {
        "User-Agent": MOBILE_UA,
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7",
      },
    });

    return response.url || url.href;
  } catch {
    return url.href;
  }
}

async function safeGoto(page, value, timeout = 50000) {
  const url = validHttpUrl(value);
  if (!url) throw new Error("INVALID_NAVIGATION_URL");

  try {
    await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout,
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (!message.includes("ERR_ABORTED") || !validHttpUrl(page.url())) {
      throw error;
    }
  }

  await page.waitForTimeout(2200);
}

async function getMeta(page, selector) {
  return clean(
    await page
      .locator(selector)
      .first()
      .getAttribute("content", { timeout: 1500 })
      .catch(() => "")
  );
}

async function extractPageBuckets(page, targetNo) {
  const buckets = [];

  const scripts = await page
    .locator("script")
    .evaluateAll((nodes) =>
      nodes
        .map((node) => ({
          id: node.id || "",
          type: node.type || "",
          text: node.textContent || "",
        }))
        .filter((item) => item.text.length > 1)
    )
    .catch(() => []);

  for (const script of scripts) {
    const parsed = parseJson(script.text);
    if (!parsed) continue;

    const bucket = createBucket(`script:${script.id || script.type || "json"}`);
    scanObject(parsed, bucket, {
      baseUrl: page.url(),
      targetNo,
    });
    buckets.push(bucket);
  }

  const dom = createBucket("dom");

  const nameSelectors = [
    'meta[property="og:title"]',
    'meta[name="twitter:title"]',
    '[class*="ProductName"]',
    '[class*="productName"]',
    '[class*="product_name"]',
    '[class*="product_title"]',
    '[class*="productTitle"]',
    'a[class*="product_link"]',
    'a[href*="/products/"]',
    '[data-testid*="product"] h1',
    "main h1",
    "article h1",
    "h1",
  ];

  for (const selector of nameSelectors) {
    if (selector.startsWith("meta")) {
      const value = await getMeta(page, selector);
      const name = validName(value);
      if (name) addCandidate(dom.names, name, 75, selector);
      continue;
    }

    const values = await page
      .locator(selector)
      .allTextContents()
      .catch(() => []);

    values.slice(0, 10).forEach((value, index) => {
      const name = validName(value);
      if (name) addCandidate(dom.names, name, 70 - index, selector);
    });
  }

  const priceSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    '[class*="sale_price"]',
    '[class*="discount"] [class*="price"]',
    '[class*="Price"] strong',
    '[class*="price"] strong',
    '[class*="price_num"]',
    '[class*="price"]',
    'strong[class*="price"]',
    '[data-testid*="price"]',
  ];

  for (const selector of priceSelectors) {
    if (selector.startsWith("meta")) {
      const value = await getMeta(page, selector);
      const price = normalizePrice(value);
      if (price) addCandidate(dom.prices, price, 80, selector);
      continue;
    }

    const values = await page
      .locator(selector)
      .allTextContents()
      .catch(() => []);

    values.slice(0, 20).forEach((value, index) => {
      const price = normalizePrice(value);
      if (price) addCandidate(dom.prices, price, 65 - index, selector);
    });
  }

  const ogImage = plausibleImage(
    await getMeta(page, 'meta[property="og:image"]'),
    page.url()
  );
  if (ogImage) addCandidate(dom.images, ogImage, 90, "og:image");

  const images = await page
    .locator("img, [style*='background-image']")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node).backgroundImage || "";
        const background =
          style.match(/url\(["']?(.*?)["']?\)/)?.[1] || "";

        return {
          src:
            node.currentSrc ||
            node.src ||
            node.getAttribute("data-src") ||
            node.getAttribute("data-original") ||
            background ||
            "",
          width: node.naturalWidth || node.clientWidth || 0,
          height: node.naturalHeight || node.clientHeight || 0,
          alt: node.alt || "",
        };
      })
    )
    .catch(() => []);

  for (const item of images) {
    const image = plausibleImage(item.src, page.url());
    if (!image || BAD_IMAGE.test(`${image} ${item.alt}`)) continue;

    const score =
      item.width >= 700 && item.height >= 700
        ? 55
        : item.width >= 350 && item.height >= 350
          ? 35
          : 10;

    addCandidate(dom.images, image, score, "dom-image");
  }

  buckets.push(dom);
  return buckets;
}


function isBrandConnectUrl(value = "") {
  try {
    return /(?:^|\.)brandconnect\.naver\.com$/i.test(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function tryBrandConnectHandoff(page, context, observedUrls) {
  if (!isBrandConnectUrl(page.url())) return "";

  const directLinks = await page
    .locator("a[href], [data-href], [data-url], [data-link]")
    .evaluateAll((nodes) =>
      nodes.flatMap((node) => [
        node.href,
        node.getAttribute("href"),
        node.getAttribute("data-href"),
        node.getAttribute("data-url"),
        node.getAttribute("data-link"),
      ]).filter(Boolean)
    )
    .catch(() => []);

  for (const raw of directLinks) {
    const url = absoluteUrl(raw, page.url());
    if (isNaverProductUrl(url)) {
      observedUrls.add(url);
      return url;
    }
  }

  const clickTargets = page.locator(
    [
      'a:has-text("상품 보러가기")',
      'button:has-text("상품 보러가기")',
      'a:has-text("구매하러 가기")',
      'button:has-text("구매하러 가기")',
      'a:has-text("쇼핑몰로 이동")',
      'button:has-text("쇼핑몰로 이동")',
      'a:has-text("상품정보")',
      'button:has-text("상품정보")',
      'a:has-text("자세히 보기")',
      'button:has-text("자세히 보기")',
      'a:has-text("구매하기")',
      'button:has-text("구매하기")',
    ].join(", ")
  );

  const count = Math.min(await clickTargets.count().catch(() => 0), 8);

  for (let index = 0; index < count; index += 1) {
    const target = clickTargets.nth(index);
    if (!(await target.isVisible().catch(() => false))) continue;

    const before = page.url();
    const popupPromise = context
      .waitForEvent("page", { timeout: 5000 })
      .catch(() => null);

    await target
      .click({ timeout: 5000, force: true })
      .catch(() => null);

    const popup = await popupPromise;
    if (popup) {
      await popup
        .waitForLoadState("domcontentloaded", { timeout: 12000 })
        .catch(() => {});
      await popup.waitForTimeout(1200);

      const popupUrl = popup.url();
      if (isNaverProductUrl(popupUrl)) {
        observedUrls.add(popupUrl);
        await popup.close().catch(() => {});
        return popupUrl;
      }

      const popupHtml = await popup.content().catch(() => "");
      const popupCandidates = extractProductUrls(popupHtml, popupUrl);
      await popup.close().catch(() => {});

      if (popupCandidates[0]) {
        observedUrls.add(popupCandidates[0]);
        return popupCandidates[0];
      }
    }

    await page.waitForTimeout(1300);
    const after = page.url();

    if (isNaverProductUrl(after)) {
      observedUrls.add(after);
      return after;
    }

    if (after !== before && !isBrandConnectUrl(after)) {
      const html = await page.content().catch(() => "");
      const candidates = extractProductUrls(html, after);
      if (candidates[0]) {
        observedUrls.add(candidates[0]);
        return candidates[0];
      }
    }
  }

  return "";
}

async function openNaverShoppingFallback(page, productNo) {
  if (!productNo) return false;

  const searchUrl =
    `https://search.shopping.naver.com/search/all?query=${encodeURIComponent(productNo)}`;

  await safeGoto(page, searchUrl, 50000);
  await page
    .waitForLoadState("networkidle", { timeout: 12000 })
    .catch(() => {});
  await page.waitForTimeout(1800);

  return true;
}

async function discoverProductUrl(page, observedUrls, bodies, inputUrl) {
  if (isNaverProductUrl(page.url())) return page.url();
  if (isNaverProductUrl(inputUrl)) return inputUrl;

  const html = await page.content().catch(() => "");
  const requestedNo = productNoFrom(inputUrl);

  const candidates = unique([
    ...observedUrls,
    ...extractProductUrls(html, page.url()),
    ...bodies.flatMap((body) => extractProductUrls(body, page.url())),
  ]);

  if (requestedNo) {
    const exact = candidates.find(
      (candidate) => productNoFrom(candidate) === requestedNo
    );
    if (exact) return exact;
  }

  return candidates[0] || "";
}

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    service: "ReviewMaker scraper",
    version: VERSION,
    endpoints: ["/health", "/extract"],
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ReviewMaker scraper",
    version: VERSION,
  });
});

app.post("/extract", async (req, res) => {
  const requestId =
    clean(req.headers["x-request-id"]) || crypto.randomUUID();

  const input = validHttpUrl(req.body?.url);
  if (!input) {
    return res.status(400).json({
      error: "올바른 상품 URL을 입력해 주세요.",
      requestId,
    });
  }

  let browser;
  let context;
  let page;

  const observedUrls = new Set();
  const observedBodies = [];
  const networkBuckets = [];

  try {
    const resolvedUrl = await resolveShortUrl(input);
    const targetNo =
      productNoFrom(resolvedUrl) || productNoFrom(input.href);

    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
      ],
    });

    context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent: MOBILE_UA,
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.7",
      },
    });

    page = await context.newPage();
    page.setDefaultTimeout(9000);
    page.setDefaultNavigationTimeout(50000);

    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      return ["font", "media"].includes(type)
        ? route.abort()
        : route.continue();
    });

    page.on("request", (request) => {
      const url = request.url();
      if (isNaverProductUrl(url)) observedUrls.add(url);
    });

    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (isNaverProductUrl(url)) observedUrls.add(url);
    });

    page.on("response", async (response) => {
      const type = response.request().resourceType();
      if (!["document", "xhr", "fetch", "script"].includes(type)) return;

      const contentType = response.headers()["content-type"] || "";
      if (!/(json|javascript|text|html)/i.test(contentType)) return;

      const body = await response.text().catch(() => "");
      if (!body || body.length > 3_000_000) return;

      observedBodies.push(body);
      if (observedBodies.length > 70) observedBodies.shift();

      for (const url of extractProductUrls(body, response.url())) {
        observedUrls.add(url);
      }

      const parsed = parseJson(body);
      if (!parsed) return;

      const bucket = createBucket(`network:${response.url()}`);
      scanObject(parsed, bucket, {
        baseUrl: response.url(),
        targetNo,
      });

      networkBuckets.push(bucket);
      if (networkBuckets.length > 100) networkBuckets.shift();
    });

    console.log("EXTRACT_START", {
      requestId,
      input: input.href,
      resolvedUrl,
      targetNo,
    });

    await safeGoto(page, resolvedUrl);
    await page
      .waitForLoadState("networkidle", { timeout: 12000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const handoffUrl = await tryBrandConnectHandoff(
      page,
      context,
      observedUrls
    );

    let productUrl =
      handoffUrl ||
      (await discoverProductUrl(
        page,
        observedUrls,
        observedBodies,
        resolvedUrl
      ));

    if (productUrl && productUrl !== page.url()) {
      await safeGoto(page, productUrl);
      await page
        .waitForLoadState("networkidle", { timeout: 12000 })
        .catch(() => {});
      await page.waitForTimeout(1500);
    } else if (!productUrl && targetNo) {
      await openNaverShoppingFallback(page, targetNo);
      productUrl =
        (await discoverProductUrl(
          page,
          observedUrls,
          observedBodies,
          page.url()
        )) || page.url();
    }

    await page
      .evaluate(async () => {
        const max = Math.min(document.body?.scrollHeight || 0, 6500);
        for (let y = 0; y <= max; y += 650) {
          window.scrollTo(0, y);
          await new Promise((resolve) => setTimeout(resolve, 110));
        }
        window.scrollTo(0, 0);
      })
      .catch(() => {});

    await page.waitForTimeout(800);

    productUrl =
      (await discoverProductUrl(
        page,
        observedUrls,
        observedBodies,
        page.url()
      )) || page.url();

    if (isNaverProductUrl(productUrl) && productUrl !== page.url()) {
      await safeGoto(page, productUrl);
      await page.waitForTimeout(1500);
    }

    const currentNo =
      productNoFrom(page.url()) ||
      productNoFrom(productUrl) ||
      targetNo;

    const pageBuckets = await extractPageBuckets(page, currentNo);
    const merged = createBucket("merged");

    for (const bucket of [...networkBuckets, ...pageBuckets]) {
      merged.names.push(...bucket.names);
      merged.prices.push(...bucket.prices);
      merged.brands.push(...bucket.brands);
      merged.categories.push(...bucket.categories);
      merged.images.push(...bucket.images);
    }

    const name = best(merged.names);
    const price = best(merged.prices);
    const brand = best(merged.brands);
    const categoryRaw = best(merged.categories);

    const images = unique(
      merged.images
        .sort((a, b) => b.score - a.score)
        .map((item) => plausibleImage(item.value, page.url()))
        .filter(Boolean)
    ).slice(0, 12);

    const diagnostics = {
      version: VERSION,
      inputUrl: input.href,
      resolvedUrl,
      targetProductNo: targetNo,
      productUrl: page.url(),
      productNo: currentNo,
      nameCandidates: merged.names.length,
      priceCandidates: merged.prices.length,
      brandCandidates: merged.brands.length,
      imageCandidates: merged.images.length,
      networkObjects: networkBuckets.length,
    };

    console.log("EXTRACT_RESULT", {
      requestId,
      name,
      price,
      brand,
      imageCount: images.length,
      diagnostics,
    });

    if (!name) {
      return res.status(422).json({
        error: "상품 페이지는 열렸지만 상품명을 찾지 못했습니다.",
        detail:
          "브랜드커넥트 링크가 실제 상품 상세 페이지를 노출하지 않았거나 네이버가 자동 접근을 제한했을 수 있습니다.",
        sourceUrl: page.url(),
        requestId,
        diagnostics,
      });
    }

    return res.json({
      ok: true,
      name,
      price,
      brand,
      category: detectCategory(name, categoryRaw),
      image: images[0] || "",
      images,
      sourceUrl: page.url(),
      sourceHost: new URL(page.url()).hostname,
      requestId,
      diagnostics,
    });
  } catch (error) {
    console.error("EXTRACT_ERROR", {
      requestId,
      name: error?.name,
      message: error?.message,
      pageUrl: page?.url?.() || "",
    });

    return res.status(422).json({
      error: "상품 페이지를 브라우저로 불러오지 못했습니다.",
      detail: error?.message || String(error),
      type: error?.name || "Error",
      pageUrl: page?.url?.() || null,
      requestId,
      version: VERSION,
    });
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ReviewMaker scraper v${VERSION} listening on ${PORT}`);
});
