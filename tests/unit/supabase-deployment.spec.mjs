// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const directory = '.github/workflows';
const load = name => readFileSync(`${directory}/${name}`, 'utf8')
  .split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
const automatic = load('functions-deploy.yml');
const manual = load('db-deploy.yml');

// Bounded source-contract checks for the current workflow layout, not a YAML
// parser. A structural rewrite should fail these guards and receive a review.
function block(source, key) {
  const lines = source.split('\n');
  const start = lines.indexOf(`${key}:`);
  if (start < 0) throw new Error(`missing workflow block: ${key}`);
  const relativeEnd = lines.slice(start + 1).findIndex(line => /^[^\s]/.test(line));
  const end = relativeEnd < 0 ? lines.length : start + 1 + relativeEnd;
  return lines.slice(start + 1, end).join('\n').trimEnd();
}

const events = source => [...block(source, 'on').matchAll(/^ {2}([a-z_]+):/gm)].map(match => match[1]);
const steps = source => block(source, 'jobs').split(/(?=^ {6}- )/m).slice(1);
const commandIndex = (parts, command) => parts.findIndex(part => part.includes(command));

describe('Supabase deployment sequencing', () => {
  it('uses only the unified workflow for automatic DB/function deployment with both change paths', () => {
    expect(events(automatic)).toEqual(['push', 'workflow_dispatch']);
    expect(events(manual)).toEqual(['workflow_dispatch']);
    const triggers = block(automatic, 'on');
    expect(triggers).toMatch(/^ {4}branches: \[main\]$/m);
    expect(triggers).toMatch(/^ {6}- 'supabase\/functions\/\*\*'$/m);
    expect(triggers).toMatch(/^ {6}- 'supabase\/migrations\/\*\*'$/m);
    expect(triggers).toMatch(/^ {6}- '\.github\/workflows\/functions-deploy\.yml'$/m);
    const automaticDeployments = readdirSync(directory).filter(name => /\.ya?ml$/.test(name)).filter(name => {
      const source = load(name);
      return /supabase (?:db push|functions deploy)/.test(source)
        && events(source).some(event => event !== 'workflow_dispatch');
    });
    expect(automaticDeployments).toEqual(['functions-deploy.yml']);
    expect(manual).toMatch(/^name: .*Manual Recovery/m);
    expect(manual).not.toContain('supabase functions deploy');
  });

  it('runs link, migration push and all functions in order in one job/checkout', () => {
    const parts = steps(automatic);
    const checkout = commandIndex(parts, 'uses: actions/checkout@');
    const link = commandIndex(parts, 'run: supabase link --project-ref');
    const push = commandIndex(parts, 'run: supabase db push --include-all');
    const functions = commandIndex(parts, 'supabase functions deploy');
    for (const index of [checkout, link, push, functions]) expect(index).toBeGreaterThanOrEqual(0);
    expect(checkout).toBeLessThan(link);
    expect(link).toBeLessThan(push);
    expect(push).toBeLessThan(functions);
    expect(parts.filter(part => part.includes('uses: actions/checkout@'))).toHaveLength(1);
    expect([...block(automatic, 'jobs').matchAll(/^ {2}([a-z_-]+):/gm)].map(match => match[1]))
      .toEqual(['deploy']);
    expect(parts[functions]).toContain('for dir in supabase/functions/*/; do');
    expect(parts[functions]).toContain('[[ "$fn" == _* ]] && continue');
    expect(parts[functions]).toContain('--project-ref "$SUPABASE_PROJECT_REF"');
    expect(parts[functions]).toContain('--no-verify-jwt');
    expect(automatic).not.toMatch(/^\s+ref:/m);
  });

  it('does not bypass failure handling or leak DB credentials into the function step', () => {
    for (const workflow of [automatic, manual]) {
      const parts = steps(workflow);
      const link = parts[commandIndex(parts, 'run: supabase link --project-ref')];
      const push = parts[commandIndex(parts, 'run: supabase db push --include-all')];
      expect(link).toBeDefined();
      expect(push).toBeDefined();
      for (const part of [link, push]) {
        expect(part).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
        expect(part).toContain('SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}');
      }
      expect(push).toMatch(/^ {8}run: supabase db push --include-all$/m);
      expect(block(workflow, 'jobs')).not.toMatch(/^\s+(?:continue-on-error|if|working-directory|permissions):/m);
    }
    const functions = steps(automatic).find(part => part.includes('supabase functions deploy'));
    expect(functions).toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}');
    expect(functions).not.toContain('SUPABASE_DB_PASSWORD');
  });

  it('shares one project-specific concurrency lock without cancelling a running deployment', () => {
    const project = block(automatic, 'env').match(/^ {2}SUPABASE_PROJECT_REF: ([a-z0-9]+)$/m)?.[1];
    expect(project).toBeTruthy();
    expect(block(manual, 'env')).toBe(block(automatic, 'env'));
    expect(block(automatic, 'concurrency')).toBe(
      `  group: supabase-production-${project}\n  cancel-in-progress: false`,
    );
    expect(block(manual, 'concurrency')).toBe(block(automatic, 'concurrency'));
    for (const workflow of [automatic, manual]) {
      expect(block(workflow, 'jobs')).not.toMatch(/^\s+concurrency:/m);
    }
  });

  it('limits GitHub permissions to repository reads and pins the same Supabase CLI', () => {
    for (const workflow of [automatic, manual]) {
      expect(block(workflow, 'permissions').trim()).toBe('contents: read');
      expect(block(workflow, 'jobs')).not.toMatch(/^\s+permissions:/m);
      expect(workflow).toMatch(/uses: supabase\/setup-cli@v1\n {8}with:\n {10}version: 2\.119\.0/);
    }
  });
});
