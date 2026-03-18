/**
 * Shared manifest parser extracted from runtime.js and ConsentWindow.jsx.
 * Used by both the pipeline engine and consent UI.
 */

export function parseManifest(manifestText) {
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

function unescapeString(s) {
  return s.replace(/\\(.)/g, (_, ch) => {
    switch (ch) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '\\': return '\\';
      case '"': return '"';
      default: return '\\' + ch;
    }
  });
}

function parseValue(value) {
  if (!value) return '';
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === 'NOW') return 'NOW';
  if (value.startsWith('"') && value.endsWith('"')) return unescapeString(value.slice(1, -1));
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1);
    const items = [];
    let cur = '', inStr = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') inStr = !inStr;
      else if (ch === ',' && !inStr) { if (cur.trim()) items.push(unescapeString(cur.trim().replace(/^"|"$/g, ''))); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) items.push(unescapeString(cur.trim().replace(/^"|"$/g, '')));
    return items;
  }
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  return value.replace(/"/g, '');
}

// Natural-language step descriptions for consent UI
export function formatResourceType(rt) {
  if (!rt) return 'data source';
  return rt.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function describeStep(name, op) {
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
