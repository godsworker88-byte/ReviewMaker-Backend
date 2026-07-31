// server/constants.js

export const VERSION = "4.0.0";

export const MOBILE_UA =
"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export const PRODUCT_HOST_RE =
/^(?:m\.)?(?:brand|smartstore)\.naver\.com$/i;

export const GENERIC_NAMES =
/^(?:naver|네이버|스마트스토어|브랜드스토어|네이버 쇼핑)$/i;

export const BAD_IMAGE =
/(logo|icon|sprite|badge|profile|avatar|banner|delivery|npay|button|favicon|blank|loading|common\/)/i;

export const MAX_NETWORK_BODIES = 80;
export const MAX_SCRIPT_SIZE = 3000000;
export const DEFAULT_TIMEOUT = 50000;
export const DEFAULT_WAIT = 2500;
