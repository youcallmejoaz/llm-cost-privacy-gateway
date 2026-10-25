# Gateway image. Lockfile installs only, no install scripts, non-root user.
FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY dashboard/package.json dashboard/
RUN npm ci --ignore-scripts --workspaces=false --include=dev
COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN npm run build

FROM node:22.22.0-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json .npmrc ./
COPY dashboard/package.json dashboard/
RUN npm ci --omit=dev --ignore-scripts --workspaces=false && npm cache clean --force
COPY --from=build /app/dist dist
COPY config config
COPY fixtures fixtures
COPY src/store/schema.sql src/store/schema.sql
USER node
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
