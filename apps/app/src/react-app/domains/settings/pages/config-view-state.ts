export type OnMyAgentTestState = "idle" | "testing" | "success" | "error";

export type OnMyAgentConnectionState = {
  url: string;
  token: string;
  testState: OnMyAgentTestState;
  testMessage: string | null;
};

export type TokenVisibilityKey = "onmyagent" | "client" | "owner" | "host";

type ConfigLocalState = {
  onmyagentConnection: OnMyAgentConnectionState;
  tokenVisible: Record<TokenVisibilityKey, boolean>;
  copyingField: string | null;
};

type ConfigLocalAction =
  | { type: "serverSettings"; connection: OnMyAgentConnectionState }
  | { type: "url"; url: string }
  | { type: "token"; token: string }
  | { type: "testState"; testState: OnMyAgentTestState; testMessage: string | null }
  | { type: "toggleToken"; key: TokenVisibilityKey }
  | { type: "copyingField"; field: string | null };

export const initialConfigLocalState: ConfigLocalState = {
  onmyagentConnection: {
    url: "",
    token: "",
    testState: "idle",
    testMessage: null,
  },
  tokenVisible: {
    onmyagent: false,
    client: false,
    owner: false,
    host: false,
  },
  copyingField: null,
};

export function configLocalReducer(
  state: ConfigLocalState,
  action: ConfigLocalAction,
): ConfigLocalState {
  switch (action.type) {
    case "serverSettings":
      return { ...state, onmyagentConnection: action.connection };
    case "url":
      return {
        ...state,
        onmyagentConnection: {
          ...state.onmyagentConnection,
          url: action.url,
          testState: "idle",
          testMessage: null,
        },
      };
    case "token":
      return {
        ...state,
        onmyagentConnection: {
          ...state.onmyagentConnection,
          token: action.token,
          testState: "idle",
          testMessage: null,
        },
      };
    case "testState":
      return {
        ...state,
        onmyagentConnection: {
          ...state.onmyagentConnection,
          testState: action.testState,
          testMessage: action.testMessage,
        },
      };
    case "toggleToken":
      return {
        ...state,
        tokenVisible: {
          ...state.tokenVisible,
          [action.key]: !state.tokenVisible[action.key],
        },
      };
    case "copyingField":
      return { ...state, copyingField: action.field };
  }
}
