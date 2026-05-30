# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN --mount=type=cache,id=npm-frontend,target=/root/.npm npm install

# Copy source code
COPY . .

# Accept build args for Vite environment variables
ARG VITE_STRIPE_PUBLISHABLE_KEY
ARG VITE_AUTH_SERVICE_URL=http://localhost:3001
ARG VITE_USER_SERVICE_URL=http://localhost:3002
ARG VITE_COURSE_SERVICE_URL=http://localhost:3003
ARG VITE_ORDER_SERVICE_URL=http://localhost:3004
ARG VITE_PAYMENT_SERVICE_URL=http://localhost:3005
ARG VITE_LEARNING_SERVICE_URL=http://localhost:3006

# Set as environment variables for Vite build
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
ENV VITE_AUTH_SERVICE_URL=$VITE_AUTH_SERVICE_URL
ENV VITE_USER_SERVICE_URL=$VITE_USER_SERVICE_URL
ENV VITE_COURSE_SERVICE_URL=$VITE_COURSE_SERVICE_URL
ENV VITE_ORDER_SERVICE_URL=$VITE_ORDER_SERVICE_URL
ENV VITE_PAYMENT_SERVICE_URL=$VITE_PAYMENT_SERVICE_URL
ENV VITE_LEARNING_SERVICE_URL=$VITE_LEARNING_SERVICE_URL

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
