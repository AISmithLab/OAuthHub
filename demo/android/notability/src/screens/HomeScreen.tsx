import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import * as GoogleAuth from '../lib/google-auth';
import type { AuthTokens } from '../lib/google-auth';
import * as LocalDB from '../storage/local-db';

// KEY DIFFERENCE FROM OAUTHUB VERSION:
// - Has FULL read/write access to entire Drive (not just /Notability)
// - Lists ALL files, not just files under /Notability
// - Uploads go to Drive root (no folder scoping)
// - App can see/modify ANY file on the user's Drive

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
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

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { LocalDB.isAuthenticated().then(setIsAuthed); }, []);

  /**
   * Restore cached tokens from local DB into the google-auth module.
   */
  const restoreTokens = async (): Promise<AuthTokens> => {
    const accessToken = await LocalDB.getAuthToken();
    const refreshToken = await LocalDB.getRefreshToken();
    const expiry = await LocalDB.getTokenExpiry();
    if (!accessToken) throw new Error('Not authenticated');

    const tokens: AuthTokens = {
      accessToken,
      refreshToken: refreshToken ?? null,
      idToken: null,
      accessTokenExpirationDate: expiry ?? new Date().toISOString(),
    };

    GoogleAuth.setCachedTokens(tokens);
    return tokens;
  };

  /**
   * Get a valid access token, refreshing if needed, and persist any updates.
   */
  const getToken = async (): Promise<string> => {
    let tokens = await restoreTokens();
    tokens = await GoogleAuth.getValidToken(tokens);

    // Persist potentially refreshed tokens
    await LocalDB.setAuthToken(tokens.accessToken);
    if (tokens.refreshToken) await LocalDB.setRefreshToken(tokens.refreshToken);
    await LocalDB.setTokenExpiry(tokens.accessTokenExpirationDate);

    return tokens.accessToken;
  };

  const handleSignIn = async () => {
    setError(null);
    try {
      const tokens = await GoogleAuth.signIn();

      await LocalDB.setAuthToken(tokens.accessToken);
      if (tokens.refreshToken) await LocalDB.setRefreshToken(tokens.refreshToken);
      await LocalDB.setTokenExpiry(tokens.accessTokenExpirationDate);

      setIsAuthed(true);
    } catch (err: any) { setError(err.message); }
  };

  const handlePickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*' });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setSelectedFile(result.assets[0]);
      }
    } catch (err: any) { setError(err.message); }
  };

  /**
   * Upload selected file directly to Google Drive root (no folder restriction).
   * Uses multipart upload: metadata + file content in a single request.
   */
  const handleBackup = async () => {
    if (!selectedFile) return;
    setIsBackingUp(true);
    setError(null);
    try {
      const accessToken = await getToken();

      // Read file content as base64
      const contentBase64 = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const metadata = {
        name: selectedFile.name,
        mimeType: selectedFile.mimeType || 'application/octet-stream',
        // NOTE: No "parents" field — file goes to Drive root.
        // The OAuthHub version scopes uploads to the /Notability folder.
      };

      const boundary = 'notability_baseline_boundary';
      const body =
        `--${boundary}\r\n` +
        'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify(metadata) + '\r\n' +
        `--${boundary}\r\n` +
        `Content-Type: ${metadata.mimeType}\r\n` +
        'Content-Transfer-Encoding: base64\r\n\r\n' +
        contentBase64 + '\r\n' +
        `--${boundary}--`;

      const res = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Upload failed (${res.status}): ${errBody}`);
      }

      setSelectedFile(null);
      // Refresh file list after upload
      await handleFetchFiles();
    } catch (err: any) { setError(err.message); }
    finally { setIsBackingUp(false); }
  };

  /**
   * Fetch ALL files from Google Drive — not scoped to any folder.
   * The OAuthHub version only returns files under /Notability.
   */
  const handleFetchFiles = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const accessToken = await getToken();

      const res = await fetch(
        'https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType,modifiedTime,parents)&orderBy=modifiedTime desc',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Drive API error (${res.status}): ${errBody}`);
      }

      const json = await res.json();
      const driveFiles = json.files ?? [];
      await LocalDB.storeFiles(driveFiles);
      setFiles(driveFiles);
    } catch (err: any) { setError(err.message); }
    finally { setIsFetching(false); }
  };

  const handleDisconnect = async () => {
    await LocalDB.clearAuth();
    GoogleAuth.setCachedTokens(null);
    setIsAuthed(false);
    setFiles([]);
    setSelectedFile(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notability</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.mainTitle}>Drive Backup</Text>
        <Text style={styles.subtitle}>
          Upload a file to Google Drive and browse ALL your Drive files.
          This baseline app has full access to your entire Drive.
        </Text>

        {isAuthed ? (
          <>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedText}>Connected to Google Drive</Text>
            </View>

            {/* Backup form */}
            <View style={styles.backupCard}>
              <TouchableOpacity onPress={handlePickFile} style={styles.filePickerButton}>
                <Text style={styles.filePickerText}>
                  {selectedFile ? selectedFile.name : 'Tap to choose a file...'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleBackup}
                disabled={isBackingUp || !selectedFile}
                style={[
                  styles.backupButton,
                  (isBackingUp || !selectedFile) ? styles.buttonDisabled : styles.buttonPurple,
                ]}
              >
                {isBackingUp ? (
                  <View style={styles.buttonRow}>
                    <ActivityIndicator size="small" color="white" />
                    <Text style={styles.buttonTextWhite}>Backing up...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonTextWhite}>Backup to Drive</Text>
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleFetchFiles}
              disabled={isFetching}
              style={[
                styles.fetchButton,
                isFetching ? styles.buttonGray : styles.buttonBlue,
              ]}
            >
              {isFetching ? (
                <View style={styles.buttonRow}>
                  <ActivityIndicator size="small" color="white" />
                  <Text style={styles.buttonTextWhite}>Loading...</Text>
                </View>
              ) : (
                <Text style={styles.buttonTextWhite}>List All Drive Files</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDisconnect}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity onPress={handleSignIn} style={styles.signInButton}>
            <Text style={styles.signInText}>Sign in with Google</Text>
          </TouchableOpacity>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {files.length > 0 && (
          <View style={styles.fileListContainer}>
            <Text style={styles.fileListTitle}>All Drive Files</Text>
            <FlatList
              data={files}
              keyExtractor={(item, i) => item.id ?? String(i)}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.fileCard}>
                  <View style={styles.fileRow}>
                    <View style={styles.fileNameRow}>
                      <Text style={styles.fileIcon}>{mimeIcon(item.mimeType)}</Text>
                      <Text style={styles.fileName} numberOfLines={1}>
                        {item.name}
                      </Text>
                    </View>
                    {item.modifiedTime && (
                      <Text style={styles.fileDate}>{formatTime(item.modifiedTime)}</Text>
                    )}
                  </View>
                  <Text style={styles.fileMime} numberOfLines={1}>{item.mimeType}</Text>
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
  content: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 48,
  },
  mainTitle: {
    fontSize: 30,
    fontWeight: 'bold',
    color: '#111827',
    marginBottom: 8,
  },
  subtitle: {
    color: '#6b7280',
    textAlign: 'center',
    marginBottom: 24,
  },
  connectedBadge: {
    backgroundColor: '#fffbeb',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
  },
  connectedText: {
    color: '#b45309',
    fontSize: 13,
    fontWeight: '500',
  },
  backupCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  filePickerButton: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  filePickerText: {
    color: '#4b5563',
    fontSize: 13,
  },
  backupButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#d1d5db',
  },
  buttonPurple: {
    backgroundColor: '#9333ea',
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonTextWhite: {
    color: '#ffffff',
    fontWeight: '500',
  },
  fetchButton: {
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    marginBottom: 12,
  },
  buttonGray: {
    backgroundColor: '#9ca3af',
  },
  buttonBlue: {
    backgroundColor: '#2563eb',
  },
  disconnectText: {
    color: '#9ca3af',
    fontSize: 13,
  },
  signInButton: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
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
    fontSize: 13,
  },
  fileListContainer: {
    width: '100%',
    marginTop: 24,
  },
  fileListTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  fileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6',
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fileNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  fileIcon: {
    fontSize: 18,
  },
  fileName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
    flex: 1,
  },
  fileDate: {
    fontSize: 13,
    color: '#9ca3af',
    marginLeft: 8,
  },
  fileMime: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
});
