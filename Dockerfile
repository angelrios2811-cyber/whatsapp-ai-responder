FROM node:20-slim

RUN apt-get update && apt-get install -y \
    chromium fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libxcomposite1 libxdamage1 \
    libxfixes3 libxkbcommon0 libxrandr2 xdg-utils \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 3000

CMD ["sh", "-c", "find /app/wwebjs_auth -name SingletonLock -o -name SingletonCookie -o -name SingletonSocket 2>/dev/null | xargs rm -f 2>/dev/null; node index.js"]
