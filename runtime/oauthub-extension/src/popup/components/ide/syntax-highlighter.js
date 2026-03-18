/**
 * Syntax highlighter for the OAuthHub manifest language.
 * Tokenizes manifest text and returns HTML with CSS classes.
 */
import { OPERATOR_TYPES, SPECIAL_VALUES } from './manifest-schema';

const OPERATOR_TYPE_NAMES = new Set(Object.keys(OPERATOR_TYPES));

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlightLine(line) {
  const trimmed = line.trim();

  // Empty line
  if (!trimmed) return escapeHtml(line);

  // Comment
  if (trimmed.startsWith('#')) {
    return `<span class="tok-comment">${escapeHtml(line)}</span>`;
  }

  // Header lines
  for (const kw of ['TITLE:', 'DESCRIPTION:', 'PIPELINE:']) {
    if (trimmed.startsWith(kw)) {
      const idx = line.indexOf(kw);
      const prefix = escapeHtml(line.slice(0, idx));
      const kwPart = `<span class="tok-header">${escapeHtml(kw)}</span>`;
      const rest = line.slice(idx + kw.length);

      if (kw === 'PIPELINE:') {
        return prefix + kwPart + highlightPipeline(rest);
      }
      return prefix + kwPart + `<span class="tok-header-value">${escapeHtml(rest)}</span>`;
    }
  }

  // Pipeline continuation (contains ->)
  if (trimmed.includes('->') && !trimmed.includes('(')) {
    return highlightPipeline(line);
  }

  // Operator definition: Name(...)
  return highlightOperator(line);
}

function highlightPipeline(text) {
  const parts = text.split(/(-\s*>)/);
  return parts.map(part => {
    if (/^-\s*>$/.test(part)) {
      return `<span class="tok-arrow">${escapeHtml(part)}</span>`;
    }
    const name = part.trim();
    if (name) {
      return `<span class="tok-op-name">${escapeHtml(part)}</span>`;
    }
    return escapeHtml(part);
  }).join('');
}

function highlightOperator(line) {
  const result = [];
  let i = 0;

  // Match operator name before first (
  const nameMatch = line.match(/^(\s*)(\w+)(\s*\()/);
  if (nameMatch) {
    result.push(escapeHtml(nameMatch[1]));
    result.push(`<span class="tok-op-name">${escapeHtml(nameMatch[2])}</span>`);
    result.push(`<span class="tok-paren">${escapeHtml(nameMatch[3])}</span>`);
    i = nameMatch[0].length;
  }

  // Tokenize the rest (inside parens)
  let state = 'normal'; // normal | key | value | string
  let token = '';
  let stringDelim = '';

  const flush = (cls) => {
    if (token) {
      if (cls) {
        result.push(`<span class="${cls}">${escapeHtml(token)}</span>`);
      } else {
        result.push(escapeHtml(token));
      }
      token = '';
    }
  };

  for (; i < line.length; i++) {
    const ch = line[i];

    if (state === 'string') {
      token += ch;
      if (ch === stringDelim && line[i - 1] !== '\\') {
        // Check if this string is an operator type value
        const strContent = token.slice(1, -1);
        if (OPERATOR_TYPE_NAMES.has(strContent)) {
          flush('tok-type-value');
        } else {
          flush('tok-string');
        }
        state = 'normal';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      flush();
      state = 'string';
      stringDelim = ch;
      token = ch;
      continue;
    }

    if (ch === '(' || ch === ')') {
      flush();
      result.push(`<span class="tok-paren">${escapeHtml(ch)}</span>`);
      continue;
    }

    if (ch === '[' || ch === ']') {
      flush();
      result.push(`<span class="tok-bracket">${escapeHtml(ch)}</span>`);
      continue;
    }

    if (ch === ':') {
      // The token before : is a field name
      flush('tok-field');
      result.push(`<span class="tok-paren">${escapeHtml(ch)}</span>`);
      state = 'normal';
      continue;
    }

    if (ch === ',') {
      flush();
      result.push(escapeHtml(ch));
      state = 'normal';
      continue;
    }

    // Check for special values and numbers on flush boundaries
    if (/\s/.test(ch) && token.trim()) {
      const trimmedToken = token.trim();
      if (SPECIAL_VALUES.includes(trimmedToken)) {
        flush('tok-keyword');
      } else if (/^\d+(\.\d+)?$/.test(trimmedToken)) {
        flush('tok-number');
      }
    }

    token += ch;
  }

  // Final flush
  if (token) {
    const trimmed = token.trim();
    if (SPECIAL_VALUES.includes(trimmed)) {
      flush('tok-keyword');
    } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
      flush('tok-number');
    } else {
      flush();
    }
  }

  return result.join('');
}

export function highlightManifest(text) {
  return text.split('\n').map(highlightLine).join('\n');
}
