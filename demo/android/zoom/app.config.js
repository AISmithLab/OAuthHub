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
    name: 'Zoom (Baseline Demo)',
    slug: 'zoom-baseline-demo',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'zoom-baseline-demo',
    android: {
      package: 'com.oauthub.demo.zoom.baseline',
      intentFilters: [
        {
          action: 'VIEW',
          data: [{ scheme: 'zoom-baseline-demo' }],
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
