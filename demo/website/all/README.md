# MeetingCal Demo (Baseline)

A minimal calendar app that integrates with Google Calendar via OAuth 2.0.
This serves as the baseline for comparing with the OAuthHub-integrated version.

## Setup

1. Create a `.env` file from `.env.example` and fill in your Google OAuth credentials.
2. `npm install`
3. `npm run dev`
4. Open `http://localhost:3000`

## Flow

1. Click **Sign in with Google** to start the OAuth flow.
2. After authorization, you are redirected back and tokens are stored.
3. Click **Fetch Calendar Events** to pull upcoming events from Google Calendar.
