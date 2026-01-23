import type { ZodType } from "zod";
import {
  KopaiError,
  KopaiNetworkError,
  KopaiTimeoutError,
  KopaiValidationError,
} from "./errors.js";
import type { RequestOptions } from "./types.js";

const DEFAULT_TIMEOUT = 30_000;

interface FetchOptions extends RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  baseHeaders?: Record<string, string>;
  fetchFn: typeof fetch;
  defaultTimeout: number;
}

/**
 * Internal fetch wrapper with timeout, signal, and Zod validation.
 */
export async function request<T>(
  url: string,
  schema: ZodType<T>,
  options: FetchOptions
): Promise<T> {
  const {
    method = "GET",
    body,
    headers = {},
    baseHeaders = {},
    signal,
    timeout,
    fetchFn,
    defaultTimeout,
  } = options;

  const effectiveTimeout = timeout ?? defaultTimeout ?? DEFAULT_TIMEOUT;

  // Create timeout controller
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(),
    effectiveTimeout
  );

  // Combine signals if user provided one
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  try {
    const response = await fetchFn(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...baseHeaders,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      await handleErrorResponse(response);
    }

    const data = await response.json();

    // Validate response with Zod schema
    const result = schema.safeParse(data);
    if (!result.success) {
      throw new KopaiValidationError(result.error);
    }

    return result.data;
  } catch (error) {
    clearTimeout(timeoutId);

    // Re-throw our errors
    if (
      error instanceof KopaiError ||
      error instanceof KopaiValidationError ||
      error instanceof KopaiTimeoutError ||
      error instanceof KopaiNetworkError
    ) {
      throw error;
    }

    // Handle abort
    if (error instanceof DOMException && error.name === "AbortError") {
      // Check if it was our timeout or user cancellation
      if (timeoutController.signal.aborted) {
        throw new KopaiTimeoutError(effectiveTimeout);
      }
      // User cancelled
      throw error;
    }

    // Network errors
    if (error instanceof TypeError) {
      throw new KopaiNetworkError(
        error.message || "Network request failed",
        error
      );
    }

    throw error;
  }
}

async function handleErrorResponse(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  // Try to parse as RFC 7807 Problem Details
  if (body && typeof body === "object") {
    const problem = body as Record<string, unknown>;
    throw new KopaiError({
      message:
        (problem.title as string) ||
        (problem.message as string) ||
        `HTTP ${response.status}`,
      code: (problem.code as string) || `HTTP_${response.status}`,
      status: response.status,
      type: (problem.type as string) || `about:blank`,
      detail: problem.detail as string | undefined,
    });
  }

  throw new KopaiError({
    message: `HTTP ${response.status}`,
    code: `HTTP_${response.status}`,
    status: response.status,
    type: "about:blank",
  });
}
