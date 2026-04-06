import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, GraphQLInt } from 'graphql';

// ─── Gmail body extraction helpers ─────────────────────────
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
    } catch { return ''; }
  }
}

function extractGmailBody(payload) {
  if (!payload) return '';
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  for (const part of parts) {
    if ((part?.mimeType || '').startsWith('text/plain') && part?.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  for (const part of parts) {
    const nestedBody = extractGmailBody(part);
    if (nestedBody) return nestedBody;
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return '';
}

// Define the MessageHeader type
const MessageHeaderType = new GraphQLObjectType({
  name: 'MessageHeader',
  fields: {
    name: { type: GraphQLString },
    value: { type: GraphQLString }
  }
});

// Define the MessagePartBody type
const MessagePartBodyType = new GraphQLObjectType({
  name: 'MessagePartBody',
  fields: {
    size: { type: GraphQLInt },
    data: { type: GraphQLString }
  }
});

// Define the MessagePart type with recursive parts
const MessagePartType = new GraphQLObjectType({
  name: 'MessagePart',
  fields: () => ({
    partId: { type: GraphQLString },
    mimeType: { type: GraphQLString },
    filename: { type: GraphQLString },
    headers: { type: new GraphQLList(MessageHeaderType) },
    body: { type: MessagePartBodyType },
    parts: { type: new GraphQLList(MessagePartType) }
  })
});

// Define the Message type
const MessageType = new GraphQLObjectType({
  name: 'Message',
  fields: {
    id: { type: GraphQLString },
    threadId: { type: GraphQLString },
    labelIds: { type: new GraphQLList(GraphQLString) },
    snippet: { type: GraphQLString },
    historyId: { type: GraphQLString },
    internalDate: { type: GraphQLString },
    payload: { type: MessagePartType },
    sizeEstimate: { type: GraphQLInt },
    raw: { type: GraphQLString },
    body: {
      type: GraphQLString,
      resolve: (message) => extractGmailBody(message.payload)
    }
  }
});

// Define the Query type
const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    messages: {
      type: new GraphQLList(MessageType),
      args: {
        userId: { type: GraphQLString },
        query: { type: GraphQLString }
      },
      resolve: async (_, { userId, query }, context) => {
        if (!context.accessToken) throw new Error('Missing access token');
        const token = context.accessToken;
        const headers = { 'Authorization': `Bearer ${token}` };

        // List messages
        const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
        listUrl.searchParams.set('maxResults', '100');
        if (query) listUrl.searchParams.set('q', query);

        const listResponse = await fetch(listUrl.toString(), { headers });
        if (!listResponse.ok) {
          const body = await listResponse.text();
          console.error(`Gmail API error: ${listResponse.status}`, body);
          throw new Error(`Gmail API error: ${listResponse.status}`);
        }
        const { messages: messageRefs = [] } = await listResponse.json();
        if (messageRefs.length === 0) return [];

        // Fetch full message details
        const detailed = await Promise.all(messageRefs.map(async (ref) => {
          try {
            const r = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}?format=full`,
              { headers }
            );
            return r.ok ? await r.json() : null;
          } catch (e) { console.warn(`Failed to fetch message ${ref.id}:`, e.message); return null; }
        }));

        return detailed.filter(Boolean);
      }
    }
  }
});

// Create and export the schema
export const gmailSchema = new GraphQLSchema({
  query: QueryType
});

// Export the message details fragment
export const MessageDetails = `
fragment MessageDetails on Message {
  id
  threadId
  labelIds
  snippet
  historyId
  internalDate
  payload {
    partId
    mimeType
    filename
    headers {
      name
      value
    }
    body {
      size
      data
    }
    parts {
      partId
      mimeType
      filename
      headers {
        name
        value
      }
      body {
        size
        data
      }
    }
  }
  sizeEstimate
  raw
}`;

// Export the message part details fragment
export const MessagePartDetails = `
fragment MessagePartDetails on MessagePart {
  partId
  mimeType
  filename
  headers {
    name
    value
  }
  body {
    size
    data
  }
  parts {
    partId
    mimeType
    filename
    headers {
      name
      value
    }
    body {
      size
      data
    }
  }
}`;
