# UberTravel Demo (Baseline)

A minimal travel planning app that integrates with Gmail via conventional OAuth 2.0. This is the baseline comparison for the OAuthHub-enhanced version.

**Privacy issue**: This baseline requests access to read *all* emails and settings via Gmail API, even though it only needs flight confirmation emails.

## Setup

1. Create a `.env` file from `.env.example` and add your Google OAuth credentials
2. `npm install`
3. `npm run dev` (runs on port 3001)
