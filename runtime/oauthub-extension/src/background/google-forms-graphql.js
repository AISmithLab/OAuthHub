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
      resolve: async (_, { formId }) => {
        try {
          const response = await fetch('./data.json');
          const data = await response.json();
          const responses = data.google_forms?.responses || [];

          return responses.map(response => ({
            responseId: response.responseId || '',
            createTime: response.createTime || '',
            lastSubmittedTime: response.lastSubmittedTime || '',
            respondentEmail: response.respondentEmail || '',
            answers: JSON.stringify(response.answers || []),
            totalScore: response.totalScore || 0
          }));
        } catch (error) {
          console.error('Error fetching form responses:', error);
          return [];
        }
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
