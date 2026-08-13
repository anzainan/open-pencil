/**
 * prism-jsx is a Prism UMD component whose source is `(function (Prism) { ... })(Prism)`,
 * i.e. it reads the bare global `Prism` at module load. Rolldown bundles the prismjs
 * core as a deferred commonjs module, so `window.Prism` is only initialized on first
 * use. A static `import 'prismjs/components/prism-jsx'` therefore evaluates the UMD
 * before the global exists and throws `ReferenceError: Prism is not defined`.
 *
 * Loading it dynamically guarantees the prismjs core (and its `window.Prism`) is
 * initialized first, so the JSX grammar registers on the same instance that
 * `import Prism from 'prismjs'` returns. See phase-state/prism-fix.md.
 */
export function loadJSXGrammar(): Promise<void> {
  return import('prismjs/components/prism-jsx').then(() => undefined)
}
