# ---- deps stage ----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- dev stage (hot reload) ----
# docker build --target dev / compose target: dev
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 4321
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- build stage ----
FROM deps AS build
COPY . .
RUN npm run build

# ---- runtime stage (production, default) ----
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 4321
USER node
CMD ["node", "./dist/server/entry.mjs"]
