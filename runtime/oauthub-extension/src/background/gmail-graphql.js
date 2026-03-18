import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, GraphQLInt } from 'graphql';

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
    raw: { type: GraphQLString }
  }
});

// Helper function to process message parts
function processPart(part) {
  return {
    partId: part.partId || '',
    mimeType: part.mimeType || '',
    filename: part.filename || '',
    headers: (part.headers || []).map(h => ({
      name: h.name,
      value: h.value
    })),
    body: {
      size: part.body?.size || 0,
      data: part.body?.data || ''
    },
    parts: part.parts ? part.parts.map(p => processPart(p)) : []
  };
}

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
      resolve: async (_, { userId }) => {
        try {
          const response = await fetch('./data.json');
          const data = await response.json();
          const messages = data.gmail;

          return messages.map(msg => ({
            id: msg.id || '',
            threadId: msg.threadId || '',
            labelIds: msg.labelIds || [],
            snippet: msg.snippet || '',
            historyId: msg.historyId || '',
            internalDate: msg.internalDate || '',
            payload: processPart(msg.payload || {}),
            sizeEstimate: msg.sizeEstimate || 0,
            raw: msg.raw || ''
          }));
        } catch (error) {
          console.error('Error fetching messages:', error);
          return [];
        }
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
