import React, { useState, useEffect } from 'react';
import { OPERATOR_TYPES } from './manifest-schema';
import { highlightManifest } from './syntax-highlighter';

function OperatorDoc({ schema }) {
  // Skip the `type` field — it's obvious and redundant
  const requiredFields = Object.entries(schema.requiredFields).filter(([k]) => k !== 'type');
  const optionalFields = Object.entries(schema.optionalFields);

  return (
    <div className="p-4 overflow-y-auto h-full">
      <p className="text-sm text-gray-700 leading-relaxed mb-4">{schema.description}</p>

      {requiredFields.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Required</div>
          <div className="flex flex-col gap-2">
            {requiredFields.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="font-mono text-sm font-semibold text-gray-900">{k}</span>
                <span className="text-xs text-gray-500 leading-relaxed">{v.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {optionalFields.length > 0 && (
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Optional</div>
          <div className="flex flex-col gap-2">
            {optionalFields.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="font-mono text-sm font-medium text-gray-900">{k}</span>
                <span className="text-xs text-gray-500 leading-relaxed">{v.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-gray-400 mb-2">Example</div>
        <pre
          className="bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlightManifest(schema.example) }}
        />
      </div>

      {schema.notes && (
        <p className="text-xs text-gray-400 italic leading-relaxed">{schema.notes}</p>
      )}
    </div>
  );
}

export default function DocPanel({ activeOperator, parsedManifest }) {
  const operatorNames = Object.keys(OPERATOR_TYPES);
  const [selectedType, setSelectedType] = useState(operatorNames[0]);

  // Auto-select when cursor moves to an operator in the editor
  useEffect(() => {
    if (activeOperator && parsedManifest?.operators?.[activeOperator]) {
      const config = parsedManifest.operators[activeOperator];
      if (config?.type && OPERATOR_TYPES[config.type]) {
        setSelectedType(config.type);
      }
    }
  }, [activeOperator, parsedManifest]);

  const schema = OPERATOR_TYPES[selectedType];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Operator index */}
      <div className="w-[88px] shrink-0 border-r border-gray-100 overflow-y-auto bg-gray-50/50">
        <div className="px-2 pt-3 pb-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Operators</span>
        </div>
        {operatorNames.map(name => (
          <button
            key={name}
            onClick={() => setSelectedType(name)}
            className={`w-full text-left px-2.5 py-2 text-sm font-medium transition-colors ${
              selectedType === name
                ? 'bg-gray-200 text-gray-900 font-semibold'
                : 'text-gray-900 hover:bg-gray-100'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Doc content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {schema && (
          <>
            <div className="px-4 pt-3 pb-2 border-b border-gray-100 shrink-0">
              <h3 className="text-base font-bold text-gray-900">{selectedType}</h3>
            </div>
            <div className="flex-1 overflow-y-auto">
              <OperatorDoc schema={schema} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
