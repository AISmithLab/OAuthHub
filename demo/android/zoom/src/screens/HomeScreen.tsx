// BASELINE: Shows ALL calendar events — no filtering, no manifest.
// Compare with the OAuthHub version which only surfaces Zoom meetings.

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as GoogleAuth from '../lib/google-auth';
import * as LocalDB from '../storage/local-db';

const CALENDAR_API =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (iso.length === 10) return d.toLocaleDateString();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const authed = await LocalDB.isAuthenticated();
      setIsAuthed(authed);
      if (authed) {
        // Restore cached tokens into memory
        const stored = await LocalDB.getAuthTokens();
        if (stored) GoogleAuth.setCachedTokens(stored);
        // Restore cached events
        const cached = await LocalDB.getEvents();
        if (cached.length > 0) setEvents(cached);
      }
    })();
  }, []);

  const handleSignIn = async () => {
    setError(null);
    try {
      const tokens = await GoogleAuth.signIn();
      await LocalDB.setAuthTokens(tokens);
      setIsAuthed(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleFetchEvents = async () => {
    setIsFetching(true);
    setError(null);
    try {
      // Get stored tokens and ensure they're valid
      let tokens = await LocalDB.getAuthTokens();
      if (!tokens) throw new Error('No auth tokens found. Please sign in again.');

      tokens = await GoogleAuth.getValidToken(tokens);
      await LocalDB.setAuthTokens(tokens);

      // Fetch ALL upcoming events from Google Calendar API directly
      const now = new Date().toISOString();
      const url = `${CALENDAR_API}?timeMin=${encodeURIComponent(now)}&maxResults=50&orderBy=startTime&singleEvents=true`;

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Calendar API error (${response.status}): ${body}`);
      }

      const json = await response.json();
      const items = json.items || [];

      // Store and display ALL events — no filtering
      await LocalDB.storeEvents(items);
      setEvents(items);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  const handleDisconnect = async () => {
    GoogleAuth.setCachedTokens(null);
    await LocalDB.clearAuth();
    setIsAuthed(false);
    setEvents([]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Zoom</Text>
        <Text style={styles.headerSubtitle}>Baseline (Direct Google OAuth)</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>Calendar Events</Text>

        {isAuthed ? (
          <>
            {/* Connection badge — green, says Google Calendar (not OAuthHub) */}
            <View style={styles.connectionBadge}>
              <View style={styles.connectionDot} />
              <Text style={styles.connectionText}>
                Connected to Google Calendar
              </Text>
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
          <TouchableOpacity
            onPress={handleSignIn}
            style={styles.signInButton}
          >
            <Text style={styles.signInText}>Sign in with Google</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {events.length > 0 && (
          <View style={styles.eventsContainer}>
            {/* Event count badge — highlights that ALL events are returned */}
            <View style={styles.eventsHeaderRow}>
              <Text style={styles.eventsHeaderTitle}>All Upcoming Events</Text>
              <View style={styles.eventCountBadge}>
                <Text style={styles.eventCountText}>
                  {events.length} event{events.length !== 1 ? 's' : ''}
                </Text>
              </View>
            </View>

            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                Showing ALL calendar events. The OAuthHub version only shows Zoom meetings.
              </Text>
            </View>

            <FlatList
              data={events}
              keyExtractor={(item, i) => item.id || String(i)}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.eventCard}>
                  {/* Event summary */}
                  <Text style={styles.eventSummary}>
                    {item.summary || '(No title)'}
                  </Text>

                  {/* Time */}
                  <Text style={styles.eventTime}>
                    {formatTime(item.start?.dateTime || item.start?.date)} —{' '}
                    {formatTime(item.end?.dateTime || item.end?.date)}
                  </Text>

                  {/* Location — full detail exposed in baseline */}
                  {item.location ? (
                    <Text style={styles.eventDetail} numberOfLines={1}>
                      Location: {item.location}
                    </Text>
                  ) : null}

                  {/* Description preview — full detail exposed in baseline */}
                  {item.description ? (
                    <Text style={styles.eventDetail} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : null}

                  {/* Attendees count — full detail exposed in baseline */}
                  {item.attendees && item.attendees.length > 0 ? (
                    <Text style={styles.eventDetail}>
                      {item.attendees.length} attendee{item.attendees.length !== 1 ? 's' : ''}
                    </Text>
                  ) : null}

                  {/* Organizer */}
                  {item.organizer?.email ? (
                    <Text style={styles.eventDetail}>
                      Organizer: {item.organizer.displayName || item.organizer.email}
                    </Text>
                  ) : null}
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
  safeArea: {
    flex: 1,
    backgroundColor: '#f3f4f6', // gray-100
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
    color: '#2563eb', // blue-600
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#9ca3af', // gray-400
    marginTop: 2,
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
    color: '#111827', // gray-900
    marginBottom: 24,
  },
  connectionBadge: {
    backgroundColor: '#ecfdf5', // emerald-50
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  connectionDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981', // emerald-500
  },
  connectionText: {
    color: '#047857', // emerald-700
    fontSize: 14,
    fontWeight: '500',
  },
  fetchButton: {
    backgroundColor: '#2563eb', // blue-600
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 12,
  },
  fetchButtonDisabled: {
    backgroundColor: '#9ca3af', // gray-400
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
    color: '#9ca3af', // gray-400
    fontSize: 14,
  },
  signInButton: {
    borderWidth: 1,
    borderColor: '#d1d5db', // gray-300
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
  },
  signInText: {
    color: '#374151', // gray-700
    fontWeight: '500',
  },
  errorBox: {
    backgroundColor: '#fef2f2', // red-50
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 16,
    width: '100%',
  },
  errorText: {
    color: '#b91c1c', // red-700
    fontSize: 14,
  },
  eventsContainer: {
    width: '100%',
    marginTop: 24,
  },
  eventsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  eventsHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151', // gray-700
  },
  eventCountBadge: {
    backgroundColor: '#fef3c7', // amber-100
    borderRadius: 9999,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  eventCountText: {
    color: '#92400e', // amber-800
    fontSize: 12,
    fontWeight: 'bold',
  },
  warningBanner: {
    backgroundColor: '#fffbeb', // amber-50
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fde68a', // amber-200
  },
  warningText: {
    color: '#b45309', // amber-700
    fontSize: 12,
  },
  eventCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
  },
  eventSummary: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827', // gray-900
  },
  eventTime: {
    fontSize: 14,
    color: '#6b7280', // gray-500
    marginTop: 4,
  },
  eventDetail: {
    fontSize: 12,
    color: '#9ca3af', // gray-400
    marginTop: 4,
  },
});
