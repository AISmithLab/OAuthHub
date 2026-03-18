import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, ToggleLeft, ToggleRight, MoreVertical, Globe, Shield, X, Clock, Hash, FolderOpen, Trash2, Settings } from 'lucide-react';

// ─── Constraint Editor Modal ─────────────────────────────────
const ConstraintEditor = ({ manifest, onClose, onSave }) => {
  const [constraints, setConstraints] = useState(
    manifest.constraints || {
      usage: { maxTotalUses: null, maxUsesPerPeriod: null, period: 'day', currentUses: 0, usageLog: [] },
      resource: { allowedFolders: [], allowedFileTypes: [], allowedLabels: [], obfuscateFields: [] },
      time: { expiresAt: null, durationMs: null, grantedAt: manifest.grantedAt || null, allowedWindows: [] }
    }
  );
  const [activeTab, setActiveTab] = useState('usage');

  const updateUsage = (key, value) => {
    setConstraints(prev => ({
      ...prev,
      usage: { ...prev.usage, [key]: value }
    }));
  };

  const updateTime = (key, value) => {
    setConstraints(prev => ({
      ...prev,
      time: { ...prev.time, [key]: value }
    }));
  };

  const updateResource = (key, value) => {
    setConstraints(prev => ({
      ...prev,
      resource: { ...prev.resource, [key]: value }
    }));
  };

  const handleSave = () => {
    chrome.runtime.sendMessage({
      type: 'UPDATE_MANIFEST_CONSTRAINTS',
      data: { manifestId: manifest.id, constraints }
    }, (response) => {
      if (response?.success) {
        onSave(constraints);
        onClose();
      }
    });
  };

  const tabs = [
    { id: 'usage', label: 'Usage', icon: Hash },
    { id: 'time', label: 'Time', icon: Clock },
    { id: 'resource', label: 'Resource', icon: FolderOpen }
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[420px] overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Constraints</h2>
            <p className="text-xs text-gray-400">{manifest.title || manifest.provider}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[260px]">
          {activeTab === 'usage' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Max total uses</label>
                <input
                  type="number"
                  min="0"
                  placeholder="Unlimited"
                  value={constraints.usage.maxTotalUses ?? ''}
                  onChange={e => updateUsage('maxTotalUses', e.target.value ? parseInt(e.target.value) : null)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Current uses: {constraints.usage.currentUses || 0}</p>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Max uses per period</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Unlimited"
                    value={constraints.usage.maxUsesPerPeriod ?? ''}
                    onChange={e => updateUsage('maxUsesPerPeriod', e.target.value ? parseInt(e.target.value) : null)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="w-32">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Period</label>
                  <select
                    value={constraints.usage.period || 'day'}
                    onChange={e => updateUsage('period', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="hour">Hour</option>
                    <option value="day">Day</option>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'time' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Expires at</label>
                <input
                  type="datetime-local"
                  value={constraints.time.expiresAt ? new Date(constraints.time.expiresAt).toISOString().slice(0, 16) : ''}
                  onChange={e => updateTime('expiresAt', e.target.value ? new Date(e.target.value).toISOString() : null)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Duration limit (hours)</label>
                <input
                  type="number"
                  min="0"
                  placeholder="No limit"
                  value={constraints.time.durationMs ? Math.round(constraints.time.durationMs / 3600000) : ''}
                  onChange={e => updateTime('durationMs', e.target.value ? parseInt(e.target.value) * 3600000 : null)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {constraints.time.grantedAt && (
                  <p className="text-xs text-gray-400 mt-1">Granted: {new Date(constraints.time.grantedAt).toLocaleString()}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Allowed time windows</label>
                {(constraints.time.allowedWindows || []).map((w, i) => (
                  <div key={i} className="flex items-center gap-2 mb-2">
                    <input
                      type="time"
                      value={w.start || '09:00'}
                      onChange={e => {
                        const windows = [...(constraints.time.allowedWindows || [])];
                        windows[i] = { ...windows[i], start: e.target.value };
                        updateTime('allowedWindows', windows);
                      }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                    />
                    <span className="text-xs text-gray-400">to</span>
                    <input
                      type="time"
                      value={w.end || '17:00'}
                      onChange={e => {
                        const windows = [...(constraints.time.allowedWindows || [])];
                        windows[i] = { ...windows[i], end: e.target.value };
                        updateTime('allowedWindows', windows);
                      }}
                      className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                    />
                    <button
                      onClick={() => {
                        const windows = constraints.time.allowedWindows.filter((_, idx) => idx !== i);
                        updateTime('allowedWindows', windows);
                      }}
                      className="p-1 hover:bg-red-50 rounded text-red-400"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => {
                    const windows = [...(constraints.time.allowedWindows || []), { start: '09:00', end: '17:00', days: [1, 2, 3, 4, 5] }];
                    updateTime('allowedWindows', windows);
                  }}
                  className="text-xs text-blue-500 hover:text-blue-700"
                >
                  + Add time window
                </button>
              </div>
            </div>
          )}

          {activeTab === 'resource' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Obfuscate fields (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. email, attendees.email"
                  value={(constraints.resource.obfuscateFields || []).join(', ')}
                  onChange={e => updateResource('obfuscateFields', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">These fields will be masked before transmission</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Allowed file types (comma-separated MIME types)</label>
                <input
                  type="text"
                  placeholder="e.g. application/pdf, image/*"
                  value={(constraints.resource.allowedFileTypes || []).join(', ')}
                  onChange={e => updateResource('allowedFileTypes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Allowed Gmail labels (comma-separated)</label>
                <input
                  type="text"
                  placeholder="e.g. INBOX, IMPORTANT"
                  value={(constraints.resource.allowedLabels || []).join(', ')}
                  onChange={e => updateResource('allowedLabels', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-6 py-3 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium text-gray-600 hover:bg-gray-200 rounded-lg transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            Save Constraints
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Context Menu Dropdown ───────────────────────────────────
const ManifestMenu = ({ manifest, onEdit, onRevoke, onClose }) => {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  return (
    <div ref={menuRef} className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20 w-44">
      <button
        onClick={() => { onEdit(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 transition-colors"
      >
        <Settings className="w-3.5 h-3.5" />
        Edit Constraints
      </button>
      <button
        onClick={() => { onRevoke(); onClose(); }}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 transition-colors"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Revoke Access
      </button>
    </div>
  );
};

// ─── Main Panel ──────────────────────────────────────────────
const ManifestsPanel = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [manifests, setManifests] = useState([]);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [editingManifest, setEditingManifest] = useState(null);

  useEffect(() => {
    chrome.storage.local.get(['manifests'], (result) => {
      if (result.manifests) {
        setManifests(result.manifests);
      }
    });
  }, []);

  const toggleManifest = async (id) => {
    const updatedManifests = manifests.map(m =>
      m.id === id ? { ...m, enabled: !m.enabled } : m
    );
    setManifests(updatedManifests);
    await chrome.storage.local.set({ manifests: updatedManifests });
  };

  const revokeManifest = (id) => {
    if (!confirm('Revoke this manifest? This will delete all authorization records and cancel scheduled tasks.')) return;
    chrome.runtime.sendMessage({
      type: 'REVOKE_MANIFEST',
      data: { manifestId: id }
    }, (response) => {
      if (response?.success) {
        setManifests(prev => prev.filter(m => m.id !== id));
      }
    });
  };

  const handleConstraintSave = (manifestId, constraints) => {
    setManifests(prev => prev.map(m =>
      m.id === manifestId ? { ...m, constraints } : m
    ));
  };

  const filteredManifests = manifests.filter(m =>
    m.provider?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.title?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.id?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Group manifests by provider
  const grouped = {};
  for (const m of filteredManifests) {
    const key = m.provider || 'Unknown';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  const providerIcons = {
    google_calendar: 'Google Calendar',
    gmail: 'Gmail',
    google_drive: 'Google Drive',
    google_forms: 'Google Forms'
  };

  return (
    <div className="w-[800px] h-[450px] overflow-auto p-6 bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Header */}
      <div className="sticky top-0 z-10 pb-4 bg-gradient-to-br from-slate-50 to-gray-100">
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => navigate('/')}
            className="p-2 hover:bg-white rounded-xl border border-transparent hover:border-gray-200 hover:shadow-sm transition-all duration-200"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Manifests</h1>
            <p className="text-xs text-gray-400">{filteredManifests.length} registered</p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search manifests..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Manifest Groups */}
      <div className="space-y-4 mt-3">
        {Object.entries(grouped).map(([provider, items]) => (
          <div key={provider} className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden">
            {/* Group Header */}
            <div className="flex justify-between items-center px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                  <Globe className="w-4 h-4 text-blue-600" />
                </div>
                <h2 className="text-sm font-semibold text-gray-900">{providerIcons[provider] || provider}</h2>
              </div>
              <span className="text-xs text-gray-400">{items.length} manifest{items.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Manifest Items */}
            <div className="divide-y divide-gray-50">
              {items.map((manifest) => {
                const c = manifest.constraints;
                const hasConstraints = c && (
                  c.usage?.maxTotalUses !== null ||
                  c.usage?.maxUsesPerPeriod !== null ||
                  c.time?.expiresAt !== null ||
                  c.time?.durationMs !== null ||
                  (c.time?.allowedWindows || []).length > 0 ||
                  (c.resource?.obfuscateFields || []).length > 0
                );

                return (
                  <div key={manifest.id} className="px-5 py-3.5 hover:bg-slate-50/50 transition-colors duration-150">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => toggleManifest(manifest.id)}
                          className="focus:outline-none transition-colors duration-200"
                        >
                          {manifest.enabled ? (
                            <ToggleRight className="w-6 h-6 text-blue-600" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-gray-300" />
                          )}
                        </button>
                        <div>
                          <span className={`text-sm font-medium ${manifest.enabled ? 'text-gray-900' : 'text-gray-400'}`}>
                            {manifest.title || manifest.provider}
                          </span>
                          {manifest.accessType && (
                            <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded bg-gray-100 text-gray-500">
                              {manifest.accessType}
                            </span>
                          )}
                          {hasConstraints && (
                            <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-amber-50 text-amber-600">
                              constrained
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setOpenMenuId(openMenuId === manifest.id ? null : manifest.id)}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <MoreVertical className="w-4 h-4 text-gray-400" />
                        </button>
                        {openMenuId === manifest.id && (
                          <ManifestMenu
                            manifest={manifest}
                            onEdit={() => setEditingManifest(manifest)}
                            onRevoke={() => revokeManifest(manifest.id)}
                            onClose={() => setOpenMenuId(null)}
                          />
                        )}
                      </div>
                    </div>

                    {/* Constraint summary */}
                    {hasConstraints && (
                      <div className="ml-9 mt-2 flex flex-wrap gap-2">
                        {c.usage?.maxTotalUses !== null && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                            {c.usage.currentUses || 0}/{c.usage.maxTotalUses} uses
                          </span>
                        )}
                        {c.usage?.maxUsesPerPeriod !== null && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                            {c.usage.maxUsesPerPeriod}/{c.usage.period}
                          </span>
                        )}
                        {c.time?.expiresAt && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                            new Date(c.time.expiresAt) < new Date() ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                          }`}>
                            expires {new Date(c.time.expiresAt).toLocaleDateString()}
                          </span>
                        )}
                        {(c.resource?.obfuscateFields || []).length > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-50 text-purple-600">
                            {c.resource.obfuscateFields.length} field(s) obfuscated
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {/* Empty State */}
        {filteredManifests.length === 0 && (
          <div className="bg-white rounded-xl shadow-lg border border-gray-100 py-12 text-center">
            <Shield className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No manifests registered</p>
            <p className="text-xs text-gray-300 mt-1">Service manifests will appear here when apps request access</p>
          </div>
        )}
      </div>

      {/* Constraint Editor Modal */}
      {editingManifest && (
        <ConstraintEditor
          manifest={editingManifest}
          onClose={() => setEditingManifest(null)}
          onSave={(constraints) => handleConstraintSave(editingManifest.id, constraints)}
        />
      )}
    </div>
  );
};

export default ManifestsPanel;
