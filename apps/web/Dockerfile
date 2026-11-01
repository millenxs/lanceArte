FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
ARG API_PROXY_TARGET=http://api:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV API_PROXY_TARGET=$API_PROXY_TARGET
COPY apps/web/package.json ./apps/web/package.json
COPY apps/web/package-lock.json ./apps/web/package-lock.json
RUN npm ci --prefix apps/web
COPY apps/web ./apps/web
RUN npm --prefix apps/web run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "--prefix", "apps/web", "start"]
