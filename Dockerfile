# Everest ALT backend — zero-dependency Node app.
FROM node:20-alpine

WORKDIR /app

# Only package.json exists; there are no deps to install, but copying it first
# keeps the layer cache friendly if deps are ever added.
COPY package.json ./
RUN npm install --omit=dev || true

COPY . .

# Bind to all interfaces inside the container; the host maps the port.
ENV HOST=0.0.0.0
ENV PORT=8787
# Persist the datastore + generated secret on a mounted volume in production.
ENV DATA_FILE=/data/data.json
ENV SECRET_FILE=/data/.secret
VOLUME ["/data"]

EXPOSE 8787
CMD ["node", "server.js"]
