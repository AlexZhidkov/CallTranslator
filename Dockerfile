FROM node:22-slim

# @livekit/rtc-node's native engine needs the system CA store, absent from slim images
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY shared ./shared

ENV NODE_ENV=production
ENV PORT=8080

CMD ["npm", "start"]
