# Openclaw 插件开发指南

本文档基于 Openclaw 官方文档整理，旨在帮助开发者了解如何开发、配置和发布 Openclaw 插件。

## 1. 简介

Openclaw 插件（Extensions）是运行时加载的 TypeScript/JavaScript 模块，用于扩展 Openclaw 的核心功能。插件与 Gateway 运行在同一进程中，因此拥有很高的权限和灵活性。

插件主要用于：
- 添加新的消息渠道（如 Feishu, WhatsApp）。
- 集成新的 AI 模型认证流程。
- 为 Agent 添加自定义工具（Tools）。
- 注册 CLI 命令或后台服务。

## 2. 插件的基本结构

一个标准的插件通常包含以下文件：
- `index.ts`（或 `.js`）：插件入口文件。
- `openclaw.plugin.json`：插件清单文件（Manifest），描述插件元数据和配置 Schema。
- `package.json`：NPM 包描述文件。

### 插件入口 (Entry Point)

插件导出一个默认函数或对象：

```typescript
// 方式一：导出注册函数
export default function register(api: OpenclawPluginApi) {
  api.logger.info("My plugin loaded!");
  // 注册功能...
}

// 方式二：导出对象
const plugin = {
  id: "my-plugin",
  register(api: OpenclawPluginApi) {
    // ...
  }
};
export default plugin;
```

### 插件清单 (openclaw.plugin.json)

```json
{
  "id": "my-plugin",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": { "type": "string" }
    }
  },
  "uiHints": {
    "apiKey": { "label": "API Key", "sensitive": true }
  }
}
```

## 3. 支持的插件类型与开发

### 3.1 消息渠道插件 (Messaging Channels)

用于接入新的聊天平台（如本项目的 Feishu 插件）。

**开发步骤：**
1. 定义渠道元数据（`meta`）：包括 ID、标签、文档路径等。
2. 实现必要接口：
   - `capabilities`: 支持的聊天类型（私聊/群聊）、媒体等。
   - `config`: 账户解析逻辑。
   - `outbound`: 发送消息的逻辑。
3. 注册渠道：`api.registerChannel({ plugin })`。

**示例代码：**
（参考本仓库 `src/channel.ts`）

### 3.2 Agent 工具 (Agent Tools)

为 AI Agent 提供调用外部服务的能力。

```typescript
import { Type } from "@sinclair/typebox";

export default function(api) {
  api.registerTool({
    name: "weather_lookup",
    description: "查询天气",
    parameters: Type.Object({
      city: Type.String()
    }),
    async execute(id, params) {
      const weather = await fetchWeather(params.city);
      return { content: [{ type: "text", text: weather }] };
    }
  });
}
```

### 3.3 模型认证提供商 (Model Auth Providers)

用于在 Openclaw 中集成第三方模型服务的 OAuth 或 API Key 认证。

```typescript
api.registerProvider({
  id: "acme",
  label: "Acme AI",
  auth: [{
    id: "api-key",
    label: "API Key",
    kind: "shared-secret",
    // ...
  }]
});
```

### 3.4 CLI 命令

注册自定义的 Openclaw 命令行指令。

```typescript
api.registerCli(({ program }) => {
  program.command("mycmd")
    .description("My custom command")
    .action(() => {
      console.log("Hello from plugin!");
    });
}, { commands: ["mycmd"] });
```

### 3.5 自动回复命令 (Auto-reply Commands)

注册无需经过 AI 处理的 Slash 命令（如 `/status`）。

```typescript
api.registerCommand({
  name: "mystatus",
  description: "查看状态",
  handler: (ctx) => ({
    text: `当前运行状态：正常`
  })
});
```

## 4. 插件配置

插件配置位于 `config.json` 或 `openclaw.json` 的 `plugins` 字段下。

```json
{
  "plugins": {
    "entries": {
      "feishu": {
        "enabled": true,
        "config": {
          "appId": "..."
        }
      },
      "my-plugin": {
        "enabled": true,
        "config": {
          "apiKey": "..."
        }
      }
    }
  }
}
```

- **enabled**: 启用/禁用开关。
- **config**: 具体配置项，会根据 `openclaw.plugin.json` 中的 schema 进行验证。

## 5. 发布与分发

推荐通过 NPM 发布插件：
1. 包名建议使用 `@openclaw/plugin-name` 或自定义 Scope。
2. `package.json` 必须包含 `openclaw` 字段：

```json
{
  "name": "@my-scope/my-plugin",
  "openclaw": {
    "extensions": ["./dist/index.js"]
  }
}
```

用户可以通过以下命令安装：
```bash
openclaw plugins install @my-scope/my-plugin
```

## 6. 在本项目中实践

本项目（`openclaw-feishu-plugin`）是一个典型的**消息渠道插件**。你可以查看 `src/` 目录下的代码来学习：
- `src/index.ts`: 插件入口，注册了 Channel、HTTP Route 和 WebSocket 服务。
- `src/channel.ts`: 定义了 Feishu 渠道的核心能力和回调。
- `src/feishu/`: 具体的飞书 API 实现。
