export type AuthResult = {
  accessToken: string;
  refreshToken: string;
};

class Auth {
  constructor(private readonly baseUrl: string) {}

  public async poll({
    uuid,
    verifier,
    signal,
  }: {
    uuid: string;
    verifier: string;
    signal?: AbortSignal | undefined;
  }) {
    const params = new URLSearchParams({ uuid, verifier });
    return this.fetchJson<AuthResult>(`/auth/poll?${params.toString()}`, {
      headers: { "content-type": "application/json" },
      signal: signal ?? null,
      validator: (data): data is AuthResult => this.isAuthResult(data),
    });
  }

  public async exchangeUserApiKey({
    token,
    signal,
  }: {
    token: string;
    signal?: AbortSignal | undefined;
  }) {
    return this.fetchJson<AuthResult>("/auth/exchange_user_api_key", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
      signal: signal ?? null,
      validator: (data): data is AuthResult => this.isAuthResult(data),
    });
  }

  private async fetchJson<T>(
    url: string,
    { validator, ...init }: RequestInit & { validator: (data: T) => data is T },
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${url}`, init);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Fetch failed ${url} for ${response.status}: ${error}`);
    }

    const data: unknown = await response.json();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated by runtime type guard
    if (!validator(data as T)) {
      const error = JSON.stringify(data);
      throw new Error(`Fetch failed ${url} for invalid response: ${error}`);
    }

    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtime-validated by guard above
    return data as T;
  }

  private isAuthResult(data: unknown): data is AuthResult {
    return (
      typeof data === "object" && data !== null && "accessToken" in data && "refreshToken" in data
    );
  }
}

export default Auth;
