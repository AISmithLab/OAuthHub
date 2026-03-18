# Notability Demo (Notability + OAuthHub)

A demo app simulating Notability's Google Drive backup feature, which backs up notes to a specific folder on Google Drive.

## How it works

**Without OAuthHub**: Notability requests permissions to read, write, and delete *all* files and folders on Google Drive, even though it only needs to manage files within its own `Notability` folder.

**With OAuthHub**: The manifest pipeline restricts file operations locally:

- **Read manifest** — Lists only files within the Notability folder on Google Drive
  1. **PullDriveFiles** — Fetch file metadata from Google Drive
  2. **SelectFiles** — Extract the file list
  3. **FilterNotabilityFolder** — Keep only files in the "Notability" folder
  4. **PostToBackend** — Send filtered file list to the app server

- **Write manifest** — Backs up a note to the Notability folder
  1. **ReceiveBackup** — Accept backup request from the app
  2. **FilterFolder** — Verify the target is the Notability folder
  3. **WriteToDrive** — Write the file to Google Drive

## Getting Started

```bash
npm install
npm run dev    # Runs on port 3002
```

The OAuthHub browser extension must be installed for the sign-in flow to work.
