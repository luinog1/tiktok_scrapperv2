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
EXPOSE 3001
CMD ["npm", "run", "start", "--", "-p", "3001"]
