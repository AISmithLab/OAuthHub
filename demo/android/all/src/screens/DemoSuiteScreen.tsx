import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import {
  APP_OPTIONS,
  VERSION_IDS,
  getVersionConfig,
  getVersionForApp,
  getEmptyData,
  type AuthMode,
  type CalendarEventItem,
  type DemoId,
  type DriveFileItem,
  type FlightItem,
  type OAuthHubVersionConfig,
  type StoredDemoData,
  type VersionId,
} from '../lib/demo-config';
import * as GoogleAuth from '../lib/google-auth';
import OAuthHubClient from '../lib/oauthub-client';
import * as DB from '../storage/demo-db';

const CALLBACK_URL = 'com.oauthub.demo://callback';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

// ── Per-version view state ─────────────────────────────────────────────

type ViewState = {
  isAuthed: boolean;
  isSigningIn: boolean;
  isFetching: boolean;
  isBackingUp: boolean;
  data: StoredDemoData;
  selectedFile: { name: string; uri: string; mimeType: string } | null;
  showData: boolean;
  error: string | null;
};

function createViewState(version: VersionId): ViewState {
  return {
    isAuthed: false,
    isSigningIn: false,
    isFetching: false,
    isBackingUp: false,
    data: getEmptyData(version),
    selectedFile: null,
    showData: false,
    error: null,
  };
}

// ── Main component ─────────────────────────────────────────────────────

export default function DemoSuiteScreen() {
  const [selectedApp, setSelectedApp] = useState<DemoId>('zoom');
  const [authMode, setAuthMode] = useState<AuthMode>('google');

  const selectedVersion = getVersionForApp(selectedApp, authMode);
  const config = getVersionConfig(selectedVersion);

  const [viewStates, setViewStates] = useState<Record<VersionId, ViewState>>(
    () =>
      VERSION_IDS.reduce(
        (acc, v) => ({ ...acc, [v]: createViewState(v) }),
        {} as Record<VersionId, ViewState>,
      ),
  );

  const viewState = viewStates[selectedVersion];

  const update = useCallback((version: VersionId, patch: Partial<ViewState>) => {
    setViewStates(prev => ({
      ...prev,
      [version]: { ...prev[version], ...patch },
    }));
  }, []);

  // ── Restore auth status when version changes ────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const isAuthed = await DB.isAuthenticated(selectedVersion);
      const cached = await DB.getData(selectedVersion);
      if (cancelled) return;
      update(selectedVersion, {
        isAuthed,
        data: cached ?? getEmptyData(selectedVersion),
        showData: cached !== null,
      });
    })();
    return () => { cancelled = true; };
  }, [selectedVersion, update]);

  // ── Deep-link callback (OAuthHub auth returns here) ─────────────────

  useEffect(() => {
    const processCallback = async (url: string) => {
      console.log('[Demo] processCallback url:', url?.substring(0, 120));
      if (!url.includes('com.oauthub.demo://callback')) return;
      try {
        const parsed = Linking.parse(url);
        const params = parsed.queryParams ?? {};
        const code = params.code as string | null;
        const state = params.state as string | null;
        const publicKeyStr = params.oauthub_public_key as string | null;
        console.log('[Demo] code:', code?.substring(0, 20), 'state:', state?.substring(0, 20));
        if (!code || !state) { console.warn('[Demo] Missing code or state'); return; }

        const pendingVersion = await DB.getPendingVersion();
        console.log('[Demo] pendingVersion:', pendingVersion);
        if (!pendingVersion) { console.warn('[Demo] No pending version'); return; }

        // Restore PKCE state from DB (may have been lost if process was killed)
        const savedPKCE = await DB.loadPKCE();
        console.log('[Demo] PKCE restored:', !!savedPKCE.state, !!savedPKCE.codeVerifier);
        if (savedPKCE.state && savedPKCE.codeVerifier) {
          OAuthHubClient.restorePKCE(savedPKCE.state, savedPKCE.codeVerifier);
        }
        await DB.clearPKCE();
        await DB.clearPendingVersion();

        console.log('[Demo] Calling exchangeToken...');
        const { access_token } = await OAuthHubClient.exchangeToken({ code, state });
        console.log('[Demo] Got access_token:', !!access_token);
        await DB.setOAuthHubToken(pendingVersion, access_token);

        if (publicKeyStr) {
          try {
            await DB.setPublicKey(pendingVersion, JSON.parse(publicKeyStr));
          } catch {}
        }

        update(pendingVersion, { isAuthed: true, isSigningIn: false, error: null });
        console.log('[Demo] Auth complete');
      } catch (err: any) {
        console.error('[Demo] processCallback error:', err.message);
        const pendingVersion = await DB.getPendingVersion();
        if (pendingVersion) {
          await DB.clearPendingVersion();
          update(pendingVersion, { isSigningIn: false, error: err.message });
        }
      }
    };

    const sub = Linking.addEventListener('url', ({ url }) => void processCallback(url));
    Linking.getInitialURL().then(url => {
      console.log('[Demo] getInitialURL:', url?.substring(0, 80));
      if (url) void processCallback(url);
    });
    return () => sub.remove();
  }, [update]);

  // ── Sign in ──────────────────────────────────────────────────────────

  const handleSignIn = async () => {
    update(selectedVersion, { error: null, isSigningIn: true });
    try {
      if (config.authMode === 'google') {
        const tokens = await GoogleAuth.signIn(config.googleScopes);
        await DB.setGoogleTokens(selectedVersion, tokens);
        update(selectedVersion, { isAuthed: true, isSigningIn: false });
      } else {
        const ohConfig = config as OAuthHubVersionConfig;
        await DB.setPendingVersion(selectedVersion);
        const url = await OAuthHubClient.generateAuthUrl({
          provider: ohConfig.oauthHubProvider,
          manifest: ohConfig.buildManifest(),
          redirect: CALLBACK_URL,
          accessType: 'user_driven',
        });
        // Persist PKCE state to DB (survives process death while OAuthHub is in foreground)
        const pkce = OAuthHubClient.getPKCEState();
        if (pkce.state && pkce.codeVerifier) {
          await DB.savePKCE(pkce.state, pkce.codeVerifier);
        }
        if (url) await Linking.openURL(url);
      }
    } catch (err: any) {
      await DB.clearPendingVersion();
      update(selectedVersion, { isSigningIn: false, error: err.message });
    }
  };

  // ── Fetch data ──────────────────────────────────────────────────────

  const executeFetch = async (version: VersionId): Promise<StoredDemoData> => {
    const cfg = getVersionConfig(version);

    if (cfg.authMode === 'google') {
      const stored = await DB.getGoogleTokens(version);
      if (!stored) throw new Error('Not signed in.');
      const valid = await GoogleAuth.getValidToken(
        { ...stored, idToken: null },
        cfg.googleScopes,
      );
      await DB.setGoogleTokens(version, valid);
      const at = valid.accessToken;

      switch (cfg.demoId) {
        case 'zoom': {
          const now = new Date().toISOString();
          const res = await fetch(
            `${CALENDAR_API}?timeMin=${encodeURIComponent(now)}&maxResults=50&orderBy=startTime&singleEvents=true`,
            { headers: { Authorization: `Bearer ${at}` } },
          );
          if (!res.ok) throw new Error(`Calendar API error (${res.status})`);
          const json = await res.json();
          return { events: json.items ?? [] };
        }
        case 'uber-travel': {
          const listRes = await fetch(
            'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
            { headers: { Authorization: `Bearer ${at}` } },
          );
          if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
          const listData = await listRes.json();
          const ids: string[] = (listData.messages ?? []).map((m: any) => m.id);
          const flights: FlightItem[] = [];
          for (const id of ids) {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
              { headers: { Authorization: `Bearer ${at}` } },
            );
            if (!msgRes.ok) continue;
            const msgData = await msgRes.json();
            const hdrs: { name: string; value: string }[] = msgData.payload?.headers ?? [];
            flights.push({
              subject: hdrs.find(h => h.name === 'Subject')?.value ?? '(no subject)',
              snippet: msgData.snippet ?? '',
            });
          }
          return { flights };
        }
        case 'notability': {
          const res = await fetch(
            'https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType,modifiedTime,parents)&orderBy=modifiedTime%20desc',
            { headers: { Authorization: `Bearer ${at}` } },
          );
          if (!res.ok) throw new Error(`Drive API error (${res.status})`);
          const json = await res.json();
          return { files: json.files ?? [] };
        }
      }
    } else {
      const token = await DB.getOAuthHubToken(version);
      if (!token) throw new Error('No OAuthHub access token.');
      const ohCfg = cfg as OAuthHubVersionConfig;
      const result = await OAuthHubClient.query({
        token,
        manifest: ohCfg.buildManifest(),
        operation: ohCfg.queryOperation,
      });
      await DB.setOAuthHubToken(version, result.token);
      const items: any[] = Array.isArray(result.data) ? result.data : [];
      switch (cfg.demoId) {
        case 'zoom':
          return { events: items };
        case 'uber-travel':
          return { flights: items };
        case 'notability':
          return { files: items };
      }
    }
  };

  const handleFetch = async () => {
    update(selectedVersion, { error: null, isFetching: true });
    try {
      const data = await executeFetch(selectedVersion);
      await DB.setData(selectedVersion, data);
      update(selectedVersion, { data, showData: true });
    } catch (err: any) {
      update(selectedVersion, { error: err.message });
    } finally {
      update(selectedVersion, { isFetching: false });
    }
  };

  // ── File backup (Notability) ─────────────────────────────────────────

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        update(selectedVersion, {
          selectedFile: {
            name: asset.name,
            uri: asset.uri,
            mimeType: asset.mimeType ?? 'application/octet-stream',
          },
        });
      }
    } catch (err: any) {
      update(selectedVersion, { error: err.message });
    }
  };

  const handleBackup = async () => {
    if (!viewState.selectedFile) return;
    update(selectedVersion, { error: null, isBackingUp: true });
    try {
      const contentBase64 = await FileSystem.readAsStringAsync(viewState.selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      if (config.authMode === 'google') {
        const stored = await DB.getGoogleTokens(selectedVersion);
        if (!stored) throw new Error('Not signed in.');
        const valid = await GoogleAuth.getValidToken(
          { ...stored, idToken: null },
          config.googleScopes,
        );
        await DB.setGoogleTokens(selectedVersion, valid);

        const boundary = 'oauthhub_demo_boundary';
        const metadata = {
          name: viewState.selectedFile.name,
          mimeType: viewState.selectedFile.mimeType,
        };
        const body =
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n` +
          `Content-Transfer-Encoding: base64\r\n\r\n${contentBase64}\r\n` +
          `--${boundary}--`;

        const res = await fetch(
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${valid.accessToken}`,
              'Content-Type': `multipart/related; boundary=${boundary}`,
            },
            body,
          },
        );
        if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      } else {
        const token = await DB.getOAuthHubToken(selectedVersion);
        if (!token) throw new Error('No OAuthHub access token.');
        const ohCfg = config as OAuthHubVersionConfig;
        const result = await OAuthHubClient.query({
          token,
          manifest: ohCfg.buildManifest(),
          operation: 'write',
          data: {
            name: viewState.selectedFile.name,
            mimeType: viewState.selectedFile.mimeType,
            contentBase64,
            parents: ['Notability'],
          },
        });
        await DB.setOAuthHubToken(selectedVersion, result.token);
      }

      update(selectedVersion, { selectedFile: null });
      await handleFetch();
    } catch (err: any) {
      update(selectedVersion, { error: err.message });
    } finally {
      update(selectedVersion, { isBackingUp: false });
    }
  };

  // ── Disconnect ────────────────────────────────────────────────────────

  const handleDisconnect = async () => {
    await DB.clearAuth(selectedVersion);
    update(selectedVersion, createViewState(selectedVersion));
  };

  // ── Render ────────────────────────────────────────────────────────────

  const isOAuthHub = config.authMode === 'oauthhub';

  return (
    <SafeAreaView style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>{config.brandName}</Text>
      </View>

      <ScrollView
        style={s.scrollView}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* App selector — horizontal scroll pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.appSelector}
          contentContainerStyle={s.appSelectorContent}
        >
          {APP_OPTIONS.map(option => (
            <TouchableOpacity
              key={option.id}
              onPress={() => setSelectedApp(option.id)}
              style={[
                s.pill,
                selectedApp === option.id ? s.pillActive : s.pillInactive,
              ]}
            >
              <Text
                style={[
                  s.pillText,
                  selectedApp === option.id ? s.pillTextActive : s.pillTextInactive,
                ]}
              >
                {option.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Auth mode toggle */}
        <View style={s.toggleRow}>
          {(['google', 'oauthhub'] as AuthMode[]).map(mode => (
            <TouchableOpacity
              key={mode}
              onPress={() => setAuthMode(mode)}
              style={[s.toggleItem, authMode === mode && s.toggleItemActive]}
            >
              <Text
                style={[
                  s.toggleText,
                  authMode === mode ? s.toggleTextActive : s.toggleTextInactive,
                ]}
              >
                {mode === 'google' ? 'Google OAuth' : 'OAuthHub'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Heading + description */}
        <Text style={s.heading}>{config.heading}</Text>
        <Text style={s.description}>{config.description}</Text>

        {/* Connected / sign-in state */}
        {viewState.isAuthed ? (
          <>
            {/* Connection badge */}
            <View
              style={[
                s.connectionBadge,
                isOAuthHub ? s.connectionBadgeOH : s.connectionBadgeGoogle,
              ]}
            >
              <View
                style={[s.connectionDot, isOAuthHub ? s.dotOH : s.dotGoogle]}
              />
              <Text
                style={[
                  s.connectionText,
                  isOAuthHub ? s.connectionTextOH : s.connectionTextGoogle,
                ]}
              >
                {config.connectedLabel}
              </Text>
            </View>

            {/* File backup card (Notability) */}
            {config.supportsUpload && (
              <View style={s.uploadCard}>
                <TouchableOpacity onPress={handlePickFile} style={s.filePicker}>
                  <Text style={s.filePickerText}>
                    {viewState.selectedFile ? '✓ ' + viewState.selectedFile.name : 'Tap to choose a file'}
                  </Text>
                  {!viewState.selectedFile && (
                    <Text style={s.filePickerHint}>Any file type</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleBackup}
                  disabled={viewState.isBackingUp || !viewState.selectedFile}
                  style={[
                    s.backupButton,
                    (viewState.isBackingUp || !viewState.selectedFile) ? s.backupButtonDisabled : s.backupButtonActive,
                  ]}
                >
                  {viewState.isBackingUp ? (
                    <View style={s.fetchingRow}>
                      <ActivityIndicator size="small" color="white" />
                      <Text style={s.buttonTextWhite}>Backing up...</Text>
                    </View>
                  ) : (
                    <Text
                      style={!viewState.selectedFile ? s.buttonTextGray : s.buttonTextWhite}
                    >
                      {config.backupLabel ?? 'Backup'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Fetch button */}
            <TouchableOpacity
              onPress={handleFetch}
              disabled={viewState.isFetching || viewState.isBackingUp}
              style={[
                s.fetchButton,
                (viewState.isFetching || viewState.isBackingUp) ? s.fetchButtonDisabled : s.fetchButtonActive,
              ]}
            >
              {viewState.isFetching ? (
                <View style={s.fetchingRow}>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={s.buttonTextWhite}>Fetching...</Text>
                </View>
              ) : (
                <Text style={s.buttonTextWhite}>{config.fetchLabel}</Text>
              )}
            </TouchableOpacity>

            {/* Disconnect */}
            <TouchableOpacity onPress={handleDisconnect} style={s.disconnectButton}>
              <Text style={s.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          /* Sign-in button */
          <TouchableOpacity
            onPress={handleSignIn}
            disabled={viewState.isSigningIn}
            style={[
              s.signInButton,
              viewState.isSigningIn && s.signInButtonDisabled,
            ]}
          >
            {viewState.isSigningIn ? (
              <ActivityIndicator size="small" color="#6b7280" />
            ) : isOAuthHub ? (
              <OAuthHubIcon />
            ) : (
              <GoogleIcon />
            )}
            <Text style={s.signInText}>{config.signInLabel}</Text>
          </TouchableOpacity>
        )}

        {/* Error banner */}
        {viewState.error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{viewState.error}</Text>
          </View>
        )}

        {/* Data list */}
        {viewState.showData && (
          <View style={s.dataSection}>
            <View style={s.dataHeader}>
              <Text style={s.dataTitle}>{config.listTitle}</Text>
              {getItemCount(viewState.data) > 0 && (
                <View style={[s.countBadge, isOAuthHub ? s.countBadgeOH : s.countBadgeAmber]}>
                  <Text style={[s.countText, isOAuthHub ? s.countTextOH : s.countTextAmber]}>
                    {getItemCount(viewState.data)}
                  </Text>
                </View>
              )}
            </View>
            {renderData(selectedVersion, viewState.data)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Data renderers ────────────────────────────────────────────────────

function getItemCount(data: StoredDemoData): number {
  return (data.events?.length ?? data.flights?.length ?? data.files?.length ?? 0);
}

function renderData(version: VersionId, data: StoredDemoData) {
  const cfg = getVersionConfig(version);
  switch (cfg.demoId) {
    case 'zoom':
      return renderEvents(data.events ?? [], cfg.emptyState);
    case 'uber-travel':
      return renderFlights(data.flights ?? [], cfg.emptyState, cfg.authMode === 'oauthhub');
    case 'notability':
      return renderFiles(data.files ?? [], cfg.emptyState);
  }
}

function renderEvents(events: CalendarEventItem[], emptyState: string) {
  if (events.length === 0) {
    return <EmptyState message={emptyState} />;
  }
  return (
    <FlatList
      data={events}
      keyExtractor={(item, i) => `${(item as any).id ?? i}`}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <View style={s.card}>
          <Text style={s.cardTitle}>{item.summary ?? '(No title)'}</Text>
          <Text style={s.cardSubtitle}>
            {formatCalTime(item.start)} — {formatCalTime(item.end)}
          </Text>
          {(item as any).location ? (
            <Text style={s.cardDetail} numberOfLines={1}>
              {(item as any).location}
            </Text>
          ) : null}
          {(item as any).attendees?.length > 0 ? (
            <Text style={s.cardDetail}>
              {(item as any).attendees.length} attendee{(item as any).attendees.length !== 1 ? 's' : ''}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}

function renderFlights(flights: FlightItem[], emptyState: string, showIcon: boolean) {
  if (flights.length === 0) {
    return <EmptyState message={emptyState} />;
  }
  return (
    <FlatList
      data={flights}
      keyExtractor={(_, i) => String(i)}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <View style={s.card}>
          {item.subject ? (
            <View style={s.flightSubjectRow}>
              {showIcon && <Text>✈️</Text>}
              <Text style={s.flightSubject} numberOfLines={1}>
                {item.subject}
              </Text>
            </View>
          ) : null}
          <Text style={s.cardSubtitle} numberOfLines={3}>
            {(item as any).body ?? item.snippet}
          </Text>
        </View>
      )}
    />
  );
}

function renderFiles(files: DriveFileItem[], emptyState: string) {
  if (files.length === 0) {
    return <EmptyState message={emptyState} />;
  }
  return (
    <FlatList
      data={files}
      keyExtractor={(item, i) => item.id ?? String(i)}
      scrollEnabled={false}
      renderItem={({ item }) => (
        <View style={s.card}>
          <View style={s.fileRow}>
            <View style={s.fileInfo}>
              <Text style={s.fileIcon}>{mimeIcon(item.mimeType)}</Text>
              <Text style={s.fileName} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
            {item.modifiedTime ? (
              <Text style={s.fileDate}>{formatRelDate(item.modifiedTime)}</Text>
            ) : null}
          </View>
          <Text style={s.fileMime} numberOfLines={1}>
            {item.mimeType}
          </Text>
        </View>
      )}
    />
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <View style={s.emptyState}>
      <Text style={s.emptyText}>{message}</Text>
    </View>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatCalTime(value: CalendarEventItem['start'] | CalendarEventItem['end']): string {
  const iso =
    typeof value === 'string'
      ? value
      : value?.dateTime ?? value?.date ?? '';
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

function formatRelDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function mimeIcon(mimeType: string): string {
  if (mimeType?.includes('folder')) return '📁';
  if (mimeType?.includes('document') || mimeType?.includes('text')) return '📄';
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('csv')) return '📊';
  if (mimeType?.includes('presentation')) return '📽';
  if (mimeType?.includes('image')) return '🖼';
  if (mimeType?.includes('pdf')) return '📕';
  if (mimeType?.includes('audio')) return '🎵';
  if (mimeType?.includes('video')) return '🎬';
  return '📎';
}

// ── Icon components ───────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#4285F4', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: 'white', fontSize: 11, fontWeight: '700' }}>G</Text>
    </View>
  );
}

function OAuthHubIcon() {
  return (
    <View style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: 'white', fontSize: 9, fontWeight: '700' }}>OH</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#2563eb' },
  scrollView: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // App selector pills
  appSelector: { marginTop: 20, marginBottom: 16 },
  appSelectorContent: { gap: 8 },
  pill: { borderRadius: 9999, paddingHorizontal: 20, paddingVertical: 8 },
  pillActive: { backgroundColor: '#2563eb' },
  pillInactive: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e5e7eb' },
  pillText: { fontWeight: '600', fontSize: 14 },
  pillTextActive: { color: '#ffffff' },
  pillTextInactive: { color: '#4b5563' },

  // Auth mode toggle
  toggleRow: {
    flexDirection: 'row',
    backgroundColor: '#e5e7eb',
    borderRadius: 12,
    padding: 4,
    marginBottom: 28,
  },
  toggleItem: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  toggleItemActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  toggleText: { fontWeight: '600', fontSize: 14 },
  toggleTextActive: { color: '#111827' },
  toggleTextInactive: { color: '#6b7280' },

  // Heading
  heading: { fontSize: 24, fontWeight: 'bold', color: '#111827', marginBottom: 8, textAlign: 'center' },
  description: { fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 28, paddingHorizontal: 8 },

  // Connection badge
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 20,
    gap: 8,
  },
  connectionBadgeOH: { backgroundColor: '#eff6ff' },
  connectionBadgeGoogle: { backgroundColor: '#ecfdf5' },
  connectionDot: { width: 8, height: 8, borderRadius: 4 },
  dotOH: { backgroundColor: '#3b82f6' },
  dotGoogle: { backgroundColor: '#10b981' },
  connectionText: { fontSize: 14, fontWeight: '500' },
  connectionTextOH: { color: '#1d4ed8' },
  connectionTextGoogle: { color: '#047857' },

  // Upload card
  uploadCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  filePicker: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  filePickerText: { color: '#9ca3af', fontSize: 14, marginBottom: 4 },
  filePickerHint: { color: '#d1d5db', fontSize: 12 },
  backupButton: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  backupButtonActive: { backgroundColor: '#9333ea' },
  backupButtonDisabled: { backgroundColor: '#e5e7eb' },

  // Fetch button
  fetchButton: { borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
  fetchButtonActive: { backgroundColor: '#2563eb' },
  fetchButtonDisabled: { backgroundColor: '#9ca3af' },
  fetchingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonTextWhite: { color: '#ffffff', fontWeight: '600' },
  buttonTextGray: { color: '#9ca3af', fontWeight: '600' },

  // Disconnect
  disconnectButton: { alignItems: 'center', paddingVertical: 8, marginBottom: 8 },
  disconnectText: { color: '#9ca3af', fontSize: 14 },

  // Sign-in
  signInButton: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingHorizontal: 32,
    paddingVertical: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  signInButtonDisabled: { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' },
  signInText: { color: '#1f2937', fontWeight: '600' },

  // Error
  errorBox: {
    backgroundColor: '#fef2f2',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  errorText: { color: '#b91c1c', fontSize: 14 },

  // Data section
  dataSection: { marginTop: 24 },
  dataHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  dataTitle: { fontSize: 16, fontWeight: '600', color: '#374151' },
  countBadge: { borderRadius: 9999, paddingHorizontal: 12, paddingVertical: 4 },
  countBadgeOH: { backgroundColor: '#dbeafe' },
  countBadgeAmber: { backgroundColor: '#fef3c7' },
  countText: { fontSize: 12, fontWeight: 'bold' },
  countTextOH: { color: '#1e40af' },
  countTextAmber: { color: '#92400e' },

  // Cards
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111827', marginBottom: 4 },
  cardSubtitle: { fontSize: 14, color: '#6b7280' },
  cardDetail: { fontSize: 12, color: '#9ca3af', marginTop: 4 },

  // Flight
  flightSubjectRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  flightSubject: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 },

  // Files
  fileRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fileInfo: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 8, marginRight: 12 },
  fileIcon: { fontSize: 20 },
  fileName: { fontSize: 14, fontWeight: '600', color: '#111827', flex: 1 },
  fileDate: { fontSize: 12, color: '#9ca3af' },
  fileMime: { fontSize: 12, color: '#d1d5db', marginTop: 4, marginLeft: 28 },

  // Empty state
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { color: '#9ca3af', fontSize: 14, textAlign: 'center' },
});
