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
    name: 'OAuthHub',
    slug: 'oauthub',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'oauthub',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    splash: {
      backgroundColor: '#1e40af',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#1e40af',
      },
      package: 'com.oauthub.android',
      permissions: [
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        'android.permission.POST_NOTIFICATIONS',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: true,
          data: [
            { scheme: 'oauthub', host: 'authorize' },
            { scheme: 'oauthub', host: 'callback' },
          ],
          category: ['DEFAULT', 'BROWSABLE'],
        },
      ],
    },
    plugins: ['expo-sqlite', 'expo-asset', 'expo-font', '@react-native-google-signin/google-signin'],
    extra: {
      googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    },
  },
};
