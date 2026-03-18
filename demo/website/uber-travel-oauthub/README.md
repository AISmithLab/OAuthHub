# UberTravel Demo (Uber + OAuthHub)

A demo app simulating Uber's travel planning feature, which extracts flight information from Gmail to offer rideshare recommendations upon arrival.

## How it works

**Without OAuthHub**: Uber requests access to read *all* your emails and settings via Gmail API, even though it only needs flight confirmation emails.

**With OAuthHub**: The manifest pipeline filters emails locally on the user's device:

1. **PullGmail** — Fetch email snippets from Gmail
2. **SelectMessages** — Extract the message list
3. **FilterFlights** — Keep only emails containing "flight" keywords
4. **ExtractDates** — Extract date/time information from flight emails
5. **PostToBackend** — Send only the extracted flight dates to the app server

## Getting Started

```bash
npm install
npm run dev    # Runs on port 3001
```

The OAuthHub browser extension must be installed for the sign-in flow to work.
