// server/browser.js

import { chromium } from "playwright";
import {
  DEFAULT_TIMEOUT,
  MOBILE_UA,
} from "./constants.js";

/**
 * Playwright Browser 생성
 */
export async function createBrowser() {
  return chromium.launch({
    headless: true,

    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
}

/**
 * BrowserContext 생성
 */
export async function createContext(browser) {
  return browser.newContext({

    userAgent: MOBILE_UA,

    viewport: {
      width: 430,
      height: 932,
    },

    locale: "ko-KR",

    timezoneId: "Asia/Seoul",

    deviceScaleFactor: 3,

    isMobile: true,

    hasTouch: true,

    javaScriptEnabled: true,
  });
}

/**
 * 새로운 Page 생성
 */
export async function createPage(browser) {

  const context = await createContext(browser);

  const page = await context.newPage();

  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  page.setDefaultNavigationTimeout(DEFAULT_TIMEOUT);

  await page.route("**/*", route => {

    const type = route.request().resourceType();

    if (
      type === "font"
    ) {
      return route.abort();
    }

    route.continue();

  });

  return page;

}

/**
 * DOMContentLoaded 까지만 기다림
 */
export async function safeGoto(page, url) {

  await page.goto(url, {

    waitUntil: "domcontentloaded",

    timeout: DEFAULT_TIMEOUT,

  });

}

/**
 * document.readyState == complete 대기
 */
export async function waitUntilReady(page) {

  try {

    await page.waitForFunction(

      () => document.readyState === "complete",

      {

        timeout: 10000,

      }

    );

  } catch {

    // complete 안되어도 진행

  }

}

/**
 * 이미지 LazyLoad 대기
 */
export async function waitImages(page) {

  try {

    await page.evaluate(async () => {

      const imgs = [...document.images];

      await Promise.all(

        imgs.map(img => {

          if (img.complete) return;

          return new Promise(resolve => {

            img.onload = resolve;

            img.onerror = resolve;

          });

        })

      );

    });

  } catch {}

}

/**
 * 페이지 안정화
 */
export async function stabilizePage(page) {

  await waitUntilReady(page);

  await page.waitForTimeout(1000);

  await waitImages(page);

  await page.waitForTimeout(500);

}
