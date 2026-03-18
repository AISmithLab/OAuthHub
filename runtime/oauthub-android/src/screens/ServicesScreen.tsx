import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Calendar, Mail, HardDrive, FileSpreadsheet, Wifi, WifiOff, Plus } from 'lucide-react-native';
import { messageHandler } from '../ipc/message-handler';

const SERVICE_META: Record<string, { name: string; icon: any; color: string; scopes: string[] }> = {
  google_calendar: {
    name: 'Google Calendar', icon: Calendar, color: '#2563eb',
    scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  },
  gmail: {
    name: 'Gmail', icon: Mail, color: '#ef4444',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  google_drive: {
    name: 'Google Drive', icon: HardDrive, color: '#f59e0b',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  google_forms: {
    name: 'Google Forms', icon: FileSpreadsheet, color: '#9333ea',
    scopes: ['https://www.googleapis.com/auth/forms.responses.readonly'],
  },
};

const ALL_SERVICES = ['google_calendar', 'gmail', 'google_drive', 'google_forms'];

export default function ServicesScreen() {
  const navigation = useNavigation();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchServices = async () => {
    const result = await messageHandler.handleGetConnectedServices();
    if (result?.success) setServices(result.services || []);
    setLoading(false);
  };

  useEffect(() => { fetchServices(); }, []);

  const handleConnect = async (provider: string) => {
    const meta = SERVICE_META[provider];
    if (!meta) return;
    setConnecting(provider);
    setError(null);
    const result = await messageHandler.handleConnectService({ provider, requiredScopes: meta.scopes });
    setConnecting(null);
    if (result?.success) fetchServices();
    else setError(`Failed to connect ${meta.name}: ${result?.error || 'Unknown error'}`);
  };

  const handleDisconnect = (provider: string) => {
    const meta = SERVICE_META[provider];
    Alert.alert(
      'Disconnect Service',
      `Are you sure you want to disconnect ${meta?.name || provider}? This will revoke all associated tokens.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect', style: 'destructive',
          onPress: async () => {
            const result = await messageHandler.handleDisconnectService({ provider });
            if (result?.success) fetchServices();
            else setError(`Failed to disconnect ${meta?.name || provider}`);
          },
        },
      ]
    );
  };

  const allItems = ALL_SERVICES.map(key => {
    const connected = services.find(s => s.provider === key);
    return {
      key,
      meta: SERVICE_META[key],
      connected: !!connected,
      active: connected?.active || 0,
      connections: connected?.connections || 0,
    };
  });

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView style={s.scrollView} contentContainerStyle={s.scrollContent}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backButton}>
            <ArrowLeft size={20} color="#4b5563" />
          </TouchableOpacity>
          <View>
            <Text style={s.headerTitle}>Connected Services</Text>
            <Text style={s.headerSubtitle}>{services.length} connected</Text>
          </View>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {loading ? (
          <View style={s.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
          </View>
        ) : (
          <View style={s.servicesList}>
            {allItems.map(({ key, meta, connected, active, connections }) => {
              const Icon = meta.icon;
              const isConnecting = connecting === key;
              return (
                <View key={key} style={s.serviceCard}>
                  <View style={s.serviceRow}>
                    <View style={s.serviceInfo}>
                      <View style={[s.iconBox, { backgroundColor: meta.color + '15' }]}>
                        <Icon size={20} color={meta.color} />
                      </View>
                      <View style={s.serviceTextBlock}>
                        <Text style={s.serviceName}>{meta.name}</Text>
                        {connected ? (
                          <View style={s.statusRow}>
                            <View style={s.activeIndicator}>
                              <Wifi size={12} color="#059669" />
                              <Text style={s.activeText}>{active} active</Text>
                            </View>
                            <Text style={s.totalText}>{connections} total</Text>
                          </View>
                        ) : (
                          <View style={s.disconnectedRow}>
                            <WifiOff size={12} color="#9ca3af" />
                            <Text style={s.disconnectedText}>Not connected</Text>
                          </View>
                        )}
                      </View>
                    </View>

                    {!connected && (
                      <TouchableOpacity
                        onPress={() => handleConnect(key)}
                        disabled={isConnecting}
                        style={[
                          s.connectButton,
                          isConnecting ? s.connectButtonDisabled : s.connectButtonActive,
                        ]}
                      >
                        {isConnecting ? (
                          <ActivityIndicator size="small" color="white" />
                        ) : (
                          <Plus size={14} color="white" />
                        )}
                        <Text style={s.connectButtonText}>
                          {isConnecting ? 'Connecting...' : 'Connect'}
                        </Text>
                      </TouchableOpacity>
                    )}

                    {connected && (
                      <View style={s.connectedColumn}>
                        <View style={s.connectedBadge}>
                          <View style={s.connectedDot} />
                          <Text style={s.connectedLabel}>Connected</Text>
                        </View>
                        <TouchableOpacity onPress={() => handleDisconnect(key)} style={s.disconnectButton}>
                          <Text style={s.disconnectText}>Disconnect</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <View style={s.infoBox}>
          <Text style={s.infoText}>
            Connect a Google service to grant OAuthHub read access. Apps will still need your approval through the consent screen before accessing any data.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc', // slate-50
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 24,
    paddingBottom: 48,
  },

  // Header
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
    color: '#111827', // gray-900
    lineHeight: 30,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#9ca3af', // gray-400
    marginTop: 2,
    lineHeight: 20,
  },

  // Loading
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },

  // Services list
  servicesList: {
    gap: 14,
  },

  // Service card
  serviceCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
    overflow: 'hidden',
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  serviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  serviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    marginRight: 12,
  },
  serviceTextBlock: {
    flex: 1,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827', // gray-900
    lineHeight: 24,
  },

  // Connected status row
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 2,
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  activeText: {
    fontSize: 14,
    color: '#059669', // emerald-600
    lineHeight: 20,
  },
  totalText: {
    fontSize: 14,
    color: '#9ca3af', // gray-400
    lineHeight: 20,
  },

  // Disconnected status row
  disconnectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  disconnectedText: {
    fontSize: 14,
    color: '#9ca3af', // gray-400
    lineHeight: 20,
  },

  // Connected column (badge + disconnect stacked)
  connectedColumn: {
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 9999,
    backgroundColor: '#ecfdf5', // emerald-50
    borderWidth: 1,
    borderColor: '#a7f3d0', // emerald-200
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981', // emerald-500
  },
  connectedLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#047857', // emerald-700
    lineHeight: 18,
  },
  disconnectButton: {
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  disconnectText: {
    fontSize: 13,
    color: '#f43f5e', // rose-500
    lineHeight: 18,
  },

  // Connect button
  connectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  connectButtonActive: {
    backgroundColor: '#2563eb', // blue-600
  },
  connectButtonDisabled: {
    backgroundColor: '#9ca3af', // gray-400
  },
  connectButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: 22,
  },

  // Error box
  errorBox: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fff1f2', // rose-50
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecdd3', // rose-200
  },
  errorText: {
    fontSize: 15,
    color: '#be123c', // rose-700
    lineHeight: 22,
  },

  // Info box
  infoBox: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#eff6ff', // blue-50
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe', // blue-100
  },
  infoText: {
    fontSize: 15,
    color: '#1d4ed8', // blue-700
    lineHeight: 22,
  },
});
