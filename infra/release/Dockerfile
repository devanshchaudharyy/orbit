# syntax=docker/dockerfile:1
FROM node:24.18.0-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global pnpm@11.25.0
WORKDIR /source
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter @orbit/api deploy --legacy --prod --offline /runtime

FROM node:24.18.0-bookworm-slim AS api
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /runtime/ ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4000/api/v1/health/live',{signal:AbortSignal.timeout(2500)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

FROM nginx:1.30.6-alpine AS web
COPY infra/release/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /source/apps/web/dist /usr/share/nginx/html
USER nginx
EXPOSE 8443
HEALTHCHECK --interval=15s --timeout=4s --retries=3 CMD wget --no-check-certificate -q -O /dev/null https://127.0.0.1:8443/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
