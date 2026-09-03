// config.js
// Runtime environment configuration for BISure Assistant.

window.APP_CONFIG = {
  // Standard batch endpoint
  API_URL: "http://localhost:8000/chat",

  // Lightweight availability check for the local FastAPI server
  HEALTH_URL: "http://localhost:8000/health",

  // Chunked or SSE streaming endpoint
  STREAM_URL: "http://localhost:8000/chat/stream",

  // Request timeout in milliseconds
  REQUEST_TIMEOUT_MS: 30000,

  // Feature flag: set true when backend streaming endpoint is active
  ENABLE_STREAMING: false,

  // Max completed conversational turns retained in context payload (3 user + 3 assistant)
  MAX_HISTORY_TURNS: 6,
};
