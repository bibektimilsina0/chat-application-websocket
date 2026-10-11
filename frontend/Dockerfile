FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist/frontend/browser ./site
EXPOSE 4200
CMD ["serve", "-s", "site", "-l", "4200"]