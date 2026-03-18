import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Switch, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { ShieldCheck, FileText, Activity, ChevronRight, TrendingDown, TrendingUp, MinusCircle, Link2 } from 'lucide-react-native';
import { messageHandler } from '../ipc/message-handler';
import { storage } from '../platform/storage';

export default function DashboardScreen() {
  const navigation = useNavigation();
  const [stats, setStats] = useState({
    manifests: { total: 0, disabled: 0 },
    rejected: { total: 0, percentage: 0 },
    responses: { total: 0, increase: 0, percentage: 0 },
  });
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          setLoading(true);
          setError(null);
          const savedEnabled = await storage.getSetting('hub_enabled');
          if (!cancelled && savedEnabled !== null) setEnabled(savedEnabled);
          const result = await messageHandler.handleGetStats();
          if (!cancelled && result?.success && result.stats) setStats(result.stats);
        } catch (err: any) {
          if (!cancelled) setError(err.message || 'Failed to load stats');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [])
  );

  const handleToggle = async (value: boolean) => {
    setEnabled(value);
    await storage.setSetting('hub_enabled', value);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.safeArea}>
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <View style={s.logoBox} accessibilityRole="image" accessibilityLabel="OAuthHub logo">
              <ShieldCheck size={22} color="white" />
            </View>
            <View>
              <Text style={s.title}>OAuthHub</Text>
              <Text style={s.subtitle}>OAuth Privacy Firewall</Text>
            </View>
          </View>
          <View style={s.headerRight}>
            <Switch
              value={enabled}
              onValueChange={handleToggle}
              trackColor={{ false: '#d1d5db', true: '#2563eb' }}
              thumbColor="white"
              accessibilityLabel={enabled ? 'Disable OAuthHub' : 'Enable OAuthHub'}
            />
            <View style={[s.statusBadge, enabled ? s.statusActive : s.statusInactive]}>
              <View style={[s.statusDot, { backgroundColor: enabled ? '#10b981' : '#9ca3af' }]} />
              <Text style={[s.statusText, { color: enabled ? '#059669' : '#6b7280' }]}>
                {enabled ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>
        </View>

        {error && (
          <View style={s.errorBox}>
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        {/* Stats Grid */}
        <StatCard
          label="Manifests"
          value={stats.manifests.total}
          subLabel={`${stats.manifests.disabled} disabled`}
          icon={<FileText size={18} color="#2563eb" />}
          iconBg="#eff6ff"
          subIcon={<MinusCircle size={14} color="#9ca3af" />}
          valueColor="#111827"
          full
        />
        <View style={s.statsRow}>
          <StatCard
            label="Rejected"
            value={stats.rejected.total}
            subLabel={`${stats.rejected.percentage}%`}
            icon={<ShieldCheck size={18} color="#f43f5e" />}
            iconBg="#fff1f2"
            subIcon={<TrendingDown size={14} color="#fb7185" />}
            valueColor="#f43f5e"
          />
          <StatCard
            label="Responses"
            value={stats.responses.total}
            subLabel={`+${stats.responses.increase}`}
            icon={<Activity size={18} color="#059669" />}
            iconBg="#ecfdf5"
            subIcon={<TrendingUp size={14} color="#10b981" />}
            valueColor="#111827"
          />
        </View>

        {stats.manifests.total === 0 && (
          <View style={s.onboardingBox}>
            <ShieldCheck size={24} color="#2563eb" />
            <Text style={s.onboardingText}>
              No manifests registered yet. When apps request access through OAuthHub, they will appear here.
            </Text>
          </View>
        )}

        {/* Navigation */}
        <NavCard
          label="Manifests"
          description="Manage permissions"
          icon={<FileText size={20} color="#2563eb" />}
          iconBg="#eff6ff"
          onPress={() => navigation.navigate('Manifests' as never)}
        />
        <NavCard
          label="Services"
          description="Connected accounts"
          icon={<Link2 size={20} color="#9333ea" />}
          iconBg="#faf5ff"
          onPress={() => navigation.navigate('Services' as never)}
        />
        <NavCard
          label="Request Logs"
          description="View access history"
          icon={<Activity size={20} color="#d97706" />}
          iconBg="#fffbeb"
          onPress={() => navigation.navigate('Logs' as never)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, subLabel, icon, iconBg, subIcon, valueColor, full }: any) {
  return (
    <View style={[s.statCard, full && { marginBottom: 10 }]} accessibilityRole="summary" accessibilityLabel={`${label}: ${value}`}>
      <View style={s.statHeader}>
        <Text style={s.statLabel}>{label}</Text>
        <View style={[s.statIconBox, { backgroundColor: iconBg }]}>{icon}</View>
      </View>
      <Text style={[s.statValue, { color: valueColor }]}>{value}</Text>
      <View style={s.statSub}>
        {subIcon}
        <Text style={s.statSubText}>{subLabel}</Text>
      </View>
    </View>
  );
}

function NavCard({ label, description, icon, iconBg, onPress }: any) {
  return (
    <TouchableOpacity style={s.navCard} onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={`${label}: ${description}`}>
      <View style={s.navLeft}>
        <View style={[s.navIconBox, { backgroundColor: iconBg }]}>{icon}</View>
        <View>
          <Text style={s.navLabel}>{label}</Text>
          <Text style={s.navDesc}>{description}</Text>
        </View>
      </View>
      <ChevronRight size={18} color="#d1d5db" />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoBox: { width: 44, height: 44, backgroundColor: '#2563eb', borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 3, shadowColor: '#2563eb', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4 },
  title: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subtitle: { fontSize: 13, color: '#9ca3af', fontWeight: '500', marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  statusActive: { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' },
  statusInactive: { backgroundColor: '#f3f4f6', borderColor: '#e5e7eb' },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },

  errorBox: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 12, marginBottom: 16 },
  errorText: { color: '#b91c1c', fontSize: 14 },

  onboardingBox: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe', borderRadius: 12, padding: 16, marginBottom: 16 },
  onboardingText: { flex: 1, fontSize: 14, color: '#1d4ed8', lineHeight: 20 },

  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: 'white', padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: '#f3f4f6',
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3,
  },
  statHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  statLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, color: '#9ca3af' },
  statIconBox: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: 32, fontWeight: '700' },
  statSub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  statSubText: { fontSize: 13, color: '#6b7280' },

  navCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'white', padding: 16, borderRadius: 16,
    borderWidth: 1, borderColor: '#f3f4f6', marginBottom: 10,
    elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 3,
  },
  navLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  navIconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 16, fontWeight: '600', color: '#111827' },
  navDesc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
});
