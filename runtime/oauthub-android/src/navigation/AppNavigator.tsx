import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import DashboardScreen from '../screens/DashboardScreen';
import ConsentScreen from '../screens/ConsentScreen';
import ManifestsScreen from '../screens/ManifestsScreen';
import ServicesScreen from '../screens/ServicesScreen';
import LogsScreen from '../screens/LogsScreen';
import { DeepLinkHandler } from '../ipc/deep-link-handler';

export type RootStackParamList = {
  Dashboard: undefined;
  Consent: {
    provider?: string;
    manifest?: string;
    redirectUri?: string;
    state?: string;
    accessType?: string;
    schedule?: string;
    codeChallenge?: string;
  };
  Manifests: undefined;
  Services: undefined;
  Logs: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

const linking = {
  prefixes: [Linking.createURL('/'), 'oauthub://'],
  config: {
    screens: {
      Dashboard: '',
      // Consent is handled by DeepLinkHandler to preserve raw query params
      Manifests: 'manifests',
      Services: 'services',
      Logs: 'logs',
    },
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer ref={navigationRef} linking={linking}>
      <DeepLinkHandler navigationRef={navigationRef} />
      <Stack.Navigator
        initialRouteName="Dashboard"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Dashboard" component={DashboardScreen} />
        <Stack.Screen name="Consent" component={ConsentScreen} />
        <Stack.Screen name="Manifests" component={ManifestsScreen} />
        <Stack.Screen name="Services" component={ServicesScreen} />
        <Stack.Screen name="Logs" component={LogsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
