# openclaw Feishu Plugin

[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.1-brightgreen.svg?style=flat-square)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Feishu%20%7C%20Lark-orange.svg?style=flat-square)](https://open.feishu.cn/)
[![openclaw](https://img.shields.io/badge/openclaw-Plugin-purple.svg?style=flat-square)](https://github.com/openclaw/openclaw)

[中文文档](./README.md)

Feishu/Lark channel plugin for [openclaw](https://github.com/openclaw/openclaw), supporting interaction with openclaw via Feishu (Lark).

## Features

- Supports receiving Feishu events via WebSocket persistent connection (Recommended).
- Supports receiving Feishu events via HTTP callback.
- **Supports Multi-account Configuration**, allowing connection to multiple Feishu bots simultaneously.
- Supports sending/editing/deleting messages.
- Supports message reactions.
- Supports pinning messages.
- Supports private (Direct) and group chats.
- Supports triggering via @Bot mentions.
- No official Feishu SDK required, zero external dependencies.

## Requirements

- Node.js >= 18.17.0 (Native WebSocket support required)
- openclaw

## Installation

### Install via openclaw CLI

```bash
openclaw plugins install https://github.com/baidan4855/openclaw-feishu-plugin
```

## Feishu App Configuration

### 1. Create Feishu App

1. Visit [Feishu Open Platform](https://open.feishu.cn/app).
2. Click "Create Custom App".
3. Fill in the app name and description.

### 2. Get Credentials

In the "Credentials & Basic Info" page of your app, get:

- **App ID**
- **App Secret**

### 3. Configure Permissions

Add the following permissions in the "Permissions Management" page:

| Permission Name | Permission Key | Usage |
| :--- | :--- | :--- |
| Obtain and send single and group messages | `im:message` | Send/Receive messages |
| Read private messages sent to bi-directional bot | `im:message.p2p_msg:readonly` | Receive DMs |
| Obtain group messages | `im:message.group_msg:readonly` | Receive Group msgs |
| Send messages as an app | `im:message:send_as_bot` | Send messages |
| Obtain user's basic information | `contact:user.base:readonly` | Get User Info |

### 4. Configure Event Subscription

In the "Events & Callbacks" page:

1. Select "Subscription Mode" as **Use Persistent Connection** (Recommended).
2. Add event: `im.message.receive_v1` (Receive messages).

> If you choose HTTP Callback mode, you need to configure a publicly accessible callback URL.

### 5. Publish App

After configuration, create a version and publish it in the "Version Management & Release" page.

## openclaw Configuration

After installing the plugin, you will see the Feishu channel in the **Channels** page of the openclaw console. Simply fill in the **App ID** and **App Secret** to complete the configuration.

> Other configuration items are optional. WebSocket persistent connection is used by default, requiring no public IP.

You can also manually configure it in openclaw's configuration file:

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxxxxxxxxx",
      "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxx"
      // "eventMode": "ws"  // ws (default) or http
    }
  }
}
```

### Configuration Options

| Option | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `appId` | string | Yes | Feishu App ID |
| `appSecret` | string | Yes | Feishu App Secret |
| `eventMode` | string | No | Event subscription mode: `ws` (default) or `http` |
| `verificationToken` | string | No | HTTP callback verification token |
| `encryptKey` | string | No | HTTP callback encryption key |
| `requireMention` | boolean | No | Whether the bot must be mentioned to reply (default: false for DM, true for Group) |
| `ignoreOtherMentions` | boolean | No | When `requireMention` is false, ignore messages where others are explicitly mentioned (default: true). <br/>Allows the bot to participate in chat without interrupting when others are addressed. |
| `baseUrl` | string | No | API Base URL, default `https://open.feishu.cn/open-apis` |

### Multi-account Configuration

The plugin supports configuring multiple Feishu accounts simultaneously, suitable for scenarios connecting multiple Feishu bots.

```json
{
  "channels": {
    "feishu": {
      // Multi-account configuration
      "accounts": {
        "bot1": {
          "name": "Bot1",
          "appId": "cli_yyyyyyyyyy",
          "appSecret": "yyyyyyyyyyyyyyyyyyyyyy",
          "eventMode": "ws"
        },
        "bot2": {
          "name": "Bot2",
          "appId": "cli_zzzzzzzzzz",
          "appSecret": "zzzzzzzzzzzzzzzzzzzzzz",
          "eventMode": "http",
          "verificationToken": "verify_token_xxx",
          "encryptKey": "encrypt_key_xxx"
        }
      }
    }
  }
}
```

#### HTTP Callback Path

When using HTTP Callback mode, different accounts need different callback URLs:

- **Default Account**: `/plugins/feishu/events`
- **bot1 Account**: `/plugins/feishu/events/bot1`
- **bot2 Account**: `/plugins/feishu/events/bot2`

Configure the corresponding callback URL for each app in the Feishu Open Platform.

> Note: When using WebSocket mode, each account establishes an independent WebSocket connection, with no callback URL configuration needed.

### Agent Binding Configuration (Bindings)

After configuring multiple Feishu accounts, you need to use the top-level `bindings` configuration to bind different agents to corresponding accounts for message routing.

```json
{
  "agents": {
    "list": [
      {
        "id": "agent1",
        "name": "Assistant 1"
      },
      {
        "id": "agent2",
        "name": "Assistant 2"
      }
    ]
  },
  "bindings": [
    {
      "agentId": "agent1",
      "match": { "channel": "feishu", "accountId": "bot1" }
    },
    {
      "agentId": "agent2",
      "match": { "channel": "feishu", "accountId": "bot2" }
    }
  ]
}
```

**Explanation:**

- `bindings`: Top-level configuration item, an array.
- `agentId`: Corresponds to the agent `id` in `agents.list`.
- `match.channel`: Fixed as `"feishu"`.
- `match.accountId`: Corresponds to the account ID in the channels configuration (e.g., `bot1`, `bot2`).
- If there is only a default account, `accountId` can be omitted: `{ "agentId": "agent1", "match": { "channel": "feishu" } }`.

With this configuration:

- Messages received by **bot1** will be routed to **agent1**.
- Messages received by **bot2** will be routed to **agent2**.

## Usage

After configuration and restarting openclaw:

- **Direct Chat**: Send messages directly to the bot.
- **Group Chat**: Mention @Bot to send messages.

## Development

### Run Tests

```bash
# Must be run within the openclaw project environment
npm test
```

### Project Structure

```
├── index.ts              # Plugin Entry
├── openclaw.plugin.json  # Plugin Manifest
├── src/
│   ├── channel.ts        # Channel Core Implementation
│   ├── runtime.ts        # Runtime Singleton
│   └── feishu/
│       ├── schema.ts     # Config Schema Definition
│       ├── config.ts     # Config Resolution
│       ├── state.ts      # Runtime State Management
│       ├── client.ts     # Feishu API Client
│       ├── inbound.ts    # Inbound Message Processing
│       ├── outbound.ts   # Outbound Message Processing
│       ├── events.ts     # HTTP Callback Parsing
│       ├── ws-client.ts  # WebSocket Client
│       ├── ws-proto.ts   # Protobuf Codec
│       └── ws-data-cache.ts  # Sharded Message Cache
└── test/                 # Unit Tests
```

## License

[MIT](LICENSE)
