import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, GraphQLFloat } from 'graphql';

// Define the FormResponse type
const FormResponseType = new GraphQLObjectType({
  name: 'FormResponse',
  fields: {
    responseId: { type: GraphQLString },
    createTime: { type: GraphQLString },
    lastSubmittedTime: { type: GraphQLString },
    respondentEmail: { type: GraphQLString },
    answers: { type: GraphQLString }, // Using String instead of JSONString for simplicity
    totalScore: { type: GraphQLFloat }
  }
});

// Define the Query type
const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    responses: {
      type: new GraphQLList(FormResponseType),
      args: {
        formId: { type: GraphQLString }
      },
      resolve: async (_, { formId }, context) => {
        if (!formId) {
          throw new Error('formId argument is required');
        }
        if (!context.accessToken) throw new Error('Missing access token');
        const token = context.accessToken;
        const url = `https://forms.googleapis.com/v1/forms/${encodeURIComponent(formId)}/responses`;

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
          const body = await response.text();
          console.error(`Forms API error: ${response.status}`, body);
          throw new Error(`Forms API error: ${response.status}`);
        }

        const data = await response.json();
        return (data.responses || []).map(r => ({
          ...r,
          answers: r.answers ? JSON.stringify(r.answers) : null
        }));
      }
    }
  }
});

// Create and export the schema
export const formsSchema = new GraphQLSchema({
  query: QueryType
});

// Export the form response details fragment
export const FormResponseDetails = `
fragment FormResponseDetails on FormResponse {
  responseId
  createTime
  lastSubmittedTime
  respondentEmail
  answers
  totalScore
}`;
