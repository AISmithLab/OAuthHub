import React, { useState, useEffect, useMemo } from 'react';
import {
  ShieldCheck, Globe, AlertTriangle, CheckCircle,
  Clock, Zap, Eye, Info
} from 'lucide-react';

// ─── Manifest Parser ──────────────────────────────────────────

function parseManifest(manifestText) {
  const manifest = { title: '', description: '', pipeline: [], operators: {} };
  if (!manifestText) return manifest;

  const lines = manifestText.split('\n');
  let pipelineStr = '';
  let operatorText = '';
  let collectingPipeline = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { collectingPipeline = false; continue; }
    if (line.startsWith('TITLE:')) { manifest.title = line.substring(6).trim(); collectingPipeline = false; }
    else if (line.startsWith('DESCRIPTION:')) { manifest.description = line.substring(12).trim(); collectingPipeline = false; }
    else if (line.startsWith('PIPELINE:')) { pipelineStr = line.substring(9); collectingPipeline = true; }
    else if (collectingPipeline && line.includes('->')) { pipelineStr += ' ' + line; }
    else { collectingPipeline = false; operatorText += line + ' '; }
  }
  manifest.pipeline = pipelineStr.replace(/\s+/g, '').split('->').filter(Boolean);

  let i = 0;
  while (i < operatorText.length) {
    const nameMatch = operatorText.substring(i).match(/^(\w+)\s*\(/);
    if (nameMatch) {
      const name = nameMatch[1];
      const bodyStart = i + nameMatch[0].length;
      let depth = 1, j = bodyStart, inStr = false;
      while (j < operatorText.length && depth > 0) {
        const ch = operatorText[j];
        if (ch === '"' && (j === 0 || operatorText[j - 1] !== '\\')) inStr = !inStr;
        if (!inStr) { if (ch === '(') depth++; else if (ch === ')') depth--; }
        j++;
      }
      manifest.operators[name] = parseOperatorConfig(operatorText.substring(bodyStart, j - 1));
      i = j;
    } else { i++; }
  }
  return manifest;
}

function parseOperatorConfig(configText) {
  const content = configText.trim();
  const config = {};
  let currentKey = '', currentValue = '', insideArray = false, insideString = false, arrayDepth = 0;
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '[') { arrayDepth++; insideArray = true; currentValue += c; }
    else if (c === ']') { arrayDepth--; if (arrayDepth === 0) insideArray = false; currentValue += c; }
    else if (c === '"' && !insideArray) { insideString = !insideString; currentValue += c; }
    else if (c === ':' && !insideString && !insideArray && currentKey === '') { currentKey = currentValue.trim(); currentValue = ''; }
    else if (c === ',' && !insideString && !insideArray) { if (currentKey) { config[currentKey] = parseValue(currentValue.trim()); currentKey = ''; currentValue = ''; } }
    else { currentValue += c; }
  }
  if (currentKey) config[currentKey] = parseValue(currentValue.trim());
  return config;
}

function parseValue(value) {
  if (!value) return '';
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === 'NOW') return 'NOW';
  if (value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1);
    const items = [];
    let cur = '', inStr = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') inStr = !inStr;
      else if (ch === ',' && !inStr) { if (cur.trim()) items.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) items.push(cur.trim().replace(/^"|"$/g, ''));
    return items;
  }
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  return value.replace(/"/g, '');
}

// ─── Natural Language Step Descriptions ───────────────────────

function formatResourceType(rt) {
  if (!rt) return 'data source';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function describeStep(name, op) {
  const type = String(op.type || '').toLowerCase();
  switch (type) {
    case 'input': case 'pull': return `Pull from ${formatResourceType(String(op.resourceType || ''))}`;
    case 'filter': {
      const fields = Array.isArray(op.fields) ? op.fields.join(', ') : Array.isArray(op.field) ? op.field.join(', ') : String(op.field || 'items');
      const target = String(op.pattern || op.targetValue || '');
      const operation = String(op.operation || 'match');
      if (operation === 'match') return `Keep items where ${fields} matches "${target}"`;
      if (operation === 'include') return `Keep items containing "${target}" in ${fields}`;
      if (operation === 'not include') return `Remove items containing "${target}" in ${fields}`;
      if (['==', '!=', '>', '<', '>=', '<='].includes(operation))
        return `Keep items where ${fields} ${operation} ${target === 'NOW' ? 'current time' : `"${target}"`}`;
      return `Filter by ${fields}`;
    }
    case 'select': {
      const f = Array.isArray(op.fields) ? op.fields : Array.isArray(op.field) ? op.field : [String(op.field || '')];
      return `Keep only: ${f.join(', ')}`;
    }
    case 'limit': return `Limit to ${String(op.count)} items`;
    case 'aggregate': return `Calculate ${String(op.operation)}${op.field ? ` of ${String(op.field)}` : ''}`;
    case 'extract': return `Extract ${String(op.pattern || 'patterns')} from ${String(op.field || 'data')}`;
    case 'sort': return `Sort by ${String(op.sortKey)} (${String(op.order || 'ascending')})`;
    case 'post': return 'Send to destination';
    default: return `Process: ${String(op.type)}`;
  }
}

// ─── Step Icon SVG paths ──────────────────────────────────────

function getIconPath(op) {
  const type = String(op.type || '').toLowerCase();
  switch (type) {
    case 'input': case 'pull':
      return 'M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3';
    case 'filter':
      return 'M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z';
    case 'select':
      return 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5';
    case 'limit':
      return 'M3.75 6.75h16.5M3.75 12h16.5M12 17.25h8.25';
    case 'aggregate':
      return 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z';
    case 'extract':
      return 'M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5';
    case 'post':
      return 'M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5';
    default:
      return 'M4.5 12a7.5 7.5 0 0015 0m-15 0a7.5 7.5 0 1115 0m-15 0H3m16.5 0H21';
  }
}

function getStepBg(op, isLast) {
  const type = String(op.type || '').toLowerCase();
  if (type === 'input' || type === 'pull') return 'bg-slate-100 text-slate-600';
  if (isLast || type === 'post') return 'bg-blue-100 text-blue-600';
  return 'bg-indigo-50 text-indigo-600';
}

// ─── Helpers ──────────────────────────────────────────────────

const getClientName = (redirectUri, manifestTitle) => {
  if (manifestTitle) return manifestTitle;
  if (!redirectUri) return 'This app';
  try {
    const url = new URL(redirectUri);
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

const isSecureRedirectUri = (uri) => {
  if (!uri) return false;
  try { const u = new URL(uri); return u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1'; }
  catch { return false; }
};

// ─── Overview Tab ─────────────────────────────────────────────

function OverviewTab({ beforeData, afterData, manifest }) {
  const beforeKeys = beforeData[0] != null ? Object.keys(beforeData[0]) : [];
  const afterItem = afterData[0];
  const afterKeys = afterItem != null && typeof afterItem === 'object' ? Object.keys(afterItem) : [];
  const keptFields = beforeKeys.filter(k => afterKeys.includes(k));
  const removedFields = beforeKeys.filter(k => !afterKeys.includes(k));
  const itemsFiltered = beforeData.length !== afterData.length;

  return (
    <div className="space-y-4 p-4">
      {/* Item count summary */}
      <div className="flex items-center justify-around rounded-xl bg-gradient-to-r from-slate-50 to-blue-50 p-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-gray-700">{beforeData.length}</div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">original</div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <svg className="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          {itemsFiltered && (
            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-600">filtered</span>
          )}
        </div>
        <div className="text-center">
          <div className="text-3xl font-bold text-blue-600">{afterData.length}</div>
          <div className="text-xs font-medium uppercase tracking-wide text-gray-400">shared</div>
        </div>
      </div>

      {/* Field access breakdown */}
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Fields shared with {manifest.title || 'app'}
        </h4>
        <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 bg-white">
          {keptFields.map(field => (
            <div key={field} className="flex items-center gap-3 px-4 py-2">
              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-3 w-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm font-medium text-gray-700">{field}</span>
            </div>
          ))}
          {removedFields.map(field => (
            <div key={field} className="flex items-center gap-3 px-4 py-2">
              <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-red-50">
                <svg className="h-3 w-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-sm text-gray-400 line-through">{field}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Processing Steps Tab ─────────────────────────────────────

function StepsTab({ manifest }) {
  return (
    <div className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Processing pipeline
      </h4>
      <div className="space-y-0">
        {manifest.pipeline.map((name, idx) => {
          const op = manifest.operators[name];
          if (!op) return null;
          const isLast = idx === manifest.pipeline.length - 1;
          const isFirst = idx === 0;

          return (
            <div key={name}>
              {!isFirst && (
                <div className="flex justify-center"><div className="h-4 w-px bg-gray-200" /></div>
              )}
              <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-white p-3 shadow-sm">
                <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${getStepBg(op, isLast)}`}>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d={getIconPath(op)} />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800">{describeStep(name, op)}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-gray-400">{name}</div>
                </div>
                <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${getStepBg(op, isLast)}`}>
                  {String(op.type)}
                </span>
              </div>
            </div>
          );
        })}
        {/* Final output step */}
        <div className="flex justify-center"><div className="h-4 w-px bg-gray-200" /></div>
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-200 text-blue-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-blue-800">Send to {manifest.title || 'app'}</div>
          </div>
          <span className="flex-shrink-0 rounded-full bg-blue-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
            Output
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Live Preview Tab ─────────────────────────────────────────

function PreviewTab({ beforeData, afterData, manifest }) {
  const before = beforeData[0];
  const after = afterData[0];

  if (before == null || after == null) {
    return <div className="p-6 text-center text-sm text-gray-400">No data available</div>;
  }

  const allKeys = Object.keys(before);
  const afterIsObject = typeof after === 'object' && after !== null;
  const afterKeys = afterIsObject ? Object.keys(after) : [];

  return (
    <div className="p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
        Data preview (1 of {afterData.length} {afterData.length === 1 ? 'item' : 'items'})
      </h4>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3">
        {/* Original */}
        <div className="flex flex-col overflow-hidden">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-400">Original</div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-gray-100 bg-gray-50 p-3">
            {allKeys.map(key => (
              <div key={key} className="mb-2 last:mb-0">
                <div className="text-[11px] font-semibold text-gray-500">{key}</div>
                <div className="truncate text-xs text-gray-700">
                  {typeof before[key] === 'object' ? JSON.stringify(before[key]) : String(before[key])}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Arrow */}
        <div className="flex items-center">
          <svg className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </div>

        {/* Processed */}
        <div className="flex flex-col overflow-hidden">
          <div className="mb-2 text-center text-[11px] font-semibold uppercase tracking-wider text-blue-500">Transmitted</div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-blue-100 bg-blue-50/50 p-3">
            {allKeys.map(key => {
              const isKept = afterKeys.includes(key);
              return (
                <div key={key} className={`mb-2 last:mb-0 ${!isKept ? 'opacity-25' : ''}`}>
                  <div className={`text-[11px] font-semibold ${isKept ? 'text-gray-500' : 'text-gray-400 line-through'}`}>
                    {key}
                  </div>
                  {isKept && afterIsObject ? (
                    <div className="truncate text-xs text-gray-700">
                      {typeof after[key] === 'object' ? JSON.stringify(after[key]) : String(after[key])}
                    </div>
                  ) : (
                    <div className="mt-0.5 h-3 w-3/4 rounded bg-gray-200/60" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main ConsentWindow ───────────────────────────────────────

const ConsentWindow = ({ provider, redirectUri, state, manifest, accessType, schedule, codeChallenge }) => {
  const [error, setError] = useState('');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [activeTab, setActiveTab] = useState('Overview');
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Parse manifest for display
  const parsedManifest = useMemo(() => parseManifest(manifest), [manifest]);
  const hasManifest = parsedManifest.pipeline.length > 0;
  const appName = getClientName(redirectUri, parsedManifest.title);

  // Request preview execution from background script
  useEffect(() => {
    if (!manifest || !hasManifest) return;
    setPreviewLoading(true);

    chrome.runtime.sendMessage(
      { type: 'PREVIEW_MANIFEST_EXECUTION', data: { manifest } },
      (response) => {
        setPreviewLoading(false);
        if (response && response.success) {
          setPreviewData(response.data);
        } else {
          console.warn('Preview execution failed:', response?.error);
        }
      }
    );
  }, [manifest, hasManifest]);

  const hasData = previewData &&
    previewData.before?.data?.length > 0 &&
    previewData.after?.data?.length > 0;

  const handleAuthorize = async () => {
    try {
      setIsAuthenticating(true);
      setError('');

      if (!window.location.href.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        setError('Security error: consent window is not running in the expected context');
        setIsAuthenticating(false);
        return;
      }

      const nonceArray = new Uint8Array(16);
      crypto.getRandomValues(nonceArray);
      const consentNonce = Array.from(nonceArray, b => b.toString(16).padStart(2, '0')).join('');

      const response = await chrome.runtime.sendMessage({
        type: 'INITIATE_GOOGLE_OAUTH_FOR_EXTERNAL_CLIENT',
        data: {
          provider, manifest, redirectUri, state,
          access_type: accessType, schedule, code_challenge: codeChallenge,
          timestamp: new Date().toISOString(), consentNonce
        }
      });

      if (!response) {
        setError('No response from background service. Please try again.');
        setIsAuthenticating(false);
        return;
      }

      if (response.success) {
        setIsAuthorized(true);
        setIsAuthenticating(false);
      } else {
        setError(response.error || 'Google authorization failed');
        setIsAuthenticating(false);
      }
    } catch (err) {
      setError('Authorization failed. Please try again.');
      setIsAuthenticating(false);
      console.error('Error:', err);
    }
  };

  const handleCancel = async () => {
    try {
      await chrome.runtime.sendMessage({
        type: 'AUTH_DENIED',
        data: { provider, manifest, redirectUri, state, timestamp: new Date().toISOString() }
      });
    } catch (err) {
      console.error('Error:', err);
    }
  };

  // ─── Success state ────────────────────────────────────────
  if (isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 to-gray-200">
        <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl shadow-gray-300/50">
          <header className="flex items-center gap-2 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-5 py-3">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <span className="text-sm font-semibold text-gray-600">OAuthHub</span>
            <span className="text-emerald-500 text-xs font-mono ml-auto">{chrome.runtime.id.substring(0, 8)}...</span>
          </header>
          <div className="px-8 py-12 text-center">
            <div className="w-16 h-16 mx-auto mb-5 bg-emerald-100 rounded-2xl flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Access Granted</h1>
            <p className="text-sm text-gray-500 mb-6">
              Redirecting you back to <span className="font-semibold text-gray-700">{appName}</span>...
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              Completing authorization...
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main consent screen ──────────────────────────────────
  const tabs = [
    { key: 'Overview', label: 'Overview' },
    { key: 'Steps', label: 'Process Steps' },
    { key: 'Preview', label: 'Data Preview' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-slate-100 to-slate-200">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl shadow-gray-300/50">

        {/* Header */}
        <header className="flex items-center gap-2 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white px-5 py-3">
          <svg className="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-sm font-semibold text-gray-600">Sign in with OAuthHub</span>
          <span className="text-emerald-500 text-xs font-mono ml-auto">{chrome.runtime.id.substring(0, 8)}...</span>
        </header>

        <section className="flex flex-col px-6 py-5">

          {/* App identity */}
          <div className="flex flex-col items-center">
            <div className="mb-3 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 p-3 shadow-lg">
              <Globe className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-center text-xl font-semibold text-gray-900">
              <span className="text-blue-600">{appName}</span> wants to access your data
            </h1>
            {parsedManifest.description && (
              <p className="mt-1 text-center text-sm text-gray-500">{parsedManifest.description}</p>
            )}
          </div>

          {/* Manifest views — tabs with real data */}
          {hasManifest && (
            <div className="mt-5">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Data processing manifest
              </h3>

              {/* Tab switcher */}
              <div className="flex rounded-xl bg-gray-100 p-1">
                {tabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 rounded-lg py-2 text-xs font-medium transition-all ${
                      activeTab === tab.key
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="mt-2 max-h-[22rem] overflow-y-auto rounded-xl border border-gray-100">
                {previewLoading ? (
                  <div className="flex items-center justify-center gap-2 p-6">
                    <svg className="h-5 w-5 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm text-gray-500">Analyzing manifest...</span>
                  </div>
                ) : (
                  <>
                    {activeTab === 'Overview' && hasData && (
                      <OverviewTab
                        beforeData={previewData.before.data}
                        afterData={previewData.after.data}
                        manifest={parsedManifest}
                      />
                    )}
                    {activeTab === 'Overview' && !hasData && (
                      <OverviewTab
                        beforeData={[]}
                        afterData={[]}
                        manifest={parsedManifest}
                      />
                    )}
                    {activeTab === 'Steps' && (
                      <StepsTab manifest={parsedManifest} />
                    )}
                    {activeTab === 'Preview' && hasData && (
                      <PreviewTab
                        beforeData={previewData.before.data}
                        afterData={previewData.after.data}
                        manifest={parsedManifest}
                      />
                    )}
                    {activeTab === 'Preview' && !hasData && (
                      <div className="p-6 text-center text-sm text-gray-400">No preview data available</div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Fallback: no manifest */}
          {!hasManifest && (
            <div className="mt-5 rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <Info className="w-3.5 h-3.5 text-gray-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">Data Destination</span>
              </div>
              <div className="px-4 py-3">
                <p className="text-sm font-mono text-gray-800 break-all">{redirectUri}</p>
                {redirectUri && !isSecureRedirectUri(redirectUri) && (
                  <div className="flex items-center gap-2 mt-2.5 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-xs font-medium text-red-700">Warning: This destination does not use HTTPS</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Access type badge */}
          <div className={`mt-4 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium ${
            accessType === 'scheduled_time' ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : accessType === 'install_time' ? 'bg-blue-50 text-blue-700 border border-blue-200'
            : 'bg-gray-50 text-gray-600 border border-gray-200'
          }`}>
            {accessType === 'scheduled_time' ? <Clock className="w-3.5 h-3.5" />
              : accessType === 'install_time' ? <Zap className="w-3.5 h-3.5" />
              : <Eye className="w-3.5 h-3.5" />}
            {accessType === 'scheduled_time' ? `Scheduled recurring access${schedule ? ` (${schedule})` : ''}`
              : accessType === 'install_time' ? 'One-time access at install'
              : 'On-demand access only'}
          </div>

          {/* Error display */}
          {error && (
            <div className="mt-4 flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-sm text-red-700">{error}</span>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-6 grid grid-cols-2 gap-3">
            <button
              onClick={handleCancel}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50"
            >
              Deny
            </button>
            <button
              onClick={handleAuthorize}
              disabled={isAuthenticating}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors ${
                isAuthenticating ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isAuthenticating ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                  Authenticating...
                </span>
              ) : 'Allow'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
};

export default ConsentWindow;
