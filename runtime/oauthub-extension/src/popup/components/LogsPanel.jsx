import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, CheckCircle, XCircle, Clock, ChevronDown, Activity } from 'lucide-react';

const LogsPanel = () => {
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState('Simple');
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    chrome.storage.local.get(['logs'], (result) => {
      if (result.logs) {
        setLogs(result.logs);
      }
    });
  }, []);

  const filteredLogs = logs.filter(log =>
    log.status.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.type.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.initiator.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
            <h1 className="text-lg font-bold text-gray-900">Request Logs</h1>
            <p className="text-xs text-gray-400">{filteredLogs.length} entries</p>
          </div>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by status, type, or initiator..."
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="relative">
            <select
              className="appearance-none pl-4 pr-10 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm cursor-pointer"
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value)}
            >
              <option>Simple</option>
              <option>Detailed</option>
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden mt-3">
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Time</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Manifest</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Initiator</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Type</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filteredLogs.map((log, index) => (
              <tr key={index} className="hover:bg-slate-50/50 transition-colors duration-150">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    <span className="text-xs text-gray-500">{new Date(log.time).toLocaleString()}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono bg-gray-50 px-2 py-1 rounded-md text-gray-700 border border-gray-100">
                    {log.manifest}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{log.initiator}</td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">{log.type}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
                    log.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-rose-50 text-rose-700 border border-rose-200'
                  }`}>
                    {log.status === 'approved'
                      ? <CheckCircle className="w-3 h-3" />
                      : <XCircle className="w-3 h-3" />
                    }
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filteredLogs.length === 0 && (
          <div className="py-12 text-center">
            <Activity className="w-8 h-8 text-gray-300 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No logs found</p>
            <p className="text-xs text-gray-300 mt-1">Matching entries will appear here</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LogsPanel;
