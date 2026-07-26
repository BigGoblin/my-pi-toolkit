import { type Client, createClient, type Interceptor } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";

import { AiService as AiServiceDesc } from "./__generated__/aiserver/v1/aiserver_service_connect.js";

interface AiServiceOptions {
  accessToken: string;
  clientType: string;
  clientVersion: string;
}

type AiServiceClient = Client<typeof AiServiceDesc>;

export type AiRpcClient = {
  getUsableModels(): Promise<Awaited<ReturnType<AiServiceClient["getUsableModels"]>>>;
};

class AiService {
  private readonly client: AiServiceClient;

  constructor(baseUrl: string, options: AiServiceOptions) {
    const authInterceptor: Interceptor = (next) => async (req) => {
      req.header.set("authorization", `Bearer ${options.accessToken}`);
      req.header.set("x-cursor-client-type", options.clientType);
      req.header.set("x-cursor-client-version", options.clientVersion);
      req.header.set("x-ghost-mode", "true");
      req.header.set("x-request-id", crypto.randomUUID());
      return next(req);
    };

    const transport = createConnectTransport({
      baseUrl,
      httpVersion: "1.1",
      interceptors: [authInterceptor],
    });

    this.client = createClient(AiServiceDesc, transport);
  }

  get rpcClient(): AiRpcClient {
    return {
      getUsableModels: () => this.client["getUsableModels"]({}),
    };
  }
}

export default AiService;
