import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowLeft, Play, Save, BookOpen, AlertTriangle, Bug, Code, X, CheckCircle2, ChevronRight, Zap, RotateCcw, Database } from 'lucide-react';
import ManifestEditor from './ide/ManifestEditor';
import DocPanel from './ide/DocPanel';
import ValidationPanel from './ide/ValidationPanel';
import DebugConsole from './ide/DebugConsole';
import { parseManifest } from './ide/manifest-parser';

const STORAGE_KEY = 'ide_manifest_draft';
const STORAGE_VERSION_KEY = 'ide_draft_v';
const STORAGE_VERSION = '4'; // bump to invalidate old buggy drafts

const SAMPLE_MANIFEST = `TITLE: Upcoming Calendar Events
DESCRIPTION: Fetch future calendar events and send to app

PIPELINE: FetchEvents -> SelectEvents -> FilterFuture -> LimitResults -> SendData

FetchEvents(
  type: "Pull",
  resourceType: "google_calendar",
  query: "{ events { summary start { dateTime } end { dateTime } } }"
)

SelectEvents(
  type: "Select",
  field: "events"
)

FilterFuture(
  type: "Filter",
  operation: ">",
  field: "start.dateTime",
  targetValue: NOW
)

LimitResults(
  type: "Limit",
  count: 10
)

SendData(
  type: "Post",
  destination: "http://localhost:3000/api/data"
)`;

const EMPTY_TEMPLATE = `TITLE:
DESCRIPTION:

PIPELINE: `;

const LEFT_TABS = [
  { id: 'docs', label: 'Docs', icon: BookOpen },
  { id: 'problems', label: 'Problems', icon: AlertTriangle },
];

const RIGHT_TABS = [
  { id: 'preview', label: 'Preview', icon: Zap },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'mock', label: 'Mock', icon: Database },
];

function MockDataPanel({ value, onChange }) {
  let jsonError = null;
  if (value.trim()) {
    try { JSON.parse(value); } catch (e) { jsonError = e.message; }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
        <p className="text-xs text-gray-500 leading-relaxed">
          Paste JSON here to use as input data instead of a live{' '}
          <span className="font-mono text-blue-600">Pull</span>. Add a{' '}
          <span className="font-mono text-blue-600">Mock</span> operator at the
          start of your pipeline, then click Test Run.
        </p>
      </div>
      <div className="flex-1 relative overflow-hidden p-3">
        <textarea
          className="w-full h-full resize-none font-mono text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 leading-relaxed"
          placeholder={'[\n  { "field": "value" },\n  { "field": "value" }\n]'}
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
      {jsonError && (
        <div className="px-3 pb-3 shrink-0">
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] font-mono text-red-600">
            {jsonError}
          </div>
        </div>
      )}
      {!jsonError && value.trim() && (
        <div className="px-3 pb-3 shrink-0">
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-[11px] text-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Valid JSON — will be used on next Test Run
          </div>
        </div>
      )}
    </div>
  );
}

function ResultsPreview({ debugOutput, isRunning }) {
  if (isRunning) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Executing pipeline...</span>
      </div>
    );
  }

  if (!debugOutput || debugOutput.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400 px-6 text-center">
        <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
          <Zap className="w-6 h-6 text-gray-300" />
        </div>
        <div>
          <p className="text-sm font-medium text-gray-500">No results yet</p>
          <p className="text-xs text-gray-400 mt-1">Click "Test Run" to execute the pipeline and preview results</p>
        </div>
      </div>
    );
  }

  const finalStep = debugOutput[debugOutput.length - 1];
  const hasError = finalStep?.operator === 'Error';

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Pipeline Trace</div>
        <div className="flex flex-col gap-1">
          {debugOutput.map((snap, i) => (
            <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
              snap.operator === 'Error' ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'
            }`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                snap.operator === 'Error' ? 'bg-red-100' : 'bg-emerald-100'
              }`}>
                {snap.operator === 'Error'
                  ? <X className="w-3 h-3 text-red-500" />
                  : <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <span className="font-mono font-semibold text-gray-800">{snap.operator}</span>
                {snap.label && <span className="text-gray-400 ml-1.5">— {snap.label}</span>}
                {snap.data && (
                  <div className="text-[10px] text-gray-500 mt-0.5 truncate font-mono">
                    {typeof snap.data === 'object'
                      ? Array.isArray(snap.data)
                        ? `Array(${snap.data.length})`
                        : `{${Object.keys(snap.data).slice(0, 3).join(', ')}${Object.keys(snap.data).length > 3 ? '...' : ''}}`
                      : String(snap.data).slice(0, 60)
                    }
                  </div>
                )}
              </div>
              {i < debugOutput.length - 1 && (
                <ChevronRight className="w-3 h-3 text-gray-300 shrink-0 mt-1" />
              )}
            </div>
          ))}
        </div>
      </div>

      {!hasError && finalStep && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Final Output</div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-2 border-b border-gray-100 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-xs font-semibold text-emerald-700">Pipeline completed successfully</span>
            </div>
            <pre className="p-3 text-[11px] font-mono text-gray-700 overflow-x-auto max-h-64 overflow-y-auto leading-relaxed">
              {JSON.stringify(finalStep.data, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {hasError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <X className="w-4 h-4 text-red-500" />
            <span className="text-xs font-semibold text-red-700">Execution failed</span>
          </div>
          <pre className="text-[11px] font-mono text-red-600 whitespace-pre-wrap">
            {JSON.stringify(finalStep.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function ManifestIDE() {
  const [manifest, setManifest] = useState('');
  const [errors, setErrors] = useState([]);
  const [leftTab, setLeftTab] = useState('docs');
  const [rightTab, setRightTab] = useState('preview');
  const [activeOperator, setActiveOperator] = useState(null);
  const [debugOutput, setDebugOutput] = useState([]);
  const [isDebugging, setIsDebugging] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [mockData, setMockData] = useState('');

  // Resizable panels
  const [leftWidth, setLeftWidth] = useState(520);
  const [rightWidth, setRightWidth] = useState(340);
  const leftWidthRef = useRef(520);
  const rightWidthRef = useRef(340);
  const dragging = useRef(null);
  const dragStartX = useRef(0);
  const dragStartWidth = useRef(0);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const dx = e.clientX - dragStartX.current;
      if (dragging.current === 'left') {
        const w = Math.max(200, Math.min(540, dragStartWidth.current + dx));
        leftWidthRef.current = w;
        setLeftWidth(w);
      } else {
        const w = Math.max(200, Math.min(540, dragStartWidth.current - dx));
        rightWidthRef.current = w;
        setRightWidth(w);
      }
    };
    const onUp = () => {
      dragging.current = null;
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startDrag = (side) => (e) => {
    e.preventDefault();
    dragging.current = side;
    dragStartX.current = e.clientX;
    dragStartWidth.current = side === 'left' ? leftWidthRef.current : rightWidthRef.current;
    document.body.style.cursor = 'col-resize';
  };

  // Load draft from storage on mount — discard drafts from old versions
  useEffect(() => {
    chrome.storage.local.get([STORAGE_KEY, STORAGE_VERSION_KEY], (result) => {
      if (result[STORAGE_KEY] && result[STORAGE_VERSION_KEY] === STORAGE_VERSION) {
        setManifest(result[STORAGE_KEY]);
      } else {
        chrome.storage.local.remove([STORAGE_KEY, STORAGE_VERSION_KEY]);
        setManifest(SAMPLE_MANIFEST);
      }
    });
  }, []);

  // Auto-save draft (don't persist empty/reset state — load fresh sample on next open)
  useEffect(() => {
    if (!manifest || manifest === EMPTY_TEMPLATE) return;
    const timer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: manifest, [STORAGE_VERSION_KEY]: STORAGE_VERSION });
    }, 1000);
    return () => clearTimeout(timer);
  }, [manifest]);

  const handleValidation = useCallback((errs) => {
    setErrors(errs);
  }, []);

  const handleCursorOperator = useCallback((op) => {
    setActiveOperator(op);
  }, []);

  const handleSave = useCallback(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: manifest });
    setSavedAt(new Date());
    setTimeout(() => setSavedAt(null), 2000);
  }, [manifest]);

  const handleRunDebug = useCallback(() => {
    setIsDebugging(true);
    setRightTab('preview');
    setDebugOutput([]);

    let parsedMockData = null;
    if (mockData.trim()) {
      try { parsedMockData = JSON.parse(mockData); } catch (_) {}
    }

    chrome.runtime.sendMessage({
      type: 'DEBUG_EXECUTE_MANIFEST',
      data: { manifest, mockData: parsedMockData }
    }, (response) => {
      setIsDebugging(false);
      if (response?.success) {
        setDebugOutput(response.debugSnapshots || []);
      } else {
        setDebugOutput([{
          operator: 'Error',
          label: 'Execution failed',
          data: { error: response?.error || 'Unknown error' }
        }]);
      }
    });
  }, [manifest, mockData]);

  const handleClickError = useCallback((line) => {
    const textarea = document.querySelector('.ide-editor textarea');
    if (textarea) {
      const lines = manifest.split('\n');
      let pos = 0;
      for (let i = 0; i < line - 1 && i < lines.length; i++) {
        pos += lines[i].length + 1;
      }
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
    }
  }, [manifest]);

  const handleReset = useCallback(() => {
    if (!confirm('Reset to blank template? Your current draft will be lost.')) return;
    chrome.storage.local.remove([STORAGE_KEY, STORAGE_VERSION_KEY]);
    setManifest(EMPTY_TEMPLATE);
    setDebugOutput([]);
  }, []);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const parsedManifest = parseManifest(manifest);
  const errorCount = errors.filter(e => e.severity === 'error').length;
  const warnCount = errors.filter(e => e.severity === 'warning').length;

  return (
    <div className="w-full h-screen flex flex-col bg-gradient-to-br from-slate-50 to-gray-100">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={handleClose}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
            title="Close IDE"
          >
            <ArrowLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div className="w-px h-5 bg-gray-200" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
              <Code className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-gray-800">OAuthHub Manifest IDE</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-red-50 text-red-600 font-semibold border border-red-200">
              {errorCount} error{errorCount > 1 ? 's' : ''}
            </span>
          )}
          {warnCount > 0 && (
            <span className="text-xs px-3 py-1 rounded-full bg-amber-50 text-amber-600 font-semibold border border-amber-200">
              {warnCount} warning{warnCount > 1 ? 's' : ''}
            </span>
          )}
          {savedAt && (
            <span className="text-[10px] text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Saved
            </span>
          )}

          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
            title="Reset to blank template"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
          >
            <Save className="w-3.5 h-3.5" />
            Save
          </button>

          <button
            onClick={handleRunDebug}
            disabled={isDebugging || errorCount > 0}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed rounded-lg transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5" />
            Test Run
          </button>
        </div>
      </div>

      {/* Three-panel content */}
      <div className="flex flex-1 min-h-0">

        {/* Left panel: Docs + Problems */}
        <div style={{ width: leftWidth }} className="flex flex-col border-r border-gray-200 bg-white shrink-0 min-w-0">
          <div className="flex border-b border-gray-200 shrink-0">
            {LEFT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setLeftTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  leftTab === tab.id
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <tab.icon size={11} />
                {tab.label}
                {tab.id === 'problems' && (errorCount + warnCount) > 0 && (
                  <span className={`ml-0.5 px-1 py-0 rounded-full text-[9px] ${
                    errorCount > 0 ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                  }`}>
                    {errorCount + warnCount}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {leftTab === 'docs' && (
              <DocPanel
                activeOperator={activeOperator}
                parsedManifest={parsedManifest}
              />
            )}
            {leftTab === 'problems' && (
              <ValidationPanel
                errors={errors}
                onClickError={handleClickError}
              />
            )}
          </div>
        </div>

        {/* Left drag handle */}
        <div
          onMouseDown={startDrag('left')}
          className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors active:bg-blue-500"
        />

        {/* Editor */}
        <div className="flex-1 min-w-0 ide-editor">
          <ManifestEditor
            value={manifest}
            onChange={setManifest}
            onValidation={handleValidation}
            onCursorOperator={handleCursorOperator}
            className="h-full"
          />
        </div>

        {/* Right drag handle */}
        <div
          onMouseDown={startDrag('right')}
          className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors active:bg-blue-500"
        />

        {/* Right panel: Preview + Debug + Mock */}
        <div style={{ width: rightWidth }} className="flex flex-col border-l border-gray-200 bg-white shrink-0 min-w-0">
          <div className="flex border-b border-gray-200 shrink-0">
            {RIGHT_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  rightTab === tab.id
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                <tab.icon size={11} />
                {tab.label}
                {tab.id === 'preview' && debugOutput.length > 0 && !isDebugging && (
                  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                )}
                {tab.id === 'mock' && mockData.trim() && (
                  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                )}
              </button>
            ))}
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {rightTab === 'preview' && (
              <ResultsPreview
                debugOutput={debugOutput}
                isRunning={isDebugging}
              />
            )}
            {rightTab === 'debug' && (
              <DebugConsole
                debugOutput={debugOutput}
                isRunning={isDebugging}
              />
            )}
            {rightTab === 'mock' && (
              <MockDataPanel
                value={mockData}
                onChange={setMockData}
              />
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
