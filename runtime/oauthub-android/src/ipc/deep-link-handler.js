/**
 * Deep link handler for oauthub:// scheme.
 * Handles incoming authorization requests from client apps.
 */
import React, { useEffect } from 'react';
import * as Linking from 'expo-linking';

export function DeepLinkHandler({ navigationRef }) {
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url, navigationRef);
    });

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink(url, navigationRef);
    });

    return () => subscription.remove();
  }, [navigationRef]);

  return null;
}

function handleDeepLink(url, navigationRef, attempts = 0) {
  if (!url) return;

  try {
    const parsed = Linking.parse(url);

    // oauthub://authorize?provider=...&manifest=...&redirect_uri=...&state=...
    if (parsed.hostname === 'authorize' || parsed.path === 'authorize') {
      if (!navigationRef?.isReady?.()) {
        if (attempts < 20) {
          setTimeout(() => handleDeepLink(url, navigationRef, attempts + 1), 100);
        } else {
          console.warn('Deep link: navigation not ready after max retries');
        }
        return;
      }

      const params = parsed.queryParams || {};

      // Validate required params
      if (!params.redirect_uri && !params.provider) {
        console.warn('Deep link: missing required params (redirect_uri or provider)');
        return;
      }

      // Validate redirect_uri scheme
      if (params.redirect_uri) {
        try {
          const rUrl = new URL(params.redirect_uri);
          const scheme = rUrl.protocol.toLowerCase();
          if (['javascript:', 'data:', 'blob:', 'vbscript:'].includes(scheme)) {
            console.warn('Deep link: blocked dangerous redirect_uri scheme');
            return;
          }
        } catch {
          console.warn('Deep link: invalid redirect_uri');
          return;
        }
      }

      // Pass raw query params as-is — no case conversion
      navigationRef.navigate('Consent', params);
    }

    // oauthub://callback — internal OAuth callback handling
    if (parsed.hostname === 'callback' || parsed.path === 'callback') {
      // Handled by react-native-app-auth internally
    }
  } catch (error) {
    console.error('Deep link handling error:', error);
  }
}

/**
 * Parse an oauthub:// URL into its components.
 * Used by the consent screen to extract authorization parameters.
 */
export function parseOAuthHubUrl(url) {
  const parsed = Linking.parse(url);
  return {
    action: parsed.hostname || parsed.path,
    params: parsed.queryParams || {},
  };
}
