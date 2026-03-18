import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import AppNavigator from './src/navigation/AppNavigator';
import { configure as configureGoogleAuth } from './src/lib/google-auth';

const GOOGLE_OAUTH_CLIENT_ID =
  Constants.expoConfig?.extra?.googleOAuthClientId ?? '';

configureGoogleAuth(GOOGLE_OAUTH_CLIENT_ID);

export default function App() {
  return (
    <SafeAreaProvider>
      <AppNavigator />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
