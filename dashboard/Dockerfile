# Dashboard image (Next.js standalone output). Build from the repo root:
#   docker build -f dashboard/Dockerfile .
FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY dashboard/package.json dashboard/
RUN npm ci --ignore-scripts
COPY dashboard dashboard
COPY demo/sample-requests.json demo/sample-requests.json
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w dashboard

FROM node:22.22.0-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 SAMPLES_PATH=/app/demo/sample-requests.json
COPY --from=build /app/dashboard/.next/standalone ./
COPY --from=build /app/dashboard/.next/static dashboard/.next/static
COPY demo/sample-requests.json demo/sample-requests.json
USER node
EXPOSE 3000
CMD ["node", "dashboard/server.js"]
