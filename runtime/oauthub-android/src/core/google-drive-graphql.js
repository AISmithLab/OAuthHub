import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, GraphQLInt } from 'graphql';

const DriveOwnerType = new GraphQLObjectType({
  name: 'DriveOwner',
  fields: {
    displayName: { type: GraphQLString },
    emailAddress: { type: GraphQLString }
  }
});

const DriveFileType = new GraphQLObjectType({
  name: 'DriveFile',
  fields: {
    id: { type: GraphQLString },
    name: { type: GraphQLString },
    mimeType: { type: GraphQLString },
    modifiedTime: { type: GraphQLString },
    createdTime: { type: GraphQLString },
    size: { type: GraphQLString },
    webViewLink: { type: GraphQLString },
    iconLink: { type: GraphQLString },
    parents: { type: new GraphQLList(GraphQLString) },
    owners: { type: new GraphQLList(DriveOwnerType) },
    starred: { type: GraphQLString },
    trashed: { type: GraphQLString }
  }
});

async function resolveDriveParentNames(files, token) {
  const parentIds = [...new Set(
    files.flatMap(file => Array.isArray(file.parents) ? file.parents : [])
  )];
  if (parentIds.length === 0) return {};

  const entries = await Promise.all(parentIds.map(async (parentId) => {
    try {
      const response = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parentId)}?fields=id,name`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      if (!response.ok) return [parentId, parentId];
      const data = await response.json();
      return [parentId, data.name || parentId];
    } catch { return [parentId, parentId]; }
  }));

  return Object.fromEntries(entries);
}

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    files: {
      type: new GraphQLList(DriveFileType),
      args: {
        query: { type: GraphQLString },
        pageSize: { type: GraphQLInt }
      },
      resolve: async (_, { query, pageSize }, context) => {
        if (!context.accessToken) throw new Error('Missing access token');
        const token = context.accessToken;
        const size = Math.min(pageSize || 50, 100);
        const driveUrl = new URL('https://www.googleapis.com/drive/v3/files');
        driveUrl.searchParams.set('pageSize', String(size));
        driveUrl.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,createdTime,size,webViewLink,iconLink,parents,owners,starred,trashed)');
        driveUrl.searchParams.set('q', query || 'trashed = false');

        const response = await fetch(driveUrl.toString(), {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
          throw new Error(`Drive API error: ${response.status}`);
        }

        const data = await response.json();
        const files = Array.isArray(data.files) ? data.files : [];

        const parentNames = await resolveDriveParentNames(files, token);
        return files.map(file => ({
          ...file,
          parents: Array.isArray(file.parents)
            ? file.parents.map(id => parentNames[id] || id)
            : []
        }));
      }
    }
  }
});

export const driveSchema = new GraphQLSchema({ query: QueryType });
