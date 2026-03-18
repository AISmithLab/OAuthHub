import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Mail, HardDrive, FileSpreadsheet, Wifi, WifiOff, Unplug, Plus, Loader2 } from 'lucide-react';

const SERVICE_META = {
  google_calendar: {
    name: 'Google Calendar', icon: Calendar, color: 'blue',
    scopes: ['https://www.googleapis.com/auth/calendar.events.readonly'],
  },
  gmail: {
    name: 'Gmail', icon: Mail, color: 'red',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  },
  google_drive: {
    name: 'Google Drive', icon: HardDrive, color: 'yellow',
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  },
  google_forms: {
    name: 'Google Forms', icon: FileSpreadsheet, color: 'purple',
    scopes: ['https://www.googleapis.com/auth/forms.responses.readonly'],
  },
};

const ALL_SERVICES = ['google_calendar', 'gmail', 'google_drive', 'google_forms'];

const colorMap = {
  blue:   { bg: 'bg-blue-50',   text: 'text-blue-600',   hover: 'hover:bg-blue-100' },
  red:    { bg: 'bg-red-50',    text: 'text-red-600',    hover: 'hover:bg-red-100' },
  yellow: { bg: 'bg-amber-50',  text: 'text-amber-600',  hover: 'hover:bg-amber-100' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', hover: 'hover:bg-purple-100' },
};

const ServicesPanel = () => {
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(null);
  const [error, setError] = useState(null);

  const fetchServices = () => {
    chrome.runtime.sendMessage({ type: 'GET_CONNECTED_SERVICES' }, (response) => {
      if (response?.success) {
        setServices(response.services || []);
      }
      setLoading(false);
    });
  };

  useEffect(() => { fetchServices(); }, []);

  const handleConnect = (provider) => {
    const meta = SERVICE_META[provider];
    if (!meta) return;

    setConnecting(provider);
    setError(null);
    chrome.runtime.sendMessage({
      type: 'CONNECT_SERVICE',
      data: { provider, requiredScopes: meta.scopes }
    }, (response) => {
      setConnecting(null);
      if (response?.success) {
        fetchServices();
      } else {
        setError(`Failed to connect ${meta.name}: ${response?.error || 'Unknown error'}`);
      }
    });
  };

  const handleDisconnect = (provider) => {
    chrome.runtime.sendMessage({ type: 'DISCONNECT_SERVICE', provider }, (response) => {
      if (response?.success) {
        fetchServices();
      }
    });
  };

  const allItems = ALL_SERVICES.map(key => {
    const connected = services.find(s => s.provider === key);
    return {
      key,
      meta: SERVICE_META[key],
      connected: !!connected,
      active: connected?.active || 0,
      connections: connected?.connections || 0,
      lastUsed: connected?.lastUsed,
    };
  });

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
            <h1 className="text-lg font-bold text-gray-900">Connected Services</h1>
            <p className="text-xs text-gray-400">{services.length} connected</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {allItems.map(({ key, meta, connected, active, connections, lastUsed }) => {
            const Icon = meta.icon;
            const colors = colorMap[meta.color];
            const isConnecting = connecting === key;
            return (
              <div key={key} className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden hover:shadow-xl transition-all duration-200">
                <div className="flex items-center justify-between px-5 py-4">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 ${colors.bg} rounded-lg flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{meta.name}</div>
                      {connected ? (
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1 text-xs text-emerald-600">
                            <Wifi className="w-3 h-3" />
                            {active} active
                          </span>
                          <span className="text-xs text-gray-400">
                            {connections} total connection{connections !== 1 ? 's' : ''}
                          </span>
                          {lastUsed && (
                            <span className="text-xs text-gray-400">
                              Last used {new Date(lastUsed).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                          <WifiOff className="w-3 h-3" />
                          Not connected
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {connected ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Connected
                        </span>
                        <button
                          onClick={() => handleDisconnect(key)}
                          className="p-2 hover:bg-rose-50 rounded-lg transition-colors group"
                          title="Disconnect"
                        >
                          <Unplug className="w-4 h-4 text-gray-400 group-hover:text-rose-500 transition-colors" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleConnect(key)}
                        disabled={isConnecting}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-white transition-all duration-200 ${
                          isConnecting
                            ? 'bg-gray-400 cursor-wait'
                            : 'bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow'
                        }`}
                      >
                        {isConnecting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        {isConnecting ? 'Connecting...' : 'Connect'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <div className="mt-4 p-4 bg-rose-50 rounded-xl border border-rose-200">
          <p className="text-xs text-rose-700">{error}</p>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
        <p className="text-xs text-blue-700">
          Connect a Google service to grant OAuthHub read access. Apps will still need your approval through the consent screen before accessing any data.
        </p>
      </div>
    </div>
  );
};

export default ServicesPanel;
