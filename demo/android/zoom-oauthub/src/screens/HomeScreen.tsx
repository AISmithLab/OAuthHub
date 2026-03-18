import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import OAuthHubClient from '../lib/oauthub-client';
import * as LocalDB from '../storage/local-db';

const CALLBACK_URL = 'zoom-oauthub-demo://callback';

function buildOAuthHubManifest(): string {
  return [
    'TITLE: Zoom',
    'DESCRIPTION: Get all upcoming Zoom meetings',
    'PIPELINE: PullCalendarEvents->SelectEvents->FilterTime->FilterZoom',
    '',
    'PullCalendarEvents(type: "Pull", resourceType: "google_calendar", query: "{ events(calendarId) {...EventDetails} }")',
    'SelectEvents(type: "Select", field: "events")',
    'FilterTime(type: "Filter", operation: ">", field: "start.dateTime", targetValue: NOW)',
    'FilterZoom(type: "Filter", operation: "match", field: ["location", "description"], pattern: "zoom\\.us", requirement: "any")',
  ].join('\n');
}

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (iso.length === 10) return d.toLocaleDateString();
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    LocalDB.isAuthenticated().then(setIsAuthed);
  }, []);

  const handleSignIn = async () => {
    try {
      const manifest = buildOAuthHubManifest();
      const url = await OAuthHubClient.generateAuthUrl({
        provider: 'google_calendar',
        manifest,
        redirect: CALLBACK_URL,
        accessType: 'user_driven',
      });
      if (url) Linking.openURL(url);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFetchEvents = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const token = await LocalDB.getAuthToken();
      if (!token) throw new Error('No access token');

      const manifest = buildOAuthHubManifest();
      const result = await OAuthHubClient.query({ token, manifest });

      // Store rotated token
      await LocalDB.setAuthToken(result.token);

      // Store and display events
      if (result.data && Array.isArray(result.data)) {
        await LocalDB.storeEvents(result.data);
        setEvents(result.data);
      } else {
        // Reload from local DB
        const stored = await LocalDB.getEvents();
        setEvents(stored);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const handleDisconnect = async () => {
    await LocalDB.clearAuth();
    setIsAuthed(false);
    setEvents([]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Zoom</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>Calendar Events</Text>

        {isAuthed ? (
          <>
            <View style={styles.connectedBadge}>
              <View style={styles.connectedDot} />
              <Text style={styles.connectedText}>Connected via OAuthHub</Text>
            </View>
            <TouchableOpacity
              onPress={handleFetchEvents}
              disabled={isFetching}
              style={[styles.fetchButton, isFetching && styles.fetchButtonDisabled]}
            >
              {isFetching ? (
                <View style={styles.fetchingRow}>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={styles.fetchButtonText}>Fetching...</Text>
                </View>
              ) : (
                <Text style={styles.fetchButtonText}>Fetch Calendar Events</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDisconnect} style={styles.disconnectButton}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={handleSignIn} style={styles.signInButton}>
            <Text style={styles.signInText}>Sign in with OAuthHub</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {events.length > 0 && (
          <View style={styles.eventsContainer}>
            <View style={styles.eventsHeader}>
              <Text style={styles.eventsTitle}>Upcoming Events</Text>
              <View style={styles.eventCountBadge}>
                <Text style={styles.eventCountText}>
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>
            <FlatList
              data={events}
              keyExtractor={(_, i) => String(i)}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.eventCard}>
                  <Text style={styles.eventSummary}>{item.summary}</Text>
                  <Text style={styles.eventTime}>
                    {formatTime(item.start?.dateTime || item.start)} — {formatTime(item.end?.dateTime || item.end)}
                  </Text>
                </View>
              )}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f3f4f6',
  },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 32,
    paddingVertical: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2563eb',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 48,
  },
  pageTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 24,
  },
  connectedBadge: {
    backgroundColor: '#ecfdf5',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectedDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
  },
  connectedText: {
    color: '#047857',
    fontSize: 14,
    fontWeight: '500',
  },
  fetchButton: {
    backgroundColor: '#2563eb',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 12,
  },
  fetchButtonDisabled: {
    backgroundColor: '#9ca3af',
  },
  fetchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fetchButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  disconnectButton: {
    marginBottom: 24,
  },
  disconnectText: {
    color: '#9ca3af',
    fontSize: 14,
  },
  signInButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  signInText: {
    color: '#374151',
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 16,
    width: '100%',
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 14,
  },
  eventsContainer: {
    width: '100%',
    marginTop: 24,
  },
  eventsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
  },
  eventCountBadge: {
    backgroundColor: '#dbeafe',
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  eventCountText: {
    color: '#1e40af',
    fontSize: 12,
    fontWeight: 'bold',
  },
  eventCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  eventSummary: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  eventTime: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
});
