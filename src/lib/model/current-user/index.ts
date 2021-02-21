import { UserProperties } from '../user';

export declare class CurrentUser implements UserProperties {
  displayName: string;
  displayPictureUrl: string;
  id: number;
  isGuest: string;
  name: string;
  properties: unknown;
  _relays: CurrentUserRelays;
  _topics: CurrentUserTopics;
  _actions: CurrentUserActions;
}

export declare class CurrentUserRelays {
  self: string;
  readFileAccessGrant: string;
  writeFileAccessGrant: string;
  channels: string;
  joinableChannels: string;
  unreadChannelsCount: string;
  unreadChannels: string;
  contactsCount: string;
  contacts: string;
}

export declare class CurrentUserTopics {
  self: string;
  channels: string;
  notifications: string;
  contacts: string;
  participants: string;
}

export declare class CurrentUserActions {
  update: string;
  createChannel: string;
}
