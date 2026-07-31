// server/resolver.js

import {
  DEFAULT_TIMEOUT,
  DEFAULT_WAIT,
} from "./constants.js";

import {
  absoluteUrl,
  clean,
  isProductUrl,
  productNoFrom,
  productUrlsInText,
  sleep,
  unique,
  validHttpUrl,
} from "./utils.js";

/**
 * URL에서 추적용 파라미터를 제거합니다.
 *
 * 상품 식별에 필요한 값은 유지하고,
 * 공유·광고·분석용 파라미터만 제거합니다.
 */
export function removeTrackingParams(value = "") {
  try {
    const url = new URL(value);

    const removableParams = [
      "NaPm",
      "n_media",
      "n_query",
      "n_rank",
      "n_ad_group",
      "n_ad",
      "n_campaign_type",
      "n_keyword",
      "n_keyword_id",
      "n_match",
      "n_network",
      "n_campaign",
      "n_ad_group_type",
      "n_mall_id",
      "n_mall_pid",
      "n_ad_group_id",
      "n_ad_id",
      "n_ad_type",
      "n_ad_extension",
      "n_interest",
      "n_gender",
      "n_age",
      "n_location",
      "n_device",
      "n_rank_type",
      "n_keyword_type",
      "n_content",
      "n_creative",
      "n_placement",
      "n_source",
      "n_medium",
      "n_term",
      "n_ref",
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "fbclid",
      "gclid",
      "yclid",
      "mc_cid",
      "mc_eid",
      "campaign",
      "campaignId",
      "trackingCode",
      "affiliate",
      "affiliateId",
      "share",
      "shareToken",
      "ref",
      "referer",
    ];

    for (const key of removableParams) {
      url.searchParams.delete(key);
    }

    url.hash = "";

    return url.href;
  } catch {
    return clean(value);
  }
}

/**
 * 동일 상품의 모바일·PC URL을 비교하기 쉽게 정규화합니다.
 */
export function normalizeProductUrl(value = "") {
  try {
    const url = new URL(value);

    if (!isProductUrl(url.href)) {
      return removeTrackingParams(url.href);
    }

    /*
     * m.brand.naver.com과 brand.naver.com 모두 허용합니다.
     * 실제 접속한 호스트는 유지합니다.
     */
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/+/g, "/");
    url.hash = "";

    return removeTrackingParams(url.href);
  } catch {
    return "";
  }
}

/**
 * 브라우저가 이동한 URL을 안전하게 기록합니다.
 */
function createRedirectRecorder(page) {
  const visited = [];

  const record = (url) => {
    const normalized = clean(url);

    if (!normalized) {
      return;
    }

    if (!visited.includes(normalized)) {
      visited.push(normalized);
    }
  };

  const onFrameNavigated = (frame) => {
    if (frame === page.mainFrame()) {
      record(frame.url());
    }
  };

  const onRequest = (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      record(request.url());
    }
  };

  page.on("framenavigated", onFrameNavigated);
  page.on("request", onRequest);

  return {
    record,

    values() {
      record(page.url());
      return [...visited];
    },

    stop() {
      page.off("framenavigated", onFrameNavigated);
      page.off("request", onRequest);
    },
  };
}

/**
 * 현재 페이지가 실제 네이버 상품 URL로 이동할 때까지 기다립니다.
 */
export async function waitForProductRedirect(
  page,
  {
    timeout = DEFAULT_TIMEOUT,
    interval = 250,
  } = {}
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const currentUrl = page.url();

    if (isProductUrl(currentUrl)) {
      return normalizeProductUrl(currentUrl);
    }

    await sleep(interval);
  }

  return "";
}

/**
 * 문서의 canonical, og:url, 링크 요소에서 상품 URL을 찾습니다.
 */
async function urlsFromDocument(page) {
  try {
    return await page.evaluate(() => {
      const values = [];

      const push = (value) => {
        if (typeof value !== "string") {
          return;
        }

        const text = value.trim();

        if (text) {
          values.push(text);
        }
      };

      const selectors = [
        'link[rel="canonical"]',
        'meta[property="og:url"]',
        'meta[name="twitter:url"]',
        'meta[name="url"]',
        'a[href*="/products/"]',
        'a[href*="channelProductNo"]',
        'a[href*="productNo"]',
      ];

      for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);

        for (const element of elements) {
          push(
            element.getAttribute("href") ||
              element.getAttribute("content") ||
              ""
          );
        }
      }

      push(location.href);

      return values;
    });
  } catch {
    return [];
  }
}

/**
 * HTML과 script 내용에서 상품 URL을 찾습니다.
 */
async function urlsFromPageSource(page) {
  let html = "";

  try {
    html = await page.content();
  } catch {
    return [];
  }

  if (!html) {
    return [];
  }

  return productUrlsInText(html, page.url());
}

/**
 * 네이버의 공유·중간 페이지에서 상품번호가 URL 파라미터로
 * 전달된 경우 상품 URL 후보를 생성합니다.
 */
function urlsFromQueryParams(value = "") {
  try {
    const source = new URL(value);
    const candidates = [];

    const possibleUrlKeys = [
      "url",
      "target",
      "targetUrl",
      "redirect",
      "redirectUrl",
      "returnUrl",
      "return_url",
      "destination",
      "destinationUrl",
      "link",
      "linkUrl",
      "productUrl",
      "product_url",
      "mallProductUrl",
      "landingUrl",
    ];

    for (const key of possibleUrlKeys) {
      const raw = source.searchParams.get(key);

      if (!raw) {
        continue;
      }

      let decoded = raw;

      for (let index = 0; index < 3; index += 1) {
        try {
          const next = decodeURIComponent(decoded);

          if (next === decoded) {
            break;
          }

          decoded = next;
        } catch {
          break;
        }
      }

      const absolute = absoluteUrl(decoded, source.href);

      if (absolute) {
        candidates.push(absolute);
      }

      candidates.push(
        ...productUrlsInText(decoded, source.href)
      );
    }

    return unique(candidates);
  } catch {
    return [];
  }
}

/**
 * 후보 URL 중 가장 적절한 상품 URL을 선택합니다.
 */
function chooseProductUrl(candidates = [], expectedProductNo = "") {
  const normalized = unique(
    candidates
      .map((value) => normalizeProductUrl(value))
      .filter((value) => isProductUrl(value))
  );

  if (!normalized.length) {
    return "";
  }

  if (expectedProductNo) {
    const exact = normalized.find(
      (value) => productNoFrom(value) === expectedProductNo
    );

    if (exact) {
      return exact;
    }
  }

  /*
   * 모바일 페이지를 우선합니다.
   * 현재 추출기는 모바일 네이버 상품 페이지에서 더 안정적으로 작동합니다.
   */
  const mobile = normalized.find((value) => {
    try {
      return new URL(value).hostname.startsWith("m.");
    } catch {
      return false;
    }
  });

  return mobile || normalized[0];
}

/**
 * 주어진 URL로 이동하고 실제 네이버 상품 페이지를 찾습니다.
 *
 * 반환 예시:
 *
 * {
 *   inputUrl: "...",
 *   resolvedUrl: "...",
 *   productNo: "13457852130",
 *   redirectChain: ["...", "..."],
 *   candidates: ["..."],
 *   resolutionMethod: "browser_redirect"
 * }
 */
export async function resolveProductPage(
  page,
  rawUrl,
  {
    timeout = DEFAULT_TIMEOUT,
    waitAfterNavigation = DEFAULT_WAIT,
  } = {}
) {
  const parsedInput = validHttpUrl(rawUrl);

  if (!parsedInput) {
    throw new Error("올바른 HTTP 또는 HTTPS 주소가 아닙니다.");
  }

  const inputUrl = parsedInput.href;
  const redirectRecorder = createRedirectRecorder(page);

  let navigationError = null;
  let response = null;

  try {
    response = await page.goto(inputUrl, {
      waitUntil: "domcontentloaded",
      timeout,
    });
  } catch (error) {
    navigationError = error;

    /*
     * 일부 네이버 페이지는 네트워크가 계속 유지되거나
     * 중간 리디렉션 중 timeout이 발생해도 최종 페이지가 열려 있을 수 있습니다.
     */
    if (!page.url() || page.url() === "about:blank") {
      redirectRecorder.stop();
      throw error;
    }
  }

  await sleep(waitAfterNavigation);

  const redirectResult = await waitForProductRedirect(page, {
    timeout: Math.min(timeout, 12_000),
    interval: 250,
  });

  const redirectChain = redirectRecorder.values();

  if (redirectResult) {
    redirectRecorder.stop();

    return {
      inputUrl,
      resolvedUrl: redirectResult,
      productNo: productNoFrom(redirectResult),
      redirectChain,
      candidates: [redirectResult],
      resolutionMethod: "browser_redirect",
      status: response?.status?.() || null,
      navigationWarning: navigationError?.message || "",
    };
  }

  const currentUrl = page.url();
  const expectedProductNo =
    productNoFrom(currentUrl) ||
    productNoFrom(inputUrl);

  const documentValues = await urlsFromDocument(page);
  const sourceValues = await urlsFromPageSource(page);

  const queryValues = unique([
    ...urlsFromQueryParams(inputUrl),
    ...urlsFromQueryParams(currentUrl),
    ...redirectChain.flatMap((value) => urlsFromQueryParams(value)),
  ]);

  const candidates = unique([
    currentUrl,
    ...redirectChain,
    ...documentValues.map((value) =>
      absoluteUrl(value, currentUrl || inputUrl)
    ),
    ...sourceValues,
    ...queryValues,
  ]);

  const resolvedUrl = chooseProductUrl(
    candidates,
    expectedProductNo
  );

  redirectRecorder.stop();

  if (!resolvedUrl) {
    const currentHost = (() => {
      try {
        return new URL(currentUrl).hostname;
      } catch {
        return "";
      }
    })();

    const error = new Error(
      "네이버 상품 페이지의 실제 주소를 찾지 못했습니다."
    );

    error.details = {
      inputUrl,
      currentUrl,
      currentHost,
      redirectChain,
      candidateCount: candidates.length,
      navigationWarning: navigationError?.message || "",
    };

    throw error;
  }

  return {
    inputUrl,
    resolvedUrl,
    productNo: productNoFrom(resolvedUrl),
    redirectChain,
    candidates: unique(
      candidates
        .map((value) => normalizeProductUrl(value))
        .filter((value) => isProductUrl(value))
    ),
    resolutionMethod: "document_discovery",
    status: response?.status?.() || null,
    navigationWarning: navigationError?.message || "",
  };
}
