declare module "~/lib/oauthub-client" {
  type GenerateAuthUrlOptions = {
    provider: string;
    manifest: string;
    redirect: string;
    accessType: "user_driven";
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

  const OAuthHubClient: {
    generateAuthUrl: (opts: GenerateAuthUrlOptions) => Promise<string>;
    exchangeToken: (opts: ExchangeTokenOptions) => Promise<{ access_token: string; expires_in?: number }>;
    query: (opts: QueryOptions) => Promise<{ success?: boolean; token: string }>;
  };

  export default OAuthHubClient;
}
