import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Linking from 'expo-linking';
import DemoSuiteScreen from '../screens/DemoSuiteScreen';

const Stack = createNativeStackNavigator();

const linking = {
  prefixes: [Linking.createURL('/'), 'com.oauthub.demo://'],
  config: {
    screens: {
      Demo: '',
    },
  },
};

export default function AppNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Demo" component={DemoSuiteScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
