// BASELINE: This app requests FULL Google Drive access via Google OAuth.
// Compare with the OAuthHub version which only accesses the /Notability
// folder via a manifest pipeline, never seeing other Drive files.

import {
  GoogleSignin,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import Constants from 'expo-constants';

const clientId = Constants.expoConfig?.extra?.googleOAuthClientId ?? '';

if (clientId) {
  GoogleSignin.configure({
    webClientId: clientId,
    offlineAccess: false,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpirationDate: string;
}

let cachedTokens: AuthTokens | null = null;

export async function signIn(): Promise<AuthTokens> {
  if (!clientId) {
    throw new Error('Google OAuth client ID not configured. Set GOOGLE_OAUTH_CLIENT_ID env var.');
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();

    cachedTokens = {
      accessToken: tokens.accessToken,
      refreshToken: null,
      idToken: tokens.idToken,
      accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    return cachedTokens;
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in cancelled');
    }
    throw error;
  }
}

export async function refreshAccessToken(_currentRefreshToken: string): Promise<AuthTokens> {
  const tokens = await GoogleSignin.getTokens();
  cachedTokens = {
    accessToken: tokens.accessToken,
    refreshToken: null,
    idToken: tokens.idToken,
    accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
  return cachedTokens;
}

export async function getValidToken(tokens: AuthTokens): Promise<AuthTokens> {
  try {
    const currentUser = GoogleSignin.getCurrentUser();
    if (!currentUser) return tokens;
    const fresh = await GoogleSignin.getTokens();
    cachedTokens = {
      accessToken: fresh.accessToken,
      refreshToken: null,
      idToken: fresh.idToken,
      accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
    return cachedTokens;
  } catch {
    return tokens;
  }
}

export function getCachedTokens(): AuthTokens | null {
  return cachedTokens;
}

export function setCachedTokens(tokens: AuthTokens | null): void {
  cachedTokens = tokens;
}
