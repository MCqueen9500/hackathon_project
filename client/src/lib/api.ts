/**
 * Shared API client (axios instance).
 *
 * - Automatically attaches the JWT access token from localStorage.
 * - Handles 401 → silent refresh → retry once.
 * - On second 401 (refresh failed) → dispatches a custom "auth:logout" event
 *   so AuthContext can clear state without a circular import.
 *
 * All client code should import `api` from here rather than using fetch directly.
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const BASE_URL = "/api"; // proxied to http://localhost:3001 in dev by Vite

export const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: false,
  headers: { "Content-Type": "application/json" },
});

// ── Request interceptor: attach access token ─────────────────────────────────

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("egc_access");
  if (token) {
    config.headers = config.headers ?? {};
    config.headers["Authorization"] = `Bearer ${token}`;
  }
  return config;
});

// ── Response interceptor: silent refresh on 401 ──────────────────────────────

let isRefreshing = false;
let pendingRequests: Array<(token: string) => void> = [];

function onRefreshDone(newToken: string) {
  pendingRequests.forEach((resolve) => resolve(newToken));
  pendingRequests = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean;
    };

    // Skip refresh loop for the refresh endpoint itself
    if (
      error.response?.status === 401 &&
      !original._retried &&
      !original.url?.includes("/auth/refresh")
    ) {
      original._retried = true;

      if (isRefreshing) {
        // Queue while another refresh is in flight
        return new Promise<string>((resolve) => {
          pendingRequests.push(resolve);
        }).then((token) => {
          original.headers["Authorization"] = `Bearer ${token}`;
          return api(original);
        });
      }

      isRefreshing = true;
      const refresh = localStorage.getItem("egc_refresh");

      if (!refresh) {
        isRefreshing = false;
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post<{ accessToken: string }>(
          `${BASE_URL}/auth/refresh`,
          { refreshToken: refresh }
        );
        const newToken = data.accessToken;
        localStorage.setItem("egc_access", newToken);
        isRefreshing = false;
        onRefreshDone(newToken);
        original.headers["Authorization"] = `Bearer ${newToken}`;
        return api(original);
      } catch {
        isRefreshing = false;
        pendingRequests = [];
        localStorage.removeItem("egc_access");
        localStorage.removeItem("egc_refresh");
        window.dispatchEvent(new Event("auth:logout"));
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  }
);

// ── Typed helper wrappers ─────────────────────────────────────────────────────

export async function apiGet<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const { data } = await api.get<T>(path, { params });
  return data;
}

export async function apiPost<T>(
  path: string,
  body?: Record<string, unknown> | FormData,
  extraHeaders?: Record<string, string>
): Promise<T> {
  const { data } = await api.post<T>(path, body, { headers: extraHeaders });
  return data;
}

export async function apiPatch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await api.patch<T>(path, body);
  return data;
}
