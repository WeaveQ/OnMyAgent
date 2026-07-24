import { APP_NAME } from "../brand";

export default {
  "providers.api_key_label": "API key",
  "providers.api_key_required": "API key is required",
  "providers.auth_failed": "Authentication failed",
  "providers.connect_failed": "Failed to connect provider",
  "providers.disabled_in_config_suffix": "and disabled it in the engine config.",
  "providers.disconnect_failed": "Failed to disconnect provider",
  "providers.disconnected_prefix": "Disconnected",
  "providers.load_failed": "Failed to load providers",
  "providers.plugin_hook_mismatch":
    "OpenCode plugin hooks failed (version/plugin mismatch)",
  "providers.plugin_hook_mismatch_hint":
    "Reload the engine so OnMyAgent can use the product-bundled OpenCode. Also align @opencode-ai/plugin with the OpenCode version (or temporarily disable third-party plugins such as oh-my-openagent), then try again.",
  "providers.no_oauth_prefix": "No OAuth flow available for",
  "providers.no_providers_available": "No providers available",
  "providers.not_connected": "Not connected to a server",
  "providers.not_oauth_flow_prefix":
    "Selected auth method is not an OAuth flow for",
  "providers.oauth_failed": "Failed to complete OAuth",
  "providers.oauth_method_required": "OAuth method is required",
  "providers.provider_error": "Provider error ({provider})",
  "providers.provider_id_required": "Provider ID is required",
  "providers.rate_limit_exceeded": "Rate limit exceeded",
  "providers.removal_unsupported":
    "Provider auth removal is not supported by this client.",
  "providers.request_failed": "Request failed",
  "providers.save_api_key_failed": "Failed to save API key",
  "providers.still_connected_suffix":
    ", but the worker still reports it as connected. Clear any remaining API key or OAuth credentials and restart the worker to fully disconnect.",
  "providers.unknown_provider": "Unknown provider",
  "providers.use_api_key_suffix": "Use an API key instead.",
} as const;
