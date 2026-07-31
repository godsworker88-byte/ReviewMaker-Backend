// server/utils.js

import {
  BAD_IMAGE,
  GENERIC_NAMES,
  PRODUCT_HOST_RE,
} from "./constants.js";

/**
 * 문자열에서 불필요한 공백과 숨은 문자를 제거합니다.
 */
export function clean(value = "") {
  return String(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 배열에서 빈 값과 중복 값을 제거합니다.
 */
export function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * 안전한 HTTP 또는 HTTPS URL인지 확인합니다.
 */
export function validHttpUrl(value) {
  try {
    const url = new URL(clean(value));

    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }

    const host = url.hostname.toLowerCase();

    const blockedHosts = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
    ];

    if (blockedHosts.includes(host) || host.endsWith(".local")) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

/**
 * 네이버 브랜드스토어 또는 스마트스토어 상품 주소인지 확인합니다.
 */
export function isProductUrl(value) {
  try {
    const url = new URL(value);

    return (
      PRODUCT_HOST_RE.test(url.hostname) &&
      /\/products\/\d+/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * 상품 URL에서 상품번호를 추출합니다.
 */
export function productNoFrom(value = "") {
  try {
    const url = new URL(value);

    return (
      url.pathname.match(/\/products\/(\d+)/i)?.[1] ||
      url.searchParams.get("channelProductNo") ||
      url.searchParams.get("productNo") ||
      ""
    );
  } catch {
    return (
      String(value).match(
        /(?:products\/|channelProductNo(?:=|%3D)|productNo(?:=|%3D))(\d+)/i
      )?.[1] || ""
    );
  }
}

/**
 * 상대주소를 절대주소로 변환합니다.
 */
export function absoluteUrl(value, base = "") {
  try {
    const normalized = String(value || "")
      .replaceAll("\\u002F", "/")
      .replaceAll("\\/", "/")
      .replaceAll("&amp;", "&");

    const url = new URL(normalized, base);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    return url.href;
  } catch {
    return "";
  }
}

/**
 * 가격 값을 "59,900원" 형식으로 변환합니다.
 */
export function normalizePrice(value = "") {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 100) {
      return "";
    }

    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }

  const text = clean(value);

  if (!text) {
    return "";
  }

  const candidates = text.match(/[0-9][0-9,]*/g) || [];

  const digits = candidates
    .map((candidate) => candidate.replace(/,/g, ""))
    .find((candidate) => {
      const number = Number(candidate);

      return (
        candidate.length >= 3 &&
        Number.isFinite(number) &&
        number >= 100 &&
        number <= 1_000_000_000
      );
    });

  if (!digits) {
    return "";
  }

  return `${Number(digits).toLocaleString("ko-KR")}원`;
}

/**
 * 상품명으로 사용할 수 있는 문자열인지 확인합니다.
 */
export function validName(value = "") {
  let text = clean(value);

  if (!text) {
    return "";
  }

  text = text
    .replace(
      /\s*[:|\-]\s*(?:네이버|NAVER|스마트스토어|브랜드스토어).*$/i,
      ""
    )
    .replace(/\s*\|\s*네이버\s*브랜드스토어.*$/i, "")
    .replace(/\s*\|\s*네이버\s*스마트스토어.*$/i, "")
    .trim();

  if (!text || text.length < 2 || text.length > 220) {
    return "";
  }

  if (GENERIC_NAMES.test(text)) {
    return "";
  }

  if (
    /상품 정보를 확인할 수 없습니다/i.test(text) ||
    /네이버 브랜드 커넥트/i.test(text) ||
    /접근이 제한되었습니다/i.test(text) ||
    /페이지를 찾을 수 없습니다/i.test(text)
  ) {
    return "";
  }

  /*
   * "벤딕트 : 브랜드스토어"처럼
   * 상품명이 아니라 스토어 이름인 제목을 제외합니다.
   */
  if (
    /:\s*브랜드스토어$/i.test(text) ||
    /:\s*스마트스토어$/i.test(text) ||
    /\|\s*브랜드스토어$/i.test(text) ||
    /\|\s*스마트스토어$/i.test(text)
  ) {
    return "";
  }

  return text;
}

/**
 * 상품 이미지로 사용할 수 있는 URL인지 확인합니다.
 */
export function plausibleImage(value, base = "") {
  const url = absoluteUrl(value, base);

  if (!url || !/^https?:/i.test(url)) {
    return "";
  }

  if (BAD_IMAGE.test(url)) {
    return "";
  }

  const imageExtension =
    /\.(?:jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.test(url);

  const knownImageHost =
    /(pstatic|shop-phinf|shopping-phinf|phinf|naver|nhncdn)/i.test(url);

  if (!imageExtension && !knownImageHost) {
    return "";
  }

  return url;
}

/**
 * 상품명과 카테고리 문자열로 기본 카테고리를 판별합니다.
 */
export function detectCategory(name = "", category = "") {
  const text = `${name} ${category}`.toLowerCase();

  if (
    /(노트북|태블릿|스마트폰|모니터|키보드|마우스|이어폰|헤드폰|카메라|충전기|ssd|메모리|cpu|그래픽카드)/i.test(
      text
    )
  ) {
    return "디지털";
  }

  if (
    /(냉장고|세탁기|건조기|에어컨|청소기|공기청정기|제습기|선풍기|가습기|전자레인지|식기세척기|정수기)/i.test(
      text
    )
  ) {
    return "생활가전";
  }

  if (
    /(식품|음료|커피|과자|간식|영양|비타민|유산균|즉석|소스|라면|쌀|고기|과일)/i.test(
      text
    )
  ) {
    return "식품";
  }

  if (
    /(세제|휴지|수납|청소용품|주방용품|욕실|침구|화장지|생활용품|조리도구)/i.test(
      text
    )
  ) {
    return "생활용품";
  }

  if (
    /(자동차|차량용|세차|블랙박스|내비게이션|카매트|방향제|맥세이프 거치대)/i.test(
      text
    )
  ) {
    return "자동차용품";
  }

  if (
    /(화장품|스킨|로션|크림|세럼|마스크팩|샴푸|린스|트리트먼트|향수)/i.test(
      text
    )
  ) {
    return "뷰티";
  }

  return "생활가전";
}

/**
 * JSON 앞부분에 보안용 문자열이 붙어 있어도 파싱을 시도합니다.
 */
export function parseJsonLoose(value = "") {
  const raw = String(value || "")
    .trim()
    .replace(/^\)\]\}',?\s*/, "");

  if (!raw || raw.length > 3_000_000) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 문자열 안에서 네이버 상품 URL들을 찾습니다.
 */
export function productUrlsInText(raw = "", base = "") {
  const text = String(raw)
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");

  const absoluteMatches =
    text.match(
      /https?:\/\/(?:m\.)?(?:brand|smartstore)\.naver\.com\/[A-Za-z0-9._~-]+\/products\/\d+[^\s"'<>\\]*/gi
    ) || [];

  const relativeMatches =
    text.match(
      /\/[A-Za-z0-9._~-]+\/products\/\d+[^\s"'<>\\]*/gi
    ) || [];

  const combined = [
    ...absoluteMatches,
    ...relativeMatches.map((value) => absoluteUrl(value, base)),
  ];

  return unique(
    combined
      .map((value) => absoluteUrl(value, base))
      .filter((value) => isProductUrl(value))
  );
}

/**
 * 지정된 시간 동안 기다립니다.
 */
export function sleep(milliseconds = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(milliseconds) || 0));
  });
}

/**
 * 오류 객체를 로그와 응답에 사용할 수 있는 형태로 변환합니다.
 */
export function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || "",
  };
}
