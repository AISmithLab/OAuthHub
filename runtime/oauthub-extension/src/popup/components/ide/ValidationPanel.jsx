import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';

export default function ValidationPanel({ errors, onClickError }) {
  if (!errors || errors.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <CheckCircle size={24} />
        <span className="text-xs">No issues found</span>
      </div>
    );
  }

  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warnCount = errors.filter(e => e.severity === 'warning').length;

  return (
    <div className="p-2 overflow-y-auto h-full">
      <div className="flex gap-3 mb-2 text-[10px]">
        {errorCount > 0 && (
          <span className="text-red-600 font-semibold">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
        )}
        {warnCount > 0 && (
          <span className="text-amber-600 font-semibold">{warnCount} warning{warnCount > 1 ? 's' : ''}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {errors.map((err, i) => (
          <div
            key={i}
            className="flex items-start gap-1.5 p-1.5 rounded text-xs cursor-pointer hover:bg-gray-50"
            onClick={() => onClickError?.(err.line)}
          >
            {err.severity === 'error' ? (
              <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
            )}
            <div>
              <span className="text-gray-400 mr-1">L{err.line}</span>
              <span className={err.severity === 'error' ? 'text-red-700' : 'text-amber-700'}>
                {err.message}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
