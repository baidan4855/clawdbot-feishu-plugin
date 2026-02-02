# Openclaw Feishu Plugin

[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Version](https://img.shields.io/badge/Version-0.1.1-brightgreen.svg?style=flat-square)](package.json)
[![Platform](https://img.shields.io/badge/Platform-Feishu%20%7C%20Lark-orange.svg?style=flat-square)](https://open.feishu.cn/)
[![openclaw](https://img.shields.io/badge/openclaw-Plugin-purple.svg?style=flat-square)](https://github.com/openclaw/openclaw)

[English Document](./README_en.md)

[openclaw](https://github.com/openclaw/openclaw) 的飞书（Feishu/Lark）渠道插件，支持通过飞书与 Openclaw 进行交互。

## 功能特性

- 支持 WebSocket 长连接方式接收飞书事件（推荐）
- 支持 HTTP 回调方式接收飞书事件
- **支持多账户配置**，可同时连接多个飞书机器人
- 支持发送/编辑/删除消息
- 支持消息表情回应
- 支持消息置顶
- 支持私聊和群聊
- 支持 @机器人 触发
- 无需飞书官方 SDK，零外部依赖

## 系统要求

- Node.js >= 18.17.0（需要原生 WebSocket 支持）
- openclaw

## 安装

### 通过 openclaw 命令安装

```bash
openclaw plugin install https://github.com/baidan4855/openclaw-feishu-plugin
```

## 飞书应用配置

### 1. 创建飞书应用

1. 访问 [飞书开放平台](https://open.feishu.cn/app)
2. 点击「创建企业自建应用」
3. 填写应用名称和描述

### 2. 获取凭证

在应用的「凭证与基础信息」页面获取：

- **App ID**
- **App Secret**

### 3. 配置权限

在「权限管理」页面添加以下权限：

| 权限名称                     | 权限标识                        | 用途         |
| ---------------------------- | ------------------------------- | ------------ |
| 获取与发送单聊、群组消息     | `im:message`                    | 收发消息     |
| 读取用户发给机器人的单聊消息 | `im:message.p2p_msg:readonly`   | 接收私聊     |
| 获取群组中所有消息           | `im:message.group_msg:readonly` | 接收群聊     |
| 以应用的身份发消息           | `im:message:send_as_bot`        | 发送消息     |
| 获取用户基本信息             | `contact:user.base:readonly`    | 获取用户信息 |

### 4. 配置事件订阅

在「事件与回调」页面：

1. 选择「订阅方式」为 **使用长连接接收事件**（推荐）
2. 添加事件：`im.message.receive_v1`（接收消息）

> 如果选择 HTTP 回调方式，需要配置公网可访问的回调地址。

### 5. 发布应用

配置完成后，在「版本管理与发布」页面创建版本并发布。

## openclaw 配置

安装插件后，在 openclaw 控制台的 **Channels** 页面即可看到 Feishu 渠道。只需填写 **App ID** 和 **App Secret** 两个必填项即可完成配置：

![配置界面](assets/config-screenshot.png)

> 其他配置项均为可选，默认使用 WebSocket 长连接方式接收消息，无需公网 IP。

也可以在 openclaw 的配置文件中手动配置：

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxxxxxxxxx",
      "appSecret": "xxxxxxxxxxxxxxxxxxxxxxxx"
      // "eventMode": "ws"  // ws（默认）或 http
    }
  }
}
```

### 配置项说明

| 配置项              | 类型   | 必填 | 说明                                              |
| ------------------- | ------ | ---- | ------------------------------------------------- |
| `appId`             | string | 是   | 飞书应用的 App ID                                 |
| `appSecret`         | string | 是   | 飞书应用的 App Secret                             |
| `eventMode`         | string | 否   | 事件订阅方式：`ws`（默认）或 `http`               |
| `verificationToken` | string | 否   | HTTP 回调验证 Token                               |
| `encryptKey`        | string | 否   | HTTP 回调加密密钥                                 |
| `requireMention`      | boolean| 否   | 是否必须被 @ 才回复（私聊默认 false，群聊默认 true）|
| `ignoreOtherMentions` | boolean| 否   | 当 requireMention 为 false 时，如果其他人被 @，是否忽略该消息（默认 true）<br/>用于让机器人在不被 @ 时参与聊天，但在别人被 @ 时礼貌闭嘴 |
| `baseUrl`           | string | 否   | API 地址，默认 `https://open.feishu.cn/open-apis` |

### 多账户配置

插件支持同时配置多个飞书账户，适用于需要连接多个飞书机器人的场景。

```json
{
  "channels": {
    "feishu": {
      // 多账户配置
      "accounts": {
        "bot1": {
          "name": "机器人1",
          "appId": "cli_yyyyyyyyyy",
          "appSecret": "yyyyyyyyyyyyyyyyyyyyyy",
          "eventMode": "ws"
        },
        "bot2": {
          "name": "机器人2",
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

#### HTTP 回调路径说明

使用 HTTP 回调模式时，不同账户需要配置不同的回调 URL：

- **默认账户**: `/plugins/feishu/events`
- **bot1 账户**: `/plugins/feishu/events/bot1`
- **bot2 账户**: `/plugins/feishu/events/bot2`

在飞书开放平台的「事件与回调」页面，为每个应用配置对应的回调地址。

> 注意：使用 WebSocket 模式时，每个账户会建立独立的 WebSocket 连接，无需额外配置回调路径。

### Agent 绑定配置（Bindings）

当配置了多个飞书账户后，需要通过顶级 `bindings` 配置将不同的 agent 绑定到对应的账户，实现消息路由。

```json
{
  "agents": {
    "list": [
      {
        "id": "agent1",
        "name": "助手1"
      },
      {
        "id": "agent2",
        "name": "助手2"
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

**说明：**

- `bindings`: 顶级配置项，是一个数组
- `agentId`: 对应 `agents.list` 中的 agent `id`
- `match.channel`: 固定为 `"feishu"`
- `match.accountId`: 对应 channels 配置中的账户 ID（如 `bot1`、`bot2`）
- 如果只有一个默认账户，可以省略 `accountId`：`{ "agentId": "agent1", "match": { "channel": "feishu" } }`

这样配置后：

- **bot1** 机器人收到的消息会路由到 **agent1** 处理
- **bot2** 机器人收到的消息会路由到 **agent2** 处理

## 使用方式

配置完成并重启 openclaw 后：

- **私聊**：直接给机器人发消息
- **群聊**：@机器人 发送消息

## 开发

### 运行测试

```bash
# 需要在 openclaw 项目环境中运行
npm test
```

### 项目结构

```
├── index.ts              # 插件入口
├── openclaw.plugin.json  # 插件清单
├── src/
│   ├── channel.ts        # 渠道核心实现
│   ├── runtime.ts        # 运行时单例
│   └── feishu/
│       ├── schema.ts     # 配置 schema 定义
│       ├── config.ts     # 配置解析
│       ├── state.ts      # 运行时状态管理
│       ├── client.ts     # 飞书 API 客户端
│       ├── inbound.ts    # 入站消息处理
│       ├── outbound.ts   # 出站消息处理
│       ├── events.ts     # HTTP 回调解析
│       ├── ws-client.ts  # WebSocket 客户端
│       ├── ws-proto.ts   # Protobuf 编解码
│       └── ws-data-cache.ts  # 分片消息缓存
└── test/                 # 单元测试
```

## 许可证

[MIT](LICENSE)
