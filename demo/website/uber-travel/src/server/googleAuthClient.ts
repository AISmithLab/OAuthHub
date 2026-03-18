import { google } from "googleapis";

const googleAuthClient = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  "http://localhost:3000/gauth/callback"
);

export default googleAuthClient;
