import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import AppNavigator from './src/navigation/AppNavigator';
import { HttpServer } from './src/ipc/http-server';
import { configureGoogleOAuth } from './src/platform/token-manager';

// Read from app.json extra config or environment variable
const GOOGLE_OAUTH_CLIENT_ID =
  Constants.expoConfig?.extra?.googleOAuthClientId ?? '';

const httpServer = new HttpServer();

export default function App() {
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    configureGoogleOAuth({ clientId: GOOGLE_OAUTH_CLIENT_ID });

    (async () => {
      // Request notification permission on Android 13+ (needed for foreground service)
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
          );
        } catch (_) {}
      }

      try {
        await httpServer.start();
      } catch (err: any) {
        const msg = err?.message || 'Unknown error';
        console.warn('HTTP server start failed:', msg);
        setServerError(`IPC server failed to start: ${msg}`);
      }
    })();

    return () => {
      httpServer.stop();
    };
  }, []);

  return (
    <SafeAreaProvider>
      {serverError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{serverError}</Text>
        </View>
      )}
      <AppNavigator />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: '#fef2f2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 13,
    textAlign: 'center',
  },
});
