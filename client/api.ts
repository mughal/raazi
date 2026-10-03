let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: {
      ...(method !== "GET" ? { "X-CSRF-Token": csrf } : {}),
      ...(!multipart && body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}
