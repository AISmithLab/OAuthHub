import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, FileText, Activity, ChevronRight, TrendingDown, TrendingUp, MinusCircle, Link2 } from 'lucide-react';

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    manifests: { total: 0, disabled: 0 },
    rejected: { total: 0, percentage: 0 },
    responses: { total: 0, increase: 0, percentage: 0 }
  });
  const [settings, setSettings] = useState({ enabled: true });

  useEffect(() => {
    chrome.storage.local.get(['settings'], (result) => {
      if (result.settings) setSettings(result.settings);
    });
    chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
      if (response?.success && response.stats) setStats(response.stats);
    });
  }, []);

  const toggleSetting = async (key) => {
    const newSettings = { ...settings, [key]: !settings[key] };
    setSettings(newSettings);
    await chrome.storage.local.set({ settings: newSettings });
  };

  return (
    <div className="w-[800px] h-[450px] overflow-auto p-6 bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
            <ShieldCheck className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">OAuthHub</h1>
            <p className="text-xs text-gray-400 font-medium">OAuth Privacy Firewall</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              settings.enabled ? 'bg-blue-600' : 'bg-gray-300'
            }`}
            onClick={() => toggleSetting('enabled')}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
              settings.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${
            settings.enabled
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-gray-100 text-gray-500 border border-gray-200'
          }`}>
            <span className={`w-2 h-2 rounded-full ${settings.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
            {settings.enabled ? 'Active' : 'Inactive'}
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white p-5 rounded-xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Manifests</span>
            <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
              <FileText className="w-4 h-4 text-blue-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900">{stats.manifests.total}</div>
          <div className="flex items-center gap-1 mt-1">
            <MinusCircle className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">{stats.manifests.disabled} disabled</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Rejected</span>
            <div className="w-8 h-8 bg-rose-50 rounded-lg flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-rose-500" />
            </div>
          </div>
          <div className="text-3xl font-bold text-rose-500">{stats.rejected.total}</div>
          <div className="flex items-center gap-1 mt-1">
            <TrendingDown className="w-3 h-3 text-rose-400" />
            <span className="text-xs text-rose-500">{stats.rejected.percentage}%</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-lg border border-gray-100 hover:shadow-xl transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Responses</span>
            <div className="w-8 h-8 bg-emerald-50 rounded-lg flex items-center justify-center">
              <Activity className="w-4 h-4 text-emerald-600" />
            </div>
          </div>
          <div className="text-3xl font-bold text-gray-900">{stats.responses.total}</div>
          <div className="flex items-center gap-1 mt-1">
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            <span className="text-xs text-emerald-600">+{stats.responses.increase} ({stats.responses.percentage}%)</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => navigate('/manifests')}
          className="group p-5 bg-white rounded-xl shadow-lg border border-gray-100 hover:shadow-xl hover:border-blue-200 transition-all duration-200 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">Manifests</div>
                <div className="text-xs text-gray-500">Manage permissions</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
          </div>
        </button>

        <button
          onClick={() => navigate('/services')}
          className="group p-5 bg-white rounded-xl shadow-lg border border-gray-100 hover:shadow-xl hover:border-purple-200 transition-all duration-200 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center group-hover:bg-purple-100 transition-colors">
                <Link2 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">Services</div>
                <div className="text-xs text-gray-500">Connected accounts</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-purple-500 transition-colors" />
          </div>
        </button>

        <button
          onClick={() => navigate('/logs')}
          className="group p-5 bg-white rounded-xl shadow-lg border border-gray-100 hover:shadow-xl hover:border-amber-200 transition-all duration-200 text-left"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center group-hover:bg-amber-100 transition-colors">
                <Activity className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-900">Request Logs</div>
                <div className="text-xs text-gray-500">View access history</div>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-amber-500 transition-colors" />
          </div>
        </button>
      </div>
    </div>
  );
};

export default Dashboard;
