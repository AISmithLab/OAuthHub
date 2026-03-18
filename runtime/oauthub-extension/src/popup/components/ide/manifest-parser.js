/**
 * Shared manifest parser and validator for the IDE.
 * Extracted and unified from runtime.js and ConsentWindow.jsx.
 */
import { OPERATOR_TYPES, RESOURCE_TYPES, FILTER_OPERATIONS, AGGREGATE_OPERATIONS, SORT_ORDERS } from './manifest-schema';

// Operator type names that can be used inline in PIPELINE without a separate definition block
const INLINE_OPERATOR_TYPES = new Set(Object.keys(OPERATOR_TYPES));

// ── Value parser ──

function parseValue(value) {
  if (value === 'NOW') return 'NOW';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Array
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(v => parseValue(v.trim()));
  }

  // Number
  const num = Number(value);
  if (!isNaN(num) && value !== '') return num;

  return value;
}

// ── Operator config parser ──

function parseOperatorConfig(configStr) {
  const config = {};
  let currentKey = '';
  let currentValue = '';
  let inString = false;
  let stringDelim = '';
  let arrayDepth = 0;
  let expectingValue = false;

  for (let i = 0; i < configStr.length; i++) {
    const ch = configStr[i];

    if (inString) {
      currentValue += ch;
      if (ch === stringDelim && configStr[i - 1] !== '\\') {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringDelim = ch;
      currentValue += ch;
      continue;
    }

    if (ch === '[') { arrayDepth++; currentValue += ch; continue; }
    if (ch === ']') { arrayDepth--; currentValue += ch; continue; }

    if (arrayDepth > 0) { currentValue += ch; continue; }

    if (ch === ':' && !expectingValue) {
      currentKey = currentValue.trim();
      currentValue = '';
      expectingValue = true;
      continue;
    }

    if (ch === ',' && expectingValue) {
      if (currentKey) {
        config[currentKey] = parseValue(currentValue.trim());
      }
      currentKey = '';
      currentValue = '';
      expectingValue = false;
      continue;
    }

    currentValue += ch;
  }

  // Final key-value pair
  if (currentKey && expectingValue) {
    config[currentKey] = parseValue(currentValue.trim());
  }

  return config;
}

// ── Main manifest parser ──

export function parseManifest(manifestText) {
  const manifest = {
    title: '',
    description: '',
    pipeline: [],
    operators: {}
  };

  const lines = manifestText.split('\n');
  let pipelineStr = '';
  let operatorText = '';
  let collectingPipeline = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { collectingPipeline = false; continue; }

    if (line.startsWith('TITLE:')) {
      manifest.title = line.substring(6).trim();
      collectingPipeline = false;
    } else if (line.startsWith('DESCRIPTION:')) {
      manifest.description = line.substring(12).trim();
      collectingPipeline = false;
    } else if (line.startsWith('PIPELINE:')) {
      pipelineStr = line.substring(9);
      collectingPipeline = true;
    } else if (collectingPipeline && line.includes('->')) {
      pipelineStr += ' ' + line;
    } else {
      collectingPipeline = false;
      operatorText += line + ' ';
    }
  }

  manifest.pipeline = pipelineStr
    .replace(/\s+/g, '')
    .split('->')
    .filter(Boolean);

  // Parse operators using balanced parentheses
  let i = 0;
  while (i < operatorText.length) {
    while (i < operatorText.length && /\s/.test(operatorText[i])) i++;
    if (i >= operatorText.length) break;

    let nameEnd = operatorText.indexOf('(', i);
    if (nameEnd === -1) break;

    const name = operatorText.slice(i, nameEnd).trim();

    let depth = 0;
    let bodyStart = nameEnd;
    let bodyEnd = -1;
    let inStr = false;
    let sd = '';

    for (let j = bodyStart; j < operatorText.length; j++) {
      const c = operatorText[j];
      if (inStr) {
        if (c === sd && operatorText[j - 1] !== '\\') inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; sd = c; continue; }
      if (c === '(') depth++;
      if (c === ')') { depth--; if (depth === 0) { bodyEnd = j; break; } }
    }

    if (bodyEnd === -1) break;

    const body = operatorText.slice(bodyStart + 1, bodyEnd);
    manifest.operators[name] = parseOperatorConfig(body);
    i = bodyEnd + 1;
  }

  // Auto-synthesize definitions for inline operator type names (e.g. bare "Debug" in pipeline)
  for (const opName of manifest.pipeline) {
    if (!manifest.operators[opName] && INLINE_OPERATOR_TYPES.has(opName)) {
      manifest.operators[opName] = { type: opName };
    }
  }

  return manifest;
}

// ── Validation ──

export function validateManifest(manifestText) {
  const errors = [];
  const warn = (line, msg) => errors.push({ line, message: msg, severity: 'warning' });
  const err = (line, msg) => errors.push({ line, message: msg, severity: 'error' });

  if (!manifestText || !manifestText.trim()) {
    err(1, 'Manifest is empty');
    return errors;
  }

  const lines = manifestText.split('\n');
  let hasTitle = false;
  let hasPipeline = false;
  let pipelineLine = -1;

  // Line-level checks
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('TITLE:')) {
      hasTitle = true;
      if (!line.substring(6).trim()) warn(i + 1, 'TITLE is empty');
    }
    if (line.startsWith('PIPELINE:')) {
      hasPipeline = true;
      pipelineLine = i + 1;
    }
  }

  if (!hasTitle) warn(1, 'Missing TITLE header');
  if (!hasPipeline) { err(1, 'Missing PIPELINE header'); return errors; }

  // Parse and validate structure
  let parsed;
  try {
    parsed = parseManifest(manifestText);
  } catch (e) {
    err(1, `Parse error: ${e.message}`);
    return errors;
  }

  if (parsed.pipeline.length === 0) {
    err(pipelineLine, 'PIPELINE is empty — add at least one operator');
    return errors;
  }

  // Check that every pipeline step has a definition (inline type names are auto-synthesized)
  for (const opName of parsed.pipeline) {
    if (!parsed.operators[opName]) {
      err(pipelineLine, `Pipeline references "${opName}" but no definition found`);
    }
  }

  // Check each operator definition
  for (const [name, config] of Object.entries(parsed.operators)) {
    const opLine = findOperatorLine(lines, name);

    if (!config.type) {
      err(opLine, `Operator "${name}" is missing the required "type" field`);
      continue;
    }

    const typeName = typeof config.type === 'string' ? config.type : String(config.type);
    const schema = OPERATOR_TYPES[typeName];

    if (!schema) {
      warn(opLine, `Unknown operator type "${typeName}" in "${name}"`);
      continue;
    }

    // Check required fields
    for (const field of Object.keys(schema.requiredFields)) {
      if (field === 'type') continue;
      if (config[field] === undefined || config[field] === null || config[field] === '') {
        err(opLine, `Operator "${name}" (${typeName}): missing required field "${field}"`);
      }
    }

    // Type-specific validations
    if (typeName === 'Pull' && config.resourceType) {
      if (!RESOURCE_TYPES.includes(config.resourceType)) {
        warn(opLine, `Operator "${name}": unknown resourceType "${config.resourceType}". Expected: ${RESOURCE_TYPES.join(', ')}`);
      }
    }

    if (typeName === 'Filter' && config.operation) {
      if (!FILTER_OPERATIONS.includes(config.operation)) {
        err(opLine, `Operator "${name}": invalid operation "${config.operation}". Expected: ${FILTER_OPERATIONS.join(', ')}`);
      }
      if (config.operation === 'match' && !config.pattern) {
        err(opLine, `Operator "${name}": "match" operation requires a "pattern" field`);
      }
      // Regex safety
      if (config.pattern && typeof config.pattern === 'string' && config.pattern.length > 500) {
        err(opLine, `Operator "${name}": regex pattern exceeds 500 character limit`);
      }
    }

    if (typeName === 'Aggregate' && config.operation) {
      if (!AGGREGATE_OPERATIONS.includes(config.operation)) {
        err(opLine, `Operator "${name}": invalid operation "${config.operation}". Expected: ${AGGREGATE_OPERATIONS.join(', ')}`);
      }
      if ((config.operation === 'sum' || config.operation === 'average') && !config.field) {
        err(opLine, `Operator "${name}": "${config.operation}" requires a "field"`);
      }
    }

    if (typeName === 'Sort' && config.order) {
      if (!SORT_ORDERS.includes(config.order)) {
        err(opLine, `Operator "${name}": order must be "ascending" or "descending"`);
      }
    }

    if (typeName === 'Limit' && config.count !== undefined) {
      if (typeof config.count !== 'number' || config.count < 1 || !Number.isInteger(config.count)) {
        err(opLine, `Operator "${name}": count must be a positive integer`);
      }
    }

    if (typeName === 'Post' && config.destination) {
      try {
        new URL(config.destination);
      } catch {
        warn(opLine, `Operator "${name}": destination "${config.destination}" is not a valid URL`);
      }
    }
  }

  // Pipeline flow checks
  if (parsed.pipeline.length > 0) {
    const firstOp = parsed.operators[parsed.pipeline[0]];
    if (firstOp && firstOp.type && !['Pull', 'Receive'].includes(firstOp.type)) {
      warn(pipelineLine, 'Pipeline should typically start with a Pull or Receive operator');
    }

    const lastOp = parsed.operators[parsed.pipeline[parsed.pipeline.length - 1]];
    if (lastOp && lastOp.type && !['Post', 'Write', 'Debug'].includes(lastOp.type)) {
      warn(pipelineLine, 'Pipeline should typically end with a Post or Write operator');
    }
  }

  // Check for unused operators
  for (const name of Object.keys(parsed.operators)) {
    if (!parsed.pipeline.includes(name)) {
      const opLine = findOperatorLine(lines, name);
      warn(opLine, `Operator "${name}" is defined but not used in the PIPELINE`);
    }
  }

  return errors;
}

function findOperatorLine(lines, name) {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith(name + '(')) return i + 1;
  }
  return 1;
}

// ── Cursor context detection for auto-complete ──

export function getCursorContext(text, cursorPos) {
  const before = text.slice(0, cursorPos);
  const lines = before.split('\n');
  const currentLine = lines[lines.length - 1];

  // Check if on a header line
  if (/^\s*TITLE:\s*/.test(currentLine)) return { type: 'header_value', header: 'TITLE' };
  if (/^\s*DESCRIPTION:\s*/.test(currentLine)) return { type: 'header_value', header: 'DESCRIPTION' };
  if (/^\s*PIPELINE:\s*/.test(currentLine)) return { type: 'pipeline' };

  // Check if after -> in pipeline line
  if (currentLine.includes('->')) return { type: 'pipeline' };

  // Check if inside an operator definition
  const lastOpenParen = before.lastIndexOf('(');
  const lastCloseParen = before.lastIndexOf(')');

  if (lastOpenParen > lastCloseParen) {
    const insideOp = before.slice(lastOpenParen);

    // After type: "
    if (/type:\s*"[^"]*$/.test(insideOp)) {
      const partial = insideOp.match(/type:\s*"([^"]*)$/)?.[1] || '';
      return { type: 'operator_type', partial };
    }

    // After resourceType: "
    if (/resourceType:\s*"[^"]*$/.test(insideOp)) {
      const partial = insideOp.match(/resourceType:\s*"([^"]*)$/)?.[1] || '';
      return { type: 'resource_type', partial };
    }

    // After operation: "
    if (/operation:\s*"[^"]*$/.test(insideOp)) {
      const partial = insideOp.match(/operation:\s*"([^"]*)$/)?.[1] || '';
      return { type: 'filter_operation', partial };
    }

    // After order: "
    if (/order:\s*"[^"]*$/.test(insideOp)) {
      const partial = insideOp.match(/order:\s*"([^"]*)$/)?.[1] || '';
      return { type: 'sort_order', partial };
    }

    // At field name position (after comma or opening paren, no colon yet)
    if (/(?:,|\()\s*\w*$/.test(insideOp)) {
      const partial = insideOp.match(/(?:,|\()\s*(\w*)$/)?.[1] || '';
      return { type: 'field_name', partial };
    }
  }

  return { type: 'none' };
}

// ── Get operator at cursor position (for docs) ──

export function getOperatorAtCursor(text, cursorPos) {
  const before = text.slice(0, cursorPos);

  // Find the last operator definition start before cursor
  const regex = /(\w+)\s*\(/g;
  let lastMatch = null;
  let match;
  while ((match = regex.exec(before)) !== null) {
    lastMatch = match;
  }

  if (!lastMatch) return null;

  // Check if cursor is still inside this operator's parens
  const opStart = lastMatch.index;
  let depth = 0;
  for (let i = opStart; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') {
      depth--;
      if (depth === 0) {
        // Operator ends at i
        if (cursorPos <= i) {
          return lastMatch[1];
        }
        return null;
      }
    }
  }

  // Still inside unclosed parens
  return lastMatch[1];
}
