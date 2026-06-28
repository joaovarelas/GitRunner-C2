# ---- build the static SPA ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

# ---- serve with nginx (+ reverse proxy to GitLab) ----
FROM nginx:alpine
# nginx:alpine runs envsubst over /etc/nginx/templates/*.template at startup,
# so GITLAB_UPSTREAM / GITLAB_HOST from the environment are baked into the config.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
