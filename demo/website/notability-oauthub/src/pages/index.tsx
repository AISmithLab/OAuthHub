import { type NextPage } from "next";
import Head from "next/head";
import { useRef, useState } from "react";
import OAuthHubClient from "~/lib/oauthub-client";
import { api } from "~/utils/api";

const OAUTHUB_MANIFEST = [
  "TITLE: Notability",
  "DESCRIPTION: Read and write backups in the Notability folder on Google Drive",
  "PIPELINE: ReceiveBackup->FilterFolder->WriteToDrive->PullDriveFiles->SelectFiles->FilterNotabilityFolder->PostToBackend",
  "",
  'ReceiveBackup(type: "Receive", source: "inline")',
  'FilterFolder(type: "Filter", operation: "==", field: "parents", targetValue: "Notability")',
  'WriteToDrive(type: "Write", action: "create", resourceType: "google_drive")',
  'PullDriveFiles(type: "Pull", resourceType: "google_drive", query: "{ files { id name mimeType modifiedTime parents } }")',
  'SelectFiles(type: "Select", field: "files")',
  'FilterNotabilityFolder(type: "Filter", operation: "include", field: "parents", targetValue: "Notability")',
  'PostToBackend(type: "Post", destination: "http://localhost:3000/api/oauthub/data")',
].join("\n");

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
    return OAuthHubClient.generateAuthUrl({
      provider: "google_drive", manifest: OAUTHUB_MANIFEST,
      redirect: window.location.origin + "/gauth/callback", accessType: "user_driven",
    });
  };

  const requestData = async () => {
    const authRes = await fetch("/api/oauthub/auth");
    const { token } = await authRes.json() as { token: string | null };
    if (!token) throw new Error("No access token");
    const result = await OAuthHubClient.query({ token, manifest: OAUTHUB_MANIFEST, operation: "read" });
    await fetch("/api/oauthub/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: result.token }),
    });
  };

  const backupFile = async (file: File) => {
    const authRes = await fetch("/api/oauthub/auth");
    const { token } = await authRes.json() as { token: string | null };
    if (!token) throw new Error("No access token");
    const contentBase64 = await fileToBase64(file);
    const result = await OAuthHubClient.query({
      token,
      manifest: OAUTHUB_MANIFEST,
      operation: "write",
      data: {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        contentBase64,
        parents: ["Notability"],
      },
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
      await backupFile(selectedFile);
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
            Upload a file and back it up into your `/Notability` folder on Google Drive through OAuthHub.
          </p>

          {/* Auth section */}
          {isAuthed ? (
            <>
              <div className="badge badge-success gap-2 p-3">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="inline-block h-4 w-4 stroke-current"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                Connected via OAuthHub
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
              <OAuthHubIcon />
              Sign in with OAuthHub
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

function OAuthHubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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
