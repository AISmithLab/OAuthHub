import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import OAuthHubClient from "~/lib/oauthub-client";
import {
  OAUTHHUB_PENDING_VERSION_STORAGE_KEY,
  isOAuthHubVersion,
  parseGoogleState,
  type VersionId,
} from "~/lib/demo-config";

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const json = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(json?.error ?? `Request failed with status ${response.status}`);
  }

  return json as T;
}

export default function CallbackPage(): JSX.Element {
  const [status, setStatus] = useState("Processing authorization...");
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const googleVersion = parseGoogleState(params.get("state"));
      const pendingVersion = sessionStorage.getItem(OAUTHHUB_PENDING_VERSION_STORAGE_KEY);
      const oauthHubVersion = pendingVersion && isOAuthHubVersion(pendingVersion)
        ? pendingVersion
        : null;
      const redirectWithError = (errorCode: "auth_denied" | "auth_failed", delayMs: number) => {
        const version = googleVersion ?? oauthHubVersion;
        const target = version
          ? `/?version=${version}&error=${errorCode}`
          : `/?error=${errorCode}`;
        sessionStorage.removeItem(OAUTHHUB_PENDING_VERSION_STORAGE_KEY);
        setTimeout(() => void router.replace(target), delayMs);
      };

      try {
        const error = params.get("error");
        if (error) {
          setStatus("Authorization denied.");
          redirectWithError("auth_denied", 1200);
          return;
        }

        const code = params.get("code");
        const state = params.get("state");
        if (!code || !state) {
          throw new Error("Missing authorization code or state");
        }

        if (parseGoogleState(state)) {
          const result = await fetchJson<{ version: VersionId }>(
            "/api/google/auth",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code, state }),
            }
          );
          void router.replace(`/?version=${result.version}`);
          return;
        }

        if (!oauthHubVersion) {
          throw new Error("Missing pending OAuthHub version");
        }

        let publicKey: unknown = null;
        try {
          publicKey = JSON.parse(params.get("oauthub_public_key") ?? "");
        } catch {
          publicKey = null;
        }

        const userSub = params.get("oauthub_user_sub") ?? null;
        const { access_token } = await OAuthHubClient.exchangeToken({ code, state });

        await fetchJson<{ success: true }>(`/api/oauthub/auth?version=${oauthHubVersion}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey,
            userSub,
            token: access_token,
          }),
        });

        sessionStorage.removeItem(OAUTHHUB_PENDING_VERSION_STORAGE_KEY);
        void router.replace(`/?version=${oauthHubVersion}`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Error processing authorization.");
        redirectWithError("auth_failed", 1800);
      }
    })();
  }, [router, router.isReady]);

  return (
    <>
      <Head>
        <title>Authorizing...</title>
      </Head>
      <div className="flex min-h-screen items-center justify-center bg-base-200" data-theme="light">
        <div className="rounded-2xl bg-base-100 px-8 py-6 text-center shadow-sm">
          <p className="text-lg">{status}</p>
        </div>
      </div>
    </>
  );
}
