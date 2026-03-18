// BASELINE: Fetches ALL emails via direct Gmail API access.
// The app sees every email in the user's inbox — not just flight-related ones.
// Compare with the OAuthHub version which scopes data to only flight snippets.

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signIn, getValidToken } from '../lib/google-auth';
import * as LocalDB from '../storage/local-db';

interface EmailItem {
  subject: string;
  from: string;
  snippet: string;
}

/**
 * Fetch email metadata directly from the Gmail API.
 *
 * KEY DIFFERENCE FROM OAUTHUB VERSION:
 * - Fetches ALL emails, not just flight-related ones
 * - Shows subject, from, and full snippet for every email
 * - Demonstrates over-fetching — the app sees ALL email metadata
 *   even though it only needs flight info
 */
async function fetchEmails(accessToken: string): Promise<EmailItem[]> {
  // Step 1: List message IDs
  const listRes = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) {
    const body = await listRes.text();
    throw new Error(`Gmail list failed (${listRes.status}): ${body}`);
  }
  const listData = await listRes.json();
  const messageIds: string[] = (listData.messages ?? []).map((m: any) => m.id);

  if (messageIds.length === 0) return [];

  // Step 2: Fetch metadata for each message
  const emails: EmailItem[] = [];
  for (const id of messageIds) {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!msgRes.ok) continue;
    const msgData = await msgRes.json();

    const headers: { name: string; value: string }[] = msgData.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)';
    const from = headers.find((h) => h.name === 'From')?.value ?? '(unknown sender)';
    const snippet: string = msgData.snippet ?? '';

    emails.push({ subject, from, snippet });
  }

  return emails;
}

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    LocalDB.isAuthenticated().then(setIsAuthed);
  }, []);

  // ── Sign in via direct Google OAuth ─────────────────────────────

  const handleSignIn = async () => {
    setError(null);
    try {
      const tokens = await signIn();
      await LocalDB.setAuthTokens(
        tokens.accessToken,
        tokens.refreshToken,
        tokens.accessTokenExpirationDate,
      );
      setIsAuthed(true);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // ── Fetch all emails from Gmail ─────────────────────────────────

  const handleScanEmails = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const storedAccess = await LocalDB.getAuthToken();
      const storedRefresh = await LocalDB.getRefreshToken();
      const storedExpiry = await LocalDB.getTokenExpiry();
      if (!storedAccess || !storedExpiry) throw new Error('No access token');

      const validTokens = await getValidToken(storedAccess, storedRefresh, storedExpiry);
      if (!validTokens) throw new Error('Session expired. Please sign in again.');

      // Persist potentially-refreshed tokens
      await LocalDB.setAuthTokens(
        validTokens.accessToken,
        validTokens.refreshToken,
        validTokens.accessTokenExpirationDate,
      );

      const results = await fetchEmails(validTokens.accessToken);
      await LocalDB.storeEmails(results);
      setEmails(results);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsFetching(false);
    }
  };

  // ── Disconnect ──────────────────────────────────────────────────

  const handleDisconnect = async () => {
    await LocalDB.clearAuth();
    setIsAuthed(false);
    setEmails([]);
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>UberTravel</Text>
      </View>

      <FlatList
        data={emails}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <Text style={styles.heroTitle}>Flight Itineraries</Text>
            <Text style={styles.heroSubtitle}>
              Extract flight information from your emails to plan rides upon arrival.
            </Text>

            {isAuthed ? (
              <>
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedText}>Connected to Gmail</Text>
                </View>

                <TouchableOpacity
                  onPress={handleScanEmails}
                  disabled={isFetching}
                  style={[
                    styles.scanButton,
                    isFetching ? styles.scanButtonDisabled : null,
                  ]}
                >
                  {isFetching ? (
                    <View style={styles.scanningRow}>
                      <ActivityIndicator size="small" color="white" />
                      <Text style={styles.scanButtonText}>Scanning...</Text>
                    </View>
                  ) : (
                    <Text style={styles.scanButtonText}>Scan Emails</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={handleDisconnect}>
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

            {emails.length > 0 && (
              <View style={styles.emailsHeaderWrapper}>
                <Text style={styles.emailsHeaderText}>
                  All Emails ({emails.length})
                </Text>
              </View>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.emailCard}>
            <Text style={styles.emailSubject} numberOfLines={1}>
              {item.subject}
            </Text>
            <Text style={styles.emailFrom} numberOfLines={1}>
              {item.from}
            </Text>
            <Text style={styles.emailSnippet} numberOfLines={2}>
              {item.snippet}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          isAuthed && !isFetching && emails.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                Tap "Scan Emails" to fetch your inbox.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
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
  listHeader: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  heroTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#111827', // gray-900
    marginBottom: 8,
  },
  heroSubtitle: {
    color: '#6b7280', // gray-500
    textAlign: 'center',
    marginBottom: 24,
  },
  connectedBadge: {
    backgroundColor: '#ecfdf5', // emerald-50
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
  },
  connectedText: {
    color: '#047857', // emerald-700
    fontSize: 12,
    fontWeight: '500',
  },
  scanButton: {
    backgroundColor: '#2563eb', // blue-600
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 12,
  },
  scanButtonDisabled: {
    backgroundColor: '#9ca3af', // gray-400
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scanButtonText: {
    color: '#ffffff',
    fontWeight: '500',
  },
  disconnectText: {
    color: '#9ca3af', // gray-400
    fontSize: 12,
  },
  signInButton: {
    borderWidth: 1,
    borderColor: '#d1d5db', // gray-300
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
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
    fontSize: 12,
  },
  emailsHeaderWrapper: {
    width: '100%',
    marginTop: 24,
  },
  emailsHeaderText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151', // gray-700
    marginBottom: 12,
  },
  emailCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
  },
  emailSubject: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827', // gray-900
    marginBottom: 4,
  },
  emailFrom: {
    fontSize: 12,
    color: '#9ca3af', // gray-400
    marginBottom: 4,
  },
  emailSnippet: {
    fontSize: 14,
    color: '#6b7280', // gray-500
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    color: '#9ca3af', // gray-400
    fontSize: 12,
  },
});
