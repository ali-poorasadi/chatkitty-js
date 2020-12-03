import { BehaviorSubject } from 'rxjs';

import { environment } from '../environments/environment';

import { ChatKittyConfiguration } from './chatkitty.configuration';
import { UnknownChatKittyError } from './chatkitty.error';
import { ChatkittyObserver } from './chatkitty.observer';
import { ChatKittyPaginator } from './chatkitty.paginator';
import { ChatKittyUnsubscribe } from './chatkitty.unsubscribe';
import { Channel } from './model/channel/channel.model';
import { CreateChannelRequest } from './model/channel/create/channel.create.request';
import {
  CreateChannelResult,
  CreatedChannelResult,
} from './model/channel/create/channel.create.result';
import {
  GetChannelResult,
  GetChannelsResult,
} from './model/channel/get/channel.get.result';
import { ChannelNotPubliclyJoinableChatKittyError } from './model/channel/join/channel.join.error';
import { JoinChannelRequest } from './model/channel/join/channel.join.request';
import {
  JoinChannelResult,
  JoinedChannelResult,
} from './model/channel/join/channel.join.result';
import { ChatSession } from './model/chat-session/chat-session.model';
import { NoActiveChatSessionChatKittyError } from './model/chat-session/start/chat-session.start.error';
import { StartChatSessionRequest } from './model/chat-session/start/chat-session.start.request';
import {
  StartChatSessionResult,
  StartedChatSessionResult,
} from './model/chat-session/start/chat-session.start.result';
import { CurrentUser } from './model/current-user/current-user.model';
import { GetCurrentUserResult } from './model/current-user/get/current-user.get.result';
import {
  UpdateCurrentUserResult,
  UpdatedCurrentUserResult,
} from './model/current-user/update/current-user.update.result';
import { GetMessagesRequest } from './model/message/get/message.get.request';
import { GetMessagesResult } from './model/message/get/message.get.result';
import MessageMapper from './model/message/message.mapper';
import {
  FileUserMessage,
  Message,
  TextUserMessage,
} from './model/message/message.model';
import {
  sendChannelFileMessage,
  sendChannelTextMessage,
  SendMessageRequest,
} from './model/message/send/message.send.request';
import {
  SendMessageResult,
  SentFileMessageResult,
  SentTextMessageResult,
} from './model/message/send/message.send.result';
import { Notification } from './model/notification/notification.model';
import {
  AccessDeniedSessionError,
  NoActiveSessionChatKittyError,
} from './model/session/start/session.error';
import { StartSessionRequest } from './model/session/start/session.start.request';
import {
  AccessDeniedSessionResult,
  StartedSessionResult,
  StartSessionResult,
} from './model/session/start/session.start.result';
import { StompXClient } from './stompx/stompx.client';

export default class ChatKitty {
  private static readonly _instances = new Map<string, ChatKitty>();

  private static readonly currentUserRelay = '/application/v1/users/me.relay';

  public static getInstance(apiKey: string): ChatKitty {
    let instance = ChatKitty._instances.get(apiKey);

    if (instance !== undefined) {
      return instance;
    }

    instance = new ChatKitty({ apiKey: apiKey });

    ChatKitty._instances.set(apiKey, instance);

    return instance;
  }

  private static channelRelay(id: number): string {
    return '/application/v1/channels/' + id + '.relay';
  }

  private readonly client: StompXClient;

  private readonly currentUserNextSubject = new BehaviorSubject<CurrentUser | null>(
    null
  );

  private currentUser: CurrentUser | undefined;
  private writeFileGrant: string | undefined;
  private chatSessions: Map<number, ChatSession> = new Map();

  private messageMapper: MessageMapper = new MessageMapper('');

  public constructor(private readonly configuration: ChatKittyConfiguration) {
    this.client = new StompXClient({
      isSecure: configuration.isSecure === undefined || configuration.isSecure,
      host: configuration.host || 'api.chatkitty.com',
      isDebug: !environment.production,
    });
  }

  public startSession(
    request: StartSessionRequest
  ): Promise<StartSessionResult> {
    return new Promise((resolve) => {
      this.client.connect({
        apiKey: this.configuration.apiKey,
        username: request.username,
        authParams: request.authParams,
        onSuccess: () => {
          this.client.relayResource<CurrentUser>({
            destination: ChatKitty.currentUserRelay,
            onSuccess: (user) => {
              this.currentUser = user;

              this.client.listenToTopic({ topic: user._topics.channels });
              this.client.listenToTopic({ topic: user._topics.notifications });

              this.currentUserNextSubject.next(user);

              this.client.relayResource<{ grant: string }>({
                destination: user._relays.writeFileAccessGrant,
                onSuccess: (grant) => {
                  this.writeFileGrant = grant.grant;
                },
              });

              this.client.relayResource<{ grant: string }>({
                destination: user._relays.readFileAccessGrant,
                onSuccess: (grant) => {
                  this.messageMapper = new MessageMapper(grant.grant);
                },
              });

              resolve(new StartedSessionResult({ user: user }));
            },
          });
        },
        onError: (error) => {
          if (error.error === 'AccessDeniedError') {
            resolve(
              new AccessDeniedSessionResult(new AccessDeniedSessionError())
            );
          } else {
            resolve(new AccessDeniedSessionResult(new UnknownChatKittyError()));
          }
        },
      });
    });
  }

  public endSession() {
    this.client.disconnect({
      onSuccess: () => {
        this.currentUserNextSubject.next(null);
      },
    });
  }

  public getCurrentUser(): Promise<GetCurrentUserResult> {
    return new Promise((resolve) => {
      this.client.relayResource<CurrentUser>({
        destination: ChatKitty.currentUserRelay,
        onSuccess: (user) => {
          resolve(new GetCurrentUserResult(user));
        },
      });
    });
  }

  public onCurrentUserChanged(
    onNextOrObserver:
      | ChatkittyObserver<CurrentUser | null>
      | ((user: CurrentUser | null) => void)
  ): ChatKittyUnsubscribe {
    const subscription = this.currentUserNextSubject.subscribe((user) => {
      if (typeof onNextOrObserver === 'function') {
        onNextOrObserver(user);
      } else {
        onNextOrObserver.onNext(user);
      }
    });

    return () => subscription.unsubscribe();
  }

  public updateCurrentUser(
    update: (user: CurrentUser) => CurrentUser
  ): Promise<UpdateCurrentUserResult> {
    return new Promise((resolve, reject) => {
      if (this.currentUser === undefined) {
        reject(new NoActiveSessionChatKittyError());
      } else {
        this.client.performAction<CurrentUser>({
          destination: this.currentUser._actions.update,
          body: update(this.currentUser),
          onSuccess: (user) => {
            this.currentUserNextSubject.next(user);

            resolve(new UpdatedCurrentUserResult(user));
          },
        });
      }
    });
  }

  public createChannel(
    request: CreateChannelRequest
  ): Promise<CreateChannelResult> {
    return new Promise((resolve, reject) => {
      if (this.currentUser === undefined) {
        reject(new NoActiveSessionChatKittyError());
      } else {
        this.client.performAction<Channel>({
          destination: this.currentUser._actions.createChannel,
          body: {
            type: request.type,
            name: request.name,
          },
          onSuccess: (channel) => {
            resolve(new CreatedChannelResult(channel));
          },
        });
      }
    });
  }

  public getChannels(): Promise<GetChannelsResult> {
    return new Promise((resolve, reject) => {
      if (this.currentUser === undefined) {
        reject(new NoActiveSessionChatKittyError());
      } else {
        ChatKittyPaginator.createInstance<Channel>(
          this.client,
          this.currentUser._relays.channels,
          'channels'
        ).then((paginator) => resolve(new GetChannelsResult(paginator)));
      }
    });
  }

  public getJoinableChannels(): Promise<GetChannelsResult> {
    return new Promise((resolve, reject) => {
      if (this.currentUser === undefined) {
        reject(new NoActiveSessionChatKittyError());
      } else {
        ChatKittyPaginator.createInstance<Channel>(
          this.client,
          this.currentUser._relays.joinableChannels,
          'channels'
        ).then((paginator) => resolve(new GetChannelsResult(paginator)));
      }
    });
  }

  public getChannel(id: number): Promise<GetChannelResult> {
    return new Promise((resolve) => {
      this.client.relayResource<Channel>({
        destination: ChatKitty.channelRelay(id),
        onSuccess: (channel) => {
          resolve(new GetChannelResult(channel));
        },
      });
    });
  }

  public joinChannel(request: JoinChannelRequest): Promise<JoinChannelResult> {
    return new Promise((resolve, reject) => {
      if (this.currentUser === undefined) {
        reject(new NoActiveSessionChatKittyError());
      } else {
        if (request.channel._actions.join) {
          this.client.performAction<Channel>({
            destination: request.channel._actions.join,
            body: request,
            onSuccess: (channel) => {
              resolve(new JoinedChannelResult(channel));
            },
          });
        } else {
          reject(new ChannelNotPubliclyJoinableChatKittyError(request.channel));
        }
      }
    });
  }

  public startChatSession(
    request: StartChatSessionRequest
  ): StartChatSessionResult {
    let unsubscribe: () => void;

    let receivedMessageUnsubscribe: () => void;

    const onReceivedMessage = request.onReceivedMessage;

    if (onReceivedMessage) {
      receivedMessageUnsubscribe = this.client.listenForEvent<Message>({
        topic: request.channel._topics.messages,
        event: 'thread.message.created',
        onSuccess: (message) => {
          onReceivedMessage(this.messageMapper.map(message));
        },
      });
    }

    const channelUnsubscribe = this.client.listenToTopic({
      topic: request.channel._topics.self,
      callback: () => {
        const messagesUnsubscribe = this.client.listenToTopic({
          topic: request.channel._topics.messages,
        });

        unsubscribe = () => {
          if (receivedMessageUnsubscribe) {
            receivedMessageUnsubscribe();
          }

          if (messagesUnsubscribe) {
            messagesUnsubscribe();
          }

          channelUnsubscribe();

          this.chatSessions.delete(request.channel.id);
        };
      },
    });

    const session = {
      channel: request.channel,
      end: () => {
        if (unsubscribe) {
          unsubscribe();
        }
      },
    };

    this.chatSessions.set(request.channel.id, session);

    return new StartedChatSessionResult(session);
  }

  public endChatSession(session: ChatSession) {
    session.end();
  }

  public sendMessage(request: SendMessageRequest): Promise<SendMessageResult> {
    return new Promise((resolve, reject) => {
      if (!this.chatSessions.has(request.channel.id)) {
        reject(new NoActiveChatSessionChatKittyError(request.channel));
      } else {
        if (sendChannelTextMessage(request)) {
          this.client.performAction<TextUserMessage>({
            destination: request.channel._actions.message,
            body: {
              type: 'TEXT',
              body: request.body,
            },
            onSuccess: (message) => {
              resolve(
                new SentTextMessageResult(this.messageMapper.map(message))
              );
            },
          });
        }

        if (sendChannelFileMessage(request)) {
          this.client.sendToStream<FileUserMessage>({
            stream: request.channel._streams.messages,
            grant: <string>this.writeFileGrant,
            blob: request.file,
            onSuccess: (message) => {
              resolve(
                new SentFileMessageResult(this.messageMapper.map(message))
              );
            },
          });
        }
      }
    });
  }

  public getMessages(request: GetMessagesRequest): Promise<GetMessagesResult> {
    return new Promise((resolve, reject) => {
      if (!this.chatSessions.has(request.channel.id)) {
        reject(new NoActiveChatSessionChatKittyError(request.channel));
      } else {
        ChatKittyPaginator.createInstance<Message>(
          this.client,
          request.channel._relays.messages,
          'messages',
          (message) => this.messageMapper.map(message)
        ).then((paginator) => resolve(new GetMessagesResult(paginator)));
      }
    });
  }

  public onNotificationReceived(
    onNextOrObserver:
      | ChatkittyObserver<Notification>
      | ((notification: Notification) => void)
  ): ChatKittyUnsubscribe {
    if (this.currentUser === undefined) {
      throw new NoActiveSessionChatKittyError();
    }

    const unsubscribe = this.client.listenForEvent<Notification>({
      topic: this.currentUser._topics.notifications,
      event: 'me.notification.created',
      onSuccess: (notification) => {
        if (typeof onNextOrObserver === 'function') {
          onNextOrObserver(notification);
        } else {
          onNextOrObserver.onNext(notification);
        }
      },
    });

    return () => unsubscribe;
  }
}
