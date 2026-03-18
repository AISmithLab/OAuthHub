import React, { useState, useRef, useCallback, useEffect } from 'react';
import { highlightManifest } from './syntax-highlighter';
import { validateManifest, getCursorContext, getOperatorAtCursor, parseManifest } from './manifest-parser';
import AutoComplete from './AutoComplete';

export default function ManifestEditor({
  value,
  onChange,
  onValidation,
  onCursorOperator,
  className = ''
}) {
  const textareaRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);
  const [autoCtx, setAutoCtx] = useState(null);
  const [autoPos, setAutoPos] = useState(null);
  const [showAuto, setShowAuto] = useState(false);

  // Sync scroll between textarea, pre, and gutter
  const syncScroll = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    if (preRef.current) {
      preRef.current.scrollTop = ta.scrollTop;
      preRef.current.scrollLeft = ta.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = ta.scrollTop;
    }
  }, []);

  // Validate on change
  useEffect(() => {
    const errors = validateManifest(value);
    onValidation?.(errors);
  }, [value, onValidation]);

  // Track cursor position for operator context
  const handleCursorChange = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const op = getOperatorAtCursor(value, pos);
    onCursorOperator?.(op);
  }, [value, onCursorOperator]);

  const handleKeyDown = useCallback((e) => {
    if (showAuto) return; // let AutoComplete handle keys

    const ta = textareaRef.current;
    if (!ta) return;

    // Tab inserts 2 spaces
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newValue = value.slice(0, start) + '  ' + value.slice(end);
      onChange(newValue);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }, [value, onChange, showAuto]);

  const handleInput = useCallback((e) => {
    const newValue = e.target.value;
    onChange(newValue);

    // Check for auto-complete context
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const ctx = getCursorContext(newValue, pos);

    if (ctx) {
      // Calculate popup position
      const lines = newValue.slice(0, pos).split('\n');
      const lineIdx = lines.length - 1;
      const colIdx = lines[lineIdx].length;
      // Approximate position based on character metrics
      const lineHeight = 20;
      const charWidth = 7.2;
      const gutterWidth = 40;
      setAutoPos({
        top: (lineIdx + 1) * lineHeight - (ta.scrollTop || 0) + 4,
        left: colIdx * charWidth + gutterWidth + 8
      });
      setAutoCtx(ctx);
      setShowAuto(true);
    } else {
      setShowAuto(false);
      setAutoCtx(null);
    }
  }, [onChange]);

  const handleAutoSelect = useCallback((item) => {
    const ta = textareaRef.current;
    if (!ta || !autoCtx) return;

    const pos = ta.selectionStart;
    const partial = autoCtx.partial || '';
    // Replace the partial text with the selected item
    const before = value.slice(0, pos - partial.length);
    const after = value.slice(pos);
    const newValue = before + item + after;
    onChange(newValue);

    setShowAuto(false);
    setAutoCtx(null);

    requestAnimationFrame(() => {
      const newPos = pos - partial.length + item.length;
      ta.selectionStart = ta.selectionEnd = newPos;
      ta.focus();
    });
  }, [value, onChange, autoCtx]);

  const handleAutoDismiss = useCallback(() => {
    setShowAuto(false);
    setAutoCtx(null);
  }, []);

  // Get defined operator names for pipeline auto-complete
  const parsed = parseManifest(value);
  const definedOperators = Object.keys(parsed.operators);

  // Line numbers
  const lines = value.split('\n');
  const lineCount = lines.length;
  const errors = validateManifest(value);
  const errorLines = new Set(errors.filter(e => e.severity === 'error').map(e => e.line));
  const warnLines = new Set(errors.filter(e => e.severity === 'warning').map(e => e.line));

  const codingFont = "'Cascadia Code', 'Cascadia Mono', Consolas, 'SF Mono', Menlo, Monaco, 'Courier New', Courier, monospace";

  return (
    <div className={`relative flex h-full bg-white text-xs ${className}`} style={{ fontFamily: codingFont }}>
      {/* Gutter (line numbers) */}
      <div
        ref={gutterRef}
        className="flex-shrink-0 w-10 bg-gray-50 border-r border-gray-200 overflow-hidden select-none"
        style={{ lineHeight: '20px' }}
      >
        <div className="py-2 px-1 text-right">
          {Array.from({ length: lineCount }, (_, i) => {
            const ln = i + 1;
            const isErr = errorLines.has(ln);
            const isWarn = !isErr && warnLines.has(ln);
            return (
              <div
                key={ln}
                className={`pr-1 text-[10px] leading-[20px] ${
                  isErr ? 'text-red-500 font-bold bg-red-50' :
                  isWarn ? 'text-amber-500 bg-amber-50' :
                  'text-gray-400'
                }`}
              >
                {ln}
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor area */}
      <div className="relative flex-1 overflow-hidden">
        {/* Syntax-highlighted layer */}
        <pre
          ref={preRef}
          className="absolute inset-0 py-2 px-2 overflow-auto whitespace-pre pointer-events-none m-0"
          style={{ lineHeight: '20px', tabSize: 2, fontFamily: codingFont }}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: highlightManifest(value) + '\n' }}
        />

        {/* Transparent textarea */}
        <textarea
          ref={textareaRef}
          className="absolute inset-0 w-full h-full py-2 px-2 bg-transparent text-transparent caret-gray-800 resize-none outline-none overflow-auto"
          style={{ lineHeight: '20px', tabSize: 2, caretColor: '#1f2937', fontFamily: codingFont }}
          value={value}
          onInput={handleInput}
          onChange={() => {}} // controlled via onInput
          onScroll={syncScroll}
          onKeyDown={handleKeyDown}
          onClick={handleCursorChange}
          onKeyUp={handleCursorChange}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
        />

        {/* Auto-complete popup */}
        {showAuto && autoCtx && (
          <AutoComplete
            context={autoCtx}
            definedOperators={definedOperators}
            position={autoPos}
            onSelect={handleAutoSelect}
            onDismiss={handleAutoDismiss}
          />
        )}
      </div>
    </div>
  );
}
