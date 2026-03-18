import { type NextPage } from "next";
import Head from "next/head";
import { useState } from "react";
import { api } from "~/utils/api";

function buildOAuthHubManifest(origin: string): string {
  return [
    "TITLE: Uber",
    "DESCRIPTION: Get only flight-related email snippets",
    "PIPELINE: PullGmail->SelectMessages->FilterFlights->SendToUber",
    "",
    'PullGmail(type: "Pull", resourceType: "gmail", query: "{ messages(userId) { snippet } }")',
    'SelectMessages(type: "Select", field: "messages")',
    'FilterFlights(type: "Filter", operation: "include", field: "snippet", targetValue: "flight")',
    `SendToUber(type: "Post", destination: "${origin}/api/oauthub/data")`,
  ].join("\n");
}

const Home: NextPage = () => {
  const authStatus = api.wall.getAuthStatus.useQuery();
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const flightData = api.wall.getFlightData.useQuery(undefined, {
    enabled: fetchEnabled,
  });

  const isAuthed = authStatus.data?.authenticated;

  const logoutMutation = api.wall.logout.useMutation({
    onSuccess: () => { void authStatus.refetch(); },
  });

  // @ts-expect-error - OAuthHubClient is a UMD module
  const getAuthUrl = async () => {
    const OAuthHubClient = require("~/lib/oauthub-client");
    const manifest = buildOAuthHubManifest(window.location.origin);
    return OAuthHubClient.generateAuthUrl({
      provider: "gmail", manifest,
      redirect: window.location.origin + "/gauth/callback", accessType: "user_driven",
    }) as Promise<string>;
  };

  // @ts-expect-error - OAuthHubClient is a UMD module
  const requestData = async () => {
    const OAuthHubClient = require("~/lib/oauthub-client");
    const authRes = await fetch("/api/oauthub/auth");
    const { token } = await authRes.json() as { token: string | null };
    if (!token) throw new Error("No access token");
    const result = await OAuthHubClient.query({
      token,
      manifest: buildOAuthHubManifest(window.location.origin),
    });
    await fetch("/api/oauthub/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: result.token }),
    });
  };

  const handleSignIn = async () => {
    const url = await getAuthUrl();
    if (url) window.location.href = url;
  };

  const handleFetchFlights = async () => {
    setIsFetching(true);
    try {
      await requestData();
      setFetchEnabled(true);
      void flightData.refetch();
    } catch (err) {
      console.error("Failed to fetch flight data:", err);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <>
      <Head>
        <title>UberTravel</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="flex min-h-screen flex-col items-center bg-base-200" data-theme="light">
        {/* Header */}
        <div className="navbar bg-base-100 shadow-sm px-8">
          <span className="text-xl font-bold text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-6 w-6">
              <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
            </svg>
            UberTravel
          </span>
        </div>

        <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
          <h1 className="text-4xl font-bold">Flight Itineraries</h1>
          <p className="text-base-content/60 text-center">
            Extract flight information from your emails to plan rides upon arrival.
          </p>

          {/* Auth section */}
          {isAuthed ? (
            <>
              <div className="badge badge-success gap-2 p-3">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-4 w-4 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                Connected via OAuthHub
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void handleFetchFlights()}
                disabled={isFetching || flightData.isFetching}
              >
                {(isFetching || flightData.isFetching) ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : null}
                Scan Emails for Flights
              </button>
              <button
                className="btn btn-ghost btn-sm text-base-content/50"
                onClick={() => logoutMutation.mutate()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn btn-outline gap-2"
              onClick={() => void handleSignIn()}
            >
              <OAuthHubIcon />
              Sign in with OAuthHub
            </button>
          )}

          {/* Flight data display */}
          {flightData.data && (
            <div className="w-full">
              <div className="divider">
                Extracted Flights ({flightData.data.length})
              </div>
              {flightData.data.length === 0 ? (
                <p className="text-center text-base-content/60">
                  No flight information found in your emails.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {flightData.data.map((flight, i) => (
                    <div key={i} className="card bg-base-100 shadow-sm">
                      <div className="card-body gap-2 p-4">
                        {flight.subject ? (
                          <div className="flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-primary">
                              <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
                            </svg>
                            <span className="text-sm font-medium text-base-content">{flight.subject}</span>
                          </div>
                        ) : null}
                        <span className="line-clamp-2 text-sm text-base-content/60">{flight.snippet}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {flightData.error && (
            <div className="alert alert-error shadow-sm">
              <span>{flightData.error.message}</span>
            </div>
          )}
        </div>
      </main>
    </>
  );
};

function OAuthHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function formatFlightDate(raw: string): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return raw;
  }
}

export default Home;
