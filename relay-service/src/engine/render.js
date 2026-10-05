const PLACEHOLDER = /\{(\w+)\}/g;

/** Names of the {placeholders} used in a template. */
export function placeholdersIn(template) {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]))];
}

/** Fill {blanks} from vars. Unknown blanks are left as-is so they're visible, not silently empty. */
export function render(template, vars) {
  return template.replace(PLACEHOLDER, (match, name) => (vars[name] ?? match));
}
