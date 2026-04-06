// ===== CONSTRAINT ENFORCEMENT =====

export const isOAuthHubEnabled = async () => {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return settings.enabled !== false;
};

export const assertOAuthHubEnabled = async () => {
  if (!(await isOAuthHubEnabled())) {
    throw new Error('OAuthHub is inactive');
  }
};

export function findManifestEntry(manifests, authData) {
  return manifests.find(m =>
    m.authCode === authData.code ||
    (m.provider === authData.provider && m.manifestText === authData.manifest)
  );
}

export async function enforceConstraints(authData) {
  if (!(await isOAuthHubEnabled())) {
    return { allowed: false, reason: 'OAuthHub is inactive' };
  }

  const { manifests = [] } = await chrome.storage.local.get('manifests');
  const manifestEntry = findManifestEntry(manifests, authData);

  if (!manifestEntry) return { allowed: true };
  if (!manifestEntry.enabled) return { allowed: false, reason: 'Manifest is disabled by user' };

  const c = manifestEntry.constraints;
  if (!c) return { allowed: true };

  const now = Date.now();

  // Time constraints
  if (c.time) {
    if (c.time.expiresAt && now > new Date(c.time.expiresAt).getTime()) {
      return { allowed: false, reason: 'Manifest has expired' };
    }
    if (c.time.durationMs && c.time.grantedAt) {
      if (now > new Date(c.time.grantedAt).getTime() + c.time.durationMs) {
        return { allowed: false, reason: 'Access duration has elapsed' };
      }
    }
    if (c.time.allowedWindows && c.time.allowedWindows.length > 0) {
      const nowDate = new Date();
      const currentDay = nowDate.getDay();
      const currentTime = nowDate.getHours() * 60 + nowDate.getMinutes();
      const inWindow = c.time.allowedWindows.some(w => {
        if (w.days && w.days.length > 0 && !w.days.includes(currentDay)) return false;
        const [startH, startM] = (w.start || '00:00').split(':').map(Number);
        const [endH, endM] = (w.end || '23:59').split(':').map(Number);
        return currentTime >= startH * 60 + startM && currentTime <= endH * 60 + endM;
      });
      if (!inWindow) return { allowed: false, reason: 'Outside allowed time window' };
    }
  }

  // Usage constraints
  if (c.usage) {
    if (c.usage.maxTotalUses !== null && c.usage.currentUses >= c.usage.maxTotalUses) {
      return { allowed: false, reason: `Total usage limit reached (${c.usage.maxTotalUses})` };
    }
    if (c.usage.maxUsesPerPeriod !== null) {
      const periodMs = { hour: 3600000, day: 86400000, week: 604800000, month: 2592000000 };
      const windowMs = periodMs[c.usage.period] || periodMs.day;
      const recentUses = (c.usage.usageLog || []).filter(t => now - new Date(t).getTime() < windowMs);
      if (recentUses.length >= c.usage.maxUsesPerPeriod) {
        return { allowed: false, reason: `Usage limit per ${c.usage.period} reached (${c.usage.maxUsesPerPeriod})` };
      }
    }
  }

  return { allowed: true, manifestEntry };
}

export async function recordConstraintUsage(authData) {
  const { manifests = [] } = await chrome.storage.local.get('manifests');
  const manifestEntry = findManifestEntry(manifests, authData);
  const idx = manifestEntry ? manifests.findIndex(m => m.id === manifestEntry.id) : -1;
  if (idx === -1) return;

  const c = manifests[idx].constraints;
  if (!c || !c.usage) return;

  c.usage.currentUses = (c.usage.currentUses || 0) + 1;
  if (!c.usage.usageLog) c.usage.usageLog = [];
  c.usage.usageLog.push(new Date().toISOString());
  if (c.usage.usageLog.length > 1000) c.usage.usageLog = c.usage.usageLog.slice(-1000);

  await chrome.storage.local.set({ manifests });
}
