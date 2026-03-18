import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import OAuthHubClient from '../lib/oauthub-client';
import * as LocalDB from '../storage/local-db';

const CALLBACK_URL = 'uber-travel-oauthub-demo://callback';

function buildOAuthHubManifest(): string {
  return [
    'TITLE: Uber',
    'DESCRIPTION: Get only flight-related email snippets',
    'PIPELINE: PullGmail->SelectMessages->FilterFlights',
    '',
    'PullGmail(type: "Pull", resourceType: "gmail", query: "{ messages(userId) { snippet } }")',
    'SelectMessages(type: "Select", field: "messages")',
    'FilterFlights(type: "Filter", operation: "include", field: "snippet", targetValue: "flight")',
  ].join('\n');
}

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [flights, setFlights] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { LocalDB.isAuthenticated().then(setIsAuthed); }, []);

  const handleSignIn = async () => {
    try {
      const url = await OAuthHubClient.generateAuthUrl({
        provider: 'gmail',
        manifest: buildOAuthHubManifest(),
        redirect: CALLBACK_URL,
        accessType: 'user_driven',
      });
      if (url) Linking.openURL(url);
    } catch (err: any) { setError(err.message); }
  };

  const handleFetchFlights = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const token = await LocalDB.getAuthToken();
      if (!token) throw new Error('No access token');
      const result = await OAuthHubClient.query({ token, manifest: buildOAuthHubManifest() });
      await LocalDB.setAuthToken(result.token);
      if (result.data && Array.isArray(result.data)) {
        await LocalDB.storeFlights(result.data);
        setFlights(result.data);
      }
    } catch (err: any) { setError(err.message); }
    finally { setIsFetching(false); }
  };

  const handleDisconnect = async () => {
    await LocalDB.clearAuth();
    setIsAuthed(false);
    setFlights([]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>UberTravel</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.pageTitle}>Flight Itineraries</Text>
        <Text style={styles.pageSubtitle}>
          Extract flight information from your emails to plan rides upon arrival.
        </Text>

        {isAuthed ? (
          <>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedBadgeText}>Connected via OAuthHub</Text>
            </View>
            <TouchableOpacity
              onPress={handleFetchFlights}
              disabled={isFetching}
              style={[styles.scanButton, isFetching && styles.scanButtonDisabled]}
            >
              {isFetching ? (
                <View style={styles.scanButtonInner}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.scanButtonText}>Scanning...</Text>
                </View>
              ) : (
                <Text style={styles.scanButtonText}>Scan Emails for Flights</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDisconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={handleSignIn} style={styles.signInButton}>
            <Text style={styles.signInButtonText}>Sign in with OAuthHub</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {isAuthed && !isFetching && flights.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateText}>
              Tap "Scan Emails for Flights" to get started.
            </Text>
          </View>
        )}

        {flights.length > 0 && (
          <View style={styles.flightsList}>
            <Text style={styles.flightsListTitle}>Extracted Flights ({flights.length})</Text>
            <FlatList
              data={flights}
              keyExtractor={(_, i) => String(i)}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.flightCard}>
                  {item.subject ? (
                    <Text style={styles.flightSubject}>{item.subject}</Text>
                  ) : null}
                  <Text style={styles.flightSnippet} numberOfLines={2}>{item.body ?? item.snippet}</Text>
                </View>
              )}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    elevation: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1565C0',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 48,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#212121',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 14,
    color: '#757575',
    textAlign: 'center',
    marginBottom: 24,
  },
  connectedBadge: {
    backgroundColor: '#E8F5E9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
  },
  connectedBadgeText: {
    color: '#2E7D32',
    fontSize: 13,
    fontWeight: '500',
  },
  scanButton: {
    backgroundColor: '#1565C0',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
    marginBottom: 12,
  },
  scanButtonDisabled: {
    backgroundColor: '#9E9E9E',
  },
  scanButtonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanButtonText: {
    color: '#FFFFFF',
    fontWeight: '500',
    fontSize: 15,
  },
  disconnectText: {
    color: '#9E9E9E',
    fontSize: 13,
  },
  signInButton: {
    borderWidth: 1,
    borderColor: '#BDBDBD',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  signInButtonText: {
    color: '#424242',
    fontWeight: '500',
    fontSize: 15,
  },
  errorBox: {
    backgroundColor: '#FFEBEE',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 16,
    width: '100%',
  },
  errorText: {
    color: '#C62828',
    fontSize: 13,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyStateText: {
    color: '#9E9E9E',
    fontSize: 13,
  },
  flightsList: {
    width: '100%',
    marginTop: 24,
  },
  flightsListTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#424242',
    marginBottom: 12,
  },
  flightCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#EEEEEE',
    elevation: 1,
  },
  flightSubject: {
    fontSize: 14,
    fontWeight: '500',
    color: '#212121',
    marginBottom: 4,
  },
  flightSnippet: {
    fontSize: 14,
    color: '#757575',
  },
});
