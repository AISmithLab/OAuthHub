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
    name: 'UberTravel (OAuthHub Demo)',
    slug: 'uber-travel-oauthub-demo',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'uber-travel-oauthub-demo',
    android: {
      package: 'com.oauthub.demo.ubertravel',
      intentFilters: [
        {
          action: 'VIEW',
          data: [{ scheme: 'uber-travel-oauthub-demo' }],
          category: ['DEFAULT', 'BROWSABLE'],
        },
      ],
    },
    plugins: ['expo-sqlite', 'expo-asset', 'expo-font'],
    extra: {
      googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
    },
  },
};
