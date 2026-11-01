FROM node:22-alpine
WORKDIR /app
COPY apps/api/package.json ./apps/api/package.json
COPY apps/api/package-lock.json ./apps/api/package-lock.json
RUN npm ci --prefix apps/api
COPY apps/api ./apps/api
RUN npm --prefix apps/api run build
EXPOSE 4000
CMD ["npm", "--prefix", "apps/api", "start"]
