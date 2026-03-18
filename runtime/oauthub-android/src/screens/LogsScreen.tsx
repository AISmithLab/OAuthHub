import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, FlatList, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, Trash2, Activity } from 'lucide-react-native';
import { storage } from '../platform/storage';

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  authorize: { bg: '#d1fae5', text: '#047857' },
  exchange:  { bg: '#dbeafe', text: '#1d4ed8' },
  query:     { bg: '#e0e7ff', text: '#4338ca' },
  rejected:  { bg: '#fee2e2', text: '#b91c1c' },
};
const DEFAULT_TYPE_COLOR = { bg: '#f3f4f6', text: '#374151' };

export default function LogsScreen() {
  const navigation = useNavigation();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLogs = async () => {
    try {
      setLoading(true);
      const result = await storage.getLogs(200);
      setLogs(result);
    } finally {
      setLoading(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [])
  );

  const clearLogs = () => {
    Alert.alert('Clear Logs', 'Are you sure you want to clear all request logs?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive',
        onPress: async () => {
          await storage.clearLogs();
          setLogs([]);
        },
      },
    ]);
  };

  const typeColor = (type: string) => TYPE_COLORS[type] ?? DEFAULT_TYPE_COLOR;

  const formatTimestamp = (ts: string) => {
    if (!ts) return '';
    try {
      return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
    } catch {
      return ts;
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const colors = typeColor(item.type);
    return (
      <View style={s.card}>
        <View style={s.cardHeader}>
          <View style={[s.badge, { backgroundColor: colors.bg }]}>
            <Text style={[s.badgeText, { color: colors.text }]}>
              {item.type}
            </Text>
          </View>
          <Text style={s.timestamp}>
            {formatTimestamp(item.timestamp)}
          </Text>
        </View>
        <Text style={s.message}>{item.message}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backButton} accessibilityRole="button" accessibilityLabel="Go back">
            <ArrowLeft size={20} color="#4b5563" />
          </TouchableOpacity>
          <View>
            <Text style={s.title}>Request Logs</Text>
            <Text style={s.subtitle}>{logs.length} entries</Text>
          </View>
        </View>
        {logs.length > 0 && (
          <TouchableOpacity onPress={clearLogs} style={s.clearButton} accessibilityRole="button" accessibilityLabel="Clear all logs">
            <Trash2 size={18} color="#ef4444" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : logs.length === 0 ? (
        <View style={s.emptyState}>
          <Activity size={32} color="#d1d5db" />
          <Text style={s.emptyText}>No activity yet</Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item, idx) => String(item.id || idx)}
          contentContainerStyle={s.listContent}
          renderItem={renderItem}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    padding: 12,
    borderRadius: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 30,
  },
  subtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginTop: 2,
    lineHeight: 20,
  },
  clearButton: {
    padding: 12,
    borderRadius: 8,
  },

  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 17,
    color: '#9ca3af',
    marginTop: 12,
    lineHeight: 24,
  },

  listContent: {
    padding: 24,
    paddingTop: 12,
  },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f3f4f6',
    padding: 18,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  badge: {
    borderRadius: 9999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    lineHeight: 17,
  },
  timestamp: {
    fontSize: 13,
    color: '#9ca3af',
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  message: {
    fontSize: 16,
    color: '#374151',
    lineHeight: 24,
  },
});
