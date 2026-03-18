import { type NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useRef, useState } from "react";
import OAuthHubClient from "~/lib/oauthub-client";
import {
  DEFAULT_VERSION,
  OAUTHHUB_PENDING_VERSION_STORAGE_KEY,
  VERSION_IDS,
  getEmptyData,
  getVersionConfig,
  normalizeQueryValue,
  parseVersionParam,
  type AuthMode,
  type CalendarEventItem,
  type DemoId,
  type DriveFileItem,
  type EmailItem,
  type FlightItem,
  type OAuthHubVersionId,
  type StoredDemoData,
  type VersionId,
} from "~/lib/demo-config";

type AuthStatus = {
  authenticated: boolean;
  authorized_at: string | null;
};

type ViewState = {
  authStatus: AuthStatus;
  data: StoredDemoData;
  errorMessage: string | null;
  isBackingUp: boolean;
  isFetching: boolean;
  isSigningIn: boolean;
  selectedFile: File | null;
  showData: boolean;
};

const APP_OPTIONS: Array<{ id: DemoId; label: string }> = [
  { id: "zoom", label: "Zoom" },
  { id: "uber-travel", label: "UberTravel" },
  { id: "notability", label: "Notability" },
];

function createViewState(version: VersionId): ViewState {
  return {
    authStatus: {
      authenticated: false,
      authorized_at: null,
    },
    data: getEmptyData(version),
    errorMessage: null,
    isBackingUp: false,
    isFetching: false,
    isSigningIn: false,
    selectedFile: null,
    showData: false,
  };
}

function createInitialViewStates(): Record<VersionId, ViewState> {
  return VERSION_IDS.reduce(
    (states, version) => ({
      ...states,
      [version]: createViewState(version),
    }),
    {} as Record<VersionId, ViewState>
  );
}

function getVersionForSelection(demoId: DemoId, authMode: AuthMode): VersionId {
  switch (demoId) {
    case "zoom":
      return authMode === "google" ? "zoom-google" : "zoom-oauthhub";
    case "uber-travel":
      return authMode === "google" ? "uber-travel-google" : "uber-travel-oauthhub";
    case "notability":
      return authMode === "google" ? "notability-google" : "notability-oauthhub";
  }
}

function parseSelectedVersion(
  versionValue: string | string[] | undefined,
  appValue: string | string[] | undefined
): VersionId {
  const version = parseVersionParam(versionValue);
  if (version) {
    return version;
  }

  const app = normalizeQueryValue(appValue);
  if (app === "zoom" || app === "uber-travel" || app === "notability") {
    return getVersionForSelection(app, "google");
  }

  return DEFAULT_VERSION;
}

const Home: NextPage = () => {
  const router = useRouter();
  const selectedVersion = useMemo(
    () => parseSelectedVersion(router.query.version, router.query.app),
    [router.query.app, router.query.version]
  );
  const config = getVersionConfig(selectedVersion);
  const selectedApp = config.demoId;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [viewStates, setViewStates] = useState<Record<VersionId, ViewState>>(
    createInitialViewStates
  );

  const viewState = viewStates[selectedVersion];

  const updateViewState = (
    version: VersionId,
    updater: (current: ViewState) => ViewState
  ) => {
    setViewStates((current) => ({
      ...current,
      [version]: updater(current[version]),
    }));
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = await fetchJson<AuthStatus>(`/api/session?version=${selectedVersion}`);
        if (cancelled) return;

        updateViewState(selectedVersion, (current) => ({
          ...current,
          authStatus: session,
        }));
      } catch (error) {
        if (cancelled) return;

        updateViewState(selectedVersion, (current) => ({
          ...current,
          errorMessage: toMessage(error, "Failed to load session"),
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedVersion]);

  useEffect(() => {
    const error = parseErrorParam(router.query.error);
    if (!error) return;

    updateViewState(selectedVersion, (current) => ({
      ...current,
      errorMessage: error,
    }));
  }, [router.query.error, selectedVersion]);

  const handleAppChange = async (nextApp: DemoId) => {
    await router.replace(
      {
        pathname: "/",
        query: { version: getVersionForSelection(nextApp, config.authMode) },
      },
      undefined,
      { shallow: true }
    );
  };

  const handleAuthModeChange = async (nextAuthMode: AuthMode) => {
    await router.replace(
      {
        pathname: "/",
        query: { version: getVersionForSelection(selectedApp, nextAuthMode) },
      },
      undefined,
      { shallow: true }
    );
  };

  const refreshView = async (version: VersionId, includeData: boolean) => {
    const [session, data] = await Promise.all([
      fetchJson<AuthStatus>(`/api/session?version=${version}`),
      includeData
        ? fetchJson<StoredDemoData>(getDataEndpoint(version))
        : Promise.resolve<StoredDemoData | null>(null),
    ]);

    updateViewState(version, (current) => ({
      ...current,
      authStatus: session,
      data: data ?? current.data,
    }));
  };

  const executeFetch = async (version: VersionId) => {
    const versionConfig = getVersionConfig(version);

    if (versionConfig.authMode === "google") {
      await fetchJson<{ success: true }>(`/api/google/data?version=${version}`, {
        method: "POST",
      });
    } else {
      const { token } = await fetchJson<{ token: string | null }>(
        `/api/oauthub/auth?version=${version}`
      );
      if (!token) {
        throw new Error("No OAuthHub access token found");
      }

      const result = await OAuthHubClient.query({
        token,
        manifest: versionConfig.buildManifest(window.location.origin, version as OAuthHubVersionId),
        operation: versionConfig.queryOperation,
      });

      await fetchJson<{ success: true }>(`/api/oauthub/auth?version=${version}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: result.token }),
      });
    }

    await refreshView(version, true);
  };

  const handleSignIn = async () => {
    updateViewState(selectedVersion, (current) => ({
      ...current,
      errorMessage: null,
      isSigningIn: true,
    }));

    try {
      if (config.authMode === "google") {
        const { authUri } = await fetchJson<{ authUri: string }>(
          `/api/google/auth?version=${selectedVersion}`
        );
        window.location.href = authUri;
        return;
      }

      sessionStorage.setItem(OAUTHHUB_PENDING_VERSION_STORAGE_KEY, selectedVersion);
      const authUri = await OAuthHubClient.generateAuthUrl({
        provider: config.oauthHubProvider,
        manifest: config.buildManifest(
          window.location.origin,
          selectedVersion as OAuthHubVersionId
        ),
        redirect: `${window.location.origin}/gauth/callback`,
        accessType: "user_driven",
      });
      if (authUri) {
        window.location.href = authUri;
      }
    } catch (error) {
      sessionStorage.removeItem(OAUTHHUB_PENDING_VERSION_STORAGE_KEY);
      updateViewState(selectedVersion, (current) => ({
        ...current,
        errorMessage: toMessage(error, "Failed to start sign-in flow"),
        isSigningIn: false,
      }));
    }
  };

  const handleFetch = async () => {
    updateViewState(selectedVersion, (current) => ({
      ...current,
      errorMessage: null,
      isFetching: true,
    }));

    try {
      await executeFetch(selectedVersion);
      updateViewState(selectedVersion, (current) => ({
        ...current,
        showData: true,
      }));
    } catch (error) {
      updateViewState(selectedVersion, (current) => ({
        ...current,
        errorMessage: toMessage(error, "Failed to fetch data"),
      }));
    } finally {
      updateViewState(selectedVersion, (current) => ({
        ...current,
        isFetching: false,
      }));
    }
  };

  const handleBackup = async () => {
    if (!viewState.selectedFile) return;

    updateViewState(selectedVersion, (current) => ({
      ...current,
      errorMessage: null,
      isBackingUp: true,
    }));

    try {
      if (config.authMode === "google") {
        await fetchJson<{ success: true }>(`/api/google/data?version=${selectedVersion}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: viewState.selectedFile.name,
            mimeType: viewState.selectedFile.type || "application/octet-stream",
            contentBase64: await fileToBase64(viewState.selectedFile),
          }),
        });
      } else {
        const { token } = await fetchJson<{ token: string | null }>(
          `/api/oauthub/auth?version=${selectedVersion}`
        );
        if (!token) {
          throw new Error("No OAuthHub access token found");
        }

        const result = await OAuthHubClient.query({
          token,
          manifest: config.buildManifest(
            window.location.origin,
            selectedVersion as OAuthHubVersionId
          ),
          operation: "write",
          data: {
            name: viewState.selectedFile.name,
            mimeType: viewState.selectedFile.type || "application/octet-stream",
            contentBase64: await fileToBase64(viewState.selectedFile),
            parents: ["Notability"],
          },
        });

        await fetchJson<{ success: true }>(`/api/oauthub/auth?version=${selectedVersion}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: result.token }),
        });
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      updateViewState(selectedVersion, (current) => ({
        ...current,
        selectedFile: null,
      }));

      await executeFetch(selectedVersion);
      updateViewState(selectedVersion, (current) => ({
        ...current,
        showData: true,
      }));
    } catch (error) {
      updateViewState(selectedVersion, (current) => ({
        ...current,
        errorMessage: toMessage(error, "Failed to back up file"),
      }));
    } finally {
      updateViewState(selectedVersion, (current) => ({
        ...current,
        isBackingUp: false,
      }));
    }
  };

  const handleDisconnect = async () => {
    updateViewState(selectedVersion, (current) => ({
      ...current,
      errorMessage: null,
    }));

    try {
      await fetchJson<{ success: true }>(`/api/session?version=${selectedVersion}`, {
        method: "DELETE",
      });

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      updateViewState(selectedVersion, () => createViewState(selectedVersion));
    } catch (error) {
      updateViewState(selectedVersion, (current) => ({
        ...current,
        errorMessage: toMessage(error, "Failed to clear session"),
      }));
    }
  };

  return (
    <>
      <Head>
        <title>{config.brandName}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="flex min-h-screen flex-col items-center bg-base-200" data-theme="light">
        <div className="navbar bg-base-100 px-8 shadow-sm">
          <span className="text-xl font-bold text-primary">
            <BrandIcon demoId={selectedApp} className="mr-2 inline h-6 w-6" />
            {config.brandName}
          </span>

          <div className="ml-auto w-48">
            <select
              className="select select-bordered h-12 w-full text-base font-semibold"
              value={selectedApp}
              onChange={(event) => void handleAppChange(event.target.value as DemoId)}
            >
              {APP_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
          <div
            role="tablist"
            className="tabs tabs-boxed rounded-xl bg-base-100 p-1 shadow-sm"
          >
            <button
              role="tab"
              type="button"
              className={`tab h-12 px-6 text-base font-semibold ${
                config.authMode === "google"
                  ? "tab-active bg-primary text-primary-content"
                  : "text-base-content/70"
              }`}
              onClick={() => void handleAuthModeChange("google")}
            >
              Google OAuth
            </button>
            <button
              role="tab"
              type="button"
              className={`tab h-12 px-6 text-base font-semibold ${
                config.authMode === "oauthhub"
                  ? "tab-active bg-primary text-primary-content"
                  : "text-base-content/70"
              }`}
              onClick={() => void handleAuthModeChange("oauthhub")}
            >
              OAuthHub
            </button>
          </div>

          <h1 className="text-4xl font-bold">{config.heading}</h1>
          {renderDescription(selectedVersion)}

          {viewState.authStatus.authenticated ? (
            <>
              <div className="badge badge-success gap-2 p-3">
                <CheckIcon />
                {config.connectedLabel}
              </div>

              {config.supportsUpload ? (
                <div className="flex w-full flex-col gap-3 rounded-xl bg-base-100 p-4 shadow-sm">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="file-input file-input-bordered w-full"
                    onChange={(event) =>
                      updateViewState(selectedVersion, (current) => ({
                        ...current,
                        selectedFile: event.target.files?.[0] ?? null,
                      }))
                    }
                  />
                  <p className="text-sm text-base-content/60">
                    {viewState.selectedFile
                      ? `Selected: ${viewState.selectedFile.name}`
                      : "Choose a note file to back up."}
                  </p>
                  <button
                    className="btn btn-secondary"
                    onClick={() => void handleBackup()}
                    disabled={viewState.isBackingUp || !viewState.selectedFile}
                  >
                    {viewState.isBackingUp ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : null}
                    Backup to /Notability
                  </button>
                </div>
              ) : null}

              <button
                className="btn btn-primary"
                onClick={() => void handleFetch()}
                disabled={viewState.isFetching || viewState.isBackingUp}
              >
                {viewState.isFetching ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : null}
                {config.fetchLabel}
              </button>
              <button
                className="btn btn-ghost btn-sm text-base-content/50"
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="btn btn-outline gap-2"
              onClick={() => void handleSignIn()}
              disabled={viewState.isSigningIn}
            >
              {config.authMode === "google" ? <GoogleIcon /> : <OAuthHubIcon />}
              {config.signInLabel}
            </button>
          )}

          {viewState.showData ? (
            <div className="w-full">
              <div className="divider">{getDividerLabel(selectedVersion)}</div>
              {renderData(selectedVersion, viewState.data)}
            </div>
          ) : null}

          {viewState.errorMessage ? (
            <div className="alert alert-error shadow-sm">
              <span>{viewState.errorMessage}</span>
            </div>
          ) : null}
        </div>
      </main>
    </>
  );
};

function getDataEndpoint(version: VersionId): string {
  return getVersionConfig(version).authMode === "google"
    ? `/api/google/data?version=${version}`
    : `/api/oauthub/data?version=${version}`;
}

function getDividerLabel(version: VersionId): string {
  return getVersionConfig(version).listTitle;
}

function renderDescription(version: VersionId) {
  switch (version) {
    case "uber-travel-google":
    case "uber-travel-oauthhub":
      return (
        <p className="text-center text-base-content/60">
          Extract flight information from your emails to plan rides upon arrival.
        </p>
      );
    case "notability-google":
      return (
        <p className="text-center text-base-content/60">
          Upload a file and back it up into your <code>/Notability</code> folder on Google Drive.
        </p>
      );
    case "notability-oauthhub":
      return (
        <p className="text-center text-base-content/60">
          Upload a file and back it up into your <code>/Notability</code> folder on Google Drive through OAuthHub.
        </p>
      );
    default:
      return null;
  }
}

function renderData(version: VersionId, data: StoredDemoData) {
  switch (version) {
    case "zoom-google":
    case "zoom-oauthhub":
      return renderEvents(data.events ?? []);
    case "uber-travel-google":
      return renderFlights(data.flights ?? [], false);
    case "uber-travel-oauthhub":
      return renderFlights(data.flights ?? [], true);
    case "notability-google":
    case "notability-oauthhub":
      return renderFiles(data.files ?? []);
  }
}

function renderEvents(events: CalendarEventItem[]) {
  if (events.length === 0) {
    return (
      <p className="text-center text-base-content/60">
        No upcoming events found.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {events.map((event, index) => (
        <div key={`${event.summary}-${index}`} className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <h3 className="card-title text-base">{event.summary}</h3>
            <p className="text-sm text-base-content/70">
              {formatCalendarTime(event.start)} — {formatCalendarTime(event.end)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderEmails(emails: EmailItem[]) {
  if (emails.length === 0) {
    return (
      <p className="text-center text-base-content/60">
        No emails found.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {emails.map((email) => (
        <div key={email.id || `${email.subject}-${email.date}`} className="card bg-base-100 shadow-sm">
          <div className="card-body gap-1 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">
                  {email.subject}
                </h3>
                <p className="truncate text-xs text-base-content/50">
                  {parseSender(email.from)}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-xs text-base-content/40">
                {formatEmailDate(email.date)}
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-base-content/60">
              {email.body || email.snippet}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderFlights(flights: FlightItem[], showIcon = true) {
  if (flights.length === 0) {
    return (
      <p className="text-center text-base-content/60">
        No flight information found in your emails.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {flights.map((flight, index) => (
        <div key={`${flight.snippet}-${index}`} className="card bg-base-100 shadow-sm">
          <div className="card-body gap-2 p-4">
            {flight.subject ? (
              showIcon ? (
                <div className="flex items-center gap-2">
                  <FlightIcon className="h-4 w-4 shrink-0 text-primary" />
                  <span className="text-sm font-medium text-base-content">{flight.subject}</span>
                </div>
              ) : (
                <span className="text-sm font-medium text-base-content">{flight.subject}</span>
              )
            ) : null}
            <span className="line-clamp-2 text-sm text-base-content/60">{flight.snippet}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function renderFiles(files: DriveFileItem[]) {
  if (files.length === 0) {
    return (
      <p className="text-center text-base-content/60">
        No files found under /Notability.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {files.map((file) => (
        <div key={file.id || `${file.name}-${file.modifiedTime}`} className="card bg-base-100 shadow-sm">
          <div className="card-body p-4">
            <div className="flex items-center justify-between">
              <h3 className="card-title text-base">
                {file.mimeType === "application/vnd.google-apps.folder" ? (
                  <FolderIcon />
                ) : (
                  <DocumentIcon />
                )}
                {file.name}
              </h3>
              {file.modifiedTime ? (
                <span className="text-sm text-base-content/50">
                  {formatRelativeDate(file.modifiedTime)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const json = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(json?.error ?? `Request failed with status ${response.status}`);
  }

  return json as T;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function parseErrorParam(value: string | string[] | undefined): string | null {
  const normalized = normalizeQueryValue(value);

  switch (normalized) {
    case "auth_denied":
      return "Authorization was denied.";
    case "auth_failed":
      return "Authorization failed.";
    default:
      return null;
  }
}

function BrandIcon({
  demoId,
  className,
}: {
  demoId: DemoId;
  className?: string;
}) {
  if (demoId === "zoom") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M23 7l-7 5 7 5V7z" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </svg>
    );
  }

  if (demoId === "uber-travel") {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
        <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

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

function OAuthHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-4 w-4 stroke-current">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-4 w-4">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-4 w-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function FlightIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M17.8 19.2L16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
    </svg>
  );
}

function CalendarBadgeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function parseSender(from: string): string {
  if (!from) return "Unknown sender";
  const match = from.match(/^(.+?)\s*<.*>$/);
  const senderName = match?.[1];
  return senderName ? senderName.replace(/"/g, "") : from;
}

function formatCalendarTime(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (iso.length === 10) return date.toLocaleDateString();
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatEmailDate(raw: string): string {
  if (!raw) return "";

  try {
    const date = new Date(raw);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    if (diffDays < 7) {
      return date.toLocaleDateString(undefined, { weekday: "short" });
    }

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return raw;
  }
}

function formatFlightDate(raw: string): string {
  if (!raw) return "";

  try {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;

    return date.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return raw;
  }
}

function formatRelativeDate(iso: string): string {
  if (!iso) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected file reader result"));
        return;
      }

      const [, base64 = ""] = result.split(",", 2);
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

export default Home;
