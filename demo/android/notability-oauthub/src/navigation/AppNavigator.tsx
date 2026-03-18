import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import HomeScreen from '../screens/HomeScreen';
import CallbackScreen from '../screens/CallbackScreen';

const Stack = createNativeStackNavigator();

const linking = {
  prefixes: [Linking.createURL('/'), 'notability-oauthub-demo://'],
  config: { screens: { Home: '', Callback: 'callback' } },
};

export default function AppNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Callback" component={CallbackScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
