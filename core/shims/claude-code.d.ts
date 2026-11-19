// The engine's types are generated where the mod is installed (.claude-plugin/types), not in this repository. The
// core only reaches the mod's pure modules, whose types name the engine's module for its state alone: this stands in.
declare module 'claude-code' {
  export interface PluginState {}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type EngineInterface = any
}
