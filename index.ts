import type { MoltbotPluginApi } from "clawdbot/plugin-sdk";
import { emptyPluginConfigSchema } from "clawdbot/plugin-sdk";

import { autoStartFeishuWs, feishuPlugin, registerFeishuHttpRoute } from "./src/channel.js";
import { setFeishuRuntime } from "./src/runtime.js";

const plugin = {
  id: "feishu",
  name: "Feishu",
  description: "Feishu channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    api.logger?.info?.("[feishu] plugin register invoked");
    setFeishuRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });
    registerFeishuHttpRoute(api);
    autoStartFeishuWs(api).catch((err) => {
      api.logger?.error?.(`[feishu] auto-start ws failed: ${String(err)}`);
    });
    api.logger?.info?.("[feishu] plugin registered");
  },
};

export default plugin;
