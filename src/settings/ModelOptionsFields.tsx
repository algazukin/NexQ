import type { ModelOptions } from "../lib/modelProfiles";
import { REASONING_EFFORTS } from "../lib/modelProfiles";

export function ModelOptionsFields({ options, onChange, efforts = REASONING_EFFORTS }: {
  options: ModelOptions;
  onChange: (options: ModelOptions) => void;
  efforts?: string[];
}) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <label className="text-xs text-muted-foreground">Reasoning
      <select aria-label="Reasoning" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground" value={options.reasoning_effort ?? ""} onChange={(event) => onChange({ ...options, reasoning_effort: event.target.value || null })}>
        <option value="">Provider default</option>
        {options.reasoning_effort && !efforts.includes(options.reasoning_effort) && <option value={options.reasoning_effort} disabled>{options.reasoning_effort} (not supported by this model)</option>}
        {efforts.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
      </select>
    </label>
    <label className="text-xs text-muted-foreground">Boost / speed
      <select aria-label="Boost / speed" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground" value={options.service_tier ?? ""} onChange={(event) => onChange({ ...options, service_tier: event.target.value || null })}>
        <option value="">Provider default</option>
        <option value="default">Off / Standard</option>
        <option value="priority">Fast / Boost</option>
      </select>
      <span className="mt-1 block text-[11px]">Fast can use more subscription limits or API credit. Proxy overrides may take precedence.</span>
    </label>
  </div>;
}
