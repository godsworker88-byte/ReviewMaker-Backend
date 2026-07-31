FROM node:20-bookworm-slim

WORKDIR /app

COPY package*.json ./

RUN npm install --omit=dev \
    && npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production
ENV PORT=10000

EXPOSE 10000

CMD ["node", "server.mjs"]
