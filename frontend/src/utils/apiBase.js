// Single source of truth for the backend URL.
// In dev no env var is set -> falls back to the local Gin server.
// In production (Vercel) set VITE_API_URL to the deployed backend origin, e.g. https://your-backend.up.railway.app
export const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:8080').replace(/\/$/, '');
export const API_BASE = `${API_ORIGIN}/api`;
