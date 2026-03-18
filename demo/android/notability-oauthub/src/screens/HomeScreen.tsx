import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import OAuthHubClient from '../lib/oauthub-client';
import * as LocalDB from '../storage/local-db';

const CALLBACK_URL = 'notability-oauthub-demo://callback';

const OAUTHUB_MANIFEST = [
  'TITLE: Notability',
  'DESCRIPTION: Read and write backups in the Notability folder on Google Drive',
  'PIPELINE: ReceiveBackup->FilterFolder->WriteToDrive->PullDriveFiles->SelectFiles->FilterNotabilityFolder',
  '',
  'ReceiveBackup(type: "Receive", source: "inline")',
  'FilterFolder(type: "Filter", operation: "==", field: "parents", targetValue: "Notability")',
  'WriteToDrive(type: "Write", action: "create", resourceType: "google_drive")',
  'PullDriveFiles(type: "Pull", resourceType: "google_drive", query: "{ files { id name mimeType modifiedTime parents } }")',
  'SelectFiles(type: "Select", field: "files")',
  'FilterNotabilityFolder(type: "Filter", operation: "include", field: "parents", targetValue: "Notability")',
].join('\n');

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

function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function HomeScreen() {
  const [isAuthed, setIsAuthed] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { LocalDB.isAuthenticated().then(setIsAuthed); }, []);

  const handleSignIn = async () => {
    try {
      const url = await OAuthHubClient.generateAuthUrl({
        provider: 'google_drive',
        manifest: OAUTHUB_MANIFEST,
        redirect: CALLBACK_URL,
        accessType: 'user_driven',
      });
      if (url) Linking.openURL(url);
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

  const handleBackup = async () => {
    if (!selectedFile) return;
    setIsBackingUp(true);
    setError(null);
    try {
      const token = await LocalDB.getAuthToken();
      if (!token) throw new Error('No access token');

      // Read file as base64
      const contentBase64 = await FileSystem.readAsStringAsync(selectedFile.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const result = await OAuthHubClient.query({
        token,
        manifest: OAUTHUB_MANIFEST,
        operation: 'write',
        data: {
          name: selectedFile.name,
          mimeType: selectedFile.mimeType || 'application/octet-stream',
          contentBase64,
          parents: ['Notability'],
        },
      });

      await LocalDB.setAuthToken(result.token);
      setSelectedFile(null);
      // Refresh file list
      await handleFetchFiles();
    } catch (err: any) { setError(err.message); }
    finally { setIsBackingUp(false); }
  };

  const handleFetchFiles = async () => {
    setIsFetching(true);
    setError(null);
    try {
      const token = await LocalDB.getAuthToken();
      if (!token) throw new Error('No access token');

      const result = await OAuthHubClient.query({
        token,
        manifest: OAUTHUB_MANIFEST,
        operation: 'read',
      });
      await LocalDB.setAuthToken(result.token);
      if (result.data && Array.isArray(result.data)) {
        await LocalDB.storeFiles(result.data);
        setFiles(result.data);
      }
    } catch (err: any) { setError(err.message); }
    finally { setIsFetching(false); }
  };

  const handleDisconnect = async () => {
    await LocalDB.clearAuth();
    setIsAuthed(false);
    setFiles([]);
    setSelectedFile(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notability</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>Drive Backup</Text>
        <Text style={styles.subtitle}>
          Upload a file and back it up into your /Notability folder on Google Drive through OAuthHub.
        </Text>

        {isAuthed ? (
          <>
            <View style={styles.connectedBadge}>
              <Text style={styles.connectedText}>Connected via OAuthHub</Text>
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
                    <Text style={styles.buttonText}>Backing up...</Text>
                  </View>
                ) : (
                  <Text style={styles.buttonText}>Backup to /Notability</Text>
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
                  <Text style={styles.buttonText}>Loading...</Text>
                </View>
              ) : (
                <Text style={styles.buttonText}>List Files Under /Notability</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleDisconnect}>
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

        {files.length > 0 && (
          <View style={styles.fileListContainer}>
            <Text style={styles.fileListTitle}>Files Under /Notability</Text>
            <FlatList
              data={files}
              keyExtractor={(_, i) => String(i)}
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
  title: {
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
    backgroundColor: '#ecfdf5',
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 16,
  },
  connectedText: {
    color: '#047857',
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
  buttonText: {
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
