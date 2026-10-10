// Seul endroit du dashboard qui parle au réseau. La méthode est écrite en dur :
// GET. Les chemins sont des constantes (src/api/client.ts), jamais construits à
// partir de données reçues.
import { InvalidResponse, type Parser } from "../validation/validate.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ApiErrorKind = "injoignable" | "http" | "invalide";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  constructor(kind: ApiErrorKind, message: string) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
  }
}

export async function getJson<T>(fetchFn: FetchLike, path: string, parse: Parser<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetchFn(path, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new ApiError("injoignable", "API injoignable");
  }
  if (!response.ok) throw new ApiError("http", `l'API a répondu ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("invalide", "réponse illisible : ce n'est pas du JSON");
  }
  try {
    return parse(body);
  } catch (error) {
    if (error instanceof InvalidResponse) throw new ApiError("invalide", error.message);
    throw error;
  }
}
