FROM node:20-bookworm-slim AS base

WORKDIR /app

COPY assistant/package*.json ./assistant/
RUN npm --prefix ./assistant ci --omit=dev

COPY assistant ./assistant
COPY shared ./shared

RUN mkdir -p /app/assistant/data

WORKDIR /app/assistant
ENV NODE_ENV=production

CMD ["npm", "run", "poll"]
