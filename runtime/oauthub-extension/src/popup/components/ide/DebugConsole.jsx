import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Bug } from 'lucide-react';

function JsonTree({ data, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (data === null || data === undefined) {
    return <span className="text-gray-400 italic">null</span>;
  }

  if (typeof data === 'string') {
    const display = data.length > 100 ? data.slice(0, 100) + '...' : data;
    return <span className="text-green-700">"{display}"</span>;
  }

  if (typeof data === 'number') {
    return <span className="text-cyan-700">{data}</span>;
  }

  if (typeof data === 'boolean') {
    return <span className="text-rose-600">{String(data)}</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="text-gray-400">[]</span>;

    return (
      <div>
        <span
          className="cursor-pointer inline-flex items-center text-gray-500 hover:text-gray-700"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <span className="text-[10px] ml-0.5">Array({data.length})</span>
        </span>
        {expanded && (
          <div className="ml-3 border-l border-gray-200 pl-2">
            {data.slice(0, 20).map((item, i) => (
              <div key={i} className="flex gap-1">
                <span className="text-gray-400 text-[10px]">{i}:</span>
                <JsonTree data={item} depth={depth + 1} />
              </div>
            ))}
            {data.length > 20 && (
              <div className="text-gray-400 text-[10px] italic">...{data.length - 20} more items</div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (typeof data === 'object') {
    const keys = Object.keys(data);
    if (keys.length === 0) return <span className="text-gray-400">{'{}'}</span>;

    return (
      <div>
        <span
          className="cursor-pointer inline-flex items-center text-gray-500 hover:text-gray-700"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          <span className="text-[10px] ml-0.5">{'{'}{keys.length}{'}'}</span>
        </span>
        {expanded && (
          <div className="ml-3 border-l border-gray-200 pl-2">
            {keys.slice(0, 30).map(key => (
              <div key={key} className="flex gap-1">
                <span className="text-amber-700 text-[10px]">{key}:</span>
                <JsonTree data={data[key]} depth={depth + 1} />
              </div>
            ))}
            {keys.length > 30 && (
              <div className="text-gray-400 text-[10px] italic">...{keys.length - 30} more keys</div>
            )}
          </div>
        )}
      </div>
    );
  }

  return <span>{String(data)}</span>;
}

export default function DebugConsole({ debugOutput, isRunning }) {
  if (isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <span className="loading loading-spinner loading-sm" />
        <span className="text-xs">Running debug pipeline...</span>
      </div>
    );
  }

  if (!debugOutput || debugOutput.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
        <Bug size={24} />
        <span className="text-xs text-center px-4">
          Insert <code className="bg-gray-100 px-1 rounded">Debug</code> operators in your pipeline and click "Run Debug" to inspect intermediary data.
        </span>
      </div>
    );
  }

  return (
    <div className="p-2 overflow-y-auto h-full">
      <div className="flex items-center gap-1 mb-2 text-gray-500">
        <Bug size={12} />
        <span className="text-[10px] uppercase font-semibold">{debugOutput.length} Debug Snapshot{debugOutput.length > 1 ? 's' : ''}</span>
      </div>

      <div className="flex flex-col gap-2">
        {debugOutput.map((snap, i) => (
          <div key={i} className="border border-gray-200 rounded overflow-hidden">
            <div className="bg-gray-50 px-2 py-1 flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-blue-600 font-semibold">{snap.operator}</span>
              {snap.label && (
                <span className="text-[10px] text-gray-500">— {snap.label}</span>
              )}
            </div>
            <div className="p-2 text-[10px] font-mono max-h-32 overflow-y-auto">
              <JsonTree data={snap.data} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
