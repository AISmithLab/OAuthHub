/**
 * Manifest IDE schema definitions: operator types, fields, documentation.
 */

export const OPERATOR_TYPES = {
  Pull: {
    description: 'Fetch data from a Google API resource server.',
    requiredFields: {
      type: { type: 'string', fixed: 'Pull' },
      resourceType: { type: 'string', description: 'The OAuth resource to pull from' },
      query: { type: 'string', description: 'GraphQL-style query specifying which fields to retrieve' }
    },
    optionalFields: {},
    example: 'PullEmails(type: "Pull", resourceType: "gmail", query: "{ messages(userId) {snippet} }")',
    notes: 'Supported resource types: google_calendar, gmail, google_drive, google_forms.'
  },
  Select: {
    description: 'Select a specific field or set of fields from the data.',
    requiredFields: {
      type: { type: 'string', fixed: 'Select' },
      field: { type: 'string|array', description: 'Field name(s) to select from each item' }
    },
    optionalFields: {},
    example: 'SelectEvents(type: "Select", field: "events")',
    notes: 'Supports dot notation for nested fields (e.g., "start.dateTime"). Can be a single string or an array of strings.'
  },
  Filter: {
    description: 'Filter data items based on a condition.',
    requiredFields: {
      type: { type: 'string', fixed: 'Filter' },
      operation: { type: 'string', description: 'Comparison operation to apply' },
      field: { type: 'string|array', description: 'Field(s) to evaluate' }
    },
    optionalFields: {
      targetValue: { type: 'any', description: 'Value to compare against' },
      pattern: { type: 'string', description: 'Regex pattern for "match" operation' },
      requirement: { type: 'string', description: '"any" or "all" when field is an array' }
    },
    example: 'FilterFlights(type: "Filter", operation: "match", field: ["snippet"], pattern: "flight", requirement: "any")',
    notes: 'Operations: ==, !=, >, >=, <, <=, include, not include, match. Use NOW as a special targetValue for current time.'
  },
  Extract: {
    description: 'Extract specific patterns from text fields using regex.',
    requiredFields: {
      type: { type: 'string', fixed: 'Extract' },
      field: { type: 'string|array', description: 'Field(s) to extract from' },
      pattern: { type: 'string|array', description: 'Regex pattern(s) to match' }
    },
    optionalFields: {},
    example: 'ExtractDate(type: "Extract", field: ["snippet"], pattern: "\\d{1,2}/\\d{1,2}/\\d{4}")',
    notes: 'Returns an array of all regex matches across all items. Uses JavaScript regex syntax.'
  },
  Post: {
    description: 'Send the processed data to an external endpoint via HTTP POST.',
    requiredFields: {
      type: { type: 'string', fixed: 'Post' },
      destination: { type: 'string', description: 'URL to POST the data to' }
    },
    optionalFields: {},
    example: 'SendToApp(type: "Post", destination: "https://api.example.com/data")',
    notes: 'Payload is signed with the session ECDSA key. The destination receives a JSON body with the processed data.'
  },
  Receive: {
    description: 'Receive and validate incoming data from an external source.',
    requiredFields: {
      type: { type: 'string', fixed: 'Receive' },
      source: { type: 'string', description: 'Expected source origin for validation' }
    },
    optionalFields: {
      action: { type: 'string', description: 'The action to perform (e.g., "create")' }
    },
    example: 'ReceiveRequest(type: "Receive", source: "www.notability.com")',
    notes: 'Used for user-driven write access. Validates that the request comes from the declared source.'
  },
  Write: {
    description: 'Write or modify data on an OAuth resource server.',
    requiredFields: {
      type: { type: 'string', fixed: 'Write' },
      resourceType: { type: 'string', description: 'The OAuth resource to write to' },
      action: { type: 'string', description: 'The write action (e.g., "create", "update", "delete")' }
    },
    optionalFields: {},
    example: 'Upload(type: "Write", action: "create", resourceType: "google_drive")',
    notes: 'The Write operator performs a sanity check: if the parent ID does not match, no action is executed.'
  },
  Limit: {
    description: 'Limit the number of items in the data array.',
    requiredFields: {
      type: { type: 'string', fixed: 'Limit' },
      count: { type: 'number', description: 'Maximum number of items to keep' }
    },
    optionalFields: {},
    example: 'LimitResults(type: "Limit", count: 10)',
    notes: 'Returns the first N items from the array.'
  },
  Sort: {
    description: 'Sort data items by a specified field.',
    requiredFields: {
      type: { type: 'string', fixed: 'Sort' },
      sortKey: { type: 'string', description: 'Field to sort by (supports dot notation)' }
    },
    optionalFields: {
      order: { type: 'string', description: '"ascending" (default) or "descending"' }
    },
    example: 'SortByDate(type: "Sort", sortKey: "start.dateTime", order: "ascending")',
    notes: 'Supports dot notation for nested sort keys.'
  },
  Aggregate: {
    description: 'Compute aggregate statistics over the data.',
    requiredFields: {
      type: { type: 'string', fixed: 'Aggregate' },
      operation: { type: 'string', description: 'Aggregation operation: count, sum, or average' }
    },
    optionalFields: {
      field: { type: 'string', description: 'Field to aggregate (required for sum/average)' }
    },
    example: 'CountResponses(type: "Aggregate", operation: "count")',
    notes: 'count returns the number of items. sum/average require a numeric field.'
  },
  Map: {
    description: 'Transform individual data items by applying a mapping function.',
    requiredFields: {
      type: { type: 'string', fixed: 'Map' },
      field: { type: 'string', description: 'Field to map over' }
    },
    optionalFields: {
      transform: { type: 'string', description: 'Transformation to apply' }
    },
    example: 'MapDates(type: "Map", field: "birthDate", transform: "toAge")',
    notes: 'Converts each item\'s field value according to the specified transformation.'
  },
  Transform: {
    description: 'Apply a transformation to derive new fields or reshape data.',
    requiredFields: {
      type: { type: 'string', fixed: 'Transform' },
      field: { type: 'string|array', description: 'Field(s) to transform' }
    },
    optionalFields: {
      operation: { type: 'string', description: 'Transformation operation' }
    },
    example: 'TransformData(type: "Transform", field: "rawDate", operation: "parseDate")',
    notes: 'Processes data to produce derived or aggregated results.'
  },
  Anonymize: {
    description: 'Anonymize sensitive data fields to enhance privacy.',
    requiredFields: {
      type: { type: 'string', fixed: 'Anonymize' },
      field: { type: 'string|array', description: 'Field(s) to anonymize' }
    },
    optionalFields: {
      method: { type: 'string', description: 'Anonymization method (e.g., "hash", "noise")' }
    },
    example: 'AnonymizeEmail(type: "Anonymize", field: "email", method: "hash")',
    notes: 'Modifies data to protect PII, e.g., hashing emails or adding noise to ages.'
  },
  Mock: {
    description: 'Inject custom JSON data into the pipeline for testing. Use instead of Pull to test operators without a live Google API connection.',
    requiredFields: {
      type: { type: 'string', fixed: 'Mock' }
    },
    optionalFields: {},
    example: 'MockInput(type: "Mock")',
    notes: 'Place at the start of the pipeline instead of Pull. Paste your test JSON in the Mock Data panel on the right side of the IDE.'
  },
  Debug: {
    description: 'Output a snapshot of intermediary pipeline data for debugging. Does NOT modify data.',
    requiredFields: {
      type: { type: 'string', fixed: 'Debug' }
    },
    optionalFields: {
      label: { type: 'string', description: 'A label to identify this debug point' }
    },
    example: 'DebugAfterFilter(type: "Debug", label: "after filtering flights")',
    notes: 'Insert between pipeline steps to inspect data at that point. Only active when running in debug mode.'
  }
};

export const RESOURCE_TYPES = ['google_calendar', 'gmail', 'google_drive', 'google_forms'];

export const FILTER_OPERATIONS = ['==', '!=', '>', '>=', '<', '<=', 'include', 'not include', 'match'];

export const AGGREGATE_OPERATIONS = ['count', 'sum', 'average'];

export const SORT_ORDERS = ['ascending', 'descending'];

export const HEADER_KEYWORDS = ['TITLE', 'DESCRIPTION', 'PIPELINE'];

export const ALL_FIELD_NAMES = [
  'type', 'resourceType', 'query', 'field', 'operation',
  'targetValue', 'pattern', 'requirement', 'destination',
  'source', 'action', 'count', 'sortKey', 'order',
  'label', 'method', 'transform', 'mimeType'
];

export const SPECIAL_VALUES = ['NOW', 'true', 'false', 'null'];
