import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

let webClientId = '';

export function configure(id: string): void {
  if (!id) {
    console.warn('Google OAuth: no client ID provided');
    return;
  }
  webClientId = id;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  accessTokenExpirationDate: string;
}

export async function signIn(scopes: string[]): Promise<AuthTokens> {
  if (!webClientId) {
    throw new Error('Google OAuth client ID not configured. Set GOOGLE_OAUTH_CLIENT_ID env var.');
  }

  const apiScopes = scopes.filter(
    (s) => s !== 'openid' && s !== 'email' && s !== 'profile',
  );

  GoogleSignin.configure({
    webClientId,
    offlineAccess: false,
    scopes: apiScopes,
  });

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const userInfo = await GoogleSignin.signIn();
    const tokens = await GoogleSignin.getTokens();

    return {
      accessToken: tokens.accessToken,
      refreshToken: null,
      idToken: tokens.idToken,
      accessTokenExpirationDate: new Date(
        Date.now() + 3600 * 1000,
      ).toISOString(),
    };
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in cancelled');
    }
    if (error.code === statusCodes.IN_PROGRESS) {
      throw new Error('Sign-in already in progress');
    }
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services not available');
    }
    throw error;
  }
}

export async function getValidToken(
  tokens: AuthTokens,
  _scopes: string[],
): Promise<AuthTokens> {
  try {
    const currentUser = GoogleSignin.getCurrentUser();
    if (!currentUser) {
      throw new Error('No signed-in user');
    }
    const freshTokens = await GoogleSignin.getTokens();
    return {
      accessToken: freshTokens.accessToken,
      refreshToken: null,
      idToken: freshTokens.idToken,
      accessTokenExpirationDate: new Date(
        Date.now() + 3600 * 1000,
      ).toISOString(),
    };
  } catch {
    return tokens;
  }
}

export async function signOut(): Promise<void> {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Ignore
  }
}
