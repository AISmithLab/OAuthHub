import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Search, Globe, Shield, Trash2 } from 'lucide-react-native';
import { messageHandler } from '../ipc/message-handler';
import { storage } from '../platform/storage';

const providerNames: Record<string, string> = {
  google_calendar: 'Google Calendar',
  gmail: 'Gmail',
  google_drive: 'Google Drive',
  google_forms: 'Google Forms',
};

export default function ManifestsScreen() {
  const navigation = useNavigation();
  const [searchTerm, setSearchTerm] = useState('');
  const [manifests, setManifests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadManifests = async () => {
    try {
      setLoading(true);
      const result = await messageHandler.handleGetManifests();
      if (result?.success) setManifests(result.manifests || []);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadManifests();
    }, [])
  );

  const toggleManifest = async (id: string) => {
    const updated = manifests.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m);
    setManifests(updated);
    const target = updated.find(m => m.id === id);
    if (target) await storage.put('manifests', target);
  };

  const revokeManifest = (id: string) => {
    Alert.alert('Revoke Manifest', 'This will delete the manifest and all associated authorization records and tokens.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke', style: 'destructive',
        onPress: async () => {
          // Cascade delete: manifest, tokens, and authorizations
          await messageHandler.revokeManifest(id);
          setManifests(prev => prev.filter(m => m.id !== id));
        },
      },
    ]);
  };

  const filtered = manifests.filter(m => {
    const term = searchTerm.toLowerCase();
    return (
      (m.provider || '').toLowerCase().includes(term) ||
      (m.title || '').toLowerCase().includes(term) ||
      (m.description || '').toLowerCase().includes(term) ||
      (m.accessType || '').toLowerCase().includes(term)
    );
  });

  const grouped: Record<string, any[]> = {};
  for (const m of filtered) {
    const key = m.provider || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView style={s.scrollView} contentContainerStyle={s.scrollContent}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <ArrowLeft size={20} color="#4b5563" />
          </TouchableOpacity>
          <View>
            <Text style={s.headerTitle}>Manifests</Text>
            <Text style={s.headerSubtitle}>{filtered.length} registered</Text>
          </View>
        </View>

        <View style={s.searchRow}>
          <View style={s.searchContainer}>
            <Search size={16} color="#9ca3af" />
            <TextInput
              placeholder="Search manifests..."
              placeholderTextColor="#9ca3af"
              style={s.searchInput}
              value={searchTerm}
              onChangeText={setSearchTerm}
              accessibilityLabel="Search manifests"
            />
          </View>
        </View>

        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : (
          <View style={s.groupList}>
            {Object.entries(grouped).map(([provider, items]) => (
              <View key={provider} style={s.groupCard}>
                <View style={s.groupHeader}>
                  <View style={s.groupHeaderLeft}>
                    <View style={s.providerIcon}>
                      <Globe size={16} color="#2563eb" />
                    </View>
                    <Text style={s.providerName}>
                      {providerNames[provider] || provider}
                    </Text>
                  </View>
                  <Text style={s.manifestCount}>
                    {items.length} manifest{items.length !== 1 ? 's' : ''}
                  </Text>
                </View>

                {items.map((manifest: any) => (
                  <View key={manifest.id} style={s.manifestRow}>
                    <View style={s.manifestRowInner}>
                      <View style={s.manifestLeft}>
                        <TouchableOpacity onPress={() => toggleManifest(manifest.id)} accessibilityRole="switch" accessibilityLabel={`Toggle ${manifest.title || manifest.provider}`}>
                          <View
                            style={[
                              s.toggleTrack,
                              manifest.enabled ? s.toggleTrackOn : s.toggleTrackOff,
                            ]}
                          >
                            <View
                              style={[
                                s.toggleThumb,
                                manifest.enabled ? s.toggleThumbOn : s.toggleThumbOff,
                              ]}
                            />
                          </View>
                        </TouchableOpacity>
                        <View>
                          <Text
                            style={[
                              s.manifestTitle,
                              manifest.enabled ? s.manifestTitleEnabled : s.manifestTitleDisabled,
                            ]}
                          >
                            {manifest.title || manifest.provider}
                          </Text>
                          {manifest.accessType && (
                            <Text style={s.manifestAccessType}>{manifest.accessType}</Text>
                          )}
                        </View>
                      </View>
                      <TouchableOpacity
                        onPress={() => revokeManifest(manifest.id)}
                        style={s.revokeButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Revoke ${manifest.title || manifest.provider}`}
                      >
                        <Trash2 size={16} color="#f43f5e" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </View>
            ))}

            {filtered.length === 0 && (
              <View style={s.emptyState}>
                <Shield size={32} color="#d1d5db" />
                <Text style={s.emptyTitle}>No manifests registered</Text>
                <Text style={s.emptySubtitle}>
                  Service manifests will appear here when apps request access
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  backButton: {
    padding: 12,
    borderRadius: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 30,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
    lineHeight: 20,
  },

  searchRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 12,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingLeft: 8,
    fontSize: 16,
    color: '#111827',
    lineHeight: 22,
  },

  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },

  groupList: {
    gap: 18,
  },

  groupCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  providerIcon: {
    width: 36,
    height: 36,
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 24,
  },
  manifestCount: {
    fontSize: 14,
    color: '#9ca3af',
    lineHeight: 20,
  },

  manifestRow: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f9fafb',
  },
  manifestRowInner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  manifestLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },

  toggleTrack: {
    width: 44,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: '#2563eb',
  },
  toggleTrackOff: {
    backgroundColor: '#d1d5db',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  toggleThumbOn: {
    alignSelf: 'flex-end' as const,
    marginRight: 4,
  },
  toggleThumbOff: {
    alignSelf: 'flex-start' as const,
    marginLeft: 4,
  },

  manifestTitle: {
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 22,
  },
  manifestTitleEnabled: {
    color: '#111827',
  },
  manifestTitleDisabled: {
    color: '#9ca3af',
  },
  manifestAccessType: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
    lineHeight: 18,
  },

  revokeButton: {
    padding: 10,
    borderRadius: 8,
  },

  emptyState: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    paddingVertical: 64,
    alignItems: 'center',
  },
  emptyTitle: {
    fontSize: 17,
    color: '#9ca3af',
    marginTop: 12,
    lineHeight: 24,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#d1d5db',
    marginTop: 4,
    textAlign: 'center',
    paddingHorizontal: 32,
    lineHeight: 20,
  },
});
