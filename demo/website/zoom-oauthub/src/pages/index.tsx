import { type NextPage } from "next";
import Head from "next/head";
import { useState } from "react";
import OAuthHubClient from "~/lib/oauthub-client";
import { api } from "~/utils/api";

function buildOAuthHubManifest(origin: string): string {
  return [
    "TITLE: Zoom",
    "DESCRIPTION: Get all upcoming Zoom meetings",
    "PIPELINE: PullCalendarEvents->SelectEvents->FilterTime->FilterZoom->PostToBackend",
    "",
    'PullCalendarEvents(type: "Pull", resourceType: "google_calendar", query: "{ events(calendarId) {...EventDetails} }")',
    'SelectEvents(type: "Select", field: "events")',
    'FilterTime(type: "Filter", operation: ">", field: "start.dateTime", targetValue: NOW)',
    'FilterZoom(type: "Filter", operation: "match", field: ["location", "description"], pattern: "zoom\\.us", requirement: "any")',
    `PostToBackend(type: "Post", destination: "${origin}/api/oauthub/data")`,
  ].join("\n");
}

const AUTH_WRITE_HEADER = "X-OAuthHub-Auth";

const Home: NextPage = () => {
  const authStatus = api.wall.getAuthStatus.useQuery();
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const calendarEvents = api.wall.getCalendarEvents.useQuery(undefined, {
    enabled: fetchEnabled,
  });

  const isAuthed = authStatus.data?.authenticated;

  const logoutMutation = api.wall.logout.useMutation({
    onSuccess: () => { void authStatus.refetch(); },
  });

  const getAuthUrl = async () => {
    const manifest = buildOAuthHubManifest(window.location.origin);
    return OAuthHubClient.generateAuthUrl({
      provider: "google_calendar", manifest,
      redirect: window.location.origin + "/gauth/callback", accessType: "user_driven",
    });
  };

  const requestData = async () => {
    const authRes = await fetch("/api/oauthub/auth");
    const { token } = await authRes.json() as { token: string | null };
    if (!token) throw new Error("No access token");
    const result = await OAuthHubClient.query({
      token,
      manifest: buildOAuthHubManifest(window.location.origin),
    });
    await fetch("/api/oauthub/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [AUTH_WRITE_HEADER]: "1",
      },
      body: JSON.stringify({ token: result.token }),
    });
  };

  const handleSignIn = async () => {
    const url = await getAuthUrl();
    if (url) window.location.href = url;
  };

  const handleFetchEvents = async () => {
    setIsFetching(true);
    try {
      await requestData();
      setFetchEnabled(true);
      void calendarEvents.refetch();
    } catch (err) {
      console.error("Failed to fetch events:", err);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <>
      <Head>
        <title>Zoom</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="flex min-h-screen flex-col items-center bg-base-200" data-theme="light">
        {/* Header */}
        <div className="navbar bg-base-100 shadow-sm px-8">
          <span className="text-xl font-bold text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-6 w-6">
              <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Zoom
          </span>
        </div>

        <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
          <h1 className="text-4xl font-bold">Calendar Events</h1>

          {/* Auth section */}
          {isAuthed ? (
            <>
              <div className="badge badge-success gap-2 p-3">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-4 w-4 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                Connected via OAuthHub
              </div>
              <button
                className="btn btn-primary"
                onClick={() => void handleFetchEvents()}
                disabled={isFetching || calendarEvents.isFetching}
              >
                {(isFetching || calendarEvents.isFetching) ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : null}
                Fetch Calendar Events
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

          {/* Events display */}
          {calendarEvents.data && (
            <div className="w-full">
              <div className="divider">Upcoming Events</div>
              {calendarEvents.data.length === 0 ? (
                <p className="text-center text-base-content/60">
                  No upcoming events found.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {calendarEvents.data.map((event, i) => (
                    <div key={i} className="card bg-base-100 shadow-sm">
                      <div className="card-body p-4">
                        <h3 className="card-title text-base">{event.summary}</h3>
                        <p className="text-sm text-base-content/70">
                          {formatTime(event.start)} — {formatTime(event.end)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {calendarEvents.error && (
            <div className="alert alert-error shadow-sm">
              <span>{calendarEvents.error.message}</span>
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

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (iso.length === 10) return d.toLocaleDateString();
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default Home;
