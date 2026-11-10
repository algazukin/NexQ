# Codex subscription and separate translation settings

NexQ can use the official local Codex CLI directly, with the ChatGPT account already signed into that CLI. CLIProxyAPI is optional; existing Custom/API configurations remain available.

## Connect Codex

1. Install Codex CLI and run `codex login`, choosing ChatGPT sign-in. An API-key login has separate billing and is not shown as a connected subscription.
2. Open Settings > AI and select **Codex · Subscription (local CLI)**.
3. Click **Check Codex connection**, select a model from the account catalog, then **Use Codex**. NexQ warms the active connection without generating an answer.
4. Set reasoning and boost under **Main AI reasoning and boost**, then **Save AI profile**. Codex reasoning choices come from its model catalog. Fast/Boost is an explicit speed-tier request and may use included limits or paid credit faster; Standard explicitly requests normal speed. Provider default preserves the provider choice.

Changing the model or profile affects later requests. The signed-in account determines model availability and speed-tier eligibility. An unsupported tier or model returns a provider error; NexQ does not promise that every account receives accelerated processing.

## Separate LLM translation profile

In Settings > Translation, select **LLM Translation**. Its profile uses the active AI provider and credentials, with an optional different model, reasoning and speed tier. Load models from that provider, configure the profile, save it, then make LLM Translation active if necessary. Disable the profile to inherit the main AI settings.

Translation uses a separate connection/process from live answers and collects its output privately. It cannot replace interview answers or change the main model. Changing models/profiles invalidates the ad-hoc translation cache; stored meeting translations remain until explicitly regenerated. Claude CLI keeps its existing Fast settings; a separate model profile is available with Codex or API providers.

For Custom/CLIProxyAPI, reasoning is sent as `reasoning_effort` and Fast/Boost as `service_tier: priority`. Forced proxy payload rules can override these choices. NexQ does not modify proxy configuration.

## Interview hints

The compact layout, automatic hints and hint shortcuts operate only during an active **Interview**, with the saved Hints preference enabled. Other meeting scenarios and standalone screen tasks use the full interface. Ending the interview restores normal window behavior without deleting the preference.

## Process and context

NexQ keeps Codex app-server warm and uses ephemeral request threads, supplying the scenario, transcript and screenshot context assembled for other providers. NexQ owns follow-up context; Codex adds no separate persistent interview history. The hidden child uses a private directory and read-only execution policy, with project instructions and automatic skill discovery/slow agent features disabled. The CLI can still report its global AGENTS.md as an instruction source; NexQ supplies an explicit answer-only developer policy and blocks external tool availability for these requests. Unexpected tool activity is rejected/stopped. NexQ edits no global Codex configuration or authentication files; login happens in the official CLI. Text/images are processed through the user Codex account.

Official protocol: https://learn.chatgpt.com/docs/app-server
Speed modes: https://learn.chatgpt.com/docs/agent-configuration/speed
Proxy payload rules: https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml
