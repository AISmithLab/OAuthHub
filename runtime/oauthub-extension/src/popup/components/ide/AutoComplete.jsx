import React, { useState, useEffect, useRef } from 'react';
import {
  OPERATOR_TYPES, RESOURCE_TYPES, FILTER_OPERATIONS,
  SORT_ORDERS, ALL_FIELD_NAMES
} from './manifest-schema';

const operatorTypeNames = Object.keys(OPERATOR_TYPES);

function getSuggestions(context, definedOperators) {
  if (!context) return [];
  const { type, partial = '' } = context;
  const lp = partial.toLowerCase();
  const filter = (items) => items.filter(i => i.toLowerCase().startsWith(lp));

  switch (type) {
    case 'operator_type': return filter(operatorTypeNames);
    case 'resource_type': return filter(RESOURCE_TYPES);
    case 'filter_operation': return filter(FILTER_OPERATIONS);
    case 'sort_order': return filter(SORT_ORDERS);
    case 'field_name': return filter(ALL_FIELD_NAMES);
    case 'pipeline': return filter(definedOperators);
    default: return [];
  }
}

export default function AutoComplete({ context, definedOperators, position, onSelect, onDismiss }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef(null);
  const suggestions = getSuggestions(context, definedOperators);

  useEffect(() => { setSelectedIndex(0); }, [context]);

  useEffect(() => {
    const handleKey = (e) => {
      if (!suggestions.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, suggestions.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        onSelect(suggestions[selectedIndex]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [suggestions, selectedIndex, onSelect, onDismiss]);

  if (!suggestions.length || !position) return null;

  return (
    <div
      ref={listRef}
      className="absolute z-50 bg-white border border-gray-300 rounded shadow-lg max-h-40 overflow-y-auto text-xs"
      style={{ top: position.top, left: position.left, minWidth: 140 }}
    >
      {suggestions.map((item, i) => (
        <div
          key={item}
          className={`px-3 py-1 cursor-pointer ${i === selectedIndex ? 'bg-blue-100 text-blue-800' : 'hover:bg-gray-100'}`}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item); }}
          onMouseEnter={() => setSelectedIndex(i)}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
