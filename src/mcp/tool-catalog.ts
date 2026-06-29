// A self-describing catalog of the server's tools, grouped by domain.
//
// Why this exists: when a client connects many MCP servers it switches to
// deferred tool loading + semantic search, and a fuzzy query can rank an
// individual tool below the result cutoff (so the model "can't find" a tool that
// is in fact present). A flat catalog the model can read lets it select any tool
// by exact name instead of guessing a query. The catalog is derived from the live
// tool list (not hand-maintained) so it can never drift out of sync, and is
// surfaced through two independent channels — the server `instructions` (passive,
// but dropped by some clients) and the get_server_context tool output (requires a
// call, but high-salience and never truncated) — which cover each other's gaps.

export interface ToolSummary {
  name: string;
  title?: string;
}

export interface ToolCatalogGroup {
  group: string;
  tools: ToolSummary[];
}

// Group order is also display order. First matching predicate wins; the final
// catch-all bucket collects anything not matched above (e.g. get_server_context).
const GROUPS: Array<{ group: string; match: (name: string) => boolean }> = [
  { group: 'Content templates', match: n => n.includes('template') },
  { group: 'Content fragments', match: n => n.includes('fragment') },
  { group: 'XDM / Schema Registry (read-only)', match: n => n.includes('xdm') },
  { group: 'Folders (organization)', match: n => n.includes('folder') },
  { group: 'Tags & tag categories (organization)', match: n => n.includes('tag') },
  { group: 'Cross-sandbox promotion & repo deploy', match: n => n.includes('promot') || n.includes('repo') },
  { group: 'Server', match: () => true }
];

/** Group the given tool definitions into the domain buckets above. */
export function buildToolCatalog(tools: ReadonlyArray<{ name: string; title?: string }>): ToolCatalogGroup[] {
  const buckets: ToolCatalogGroup[] = GROUPS.map(g => ({ group: g.group, tools: [] }));
  for (const t of tools) {
    const idx = GROUPS.findIndex(g => g.match(t.name));
    buckets[idx].tools.push({ name: t.name, title: t.title });
  }
  return buckets.filter(g => g.tools.length > 0);
}

/** Render the catalog as a compact one-line string for the server instructions. */
export function formatToolCatalog(catalog: ToolCatalogGroup[]): string {
  return catalog.map(g => `${g.group} — ${g.tools.map(t => t.name).join(', ')}`).join('; ');
}
