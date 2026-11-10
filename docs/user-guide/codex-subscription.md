# Codex subscription and separate translation settings

NexQ can use the official local Codex CLI directly, with the ChatGPT account already signed into that CLI. CLIProxyAPI is optional; existing Custom/API configurations remain available.

## Connect Codex

1. Install Codex CLI and run `codex login`, choosing ChatGPT sign-in. An API-key login has separate billing and is not shown as a connected subscription.
2. Open **Settings → LLM Providers** and select **Codex CLI** in the **AI providers** list.
3. Check the login status and click **Set Codex CLI as Active Provider**. NexQ uses the saved model or the catalog default and warms the connection. To choose a different model, open **Advanced settings**.
4. In **Advanced settings**, set reasoning and Boost, then click **Save AI profile**. Available reasoning levels come from the model catalog. Fast/Boost requests the priority tier and may use included limits or paid credit faster. Standard requests normal speed. Provider default leaves the choice to Codex.

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
