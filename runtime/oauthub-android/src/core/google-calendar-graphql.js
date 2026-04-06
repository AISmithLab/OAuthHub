import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList,
         GraphQLInt, GraphQLBoolean } from 'graphql';

const CreatorType = new GraphQLObjectType({
  name: 'Creator',
  fields: {
    id: { type: GraphQLString },
    email: { type: GraphQLString },
    displayName: { type: GraphQLString },
    self: { type: GraphQLBoolean }
  }
});

const OrganizerType = new GraphQLObjectType({
  name: 'Organizer',
  fields: {
    id: { type: GraphQLString },
    email: { type: GraphQLString },
    displayName: { type: GraphQLString },
    self: { type: GraphQLBoolean }
  }
});

const DateTimeType = new GraphQLObjectType({
  name: 'DateTime',
  fields: {
    date: { type: GraphQLString },
    dateTime: { type: GraphQLString },
    timeZone: { type: GraphQLString }
  }
});

const AttendeeType = new GraphQLObjectType({
  name: 'Attendee',
  fields: {
    id: { type: GraphQLString },
    email: { type: GraphQLString },
    displayName: { type: GraphQLString },
    organizer: { type: GraphQLBoolean },
    self: { type: GraphQLBoolean },
    resource: { type: GraphQLBoolean },
    optional: { type: GraphQLBoolean },
    responseStatus: { type: GraphQLString },
    comment: { type: GraphQLString },
    additionalGuests: { type: GraphQLInt }
  }
});

const ConferenceSolutionKeyType = new GraphQLObjectType({
  name: 'ConferenceSolutionKey',
  fields: { type: { type: GraphQLString } }
});

const ConferenceStatusType = new GraphQLObjectType({
  name: 'ConferenceStatus',
  fields: { statusCode: { type: GraphQLString } }
});

const CreateRequestType = new GraphQLObjectType({
  name: 'CreateRequest',
  fields: {
    requestId: { type: GraphQLString },
    conferenceSolutionKey: { type: ConferenceSolutionKeyType },
    status: { type: ConferenceStatusType }
  }
});

const EntryPointType = new GraphQLObjectType({
  name: 'EntryPoint',
  fields: {
    entryPointType: { type: GraphQLString },
    uri: { type: GraphQLString },
    label: { type: GraphQLString },
    pin: { type: GraphQLString },
    accessCode: { type: GraphQLString },
    meetingCode: { type: GraphQLString },
    passcode: { type: GraphQLString },
    password: { type: GraphQLString }
  }
});

const ConferenceSolutionType = new GraphQLObjectType({
  name: 'ConferenceSolution',
  fields: {
    key: { type: ConferenceSolutionKeyType },
    name: { type: GraphQLString },
    iconUri: { type: GraphQLString }
  }
});

const ConferenceDataType = new GraphQLObjectType({
  name: 'ConferenceData',
  fields: {
    createRequest: { type: CreateRequestType },
    entryPoints: { type: new GraphQLList(EntryPointType) },
    conferenceSolution: { type: ConferenceSolutionType },
    conferenceId: { type: GraphQLString },
    signature: { type: GraphQLString },
    notes: { type: GraphQLString }
  }
});

const RemindersType = new GraphQLObjectType({
  name: 'Reminders',
  fields: {
    useDefault: { type: GraphQLBoolean },
    overrides: { type: new GraphQLList(new GraphQLObjectType({
      name: 'ReminderOverride',
      fields: {
        method: { type: GraphQLString },
        minutes: { type: GraphQLInt }
      }
    }))}
  }
});

const EventType = new GraphQLObjectType({
  name: 'Event',
  fields: {
    kind: { type: GraphQLString },
    etag: { type: GraphQLString },
    id: { type: GraphQLString },
    status: { type: GraphQLString },
    htmlLink: { type: GraphQLString },
    created: { type: GraphQLString },
    updated: { type: GraphQLString },
    summary: { type: GraphQLString },
    description: { type: GraphQLString },
    location: { type: GraphQLString },
    colorId: { type: GraphQLString },
    creator: { type: CreatorType },
    organizer: { type: OrganizerType },
    start: { type: DateTimeType },
    end: { type: DateTimeType },
    endTimeUnspecified: { type: GraphQLBoolean },
    recurrence: { type: new GraphQLList(GraphQLString) },
    recurringEventId: { type: GraphQLString },
    originalStartTime: { type: DateTimeType },
    transparency: { type: GraphQLString },
    visibility: { type: GraphQLString },
    iCalUID: { type: GraphQLString },
    sequence: { type: GraphQLInt },
    attendees: { type: new GraphQLList(AttendeeType) },
    attendeesOmitted: { type: GraphQLBoolean },
    hangoutLink: { type: GraphQLString },
    conferenceData: { type: ConferenceDataType },
    anyoneCanAddSelf: { type: GraphQLBoolean },
    guestsCanInviteOthers: { type: GraphQLBoolean },
    guestsCanModify: { type: GraphQLBoolean },
    guestsCanSeeOtherGuests: { type: GraphQLBoolean },
    privateCopy: { type: GraphQLBoolean },
    locked: { type: GraphQLBoolean },
    reminders: { type: RemindersType },
    eventType: { type: GraphQLString }
  }
});

const QueryType = new GraphQLObjectType({
  name: 'Query',
  fields: {
    events: {
      type: new GraphQLList(EventType),
      args: {
        calendarId: { type: GraphQLString }
      },
      resolve: async (_, { calendarId }, context) => {
        if (!context.accessToken) throw new Error('Missing access token');
        const token = context.accessToken;
        const now = new Date().toISOString();
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events?maxResults=50&timeMin=${encodeURIComponent(now)}&singleEvents=true&orderBy=startTime`;

        const response = await fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(`Calendar API error: ${response.status}`);
        }

        const data = await response.json();
        return data.items || [];
      }
    }
  }
});

export const calendarSchema = new GraphQLSchema({ query: QueryType });

export const EventDetails = `
fragment EventDetails on Event {
  kind
  etag
  id
  status
  htmlLink
  created
  updated
  summary
  description
  location
  colorId
  creator { id email displayName self }
  organizer { id email displayName self }
  start { date dateTime timeZone }
  end { date dateTime timeZone }
  endTimeUnspecified
  recurrence
  recurringEventId
  originalStartTime { date dateTime timeZone }
  transparency
  visibility
  iCalUID
  sequence
  attendees { id email displayName organizer self resource optional responseStatus comment additionalGuests }
  attendeesOmitted
  hangoutLink
  conferenceData {
    createRequest { requestId conferenceSolutionKey { type } status { statusCode } }
    entryPoints { entryPointType uri label pin accessCode meetingCode passcode password }
    conferenceSolution { key { type } name iconUri }
    conferenceId signature notes
  }
  anyoneCanAddSelf
  guestsCanInviteOthers
  guestsCanModify
  guestsCanSeeOtherGuests
  privateCopy
  locked
  reminders { useDefault overrides { method minutes } }
  eventType
}`;
