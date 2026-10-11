FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
ENV MIGRATIONS_DIR=/database
EXPOSE 4000
CMD ["sh", "-c", "node scripts/migrate.cjs && npm start"]
