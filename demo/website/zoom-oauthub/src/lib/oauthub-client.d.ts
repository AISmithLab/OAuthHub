declare module "~/lib/oauthub-client" {
  type GenerateAuthUrlOptions = {
    provider: string;
    manifest: string;
    redirect: string;
    accessType: string;
    schedule?: string;
  };

  type ExchangeTokenOptions = {
    code: string;
    state: string;
  };

  type QueryOptions = {
    token: string;
    manifest: string;
    operation?: "read" | "write";
    data?: Record<string, unknown>;
  };

  type HeaderInput = Headers | Record<string, string | string[] | undefined>;

  const OAuthHubClient: {
    generateAuthUrl: (opts: GenerateAuthUrlOptions) => Promise<string>;
    exchangeToken: (opts: ExchangeTokenOptions) => Promise<{ access_token: string; expires_in?: number }>;
    query: (opts: QueryOptions) => Promise<{ success: boolean; token: string }>;
    verifySignedPayload: <T>(opts: {
      headers: HeaderInput;
      rawBody: string;
      publicKeyJwk: unknown;
      requireSignature?: boolean;
    }) => Promise<{ body: T; signature: string | null }>;
  };

  export default OAuthHubClient;
}
