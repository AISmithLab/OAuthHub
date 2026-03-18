const fs = require('fs');
const path = require('path');

// Load .env file
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2];
    }
  }
}

module.exports = {
  expo: {
    name: 'OAuthHub Demo Suite',
    slug: 'oauthhub-demo',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'com.oauthub.demo',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#f59e0b',
      },
      package: 'com.oauthub.demo',
      intentFilters: [
        {
          action: 'VIEW',
          data: [{ scheme: 'com.oauthub.demo' }],
          category: ['DEFAULT', 'BROWSABLE'],
        },
      ],
    },
    plugins: [
      'expo-asset',
      'expo-font',
      'expo-sqlite',
      'expo-document-picker',
      '@react-native-google-signin/google-signin',
    ],
    extra: {
      googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    },
  },
};
