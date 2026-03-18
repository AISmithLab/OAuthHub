import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { ShieldCheck, Globe, AlertTriangle, CheckCircle, Clock, Zap, Eye, Info } from 'lucide-react-native';
import { parseManifest, describeStep, formatResourceType } from '../core/manifest-parser';
import { messageHandler } from '../ipc/message-handler';

function getStepBg(op: any, isLast: boolean) {
  const type = String(op.type || '').toLowerCase();
  if (type === 'input' || type === 'pull') return { bg: s.stepBgSlate, text: s.stepTextSlate };
  if (isLast || type === 'post') return { bg: s.stepBgBlue, text: s.stepTextBlue };
  return { bg: s.stepBgIndigo, text: s.stepTextIndigo };
}

// Overview Tab
function OverviewTab({ beforeData, afterData, manifest }: any) {
  const beforeKeys = beforeData[0] != null ? Object.keys(beforeData[0]) : [];
  const afterItem = afterData[0];
  const afterKeys = afterItem != null && typeof afterItem === 'object' ? Object.keys(afterItem) : [];
  const keptFields = beforeKeys.filter(k => afterKeys.includes(k));
  const removedFields = beforeKeys.filter(k => !afterKeys.includes(k));
  const itemsFiltered = beforeData.length !== afterData.length;

  return (
    <View style={s.overviewContainer}>
      <View style={s.overviewCountRow}>
        <View style={s.overviewCountBlock}>
          <Text style={s.overviewCountNumber}>{beforeData.length}</Text>
          <Text style={s.overviewCountLabel}>original</Text>
        </View>
        <View style={s.overviewArrowBlock}>
          <Text style={s.arrowText}>{'\u2192'}</Text>
          {itemsFiltered && (
            <View style={s.filteredBadge}>
              <Text style={s.filteredBadgeText}>filtered</Text>
            </View>
          )}
        </View>
        <View style={s.overviewCountBlock}>
          <Text style={s.overviewCountNumberBlue}>{afterData.length}</Text>
          <Text style={s.overviewCountLabel}>shared</Text>
        </View>
      </View>

      <View>
        <Text style={s.sectionLabel}>
          Fields shared with {manifest.title || 'app'}
        </Text>
        <View style={s.fieldsCard}>
          {keptFields.map((field: string) => (
            <View key={field} style={s.fieldRow}>
              <View style={s.fieldCheckIcon}>
                <Text style={s.fieldCheckText}>{'\u2713'}</Text>
              </View>
              <Text style={s.fieldKeptText}>{field}</Text>
            </View>
          ))}
          {removedFields.map((field: string) => (
            <View key={field} style={s.fieldRow}>
              <View style={s.fieldRemoveIcon}>
                <Text style={s.fieldRemoveText}>{'\u2715'}</Text>
              </View>
              <Text style={s.fieldRemovedText}>{field}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

// Steps Tab
function StepsTab({ manifest }: any) {
  return (
    <View style={s.stepsContainer}>
      <Text style={s.sectionLabel}>
        Processing pipeline
      </Text>
      <View>
        {manifest.pipeline.map((name: string, idx: number) => {
          const op = manifest.operators[name];
          if (!op) return null;
          const isLast = idx === manifest.pipeline.length - 1;
          const colors = getStepBg(op, isLast);

          return (
            <View key={name}>
              {idx > 0 && (
                <View style={s.connectorWrapper}><View style={s.connectorLine} /></View>
              )}
              <View style={s.stepCard}>
                <View style={[s.stepIconBox, colors.bg]}>
                  <Text style={[s.stepDot, colors.text]}>{'\u25CF'}</Text>
                </View>
                <View style={s.stepContent}>
                  <Text style={s.stepTitle}>{describeStep(name, op)}</Text>
                  <Text style={s.stepMono}>{name}</Text>
                </View>
                <View style={[s.stepTypeBadge, colors.bg]}>
                  <Text style={[s.stepTypeBadgeText, colors.text]}>{String(op.type)}</Text>
                </View>
              </View>
            </View>
          );
        })}
        {/* Final output step */}
        <View style={s.connectorWrapper}><View style={s.connectorLine} /></View>
        <View style={s.outputStepCard}>
          <View style={s.outputStepIcon}>
            <Text style={s.outputStepArrow}>{'\u2192'}</Text>
          </View>
          <View style={s.stepContent}>
            <Text style={s.outputStepTitle}>Send to {manifest.title || 'app'}</Text>
          </View>
          <View style={s.outputBadge}>
            <Text style={s.outputBadgeText}>Output</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

// Preview Tab
function PreviewTab({ beforeData, afterData }: any) {
  const before = beforeData[0];
  const after = afterData[0];
  if (before == null || after == null) {
    return <View style={s.previewEmpty}><Text style={s.previewEmptyText}>No data available</Text></View>;
  }

  const allKeys = Object.keys(before);
  const afterIsObject = typeof after === 'object' && after !== null;
  const afterKeys = afterIsObject ? Object.keys(after) : [];

  return (
    <View style={s.previewContainer}>
      <Text style={s.sectionLabel}>
        Data preview (1 of {afterData.length} {afterData.length === 1 ? 'item' : 'items'})
      </Text>
      <View style={s.previewColumns}>
        <View style={s.previewColumn}>
          <Text style={s.previewOriginalHeader}>Original</Text>
          <View style={s.previewOriginalCard}>
            {allKeys.map(key => (
              <View key={key} style={s.previewFieldBlock}>
                <Text style={s.previewFieldLabel}>{key}</Text>
                <Text style={s.previewFieldValue} numberOfLines={1}>
                  {typeof before[key] === 'object' ? JSON.stringify(before[key]) : String(before[key])}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={s.previewArrowCol}>
          <Text style={s.arrowText}>{'\u2192'}</Text>
        </View>
        <View style={s.previewColumn}>
          <Text style={s.previewTransmittedHeader}>Transmitted</Text>
          <View style={s.previewTransmittedCard}>
            {allKeys.map(key => {
              const isKept = afterKeys.includes(key);
              return (
                <View key={key} style={[s.previewFieldBlock, !isKept && s.previewFieldDimmed]}>
                  <Text style={isKept ? s.previewFieldLabel : s.previewFieldLabelStruck}>
                    {key}
                  </Text>
                  {isKept && afterIsObject ? (
                    <Text style={s.previewFieldValue} numberOfLines={1}>
                      {typeof after[key] === 'object' ? JSON.stringify(after[key]) : String(after[key])}
                    </Text>
                  ) : (
                    <View style={s.previewRedactedBar} />
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

// Main Consent Screen
export default function ConsentScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params as any || {};

  // Raw query params from deep link — snake_case as-is
  const provider = params.provider;
  const redirectUri = params.redirect_uri;
  const state = params.state;
  const manifest = params.manifest;
  const accessType = params.access_type;
  const schedule = params.schedule;
  const codeChallenge = params.code_challenge;

  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const parsedManifest = useMemo(() => parseManifest(manifest), [manifest]);
  const hasManifest = parsedManifest.pipeline.length > 0;

  const getClientName = (uri: string, title: string) => {
    if (title) return title;
    if (!uri) return 'This app';
    try {
      const url = new URL(uri);
      const hostname = url.hostname;
      if (hostname === 'localhost' || hostname === '127.0.0.1') return 'Localhost';
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        const mainPart = parts[parts.length - 2];
        return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
      }
      return hostname;
    } catch { return 'This app'; }
  };

  const appName = getClientName(redirectUri, parsedManifest.title);

  useEffect(() => {
    if (!manifest || !hasManifest) return;
    setPreviewLoading(true);
    messageHandler.handlePreviewManifest({ manifest }).then(response => {
      setPreviewLoading(false);
      if (response?.success) setPreviewData(response.data);
    });
  }, [manifest, hasManifest]);

  const hasData = previewData?.before?.data?.length > 0 && previewData?.after?.data?.length > 0;

  const handleAuthorize = async () => {
    try {
      setIsAuthenticating(true);
      setError('');

      console.log('[Consent] handleAuthorize called, redirectUri:', redirectUri);
      const response = await messageHandler.handleAuthorize({
        provider, manifest, redirectUri, state,
        accessType, schedule, codeChallenge,
      });
      console.log('[Consent] handleAuthorize response:', JSON.stringify(response).substring(0, 200));

      if (response.success) {
        setIsAuthorized(true);
        // Redirect back to calling app with auth code
        if (redirectUri) {
          const callbackUrl = `${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${encodeURIComponent(response.authCode)}&state=${encodeURIComponent(state)}${response.publicKeyJWK ? '&oauthub_public_key=' + encodeURIComponent(JSON.stringify(response.publicKeyJWK)) : ''}`;
          console.log('[Consent] Redirecting to:', callbackUrl.substring(0, 200));
          setTimeout(() => {
            Linking.openURL(callbackUrl).catch((err: any) =>
              console.error('[Consent] Linking.openURL failed:', err.message)
            );
          }, 500);
        }
      } else {
        console.warn('[Consent] Authorization failed:', response.error);
        setError(response.error || 'Authorization failed');
      }
    } catch (err: any) {
      console.error('[Consent] Error:', err.message);
      setError(err.message || 'Authorization failed');
    } finally {
      setIsAuthenticating(false);
    }
  };

  const handleCancel = () => {
    // Redirect back to calling app with error=access_denied per OAuth 2.0 spec
    if (redirectUri) {
      try {
        const callbackUrl = new URL(redirectUri);
        callbackUrl.searchParams.append('error', 'access_denied');
        callbackUrl.searchParams.append('error_description', 'User denied the authorization request');
        if (state) callbackUrl.searchParams.append('state', state);
        Linking.openURL(callbackUrl.toString());
      } catch {
        // Invalid redirect URI, just go back
      }
    }
    navigation.goBack();
  };

  // Success state
  if (isAuthorized) {
    return (
      <SafeAreaView style={s.safeArea}>
        <View style={s.successCentered}>
          <View style={s.card}>
            <View style={s.headerBarSuccess}>
              <ShieldCheck size={20} color="#10b981" />
              <Text style={s.headerTitle}>OAuthHub</Text>
            </View>
            <View style={s.successBody}>
              <View style={s.successIconBox}>
                <CheckCircle size={32} color="#059669" />
              </View>
              <Text style={s.successHeading}>Access Granted</Text>
              <Text style={s.successSubtext}>
                Redirecting you back to <Text style={s.successAppName}>{appName}</Text>...
              </Text>
              <ActivityIndicator size="small" color="#9ca3af" />
            </View>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // Main consent screen
  const tabs = [
    { key: 'Overview', label: 'Overview' },
    { key: 'Steps', label: 'Process Steps' },
    { key: 'Preview', label: 'Data Preview' },
  ];

  const accessBadgeStyle =
    accessType === 'scheduled_time' ? s.accessBadgeAmber
    : accessType === 'install_time' ? s.accessBadgeBlue
    : s.accessBadgeGray;

  const accessTextStyle =
    accessType === 'scheduled_time' ? s.accessTextAmber
    : accessType === 'install_time' ? s.accessTextBlue
    : s.accessTextGray;

  return (
    <SafeAreaView style={s.safeArea}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.card}>
          {/* Header */}
          <View style={s.headerBar}>
            <ShieldCheck size={20} color="#3b82f6" />
            <Text style={s.headerTitle}>Sign in with OAuthHub</Text>
          </View>

          <View style={s.bodyPadding}>
            {/* App identity */}
            <View style={s.appIdentity}>
              <View style={s.globeBox}>
                <Globe size={32} color="white" />
              </View>
              <Text style={s.appIdentityTitle}>
                <Text style={s.appNameHighlight}>{appName}</Text> wants to access your data
              </Text>
              {parsedManifest.description ? (
                <Text style={s.appDescription}>{parsedManifest.description}</Text>
              ) : null}
            </View>

            {/* Manifest views — tabs */}
            {hasManifest && (
              <View style={s.manifestSection}>
                <Text style={s.sectionLabel}>
                  Data processing manifest
                </Text>
                <View style={s.tabBar}>
                  {tabs.map(tab => (
                    <TouchableOpacity
                      key={tab.key}
                      onPress={() => setActiveTab(tab.key)}
                      style={[s.tabItem, activeTab === tab.key && s.tabItemActive]}
                    >
                      <Text style={[s.tabLabel, activeTab === tab.key && s.tabLabelActive]}>
                        {tab.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={s.tabContent}>
                  <ScrollView nestedScrollEnabled>
                    {previewLoading ? (
                      <View style={s.loadingContainer}>
                        <ActivityIndicator size="small" color="#3b82f6" />
                        <Text style={s.loadingText}>Analyzing manifest...</Text>
                      </View>
                    ) : (
                      <>
                        {activeTab === 'Overview' && hasData && (
                          <OverviewTab beforeData={previewData.before.data} afterData={previewData.after.data} manifest={parsedManifest} />
                        )}
                        {activeTab === 'Overview' && !hasData && (
                          <OverviewTab beforeData={[]} afterData={[]} manifest={parsedManifest} />
                        )}
                        {activeTab === 'Steps' && <StepsTab manifest={parsedManifest} />}
                        {activeTab === 'Preview' && hasData && (
                          <PreviewTab beforeData={previewData.before.data} afterData={previewData.after.data} manifest={parsedManifest} />
                        )}
                        {activeTab === 'Preview' && !hasData && (
                          <View style={s.previewEmpty}>
                            <Text style={s.previewEmptyText}>No preview data available</Text>
                          </View>
                        )}
                      </>
                    )}
                  </ScrollView>
                </View>
              </View>
            )}

            {/* Warning: no manifest provided */}
            {!hasManifest && (
              <View style={s.warningBox}>
                <AlertTriangle size={16} color="#b45309" />
                <Text style={s.warningText}>
                  This app did not provide a data processing manifest. You cannot preview what data will be shared.
                </Text>
              </View>
            )}

            {/* Fallback: no manifest */}
            {!hasManifest && redirectUri && (
              <View style={s.fallbackCard}>
                <View style={s.fallbackHeader}>
                  <Info size={14} color="#9ca3af" />
                  <Text style={s.fallbackHeaderText}>Data Destination</Text>
                </View>
                <View style={s.fallbackBody}>
                  <Text style={s.fallbackUri}>{redirectUri}</Text>
                </View>
              </View>
            )}

            {/* Access type badge */}
            <View style={[s.accessBadgeBase, accessBadgeStyle]}>
              {accessType === 'scheduled_time' ? <Clock size={14} color="#b45309" />
                : accessType === 'install_time' ? <Zap size={14} color="#2563eb" />
                : <Eye size={14} color="#6b7280" />}
              <Text style={accessTextStyle}>
                {accessType === 'scheduled_time' ? `Scheduled recurring access${schedule ? ` (${schedule})` : ''}`
                  : accessType === 'install_time' ? 'One-time access at install'
                  : 'On-demand access only'}
              </Text>
            </View>

            {/* Error */}
            {error ? (
              <View style={s.errorBox}>
                <AlertTriangle size={16} color="#ef4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Action buttons */}
            <View style={s.buttonRow}>
              <TouchableOpacity
                onPress={handleCancel}
                style={s.denyButton}
              >
                <Text style={s.denyButtonText}>Deny</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleAuthorize}
                disabled={isAuthenticating}
                style={[s.allowButton, isAuthenticating && s.allowButtonDisabled]}
              >
                {isAuthenticating ? (
                  <View style={s.authLoadingRow}>
                    <ActivityIndicator size="small" color="white" />
                    <Text style={s.allowButtonText}>Authenticating...</Text>
                  </View>
                ) : (
                  <Text style={s.allowButtonText}>Allow</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // ── Layout / Safe Area ───────────────────────────────────
  safeArea: {
    flex: 1,
    backgroundColor: '#f1f5f9', // slate-100
  },
  scrollContent: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    minHeight: '100%',
  },
  card: {
    width: '100%',
    maxWidth: 512,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },

  // ── Header ───────────────────────────────────────────────
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6', // gray-100
    backgroundColor: '#f9fafb',   // gray-50
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerBarSuccess: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    backgroundColor: '#f9fafb',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4b5563', // gray-600
  },

  // ── Body padding ─────────────────────────────────────────
  bodyPadding: {
    paddingHorizontal: 24,
    paddingVertical: 20,
  },

  // ── App identity ─────────────────────────────────────────
  appIdentity: {
    alignItems: 'center',
  },
  globeBox: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: '#2563eb', // blue-600
    padding: 12,
  },
  appIdentityTitle: {
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '600',
    color: '#111827', // gray-900
  },
  appNameHighlight: {
    color: '#2563eb', // blue-600
  },
  appDescription: {
    marginTop: 4,
    textAlign: 'center',
    fontSize: 14,
    color: '#6b7280', // gray-500
  },

  // ── Section label (reused) ───────────────────────────────
  sectionLabel: {
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#9ca3af', // gray-400
  },

  // ── Tab bar ──────────────────────────────────────────────
  manifestSection: {
    marginTop: 20,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 12,
    backgroundColor: '#f3f4f6', // gray-100
    padding: 4,
  },
  tabItem: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  tabItemActive: {
    backgroundColor: '#ffffff',
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#6b7280', // gray-500
  },
  tabLabelActive: {
    color: '#111827', // gray-900
  },
  tabContent: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
    maxHeight: 320,
    overflow: 'hidden',
  },

  // ── Loading state ────────────────────────────────────────
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 24,
  },
  loadingText: {
    fontSize: 14,
    color: '#6b7280',
  },

  // ── Overview Tab ─────────────────────────────────────────
  overviewContainer: {
    padding: 16,
    gap: 16,
  },
  overviewCountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    borderRadius: 12,
    backgroundColor: '#f8fafc', // slate-50
    padding: 16,
  },
  overviewCountBlock: {
    alignItems: 'center',
  },
  overviewCountNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#374151', // gray-700
  },
  overviewCountNumberBlue: {
    fontSize: 30,
    fontWeight: '700',
    color: '#2563eb', // blue-600
  },
  overviewCountLabel: {
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: '#9ca3af', // gray-400
  },
  overviewArrowBlock: {
    alignItems: 'center',
    gap: 4,
  },
  arrowText: {
    color: '#d1d5db', // gray-300
  },
  filteredBadge: {
    borderRadius: 999,
    backgroundColor: '#fff7ed', // orange-100
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  filteredBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#ea580c', // orange-600
  },
  fieldsCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
    backgroundColor: '#ffffff',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#fafafa', // gray-50
  },
  fieldCheckIcon: {
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: '#d1fae5', // emerald-100
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldCheckText: {
    color: '#059669', // emerald-600
    fontSize: 12,
  },
  fieldKeptText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151', // gray-700
  },
  fieldRemoveIcon: {
    height: 20,
    width: 20,
    borderRadius: 10,
    backgroundColor: '#fef2f2', // red-50
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldRemoveText: {
    color: '#f87171', // red-400
    fontSize: 12,
  },
  fieldRemovedText: {
    fontSize: 14,
    color: '#9ca3af', // gray-400
    textDecorationLine: 'line-through',
  },

  // ── Steps Tab ────────────────────────────────────────────
  stepsContainer: {
    padding: 16,
  },
  connectorWrapper: {
    alignItems: 'center',
  },
  connectorLine: {
    height: 16,
    width: 1,
    backgroundColor: '#e5e7eb', // gray-200
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
    backgroundColor: '#ffffff',
    padding: 12,
  },
  stepIconBox: {
    height: 32,
    width: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDot: {
    fontSize: 12,
  },
  stepContent: {
    flex: 1,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1f2937', // gray-800
  },
  stepMono: {
    marginTop: 2,
    fontSize: 11,
    color: '#9ca3af', // gray-400
    fontFamily: 'monospace',
  },
  stepTypeBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  stepTypeBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
  },

  // Step color variants
  stepBgSlate: {
    backgroundColor: '#f1f5f9', // slate-100
  },
  stepTextSlate: {
    color: '#475569', // slate-600
  },
  stepBgBlue: {
    backgroundColor: '#dbeafe', // blue-100
  },
  stepTextBlue: {
    color: '#2563eb', // blue-600
  },
  stepBgIndigo: {
    backgroundColor: '#eef2ff', // indigo-50
  },
  stepTextIndigo: {
    color: '#4f46e5', // indigo-600
  },

  // Output step
  outputStepCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#bfdbfe', // blue-200
    backgroundColor: '#eff6ff', // blue-50
    padding: 12,
  },
  outputStepIcon: {
    height: 32,
    width: 32,
    borderRadius: 8,
    backgroundColor: '#bfdbfe', // blue-200
    alignItems: 'center',
    justifyContent: 'center',
  },
  outputStepArrow: {
    color: '#1d4ed8', // blue-700
    fontSize: 12,
  },
  outputStepTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1e40af', // blue-800
  },
  outputBadge: {
    borderRadius: 999,
    backgroundColor: '#bfdbfe', // blue-200
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  outputBadgeText: {
    fontSize: 10,
    fontWeight: '500',
    textTransform: 'uppercase',
    color: '#1d4ed8', // blue-700
  },

  // ── Preview Tab ──────────────────────────────────────────
  previewContainer: {
    padding: 16,
  },
  previewEmpty: {
    padding: 24,
    alignItems: 'center',
  },
  previewEmptyText: {
    fontSize: 14,
    color: '#9ca3af',
  },
  previewColumns: {
    flexDirection: 'row',
    gap: 12,
  },
  previewColumn: {
    flex: 1,
  },
  previewArrowCol: {
    justifyContent: 'center',
  },
  previewOriginalHeader: {
    marginBottom: 8,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#9ca3af', // gray-400
  },
  previewTransmittedHeader: {
    marginBottom: 8,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#3b82f6', // blue-500
  },
  previewOriginalCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#f3f4f6', // gray-100
    backgroundColor: '#f9fafb', // gray-50
    padding: 12,
  },
  previewTransmittedCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe', // blue-100
    backgroundColor: '#eff6ff', // blue-50
    padding: 12,
  },
  previewFieldBlock: {
    marginBottom: 8,
  },
  previewFieldDimmed: {
    opacity: 0.25,
  },
  previewFieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6b7280', // gray-500
  },
  previewFieldLabelStruck: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9ca3af', // gray-400
    textDecorationLine: 'line-through',
  },
  previewFieldValue: {
    fontSize: 12,
    color: '#374151', // gray-700
  },
  previewRedactedBar: {
    marginTop: 2,
    height: 12,
    width: '75%',
    borderRadius: 4,
    backgroundColor: '#e5e7eb', // gray-200
  },

  // ── Fallback (no manifest) ───────────────────────────────
  fallbackCard: {
    marginTop: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb', // gray-200
    overflow: 'hidden',
  },
  fallbackHeader: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f9fafb', // gray-50
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fallbackHeaderText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    color: '#9ca3af', // gray-400
  },
  fallbackBody: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  fallbackUri: {
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#1f2937', // gray-800
  },

  // ── Access type badge ────────────────────────────────────
  accessBadgeBase: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  accessBadgeAmber: {
    backgroundColor: '#fffbeb', // amber-50
    borderColor: '#fde68a',     // amber-200
  },
  accessBadgeBlue: {
    backgroundColor: '#eff6ff', // blue-50
    borderColor: '#bfdbfe',     // blue-200
  },
  accessBadgeGray: {
    backgroundColor: '#f9fafb', // gray-50
    borderColor: '#e5e7eb',     // gray-200
  },
  accessTextAmber: {
    fontSize: 12,
    fontWeight: '500',
    color: '#b45309', // amber-700
  },
  accessTextBlue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1d4ed8', // blue-700
  },
  accessTextGray: {
    fontSize: 12,
    fontWeight: '500',
    color: '#4b5563', // gray-600
  },

  // ── Warning (no manifest) ───────────────────────────────
  warningBox: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  warningText: {
    fontSize: 13,
    color: '#92400e',
    flex: 1,
    lineHeight: 18,
  },

  // ── Error ────────────────────────────────────────────────
  errorBox: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2', // red-50
    borderWidth: 1,
    borderColor: '#fecaca',     // red-200
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  errorText: {
    fontSize: 14,
    color: '#b91c1c', // red-700
    flex: 1,
  },

  // ── Action buttons ───────────────────────────────────────
  buttonRow: {
    marginTop: 24,
    flexDirection: 'row',
    gap: 12,
  },
  denyButton: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb', // gray-200
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  denyButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#374151', // gray-700
  },
  allowButton: {
    flex: 1,
    borderRadius: 12,
    backgroundColor: '#2563eb', // blue-600
    paddingHorizontal: 16,
    paddingVertical: 10,
    alignItems: 'center',
  },
  allowButtonDisabled: {
    backgroundColor: '#9ca3af', // gray-400
  },
  allowButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ffffff',
  },
  authLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  // ── Success state ────────────────────────────────────────
  successCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  successBody: {
    paddingHorizontal: 32,
    paddingVertical: 48,
    alignItems: 'center',
  },
  successIconBox: {
    width: 64,
    height: 64,
    marginBottom: 20,
    backgroundColor: '#d1fae5', // emerald-100
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successHeading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827', // gray-900
    marginBottom: 8,
  },
  successSubtext: {
    fontSize: 14,
    color: '#6b7280', // gray-500
    marginBottom: 24,
    textAlign: 'center',
  },
  successAppName: {
    fontWeight: '600',
    color: '#374151', // gray-700
  },
});
