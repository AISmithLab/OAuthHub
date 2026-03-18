import { useEffect, useState } from "react";
import { useRouter } from "next/router";

export default function CallbackPage(): JSX.Element {
  const [status, setStatus] = useState("Processing authorization...");
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    (async () => {
      try {
        const code = router.query.code as string;
        if (!code) { setStatus("Authorization failed."); return; }

        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        });
        void router.push("/");
      } catch {
        setStatus("Error processing authorization.");
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
