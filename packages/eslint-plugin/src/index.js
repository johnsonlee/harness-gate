import path from 'node:path';
import fs from 'node:fs';

const strings = { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true };
const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.json'];
const normalize = value => value.replaceAll('\\', '/');
function glob(pattern, value) {
  const escaped = pattern.split('**').map(part => part.split('*').map(piece => piece.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function visitors(context, check) {
  function visit(source) {
    if (source && typeof source.value === 'string') check(source.value, source);
    else if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) check(source.quasis[0].value.cooked, source);
  }
  return {
    ImportDeclaration: node => visit(node.source),
    ExportNamedDeclaration: node => visit(node.source),
    ExportAllDeclaration: node => visit(node.source),
    ImportExpression: node => visit(node.source),
    CallExpression: node => {
      if (node.callee.type !== 'Identifier' || node.callee.name !== 'require' || node.arguments.length !== 1) return;
      // A locally bound function named require is not Node's module loader.
      for (let scope = context.sourceCode.getScope(node); scope; scope = scope.upper) {
        const variable = scope.set.get('require');
        if (variable) {
          if (variable.defs.length) return;
          break;
        }
      }
      visit(node.arguments[0]);
    },
    TSImportEqualsDeclaration: node => {
      if (node.moduleReference.type === 'TSExternalModuleReference') visit(node.moduleReference.expression);
    },
  };
}

const forbiddenImports = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow explicitly configured import specifiers' },
    schema: [{ type: 'object', properties: { patterns: strings }, required: ['patterns'], additionalProperties: false }],
    messages: { forbidden: 'Import "{{specifier}}" is forbidden by pattern "{{pattern}}".' },
  },
  create(context) {
    const patterns = context.options[0]?.patterns ?? [];
    return visitors(context, (specifier, node) => {
      const pattern = patterns.find(pattern => glob(pattern, specifier));
      if (pattern) context.report({ node, messageId: 'forbidden', data: { specifier, pattern } });
    });
  },
};

function resolveSource(candidate) {
  const choices = [candidate];
  // TypeScript commonly writes .js specifiers for source files compiled from .ts.
  if (/\.(js|jsx|mjs|cjs)$/.test(candidate)) {
    const sourceExt = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }[path.extname(candidate)];
    choices.unshift(...sourceExt.map(ext => candidate.slice(0, -path.extname(candidate).length) + ext));
  }
  choices.push(...extensions.map(ext => candidate + ext), ...extensions.map(ext => path.join(candidate, `index${ext}`)));
  return choices.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) ?? candidate;
}
const inside = (root, file) => file === root || file.startsWith(root + path.sep);
const dependencyBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce explicitly configured module dependency boundaries' },
    schema: [{
      type: 'object', additionalProperties: false,
      required: ['modules', 'allow'],
      properties: {
        rootDir: { type: 'string' },
        modules: { type: 'array', minItems: 1, items: { type: 'object', required: ['name', 'root'], additionalProperties: false, properties: { name: { type: 'string', minLength: 1 }, root: { type: 'string', minLength: 1 } } } },
        allow: { type: 'object', additionalProperties: strings },
        aliases: { type: 'object', additionalProperties: strings },
      },
    }],
    messages: { boundary: 'Module "{{from}}" cannot depend on module "{{to}}" through "{{specifier}}".' },
  },
  create(context) {
    const options = context.options[0];
    if (!options) return {};
    const root = path.resolve(context.cwd ?? context.getCwd(), options.rootDir ?? '.');
    const modules = options.modules.map(mod => ({ ...mod, root: path.resolve(root, mod.root) })).sort((a, b) => b.root.length - a.root.length);
    const names = new Set(modules.map(mod => mod.name));
    if (names.size !== modules.length) throw new Error('harness/dependency-boundaries: module names must be unique');
    for (const [from, allowed] of Object.entries(options.allow)) {
      if (!names.has(from) || allowed.some(name => !names.has(name))) throw new Error('harness/dependency-boundaries: allow references an unknown module');
    }
    const aliases = Object.entries(options.aliases ?? {}).sort(([a], [b]) => Number(a.includes('*')) - Number(b.includes('*')) || b.replace('*', '').length - a.replace('*', '').length);
    for (const [key, targets] of aliases) {
      if ((key.match(/\*/g) ?? []).length > 1 || targets.some(target => (target.match(/\*/g) ?? []).length > 1)) throw new Error('harness/dependency-boundaries: alias paths support at most one wildcard');
    }
    const filename = context.physicalFilename ?? context.getPhysicalFilename();
    const from = modules.find(mod => inside(mod.root, path.resolve(filename)));
    if (!from || !Object.hasOwn(options.allow, from.name)) return {};
    return visitors(context, (specifier, node) => {
      let candidates = [];
      if (specifier.startsWith('./') || specifier.startsWith('../')) candidates = [path.resolve(path.dirname(filename), specifier)];
      else if (path.isAbsolute(specifier)) candidates = [specifier];
      else {
        for (const [key, targets] of aliases) {
          const star = key.indexOf('*');
          if (star < 0 ? key !== specifier : !(specifier.startsWith(key.slice(0, star)) && specifier.endsWith(key.slice(star + 1)) && specifier.length >= key.length - 1)) continue;
          const matched = star < 0 ? '' : specifier.slice(star, specifier.length - (key.length - star - 1));
          candidates = targets.map(target => path.resolve(root, target.replace('*', matched)));
          break;
        }
      }
      if (!candidates.length) return;
      const resolved = candidates.map(resolveSource);
      const target = resolved.find(file => { try { return fs.statSync(file).isFile(); } catch { return false; } }) ?? resolved[0];
      const to = modules.find(mod => inside(mod.root, target));
      if (to && to.name !== from.name && !options.allow[from.name].includes(to.name)) {
        context.report({ node, messageId: 'boundary', data: { from: from.name, to: to.name, specifier: normalize(specifier) } });
      }
    });
  },
};

const plugin = {
  meta: { name: 'eslint-plugin-harness-gate', version: '0.1.0' },
  rules: { 'forbidden-imports': forbiddenImports, 'dependency-boundaries': dependencyBoundaries },
  configs: {},
};
plugin.configs.recommended = { name: 'harness/recommended', plugins: { harness: plugin }, rules: {} };
export default plugin;
export const rules = plugin.rules;
