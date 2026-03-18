# Notability Demo (Baseline)

A minimal note backup app that integrates with Google Drive via conventional OAuth 2.0. This is the baseline comparison for the OAuthHub-enhanced version.

**Privacy issue**: This baseline requests permissions to read, write, and delete *all* files and folders on Google Drive, even though it only needs to manage files within the `Notability` folder.

## Setup

1. Create a `.env` file from `.env.example` and add your Google OAuth credentials
2. `npm install`
3. `npm run dev` (runs on port 3002)
