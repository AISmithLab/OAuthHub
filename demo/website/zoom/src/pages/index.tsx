import { type NextPage } from "next";
import Head from "next/head";
import { useState } from "react";
import { api } from "~/utils/api";

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
    const res = await fetch("/api/auth");
    const { authUri } = await res.json() as { authUri?: string };
    return authUri;
  };

  const requestData = async () => {
    await fetch("/api/data", { method: "POST" });
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
                Connected to Google Calendar
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
              <GoogleIcon />
              Sign in with Google
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

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09a6.97 6.97 0 0 1 0-4.18V7.07H2.18A11.97 11.97 0 0 0 0 12c0 1.94.46 3.77 1.28 5.4l3.56-2.77.01-.54z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.77 14.97.5 12 .5 7.7.5 3.99 2.97 2.18 6.57l3.66 2.84c.87-2.6 3.3-4.03 6.16-4.03z" fill="#EA4335" />
    </svg>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (iso.length === 10) return d.toLocaleDateString(); // all-day event (date only)
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

export default Home;
