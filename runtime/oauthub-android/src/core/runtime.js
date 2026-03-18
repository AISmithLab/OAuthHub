// Import TokenManager only - GraphQL schemas removed to avoid DOM conflicts in service worker
import TokenManager from '../platform/token-manager.js';
import OAuthCrypto from './oauth-crypto.js';

// Note: GraphQL schemas temporarily disabled in service worker context
// Using mock data instead until proper service worker GraphQL solution is implemented

// SSRF protection: block requests to private/internal IP ranges
function isAllowedUrl(urlString) {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;
    // Block private IPv4 ranges
    if (/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.)/.test(hostname)) return false;
    // Block IPv6 loopback and link-local
    if (hostname === '::1' || hostname === '[::1]' || hostname.startsWith('fe80')) return false;
    // Block localhost
    if (hostname === 'localhost') return false;
    // Block metadata endpoints
    if (hostname === '169.254.169.254') return false;
    // Only allow https (and http for Google APIs which redirect)
    if (!['https:', 'http:'].includes(url.protocol)) return false;
    return true;
  } catch {
    return false;
  }
}

// ReDoS protection: reject patterns with dangerous constructs
function isSafeRegex(pattern) {
  // Reject nested quantifiers like (a+)+ or (a*){2,} which cause catastrophic backtracking
  if (/(\+|\*|\{)\s*\)(\+|\*|\{|\?)/.test(pattern)) return false;
  // Reject deeply nested groups with alternation and quantifiers
  if (/\(([^)]*\|[^)]*)\)(\+|\*|\{)/.test(pattern)) {
    // Only block if the alternation contains quantifiers inside
    const inner = pattern.match(/\(([^)]*\|[^)]*)\)(\+|\*|\{)/);
    if (inner && /(\+|\*|\{)/.test(inner[1])) return false;
  }
  return true;
}

// Polyfill crypto.randomUUID for environments that lack it
function randomUUID() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

// Helper Functions
function parseManifest(manifestText) {
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

  // Phase 1: Extract headers and collect operator text
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

  // Phase 2: Parse pipeline by splitting on ->
  manifest.pipeline = pipelineStr
    .replace(/\s+/g, '')
    .split('->')
    .filter(Boolean);

  // Phase 3: Parse operators using balanced parentheses
  let i = 0;
  while (i < operatorText.length) {
    const nameMatch = operatorText.substring(i).match(/^(\w+)\s*\(/);
    if (nameMatch) {
      const name = nameMatch[1];
      const bodyStart = i + nameMatch[0].length;
      let depth = 1;
      let j = bodyStart;
      let inStr = false;

      // Walk forward to find the matching closing paren
      while (j < operatorText.length && depth > 0) {
        const ch = operatorText[j];
        if (ch === '"' && (j === 0 || operatorText[j - 1] !== '\\')) {
          inStr = !inStr;
        }
        if (!inStr) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        j++;
      }

      const body = operatorText.substring(bodyStart, j - 1);
      manifest.operators[name] = parseOperatorConfig(body);
      i = j;
    } else {
      i++;
    }
  }

  return manifest;
}

function parseOperatorConfig(configText) {
  const content = configText.trim();

  // Handle complex parsing for arrays with regex patterns
  const config = {};
  let currentKey = '';
  let currentValue = '';
  let insideArray = false;
  let insideString = false;
  let arrayDepth = 0;

  const chars = content.split('');

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];

    if (char === '[') {
      arrayDepth++;
      insideArray = true;
      currentValue += char;
    } else if (char === ']') {
      arrayDepth--;
      if (arrayDepth === 0) insideArray = false;
      currentValue += char;
    } else if (char === '"' && !insideArray) {
      insideString = !insideString;
      currentValue += char;
    } else if (char === ':' && !insideString && !insideArray && currentKey === '') {
      currentKey = currentValue.trim();
      currentValue = '';
    } else if (char === ',' && !insideString && !insideArray) {
      // Process key-value pair
      if (currentKey) {
        config[currentKey] = parseValue(currentValue.trim());
        currentKey = '';
        currentValue = '';
      }
    } else {
      currentValue += char;
    }
  }

  // Handle last pair
  if (currentKey) {
    config[currentKey] = parseValue(currentValue.trim());
  }

  return config;
}

function parseValue(value) {
  if (!value) return '';

  if (value === 'NOW') {
    return Runtime.DATETIME.NOW;
  } else if (value === 'true' || value === 'false') {
    return value === 'true';
  } else if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, (_, ch) => {
      switch (ch) {
        case 'n': return '\n';
        case 't': return '\t';
        case 'r': return '\r';
        case '\\': return '\\';
        case '"': return '"';
        default: return '\\' + ch;
      }
    });
  } else if (value.startsWith('[') && value.endsWith(']')) {
    // Parse array - handle regex patterns properly
    const arrayContent = value.slice(1, -1);
    const items = [];
    let currentItem = '';
    let insideString = false;

    for (let i = 0; i < arrayContent.length; i++) {
      const char = arrayContent[i];

      if (char === '"') {
        insideString = !insideString;
      } else if (char === ',' && !insideString) {
        if (currentItem.trim()) {
          items.push(parseArrayItem(currentItem.trim()));
        }
        currentItem = '';
        continue;
      }

      currentItem += char;
    }

    // Handle last item
    if (currentItem.trim()) {
      items.push(parseArrayItem(currentItem.trim()));
    }

    return items;
  } else if (!isNaN(value) && value !== '') {
    return Number(value);
  } else {
    return value.replace(/"/g, '');
  }
}

function parseArrayItem(item) {
  if (item.startsWith('"') && item.endsWith('"')) {
    return item.slice(1, -1).replace(/\\(.)/g, (_, ch) => {
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
  return item;
}

function encodeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function decodeBase64ToBytes(value) {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

function decodeBase64Url(value) {
  if (!value) return '';

  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    try {
      const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      return atob(padded);
    } catch {
      return '';
    }
  }
}

function extractGmailBody(payload) {
  if (!payload) return '';

  const parts = Array.isArray(payload.parts) ? payload.parts : [];

  for (const part of parts) {
    const mimeType = part?.mimeType || '';
    if (mimeType.startsWith('text/plain') && part?.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }

  for (const part of parts) {
    const nestedBody = extractGmailBody(part);
    if (nestedBody) return nestedBody;
  }

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  return '';
}

function isBinaryBody(value) {
  return (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof FormData !== 'undefined' && value instanceof FormData) ||
    (typeof URLSearchParams !== 'undefined' && value instanceof URLSearchParams) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value);
}

// Main Runtime Class
class Runtime {
  static DATETIME = {
    get NOW() { return new Date().toISOString(); }
  };

  // Resolve sentinel values like '__NOW__' to actual datetime at execution time
  static resolveSentinel(value) {
    if (value === '__NOW__' || value === 'NOW') return new Date().toISOString();
    return value;
  }

  /**
   * @param {Object} [opts]
   * @param {CryptoKey} [opts.privateKey]   – ECDSA P-256 private key for signing
   * @param {Object}    [opts.publicKeyJWK] – Matching public key JWK
   * @param {boolean}   [opts.interactive]  – Allow interactive Google auth prompts (default: true)
   */
  constructor(opts = {}) {
    this.tokenManager = new TokenManager({ initialGoogleTokens: opts.googleTokens || null });
    this.oauthCrypto = new OAuthCrypto();
    this.privateKey = opts.privateKey || null;
    this.publicKeyJWK = opts.publicKeyJWK || null;
    this.interactive = opts.interactive !== undefined ? opts.interactive : true;
  }

  // ─── API helpers per resource type ────────────────────────────

  async _fetchGmail(query, token) {

    const headers = { 'Authorization': `Bearer ${token}` };
    const gmailUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    gmailUrl.searchParams.set('maxResults', '100');

    const response = await fetch(gmailUrl.toString(), { headers });
    if (!response.ok) {
      throw new Error(`Gmail API error: ${response.status} ${await response.text()}`);
    }

    const messageList = await response.json();
    const messagesToFetch = Array.isArray(messageList.messages) ? messageList.messages : [];

    if (messagesToFetch.length === 0) {
      return { messages: [] };
    }

    const detailedMessages = [];

    for (const msg of messagesToFetch) {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers }
        );
        if (r.ok) {
          const d = await r.json();
          const hdrs = d.payload?.headers || [];
          detailedMessages.push({
            id: d.id,
            threadId: d.threadId,
            labelIds: d.labelIds || [],
            snippet: d.snippet || '',
            body: extractGmailBody(d.payload),
            historyId: d.historyId,
            internalDate: d.internalDate,
            payload: {
              headers: [
                { name: 'Subject', value: hdrs.find(h => h.name.toLowerCase() === 'subject')?.value || '' },
                { name: 'From',    value: hdrs.find(h => h.name.toLowerCase() === 'from')?.value || '' }
              ]
            }
          });
        }
      } catch (e) {
        console.warn(`Failed to fetch message ${msg.id}:`, e.message);
      }
    }
    return { messages: detailedMessages };
  }

  async _fetchCalendar(query, token) {

    const now = new Date().toISOString();
    const calUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=50&timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime`;
    const response = await fetch(calUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Calendar API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const events = (data.items || []).map(ev => ({
      id: ev.id,
      summary: ev.summary || '',
      description: ev.description || '',
      start: ev.start || {},
      end: ev.end || {},
      attendees: (ev.attendees || []).map(a => ({
        email: a.email,
        displayName: a.displayName || '',
        responseStatus: a.responseStatus || ''
      })),
      location: ev.location || '',
      status: ev.status || '',
      htmlLink: ev.htmlLink || ''
    }));
    return { events };
  }

  async _fetchDrive(query, token) {

    const driveUrl = 'https://www.googleapis.com/drive/v3/files?pageSize=50&fields=files(id,name,mimeType,modifiedTime,size,webViewLink,parents)&q=trashed%20%3D%20false';
    const response = await fetch(driveUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Drive API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    const files = Array.isArray(data.files) ? data.files : [];
    const parentNames = await this._resolveDriveParentNames(files, token);

    return {
      files: files.map(file => ({
        ...file,
        parents: Array.isArray(file.parents)
          ? file.parents.map(parentId => parentNames[parentId] || parentId)
          : []
      }))
    };
  }

  async _fetchForms(query, token) {

    // Forms API requires a form ID; extract from query if present
    const formIdMatch = query.match(/formId:\s*"([^"]+)"/);
    if (!formIdMatch) {
      throw new Error('Forms query must include formId, e.g. formId: "abc123"');
    }
    const formId = formIdMatch[1];

    const formsUrl = `https://forms.googleapis.com/v1/forms/${formId}/responses`;
    const response = await fetch(formsUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) {
      throw new Error(`Forms API error: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return { responses: data.responses || [] };
  }

  async receive(name, source, request) {
    if (!source || source === 'inline') {
      return request ?? null;
    }

    if (typeof source !== 'string') {
      throw new Error(`Operator ${name}: source must be "inline" or a URL string.`);
    }

    let requestConfig = {};
    if (request != null) {
      if (typeof request !== 'object' || Array.isArray(request)) {
        throw new Error(`Operator ${name}: request payload for URL sources must be an object.`);
      }
      requestConfig = request;
    }

    const {
      method = 'POST',
      headers = {},
      body = undefined,
      credentials = 'omit',
      query = undefined
    } = requestConfig;

    const url = new URL(source);
    if (query && typeof query === 'object' && !Array.isArray(query)) {
      for (const [key, value] of Object.entries(query)) {
        if (value == null) continue;
        url.searchParams.set(key, String(value));
      }
    }

    const normalizedHeaders = { ...headers };
    const init = {
      method,
      headers: normalizedHeaders,
      credentials
    };

    if (body !== undefined) {
      if (typeof body === 'string' || isBinaryBody(body)) {
        init.body = body;
      } else {
        if (!Object.keys(normalizedHeaders).some(key => key.toLowerCase() === 'content-type')) {
          normalizedHeaders['Content-Type'] = 'application/json';
        }
        init.body = JSON.stringify(body);
      }
    }

    const response = await fetch(url.toString(), init);
    if (!response.ok) {
      throw new Error(`Operator ${name}: source request failed: ${response.status} ${await response.text()}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return await response.json();
    }

    return await response.text();
  }

  // ─── GraphQL field projection helper ─────────────────────────

  /**
   * Parse a GraphQL-style query string and extract requested field names.
   * Supports simple queries like: { events { summary start end attendees } }
   * Returns an array of field names, or null if no valid query.
   */
  static parseFieldsFromQuery(query) {
    if (!query || typeof query !== 'string') return null;

    // Strip outer braces and type name to get field list
    // e.g. "{ events { summary start end } }" -> "summary start end"
    const cleaned = query.replace(/[{}]/g, ' ').trim();
    const tokens = cleaned.split(/\s+/).filter(Boolean);

    // Filter out type names (first token is usually the resource type)
    // Keep only lowercase field-looking names
    const fields = tokens.filter(t => /^[a-z_][a-zA-Z0-9_.]*$/.test(t));
    return fields.length > 0 ? fields : null;
  }

  /**
   * Project (filter) fields from data objects based on requested fields.
   * Only keeps the specified fields in each item.
   */
  static projectFields(data, fields) {
    if (!fields || !Array.isArray(fields) || fields.length === 0) return data;
    if (!Array.isArray(data)) return data;

    return data.map(item => {
      const projected = {};
      for (const field of fields) {
        const value = field.split('.').reduce((acc, k) => acc && acc[k], item);
        if (value !== undefined) {
          projected[field.includes('.') ? field.split('.').pop() : field] = value;
        }
      }
      return projected;
    });
  }

  /**
   * Build Google API `fields` parameter from requested field names.
   * Maps GraphQL-style fields to Google API fields format.
   */
  static buildGoogleApiFields(resourceType, requestedFields) {
    if (!requestedFields) return null;

    const fieldMappings = {
      google_calendar: {
        wrapper: 'items',
        fields: { id: 'id', summary: 'summary', description: 'description', start: 'start', end: 'end', attendees: 'attendees', location: 'location', status: 'status', htmlLink: 'htmlLink' }
      },
      gmail: {
        wrapper: 'messages',
        fields: { id: 'id', threadId: 'threadId', snippet: 'snippet', body: 'body', labelIds: 'labelIds', payload: 'payload' }
      },
      google_drive: {
        wrapper: 'files',
        fields: { id: 'id', name: 'name', mimeType: 'mimeType', modifiedTime: 'modifiedTime', size: 'size', webViewLink: 'webViewLink', parents: 'parents' }
      }
    };

    const mapping = fieldMappings[resourceType];
    if (!mapping) return null;

    const apiFields = requestedFields
      .map(f => mapping.fields[f])
      .filter(Boolean);

    return apiFields.length > 0 ? `${mapping.wrapper}(${apiFields.join(',')})` : null;
  }

  // ─── pull: dispatch to the correct API handler ────────────────

  async pull(name, resourceType, query, manifest) {
    const supported = ['gmail', 'google_calendar', 'google_forms', 'google_drive'];
    if (!supported.includes(resourceType)) {
      throw new Error(`Operator ${name}: resourceType ${resourceType} not supported.`);
    }

    // Get valid Google token via chrome.identity
    const scopes = this.tokenManager.inferScopes(manifest);
    const tokenData = await this.tokenManager.getValidGoogleToken(scopes, null, 'GET', { interactive: this.interactive });
    const accessToken = tokenData.access_token || tokenData;

    // Parse GraphQL-style query for field projection
    const requestedFields = Runtime.parseFieldsFromQuery(query);

    let result;
    switch (resourceType) {
      case 'gmail':            result = await this._fetchGmail(query, accessToken); break;
      case 'google_calendar':  result = await this._fetchCalendar(query, accessToken); break;
      case 'google_drive':     result = await this._fetchDrive(query, accessToken); break;
      case 'google_forms':     result = await this._fetchForms(query, accessToken); break;
      default:
        throw new Error(`Operator ${name}: no handler for ${resourceType}`);
    }

    // Apply client-side field projection if query specified fields
    if (requestedFields) {
      const dataKey = Object.keys(result)[0];
      if (dataKey && Array.isArray(result[dataKey])) {
        result[dataKey] = Runtime.projectFields(result[dataKey], requestedFields);
      }
    }

    return result;
  }

  async _resolveDriveParentNames(files, token) {
    const parentIds = [...new Set(
      files.flatMap(file => Array.isArray(file.parents) ? file.parents : [])
    )];

    if (parentIds.length === 0) {
      return {};
    }

    const entries = await Promise.all(parentIds.map(async (parentId) => {
      try {
        const response = await fetch(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parentId)}?fields=id,name`,
          { headers: { 'Authorization': `Bearer ${token}` } }
        );

        if (!response.ok) {
          return [parentId, parentId];
        }

        const data = await response.json();
        return [parentId, data.name || parentId];
      } catch {
        return [parentId, parentId];
      }
    }));

    return Object.fromEntries(entries);
  }

  _matchesFilterOperation(value, operation, target) {
    const values = Array.isArray(value) ? value : [value];

    switch (operation) {
      case '==':
        return values.some(entry => entry === target);
      case '!=':
        return values.every(entry => entry !== target);
      case '>':
        return values.some(entry => entry > target);
      case '>=':
        return values.some(entry => entry >= target);
      case '<':
        return values.some(entry => entry < target);
      case '<=':
        return values.some(entry => entry <= target);
      case 'include':
        return values.some(entry => String(entry ?? '').toLowerCase().includes(String(target).toLowerCase()));
      case 'not include':
        return values.every(entry => !String(entry ?? '').toLowerCase().includes(String(target).toLowerCase()));
      case 'match': {
        if (!isSafeRegex(target)) {
          throw new Error('Regex pattern rejected: potential ReDoS');
        }
        const regex = new RegExp(target);
        return values.some(entry => regex.test(String(entry ?? '')));
      }
      default:
        return false;
    }
  }

  filter(data, name, operation, field, targetValue = null, pattern = null, requirement = null) {
    const validOperations = ["==", "!=", ">", ">=", "<", "<=", "include", "not include", "match"];
    if (!validOperations.includes(operation)) {
      throw new Error(`Operator ${name}: operation ${operation} not supported.`);
    }

    const target = Runtime.resolveSentinel(pattern || targetValue);
    const matchesItem = item => {
      const value = Array.isArray(field) ?
        field.map(f => this.getKey(f, item)) :
        this.getKey(field, item);

      if (Array.isArray(field)) {
        if (requirement === 'all') {
          return value.every(v => v != null && this._matchesFilterOperation(v, operation, target));
        }
        return value.some(v => v != null && this._matchesFilterOperation(v, operation, target));
      }

      if (value === undefined) return false;
      return this._matchesFilterOperation(value, operation, target);
    };

    if (Array.isArray(data)) {
      return data.filter(matchesItem);
    }

    if (data == null) {
      return data;
    }

    return matchesItem(data) ? data : null;
  }

  getKey(key, obj) {
    return key.split('.').reduce((acc, curr) => acc && acc[curr], obj);
  }

  limit(data, name, count) {
    if (typeof count !== 'number') {
      throw new Error(`Operator ${name}: the count property should be an integer.`);
    }
    return data.slice(0, count);
  }

  select(data, name, field) {
    if (Array.isArray(data)) {
      if (Array.isArray(field) && field.length > 1) {
        return data.map(item => {
          return field.reduce((acc, key) => {
            const value = this.getKey(key, item);
            if (value !== undefined) {
              acc[key.split('.').pop()] = value;
            }
            return acc;
          }, {});
        });
      } else {
        const singleField = Array.isArray(field) ? field[0] : field;
        return data.map(item => this.getKey(singleField, item)).filter(Boolean);
      }
    } else {
      if (Array.isArray(field) && field.length > 1) {
        return field.reduce((acc, key) => {
          const value = this.getKey(key, data);
          if (value !== undefined) {
            acc[key.split('.').pop()] = value;
          }
          return acc;
        }, {});
      } else {
        const singleField = Array.isArray(field) ? field[0] : field;
        return this.getKey(singleField, data);
      }
    }
  }

  aggregate(data, name, operation, field = null) {
    if (!['count', 'sum', 'average'].includes(operation)) {
      throw new Error(`Operator ${name}: operation ${operation} not supported.`);
    }

    if (operation === 'count') {
      if (!field) {
        return data.length;
      }
      return new Set(data.map(item => this.getKey(field, item)).filter(Boolean)).size;
    }

    if (!field) {
      throw new Error(`Operator ${name}: field is required for ${operation} operation.`);
    }

    const values = data.map(item => this.getKey(field, item)).filter(val => val != null);

    switch (operation) {
      case 'sum':
        return values.reduce((acc, val) => acc + val, 0);
      case 'average':
        if (values.length === 0) return 0;
        return values.reduce((acc, val) => acc + val, 0) / values.length;
      default:
        throw new Error(`Operator ${name}: Unknown operation ${operation}`);
    }
  }

  extract(data, name, field, pattern) {
    if (!Array.isArray(pattern)) {
      pattern = [pattern];
    }
    if (!Array.isArray(field)) {
      field = [field];
    }

    const results = [];
    for (const item of data) {
      for (const f of field) {
        const value = this.getKey(f, item);
        if (value == null) continue;

        for (const regex of pattern) {
          try {
            if (!isSafeRegex(regex)) {
              console.warn(`Regex pattern rejected in operator ${name}: potential ReDoS`);
              continue;
            }
            const regexObj = new RegExp(regex, 'g');
            const matches = value.match(regexObj);
            if (matches) {
              results.push(...matches);
            }
          } catch (error) {
            console.error(`Invalid regex pattern '${regex}' in operator ${name}:`, error.message);
            // Continue with other patterns instead of failing completely
          }
        }
      }
    }
    return results;
  }


  sort(data, name, sortKey, order = 'ascending') {
    if (!['ascending', 'descending'].includes(order)) {
      throw new Error(`Operator ${name}: order must be "ascending" or "descending"`);
    }

    return [...data].sort((a, b) => {
      const valA = this.getKey(sortKey, a);
      const valB = this.getKey(sortKey, b);

      if (valA < valB) return order === 'ascending' ? -1 : 1;
      if (valA > valB) return order === 'ascending' ? 1 : -1;
      return 0;
    });
  }

  async post(name, destination, data) {
    // SSRF protection: validate destination URL
    if (!isAllowedUrl(destination)) {
      throw new Error(`Operator ${name}: destination URL is not allowed (private/internal address blocked)`);
    }

    try {
      const timestamp = new Date().toISOString();
      const payload = {
        type: 'pipeline_data',
        data: data,
        timestamp: timestamp
      };
      const body = JSON.stringify(payload);

      const headers = {
        'Content-Type': 'application/json',
        'X-OAuthHub-Type': 'pipeline_data',
        'X-OAuthHub-Timestamp': timestamp
      };

      // Sign a SHA-256 digest of the body as a JWT (ES256).
      // The JWT claims contain { body_hash, iat } — NOT the full payload,
      // keeping the header small regardless of data size.
      // The receiver verifies against the public key distributed during the
      // OAuth redirect (oauthub_public_key param).
      if (this.privateKey) {
        try {
          const bodyHash = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(body)
          );
          const bodyHashB64 = this.oauthCrypto.base64URLEncode(new Uint8Array(bodyHash));
          const signatureJWT = await this.oauthCrypto.signJWT(
            { alg: 'ES256', typ: 'oauthub+jwt' },
            { body_hash: bodyHashB64, iat: Math.floor(Date.now() / 1000) },
            this.privateKey
          );
          headers['X-OAuthHub-Signature'] = signatureJWT;
        } catch (signErr) {
          throw new Error(`Payload signing failed: ${signErr.message}`);
        }
      }

      const response = await fetch(destination, {
        method: 'POST',
        headers: headers,
        body: body
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        throw new Error(`HTTP error! status: ${response.status} - ${errorBody}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Operator ${name}: Error posting to ${destination}:`, error);
      throw error;
    }
  }

  async _getManifestAccessToken(manifest, method) {
    const scopes = this.tokenManager.inferScopes(manifest);
    const tokenData = await this.tokenManager.getValidGoogleToken(
      scopes,
      null,
      method,
      { interactive: this.interactive }
    );
    return tokenData.access_token || tokenData;
  }

  async _findDriveFolderIdByName(name, parentId, token) {
    const q = [
      `name = '${encodeDriveQueryValue(name)}'`,
      "mimeType = 'application/vnd.google-apps.folder'",
      "trashed = false",
      `'${parentId}' in parents`
    ].join(' and ');

    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)&q=${encodeURIComponent(q)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!response.ok) {
      throw new Error(`Drive folder lookup failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return data.files?.[0]?.id || null;
  }

  async _createDriveFolder(name, parentId, token) {
    const response = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      })
    });

    if (!response.ok) {
      throw new Error(`Drive folder creation failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    if (!data.id) {
      throw new Error('Drive folder creation did not return an id');
    }
    return data.id;
  }

  async _ensureDriveFolderPath(folderPath, token) {
    const parts = String(folderPath || '')
      .split('/')
      .map(part => part.trim())
      .filter(Boolean);

    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'root')) {
      return 'root';
    }

    let parentId = 'root';
    for (const part of parts) {
      const existingId = await this._findDriveFolderIdByName(part, parentId, token);
      parentId = existingId || await this._createDriveFolder(part, parentId, token);
    }

    return parentId;
  }

  async _createDriveFile(token, payload) {
    const boundary = `oauthhub_${randomUUID()}`;
    const metadata = {
      name: payload.name,
      mimeType: payload.mimeType,
      parents: payload.parents
    };

    const mediaBytes = payload.contentBase64
      ? decodeBase64ToBytes(payload.contentBase64)
      : new TextEncoder().encode(payload.contentText || '');

    // Build multipart body using Buffer/Uint8Array concatenation
    // (React Native may not support Blob in all environments)
    const encoder = new TextEncoder();
    const preamble = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${payload.mimeType}\r\n\r\n`
    );
    const epilogue = encoder.encode(`\r\n--${boundary}--`);
    const bodyParts = new Uint8Array(preamble.length + mediaBytes.length + epilogue.length);
    bodyParts.set(preamble, 0);
    bodyParts.set(mediaBytes, preamble.length);
    bodyParts.set(epilogue, preamble.length + mediaBytes.length);

    const response = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,parents',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`
        },
        body: bodyParts
      }
    );

    if (!response.ok) {
      throw new Error(`Drive file upload failed: ${response.status} ${await response.text()}`);
    }

    const data = await response.json();
    return {
      id: data.id || '',
      name: data.name || payload.name,
      mimeType: data.mimeType || payload.mimeType,
      modifiedTime: data.modifiedTime || '',
      parents: payload.parentNames
    };
  }

  async write(name, resourceType, action, data, manifest) {
    if (resourceType !== 'google_drive') {
      throw new Error(`Operator ${name}: write only supports google_drive right now.`);
    }

    if (action !== 'create') {
      throw new Error(`Operator ${name}: write action ${action} not supported.`);
    }

    const payload = data && typeof data === 'object'
      ? {
          ...(data.body || {}),
          ...(data.parameters || {}),
          ...data
        }
      : {};

    if (!payload.name) {
      throw new Error(`Operator ${name}: missing file name.`);
    }

    const token = await this._getManifestAccessToken(manifest, 'POST');
    const parentNames = Array.isArray(payload.parents) && payload.parents.length > 0
      ? payload.parents.map(parent => String(parent))
      : ['root'];
    const parentIds = [];

    for (const parentName of parentNames) {
      parentIds.push(await this._ensureDriveFolderPath(parentName, token));
    }

    return await this._createDriveFile(token, {
      name: String(payload.name),
      mimeType: String(payload.mimeType || 'application/octet-stream'),
      contentBase64: payload.contentBase64 ? String(payload.contentBase64) : null,
      contentText: payload.content != null ? String(payload.content) : '',
      parents: parentIds,
      parentNames
    });
  }

  // ─── Sample data generators for manifest preview ────────────

  static _sampleData(resourceType) {
    switch ((resourceType || '').toLowerCase()) {
      case 'gmail':
        return {
          dataKey: 'messages',
          data: [
            {
              id: 'msg_001', threadId: 'thread_001',
              labelIds: ['INBOX', 'IMPORTANT'],
              snippet: 'Your flight to San Francisco departs on March 15 at 8:30 AM from JFK.',
              body: 'Dear Traveler,\n\nYour flight reservation has been confirmed.\n\nFlight: AA 1234\nDeparture: March 15, 2025 at 8:30 AM from JFK Terminal 4\nArrival: March 15, 2025 at 11:45 AM at SFO Terminal 2\nBooking Reference: XKRT72\n\nPlease arrive at the airport at least 2 hours before departure.\n\nThank you for choosing American Airlines.',
              historyId: '12345', internalDate: '1710400000000',
              payload: { headers: [
                { name: 'Subject', value: 'Flight Confirmation - JFK to SFO' },
                { name: 'From', value: 'bookings@airline.com' },
                { name: 'Date', value: 'Thu, 13 Mar 2025 10:22:00 -0400' }
              ]}
            },
            {
              id: 'msg_002', threadId: 'thread_002',
              labelIds: ['INBOX'],
              snippet: 'Meeting notes from today\'s standup. Action items: review PR #42, update docs.',
              body: 'Hi team,\n\nHere are the notes from today\'s standup:\n\n- Alice: Working on PR #42, needs review\n- Bob: Updating documentation for the API changes\n- Carol: Investigating the performance regression in staging\n\nAction items:\n1. Review PR #42 by EOD\n2. Update docs for v2.3 release\n\nBest,\nTeam Lead',
              historyId: '12346', internalDate: '1710300000000',
              payload: { headers: [
                { name: 'Subject', value: 'Standup Notes - March 12' },
                { name: 'From', value: 'team@company.com' },
                { name: 'Date', value: 'Wed, 12 Mar 2025 09:15:00 -0400' }
              ]}
            },
            {
              id: 'msg_003', threadId: 'thread_003',
              labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'],
              snippet: 'Your order #A1234 has shipped! Track your flight case delivery here.',
              body: 'Order Confirmation\n\nYour order #A1234 has shipped!\n\nItem: Premium Flight Case - Black\nQuantity: 1\nTracking Number: 1Z999AA10123456784\nEstimated Delivery: March 18, 2025\n\nTrack your package at: https://tracking.example.com/1Z999AA10123456784\n\nThank you for your purchase!',
              historyId: '12347', internalDate: '1710200000000',
              payload: { headers: [
                { name: 'Subject', value: 'Order Shipped - Flight Case' },
                { name: 'From', value: 'orders@store.com' },
                { name: 'Date', value: 'Tue, 11 Mar 2025 14:30:00 -0400' }
              ]}
            },
            {
              id: 'msg_004', threadId: 'thread_004',
              labelIds: ['INBOX'],
              snippet: 'Reminder: dentist appointment tomorrow at 2 PM.',
              body: 'Hello,\n\nThis is a reminder that you have an appointment scheduled:\n\nDate: March 12, 2025\nTime: 2:00 PM\nDoctor: Dr. Smith\nLocation: 123 Health St, Suite 200\n\nPlease arrive 15 minutes early. If you need to cancel or reschedule, call us at (555) 123-4567.\n\nBest regards,\nSmile Dental Clinic',
              historyId: '12348', internalDate: '1710100000000',
              payload: { headers: [
                { name: 'Subject', value: 'Appointment Reminder' },
                { name: 'From', value: 'clinic@health.com' },
                { name: 'Date', value: 'Mon, 10 Mar 2025 08:00:00 -0400' }
              ]}
            },
            {
              id: 'msg_005', threadId: 'thread_005',
              labelIds: ['INBOX'],
              snippet: 'Your return flight from LAX to JFK is confirmed for April 2.',
              body: 'Booking Confirmed\n\nYour return flight has been booked successfully.\n\nFlight: UA 5678\nDeparture: April 2, 2025 at 6:15 PM from LAX Terminal 7\nArrival: April 3, 2025 at 2:30 AM at JFK Terminal 1\nBooking Reference: PLMW93\nSeat: 14A (Window)\n\nCheck in online 24 hours before departure at united.com.\n\nSafe travels!',
              historyId: '12349', internalDate: '1710000000000',
              payload: { headers: [
                { name: 'Subject', value: 'Return Flight Confirmation' },
                { name: 'From', value: 'bookings@airline.com' },
                { name: 'Date', value: 'Sun, 09 Mar 2025 16:45:00 -0400' }
              ]}
            }
          ]
        };

      case 'google_calendar':
        return {
          dataKey: 'events',
          data: [
            {
              id: 'evt_001', summary: 'Team Standup',
              description: 'Daily sync with the engineering team',
              start: { dateTime: new Date(Date.now() + 86400000).toISOString(), timeZone: 'America/New_York' },
              end: { dateTime: new Date(Date.now() + 88200000).toISOString(), timeZone: 'America/New_York' },
              attendees: [
                { email: 'alice@company.com', displayName: 'Alice', responseStatus: 'accepted' },
                { email: 'bob@company.com', displayName: 'Bob', responseStatus: 'tentative' }
              ],
              location: 'https://zoom.us/j/123456789',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?id=evt_001'
            },
            {
              id: 'evt_002', summary: 'Product Review',
              description: 'Quarterly product review with stakeholders via Google Meet',
              start: { dateTime: new Date(Date.now() + 172800000).toISOString(), timeZone: 'America/New_York' },
              end: { dateTime: new Date(Date.now() + 176400000).toISOString(), timeZone: 'America/New_York' },
              attendees: [
                { email: 'carol@company.com', displayName: 'Carol', responseStatus: 'accepted' }
              ],
              location: 'Conference Room B',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?id=evt_002'
            },
            {
              id: 'evt_003', summary: 'Zoom Workshop',
              description: 'External workshop on API design. Join via https://zoom.us/j/987654321',
              start: { dateTime: new Date(Date.now() + 259200000).toISOString(), timeZone: 'America/New_York' },
              end: { dateTime: new Date(Date.now() + 266400000).toISOString(), timeZone: 'America/New_York' },
              attendees: [],
              location: 'https://zoom.us/j/987654321',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?id=evt_003'
            },
            {
              id: 'evt_004', summary: 'Dentist Appointment',
              description: 'Regular checkup',
              start: { dateTime: new Date(Date.now() + 345600000).toISOString(), timeZone: 'America/New_York' },
              end: { dateTime: new Date(Date.now() + 349200000).toISOString(), timeZone: 'America/New_York' },
              attendees: [],
              location: '123 Health St',
              status: 'confirmed',
              htmlLink: 'https://calendar.google.com/event?id=evt_004'
            }
          ]
        };

      case 'google_drive':
        return {
          dataKey: 'files',
          data: [
            {
              id: 'file_001', name: 'Q1 Report.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2024-03-01T10:00:00Z', createdTime: '2024-02-15T08:00:00Z',
              size: '2048576',
              webViewLink: 'https://drive.google.com/file/d/file_001/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf',
              parents: ['Shared'],
              owners: [{ displayName: 'Alice Chen', emailAddress: 'alice@example.com' }],
              starred: false, trashed: false
            },
            {
              id: 'file_002', name: 'Lecture 7 - Machine Learning.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2024-02-28T14:30:00Z', createdTime: '2024-02-20T09:00:00Z',
              size: '5242880',
              webViewLink: 'https://drive.google.com/file/d/file_002/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf',
              parents: ['Notability'],
              owners: [{ displayName: 'Bob Martinez', emailAddress: 'bob@example.com' }],
              starred: true, trashed: false
            },
            {
              id: 'file_003', name: 'CS 229 Notes - Week 3.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2024-03-05T09:15:00Z', createdTime: '2024-03-04T11:00:00Z',
              size: '1024000',
              webViewLink: 'https://drive.google.com/file/d/file_003/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf',
              parents: ['Notability'],
              owners: [{ displayName: 'Bob Martinez', emailAddress: 'bob@example.com' }],
              starred: false, trashed: false
            },
            {
              id: 'file_004', name: 'Vacation Photos.zip',
              mimeType: 'application/zip',
              modifiedTime: '2024-01-20T16:45:00Z', createdTime: '2024-01-18T12:00:00Z',
              size: '104857600',
              webViewLink: 'https://drive.google.com/file/d/file_004/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/zip',
              parents: ['Photos'],
              owners: [{ displayName: 'Alice Chen', emailAddress: 'alice@example.com' }],
              starred: false, trashed: false
            },
            {
              id: 'file_005', name: 'Research Paper Draft.docx',
              mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              modifiedTime: '2024-03-10T22:00:00Z', createdTime: '2024-02-01T10:30:00Z',
              size: '358400',
              webViewLink: 'https://drive.google.com/file/d/file_005/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              parents: ['Documents'],
              owners: [{ displayName: 'Alice Chen', emailAddress: 'alice@example.com' }],
              starred: true, trashed: false
            },
            {
              id: 'file_006', name: 'Organic Chemistry Highlights.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2024-03-08T13:20:00Z', createdTime: '2024-03-07T08:45:00Z',
              size: '2621440',
              webViewLink: 'https://drive.google.com/file/d/file_006/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf',
              parents: ['Notability'],
              owners: [{ displayName: 'Bob Martinez', emailAddress: 'bob@example.com' }],
              starred: false, trashed: false
            },
            {
              id: 'file_007', name: 'Budget 2024.xlsx',
              mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              modifiedTime: '2024-02-14T17:00:00Z', createdTime: '2024-01-05T09:00:00Z',
              size: '524288',
              webViewLink: 'https://drive.google.com/file/d/file_007/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              parents: ['Documents'],
              owners: [{ displayName: 'Alice Chen', emailAddress: 'alice@example.com' }],
              starred: false, trashed: false
            },
            {
              id: 'file_008', name: 'Thermodynamics Lab Report.pdf',
              mimeType: 'application/pdf',
              modifiedTime: '2024-03-11T10:30:00Z', createdTime: '2024-03-10T14:00:00Z',
              size: '1843200',
              webViewLink: 'https://drive.google.com/file/d/file_008/view',
              iconLink: 'https://drive-thirdparty.googleusercontent.com/16/type/application/pdf',
              parents: ['Notability'],
              owners: [{ displayName: 'Bob Martinez', emailAddress: 'bob@example.com' }],
              starred: true, trashed: false
            }
          ]
        };

      case 'google_forms':
        return {
          dataKey: 'responses',
          data: [
            { responseId: 'resp_001', createTime: '2024-03-01T10:00:00Z', answers: { q1: { textAnswers: { answers: [{ value: 'Yes' }] } } } },
            { responseId: 'resp_002', createTime: '2024-03-02T11:00:00Z', answers: { q1: { textAnswers: { answers: [{ value: 'No' }] } } } }
          ]
        };

      default:
        return {
          dataKey: 'items',
          data: [
            { id: '1', value: 'Sample item 1' },
            { id: '2', value: 'Sample item 2' }
          ]
        };
    }
  }

  /**
   * Execute a manifest against sample data for preview purposes.
   * Skips Pull (uses sample data) and Post (doesn't send anything).
   * Returns { before, after, manifest } for the consent UI.
   */
  executeManifestPreview(manifestText) {
    const manifest = parseManifest(manifestText);

    // Find the Pull/Input operator to determine resource type
    let resourceType = 'unknown';
    for (const name of manifest.pipeline) {
      const op = manifest.operators[name];
      if (op && ['pull', 'input'].includes(String(op.type).toLowerCase())) {
        resourceType = String(op.resourceType || 'unknown');
        break;
      }
    }

    const sample = Runtime._sampleData(resourceType);
    // Deep copy items for the "before" display
    const beforeData = JSON.parse(JSON.stringify(sample.data));

    // Seed currentData as the container object that Pull would return
    // (e.g. { events: [...] } for calendar, { messages: [...] } for gmail)
    // so that Select(field: "events") can unwrap it correctly.
    let currentData = { [sample.dataKey]: JSON.parse(JSON.stringify(sample.data)) };

    for (const operatorName of manifest.pipeline) {
      const config = manifest.operators[operatorName];
      if (!config) continue;

      const type = String(config.type).toLowerCase();

      switch (type) {
        case 'pull':
        case 'input':
          // Skip - we already seeded with sample data
          break;

        case 'select':
          currentData = this.select(currentData, operatorName, config.field);
          break;

        case 'filter':
          currentData = this.filter(
            currentData, operatorName,
            config.operation, config.field,
            config.targetValue, config.pattern, config.requirement
          );
          break;

        case 'limit':
          currentData = this.limit(currentData, operatorName, config.count);
          break;

        case 'aggregate':
          currentData = this.aggregate(currentData, operatorName, config.operation, config.field);
          break;

        case 'extract':
          currentData = this.extract(currentData, operatorName, config.field, config.pattern);
          break;

        case 'sort':
          currentData = this.sort(currentData, operatorName, config.sortKey, config.order);
          break;

        case 'post':
          // Skip - don't actually send data during preview
          break;

        default:
          // Unknown operator type, skip during preview
          break;
      }
    }

    return {
      before: { data: beforeData },
      after: { data: Array.isArray(currentData) ? currentData : [currentData] },
      manifest
    };
  }

  async executeManifest(manifestText, opts = {}) {
    const manifest = parseManifest(manifestText);
    const operation = opts.operation || 'read';
    // For write operations, seed the pipeline with the caller's data
    let currentData = operation === 'write' ? (opts.data || null) : null;

    for (const operatorName of manifest.pipeline) {
      const config = manifest.operators[operatorName];
      if (!config) {
        throw new Error(`Operator ${operatorName} not found in manifest`);
      }

      const operatorType = config.type.toLowerCase();

      if (operation === 'read' && currentData == null && !['pull', 'input'].includes(operatorType)) {
        continue;
      }

      switch (operatorType) {
        case 'receive':
          currentData = await this.receive(
            operatorName,
            config.source,
            opts.data
          );
          break;

        case 'pull':
          currentData = await this.pull(
            operatorName,
            config.resourceType,
            config.query,
            manifest
          );
          break;

        case 'filter':
          currentData = this.filter(
            currentData,
            operatorName,
            config.operation,
            config.field,
            config.targetValue,
            config.pattern,
            config.requirement
          );
          break;

        case 'select':
          currentData = this.select(
            currentData,
            operatorName,
            config.field
          );
          break;

        case 'limit':
          currentData = this.limit(
            currentData,
            operatorName,
            config.count
          );
          break;

        case 'aggregate':
          currentData = this.aggregate(
            currentData,
            operatorName,
            config.operation,
            config.field
          );
          break;

        case 'extract':
          currentData = this.extract(
            currentData,
            operatorName,
            config.field,
            config.pattern
          );
          break;

        case 'sort':
          currentData = this.sort(
            currentData,
            operatorName,
            config.sortKey,
            config.order
          );
          break;

        case 'post':
          currentData = await this.post(
            operatorName,
            config.destination,
            currentData
          );
          break;

        case 'write':
          currentData = await this.write(
            operatorName,
            config.resourceType,
            config.action,
            currentData,
            manifest
          );
          if (operation === 'write') {
            return currentData;
          }
          break;

        default:
          throw new Error(`Operator ${operatorName}: Unknown operator type ${config.type}`);
      }

    }

    return currentData;
  }
}

// Export both named and default
export { Runtime };
export default Runtime;
