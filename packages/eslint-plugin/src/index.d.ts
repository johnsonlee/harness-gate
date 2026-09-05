import type { ESLint, Linter, Rule } from 'eslint';

export interface ForbiddenImportsOptions {
  patterns: string[];
}

export interface DependencyBoundariesOptions {
  rootDir?: string;
  modules: Array<{ name: string; root: string }>;
  allow: Record<string, string[]>;
  aliases?: Record<string, string[]>;
}

export declare const rules: Record<'forbidden-imports' | 'dependency-boundaries', Rule.RuleModule>;
declare const plugin: ESLint.Plugin & {
  rules: typeof rules;
  configs: { recommended: Linter.Config };
};
export default plugin;
