FROM node:22-alpine AS dependencies

WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

FROM dependencies AS build

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
USER node
# Render's default public port. Local Compose still uses the 3001 fallback
# from the command below; EXPOSE is only image metadata.
EXPOSE 10000
# Render supplies PORT at runtime (10000 by default). Keep 3001 as the
# local/docker-compose fallback while binding on every container interface.
CMD ["sh", "-c", "npm run start -- -p ${PORT:-3001} -H 0.0.0.0"]
