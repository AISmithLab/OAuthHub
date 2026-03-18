import { type NextPage } from "next";
import Head from "next/head";
import { useRef, useState } from "react";
import { api } from "~/utils/api";

const Home: NextPage = () => {
  const authStatus = api.wall.getAuthStatus.useQuery();
  const [fetchEnabled, setFetchEnabled] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const driveFiles = api.wall.getDriveFiles.useQuery(undefined, {
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

  const handleFetchFiles = async () => {
    setIsFetching(true);
    try {
      await requestData();
      setFetchEnabled(true);
      void driveFiles.refetch();
    } catch (err) {
      console.error("Failed to fetch files:", err);
    } finally {
      setIsFetching(false);
    }
  };

  const handleBackup = async () => {
    if (!selectedFile) return;
    setIsBackingUp(true);
    try {
      const contentBase64 = await fileToBase64(selectedFile);
      await fetch("/api/data", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selectedFile.name,
          mimeType: selectedFile.type || "application/octet-stream",
          contentBase64,
        }),
      });
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      await requestData();
      setFetchEnabled(true);
      void driveFiles.refetch();
    } catch (err) {
      console.error("Failed to backup note:", err);
    } finally {
      setIsBackingUp(false);
    }
  };

  return (
    <>
      <Head>
        <title>Notability</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className="flex min-h-screen flex-col items-center bg-base-200" data-theme="light">
        {/* Header */}
        <div className="navbar bg-base-100 shadow-sm px-8">
          <span className="text-xl font-bold text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-6 w-6">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            Notability
          </span>
        </div>

        <div className="flex w-full max-w-2xl flex-col items-center gap-6 px-4 py-12">
          <h1 className="text-4xl font-bold">Drive Backup</h1>
          <p className="text-base-content/60 text-center">
            Upload a file and back it up into your `/Notability` folder on Google Drive.
          </p>

          {/* Auth section */}
          {isAuthed ? (
            <>
              <div className="badge badge-success gap-2 p-3">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-4 w-4 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                Connected to Google Drive
              </div>

              {/* Backup form */}
              <div className="flex w-full flex-col gap-3 rounded-xl bg-base-100 p-4 shadow-sm">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="file-input file-input-bordered w-full"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-sm text-base-content/60">
                  {selectedFile ? `Selected: ${selectedFile.name}` : "Choose a note file to back up."}
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={() => void handleBackup()}
                  disabled={isBackingUp || !selectedFile}
                >
                  {isBackingUp ? (
                    <span className="loading loading-spinner loading-sm" />
                  ) : null}
                  Backup to /Notability
                </button>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => void handleFetchFiles()}
                disabled={isFetching || driveFiles.isFetching}
              >
                {(isFetching || driveFiles.isFetching) ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : null}
                List Files Under /Notability
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

          {/* Files display */}
          {driveFiles.data && (
            <div className="w-full">
              <div className="divider">Files Under /Notability</div>
              {driveFiles.data.length === 0 ? (
                <p className="text-center text-base-content/60">
                  No files found under /Notability.
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {driveFiles.data.map((file, i) => (
                    <div key={i} className="card bg-base-100 shadow-sm">
                      <div className="card-body p-4">
                        <div className="flex items-center justify-between">
                          <h3 className="card-title text-base">
                            <FileIcon mimeType={file.mimeType} />
                            {file.name}
                          </h3>
                          {file.modifiedTime && (
                            <span className="text-sm text-base-content/50">
                              {formatTime(file.modifiedTime)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {driveFiles.error && (
            <div className="alert alert-error shadow-sm">
              <span>{driveFiles.error.message}</span>
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

function FileIcon({ mimeType }: { mimeType: string }) {
  const isFolder = mimeType === "application/vnd.google-apps.folder";
  if (isFolder) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-4 w-4">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 inline h-4 w-4">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
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
