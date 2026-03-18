import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import OAuthHubClient from '../lib/oauthub-client';
import * as LocalDB from '../storage/local-db';

export default function CallbackScreen() {
  const [status, setStatus] = useState('Processing authorization...');
  const navigation = useNavigation();
  const route = useRoute();

  useEffect(() => {
    (async () => {
      try {
        // Get params from deep link
        const url = await Linking.getInitialURL();
        let code: string | null = null;
        let state: string | null = null;
        let publicKeyStr: string | null = null;

        if (url) {
          const parsed = Linking.parse(url);
          const params = parsed.queryParams || {};
          code = params.code as string;
          state = params.state as string;
          publicKeyStr = params.oauthub_public_key as string;
        }

        // Also check route params (from navigation)
        const routeParams = (route.params || {}) as any;
        code = code || routeParams.code;
        state = state || routeParams.state;
        publicKeyStr = publicKeyStr || routeParams.oauthub_public_key;

        if (!code || !state) {
          setStatus('Authorization failed — missing code or state.');
          setTimeout(() => navigation.navigate('Home' as never), 2000);
          return;
        }

        // Parse public key
        let publicKey = null;
        try { publicKey = JSON.parse(publicKeyStr || ''); } catch {}

        // Exchange auth code for access token (PKCE + CSRF handled by library)
        const { access_token } = await OAuthHubClient.exchangeToken({ code, state });

        // Store credentials locally
        await LocalDB.setAuthToken(access_token);
        if (publicKey) await LocalDB.setPublicKey(publicKey);

        setStatus('Authorization successful! Redirecting...');
        setTimeout(() => navigation.navigate('Home' as never), 500);
      } catch (err: any) {
        setStatus(err.message || 'Error processing authorization.');
        setTimeout(() => navigation.navigate('Home' as never), 2000);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.statusText}>{status}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: 18,
    color: '#374151',
  },
});
