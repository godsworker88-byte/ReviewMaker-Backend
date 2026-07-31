import express from "express";
import cors from "cors";
import { createBrowser, createPage, stabilizePage } from "./server/browser.js";
import { resolveProductPage } from "./server/resolver.js";
import {
  clean,
  detectCategory,
  normalizePrice,
  plausibleImage,
  serializeError,
  unique,
  validHttpUrl,
  validName,
} from "./server/utils.js";
import { VERSION } from "./server/constants.js";

const app = express();
const PORT = Number(process.env.PORT || 10000);
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("허용되지 않은 출처입니다."));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept", "X-Request-Id"],
  })
);

function first(...values) {
  return values.map((value) => clean(value)).find(Boolean) || "";
}

function findBrand(jsonLd = []) {
  for (const item of jsonLd) {
    const brand = item?.brand;
    if (typeof brand === "string" && clean(brand)) return clean(brand);
    if (brand && typeof brand === "object" && clean(brand.name)) return clean(brand.name);
  }
  return "";
}

function findOfferPrice(jsonLd = []) {
  for (const item of jsonLd) {
    const offers = Array.isArray(item?.offers) ? item.offers[0] : item?.offers;
    const value = offers?.price ?? offers?.lowPrice ?? item?.price;
    const price = normalizePrice(value);
    if (price) return price;
  }
  return "";
}

async function extractFromPage(page) {
  return page.evaluate(() => {
    const text = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const attr = (selector, name = "content") =>
      text(document.querySelector(selector)?.getAttribute(name));

    const jsonLd = [];
    for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed = JSON.parse(node.textContent || "null");
        if (Array.isArray(parsed)) jsonLd.push(...parsed);
        else if (Array.isArray(parsed?.["@graph"])) jsonLd.push(...parsed["@graph"]);
        else if (parsed) jsonLd.push(parsed);
      } catch {}
    }

    const imageValues = [
      attr('meta[property="og:image"]'),
      attr('meta[name="twitter:image"]'),
      ...jsonLd.flatMap((item) => {
        const value = item?.image;
        if (Array.isArray(value)) return value;
        if (typeof value === "string") return [value];
        if (value && typeof value === "object") return [value.url, value.contentUrl];
        return [];
      }),
      ...Array.from(document.images)
        .map((img) => img.currentSrc || img.src || img.getAttribute("data-src") || img.getAttribute("data-original"))
        .filter(Boolean),
    ];

    return {
      title: attr('meta[property="og:title"]') || attr('meta[name="twitter:title"]') || text(document.title),
      description: attr('meta[property="og:description"]') || attr('meta[name="description"]'),
      brandMeta: attr('meta[property="product:brand"]') || attr('meta[name="brand"]'),
      priceMeta:
        attr('meta[property="product:price:amount"]') ||
        attr('meta[property="og:price:amount"]') ||
        attr('meta[itemprop="price"]'),
      categoryMeta: attr('meta[property="product:category"]') || attr('meta[name="category"]'),
      jsonLd,
      images: imageValues,
      url: location.href,
    };
  });
}

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "ReviewMaker Backend", version: VERSION });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

app.get("/extract", (_req, res) => {
  res.status(405).json({ error: "POST 요청만 지원합니다." });
});

app.post("/extract", async (req, res) => {
  const requestId = req.get("X-Request-Id") || crypto.randomUUID();
  const rawUrl = clean(req.body?.url);

  if (!validHttpUrl(rawUrl)) {
    return res.status(400).json({ error: "올바른 상품 URL을 입력해 주세요.", requestId });
  }

  let browser;
  let page;

  try {
    browser = await createBrowser();
    page = await createPage(browser);

    const resolved = await resolveProductPage(page, rawUrl);
    if (page.url() !== resolved.resolvedUrl) {
      await page.goto(resolved.resolvedUrl, { waitUntil: "domcontentloaded", timeout: 50000 });
    }
    await stabilizePage(page);

    const data = await extractFromPage(page);
    const productItems = data.jsonLd.filter((item) => {
      const type = item?.["@type"];
      return type === "Product" || (Array.isArray(type) && type.includes("Product"));
    });

    const name = validName(
      first(
        ...productItems.map((item) => item?.name),
        data.title
      )
    );
    const brand = first(findBrand(productItems), data.brandMeta);
    const price = first(findOfferPrice(productItems), normalizePrice(data.priceMeta));
    const categorySource = first(
      ...productItems.map((item) => item?.category),
      data.categoryMeta,
      data.description
    );
    const images = unique(
      data.images
        .map((value) => plausibleImage(value, data.url))
        .filter(Boolean)
    ).slice(0, 12);

    if (!name && !price && images.length === 0) {
      return res.status(422).json({
        error: "상품 정보를 확인할 수 없습니다.",
        detail: "네이버 상품 상세주소인지 확인한 뒤 다시 시도해 주세요.",
        resolvedUrl: resolved.resolvedUrl,
        requestId,
      });
    }

    return res.json({
      ok: true,
      name,
      brand,
      price,
      category: detectCategory(name, categorySource),
      images,
      resolvedUrl: resolved.resolvedUrl,
      productNo: resolved.productNo,
      requestId,
    });
  } catch (error) {
    console.error("EXTRACT_ERROR", { requestId, ...serializeError(error) });
    return res.status(500).json({
      error: "상품 페이지를 브라우저로 불러오지 못했습니다.",
      detail: error?.message || String(error),
      requestId,
    });
  } finally {
    try { await page?.context()?.close(); } catch {}
    try { await browser?.close(); } catch {}
  }
});

app.use((error, _req, res, _next) => {
  console.error("SERVER_ERROR", serializeError(error));
  res.status(500).json({ error: error?.message || "서버 오류가 발생했습니다." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ReviewMaker Backend v${VERSION} listening on port ${PORT}`);
});
