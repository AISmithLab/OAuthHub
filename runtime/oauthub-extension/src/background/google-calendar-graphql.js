import { GraphQLSchema, GraphQLObjectType, GraphQLString, GraphQLList, 
         GraphQLInt, GraphQLBoolean, GraphQLFloat } from 'graphql';

// Basic types
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

// Conference related types
const ConferenceSolutionKeyType = new GraphQLObjectType({
  name: 'ConferenceSolutionKey',
  fields: {
    type: { type: GraphQLString }
  }
});

const ConferenceStatusType = new GraphQLObjectType({
  name: 'ConferenceStatus',
  fields: {
    statusCode: { type: GraphQLString }
  }
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

// Location related types
const CustomLocationType = new GraphQLObjectType({
  name: 'CustomLocation',
  fields: {
    label: { type: GraphQLString }
  }
});

const OfficeLocationType = new GraphQLObjectType({
  name: 'OfficeLocation',
  fields: {
    buildingId: { type: GraphQLString },
    floorId: { type: GraphQLString },
    floorSectionId: { type: GraphQLString },
    deskId: { type: GraphQLString },
    label: { type: GraphQLString }
  }
});

const WorkingLocationPropertiesType = new GraphQLObjectType({
  name: 'WorkingLocationProperties',
  fields: {
    type: { type: GraphQLString },
    homeOffice: { type: GraphQLString }, // Changed from JSONString to String for simplicity
    customLocation: { type: CustomLocationType },
    officeLocation: { type: OfficeLocationType }
  }
});

// Other event-related types
const ExtendedPropertiesType = new GraphQLObjectType({
  name: 'ExtendedProperties',
  fields: {
    private: { type: GraphQLString }, // Changed from JSONString to String for simplicity
    shared: { type: GraphQLString }
  }
});

const GadgetType = new GraphQLObjectType({
  name: 'Gadget',
  fields: {
    type: { type: GraphQLString },
    title: { type: GraphQLString },
    link: { type: GraphQLString },
    iconLink: { type: GraphQLString },
    width: { type: GraphQLInt },
    height: { type: GraphQLInt },
    display: { type: GraphQLString },
    preferences: { type: GraphQLString } // Changed from JSONString to String for simplicity
  }
});

const ReminderOverrideType = new GraphQLObjectType({
  name: 'ReminderOverride',
  fields: {
    method: { type: GraphQLString },
    minutes: { type: GraphQLInt }
  }
});

const RemindersType = new GraphQLObjectType({
  name: 'Reminders',
  fields: {
    useDefault: { type: GraphQLBoolean },
    overrides: { type: new GraphQLList(ReminderOverrideType) }
  }
});

const SourceType = new GraphQLObjectType({
  name: 'Source',
  fields: {
    url: { type: GraphQLString },
    title: { type: GraphQLString }
  }
});

const OutOfOfficePropertiesType = new GraphQLObjectType({
  name: 'OutOfOfficeProperties',
  fields: {
    autoDeclineMode: { type: GraphQLString },
    declineMessage: { type: GraphQLString }
  }
});

const FocusTimePropertiesType = new GraphQLObjectType({
  name: 'FocusTimeProperties',
  fields: {
    autoDeclineMode: { type: GraphQLString },
    declineMessage: { type: GraphQLString },
    chatStatus: { type: GraphQLString }
  }
});

const AttachmentType = new GraphQLObjectType({
  name: 'Attachment',
  fields: {
    fileUrl: { type: GraphQLString },
    title: { type: GraphQLString },
    mimeType: { type: GraphQLString },
    iconLink: { type: GraphQLString },
    fileId: { type: GraphQLString }
  }
});

// Main Event type
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
    extendedProperties: { type: ExtendedPropertiesType },
    hangoutLink: { type: GraphQLString },
    conferenceData: { type: ConferenceDataType },
    gadget: { type: GadgetType },
    anyoneCanAddSelf: { type: GraphQLBoolean },
    guestsCanInviteOthers: { type: GraphQLBoolean },
    guestsCanModify: { type: GraphQLBoolean },
    guestsCanSeeOtherGuests: { type: GraphQLBoolean },
    privateCopy: { type: GraphQLBoolean },
    locked: { type: GraphQLBoolean },
    reminders: { type: RemindersType },
    source: { type: SourceType },
    workingLocationProperties: { type: WorkingLocationPropertiesType },
    outOfOfficeProperties: { type: OutOfOfficePropertiesType },
    focusTimeProperties: { type: FocusTimePropertiesType },
    attachments: { type: new GraphQLList(AttachmentType) },
    eventType: { type: GraphQLString }
  }
});

// Helper functions to convert JSON to typed objects
const jsonToEventHelper = {
  creator: (json) => ({
    id: json.id || '',
    email: json.email || '',
    displayName: json.displayName || '',
    self: json.self || false
  }),

  dateTime: (json) => ({
    date: json.date || '',
    dateTime: json.dateTime || null,
    timeZone: json.timeZone || ''
  }),

  // Add other helper functions as needed...
};

// Query type
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
          console.error(`Calendar API error: ${response.status}`, body);
          throw new Error(`Calendar API error: ${response.status}`);
        }

        const data = await response.json();
        return data.items || [];
      }
    }
  }
});

// Create and export the schema
export const calendarSchema = new GraphQLSchema({
  query: QueryType
});

// Export the event details fragment
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
  creator {
    id
    email
    displayName
    self
  }
  organizer {
    id
    email
    displayName
    self
  }
  start {
    date
    dateTime
    timeZone
  }
  end {
    date
    dateTime
    timeZone
  }
  endTimeUnspecified
  recurrence
  recurringEventId
  originalStartTime {
    date
    dateTime
    timeZone
  }
  transparency
  visibility
  iCalUID
  sequence
  attendees {
    id
    email
    displayName
    organizer
    self
    resource
    optional
    responseStatus
    comment
    additionalGuests
  }
  attendeesOmitted
  extendedProperties {
    private
    shared
  }
  hangoutLink
  conferenceData {
    createRequest {
      requestId
      conferenceSolutionKey {
        type
      }
      status {
        statusCode
      }
    }
    entryPoints {
      entryPointType
      uri
      label
      pin
      accessCode
      meetingCode
      passcode
      password
    }
    conferenceSolution {
      key {
        type
      }
      name
      iconUri
    }
    conferenceId
    signature
    notes
  }
  gadget {
    type
    title
    link
    iconLink
    width
    height
    display
    preferences
  }
  anyoneCanAddSelf
  guestsCanInviteOthers
  guestsCanModify
  guestsCanSeeOtherGuests
  privateCopy
  locked
  reminders {
    useDefault
    overrides {
      method
      minutes
    }
  }
  source {
    url
    title
  }
  workingLocationProperties {
    type
    homeOffice
    customLocation {
      label
    }
    officeLocation {
      buildingId
      floorId
      floorSectionId
      deskId
      label
    }
  }
  outOfOfficeProperties {
    autoDeclineMode
    declineMessage
  }
  focusTimeProperties {
    autoDeclineMode
    declineMessage
    chatStatus
  }
  attachments {
    fileUrl
    title
    mimeType
    iconLink
    fileId
  }
  eventType
}`;

