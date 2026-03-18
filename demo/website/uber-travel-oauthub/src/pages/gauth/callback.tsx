import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function CallbackPage(): JSX.Element {
  const [status, setStatus] = useState("Processing authorization...");
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    (async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const error = params.get("error");
        if (error) { setStatus("Authorization denied."); return; }

        const code = params.get("code");
        const state = params.get("state");
        if (!code || !state) { setStatus("Authorization failed."); return; }

        // Extract hub identity params
        let publicKey = null;
        try { publicKey = JSON.parse(params.get("oauthub_public_key") ?? ""); } catch { /* */ }
        const userSub = params.get("oauthub_user_sub") ?? null;

        // Exchange auth code for access token (PKCE + CSRF handled by library)
        // @ts-expect-error - OAuthHubClient is a UMD module
        const OAuthHubClient = require("~/lib/oauthub-client");
        const { access_token } = await OAuthHubClient.exchangeToken({ code, state });

        // Persist token + credentials on server (never stored client-side)
        await fetch("/api/oauthub/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publicKey, userSub, token: access_token }),
        });
        void router.push("/");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error processing authorization.";
        setStatus(msg);
        setTimeout(() => void router.push("/?error=auth_failed"), 2000);
      }
    })();
  }, [router.isReady, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-lg">{status}</p>
    </div>
  );
}
