// BASELINE: This app requests FULL Gmail read access via Google OAuth.
// Compare with the OAuthHub version which only receives flight-related
// email snippets via a manifest pipeline, never seeing other emails.

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
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  accessTokenExpirationDate: string;
}

export async function signIn(): Promise<AuthTokens> {
  if (!clientId) {
    throw new Error('Google OAuth client ID not configured. Set GOOGLE_OAUTH_CLIENT_ID env var.');
  }

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();
    return {
      accessToken: tokens.accessToken,
      refreshToken: null,
      accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in cancelled');
    }
    throw error;
  }
}

export async function refreshToken(_storedRefreshToken: string): Promise<AuthTokens> {
  const tokens = await GoogleSignin.getTokens();
  return {
    accessToken: tokens.accessToken,
    refreshToken: null,
    accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
  };
}

export async function getValidToken(
  storedAccessToken: string,
  storedRefreshToken: string | null,
  expirationDate: string,
): Promise<AuthTokens | null> {
  try {
    const currentUser = GoogleSignin.getCurrentUser();
    if (!currentUser) return null;
    const tokens = await GoogleSignin.getTokens();
    return {
      accessToken: tokens.accessToken,
      refreshToken: null,
      accessTokenExpirationDate: new Date(Date.now() + 3600 * 1000).toISOString(),
    };
  } catch {
    return null;
  }
}
