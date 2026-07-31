# ReviewMaker AI v1

## 배포
1. ZIP을 Netlify Drop에 업로드합니다.
2. Project configuration → Environment variables에서 `GEMINI_API_KEY`를 추가합니다.
3. 새 배포를 실행합니다.
4. 선택 변수 `GEMINI_MODEL`의 기본값은 `gemini-2.5-flash-lite`입니다.

## 비용 절약
제목·본문·CTA·FAQ·태그를 한 번의 Gemini 요청으로 생성합니다. 저장과 다시 열기는 브라우저에서 처리되어 API 비용이 없습니다.

## 주의
자동 상품정보 추출은 쇼핑몰 정책에 따라 실패할 수 있습니다. 생성 결과의 가격과 사양은 게시 전에 확인하세요. API 키를 HTML에 직접 넣지 마세요.
Trigger Vercel deployment
