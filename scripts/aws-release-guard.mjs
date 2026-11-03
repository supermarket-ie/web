import { readFileSync } from 'node:fs';

const ACCOUNT = '611622961299';
const REGION = 'eu-west-1';
const REPOSITORY = 'smie-prod';
const REPO_PREFIX = ACCOUNT + '.dkr.ecr.' + REGION + '.amazonaws.com/' + REPOSITORY + ':';
const IMAGE_TAG_PATTERN = /^[0-9a-f]{7}-prod$/;

function assert(condition, message) {
  if (!condition) throw new Error('AWS release refused: ' + message);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function equal(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function imageFromDefinition(raw, containerName) {
  assert(typeof raw === 'string', 'task container definitions are missing');
  const definitions = JSON.parse(raw);
  assert(Array.isArray(definitions) && definitions.length === 1, 'unexpected ECS container layout');
  const container = definitions[0];
  assert(container.name === containerName, 'unexpected ECS container name');
  assert(typeof container.image === 'string' && container.image.startsWith(REPO_PREFIX), 'unexpected ECS image repository');
  return { container, definitions, tag: container.image.slice(REPO_PREFIX.length) };
}

function resourcesIn(module, result = []) {
  if (!module) return result;
  result.push(...(module.resources || []));
  for (const child of module.child_modules || []) resourcesIn(child, result);
  return result;
}

export function currentWorkerTag(state) {
  const resources = resourcesIn(state.values?.root_module);
  const tags = [
    ['aws_ecs_task_definition.sqs_consumer[0]', 'sqs-consumer'],
    ['aws_ecs_task_definition.scheduled[0]', 'scheduled'],
  ].map(([address, name]) => {
    const entry = resources.find((resource) => resource.address === address);
    assert(entry?.values, 'production worker state missing: ' + address);
    const { tag } = imageFromDefinition(entry.values.container_definitions, name);
    assert(IMAGE_TAG_PATTERN.test(tag), 'worker image tag is not a known production SHA: ' + address);
    return tag;
  });
  assert(tags[0] === tags[1], 'production worker images differ; refusing to change either');
  return tags[0];
}

function verifyVariables(variables, desiredTag, workerTag) {
  const expected = {
    aws_region: REGION,
    name_prefix: REPOSITORY,
    create_resources: true,
    deploy_application: true,
    test_mode: false,
    enable_workers: true,
    public_base_url: 'https://www.supermarket.ie',
    website_queue_backend: 'sqs',
    enable_outbound_email_on_aws: true,
    image_tag: desiredTag,
    image_tag_worker: workerTag,
  };
  for (const [key, value] of Object.entries(expected)) {
    assert(equal(variables?.[key]?.value, value), 'production configuration mismatch: ' + key);
  }
  assert(Number(variables?.worker_desired_count?.value) >= 1, 'production queue consumer must remain running');
  assert(variables?.secret_arns?.value && Object.keys(variables.secret_arns.value).length > 0, 'production secret mappings are absent');
}

function verifyTaskDefinition(change, desiredTag) {
  assert(equal(change.actions, ['delete', 'create']), 'web task definition must only be replaced');
  assert(equal(change.replace_paths, [['container_definitions']]), 'web task replacement is not image-only');
  const before = change.before || {};
  const after = change.after || {};
  const beforeImage = imageFromDefinition(before.container_definitions, 'web');
  const afterImage = imageFromDefinition(after.container_definitions, 'web');
  assert(afterImage.tag === desiredTag, 'new web task image does not match requested tag');
  assert(IMAGE_TAG_PATTERN.test(beforeImage.tag), 'current web image has an unexpected tag');
  const previous = structuredClone(beforeImage.container);
  const next = structuredClone(afterImage.container);
  next.image = previous.image;
  assert(equal(previous, next), 'web container changed beyond its image');
  const computed = new Set(['arn', 'arn_without_revision', 'id', 'revision']);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (computed.has(key) || key === 'container_definitions') continue;
    assert(equal(before[key], after[key]), 'web task attribute changed: ' + key);
  }
  const env = Object.fromEntries((afterImage.container.environment || []).map(({ name, value }) => [name, value]));
  assert(env.APP_ENV === 'production', 'web would not run in production mode');
  assert(env.SUPABASE_READ_ONLY === 'false', 'web would run read-only');
  assert(env.QUEUE_BACKEND === 'sqs', 'web queue backend would change');
}

function verifyService(change) {
  assert(equal(change.actions, ['update']), 'web ECS service change is not in-place');
  const before = change.before || {};
  const after = change.after || {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'task_definition') continue;
    assert(equal(before[key], after[key]), 'web ECS service attribute changed: ' + key);
  }
}

export function verifyPlan(plan, desiredTag, workerTag) {
  assert(IMAGE_TAG_PATTERN.test(desiredTag), 'image tag must be a seven-character SHA with -prod suffix');
  assert(IMAGE_TAG_PATTERN.test(workerTag), 'worker image tag is invalid');
  verifyVariables(plan.variables, desiredTag, workerTag);

  const changes = (plan.resource_changes || []).filter((entry) => {
    const actions = entry.change?.actions || [];
    return !equal(actions, ['no-op']) && !(entry.mode === 'data' && equal(actions, ['read']));
  });
  const allowed = new Map([
    ['aws_ecs_task_definition.app[0]', verifyTaskDefinition],
    ['aws_ecs_service.app[0]', verifyService],
  ]);
  for (const entry of changes) {
    assert(entry.mode === 'managed' && allowed.has(entry.address), 'unexpected infrastructure change: ' + entry.address);
    allowed.get(entry.address)(entry.change, desiredTag);
  }
  assert(changes.length === 0 ||
    (changes.length === 2 && changes.some((e) => e.address === 'aws_ecs_task_definition.app[0]') &&
      changes.some((e) => e.address === 'aws_ecs_service.app[0]')),
  'expected only the web task definition and ECS service to change together');

  const web = resourcesIn(plan.planned_values?.root_module)
    .find((entry) => entry.address === 'aws_ecs_task_definition.app[0]');
  assert(web?.values, 'planned production web task is absent');
  const image = imageFromDefinition(web.values.container_definitions, 'web');
  assert(image.tag === desiredTag, 'planned web task image tag differs from requested tag');
  return changes.length === 0 ? 'Already at the requested production image (no changes)' :
    'Image-only web task replacement and ECS service update; workers and other infrastructure unchanged';
}

function main() {
  const [operation, path, imageTag, workerTag] = process.argv.slice(2);
  assert(operation && path, 'usage: node aws-release-guard.mjs worker-tag|verify-plan <json> [imageTag] [workerTag]');
  const document = JSON.parse(readFileSync(path, 'utf8'));
  if (operation === 'worker-tag') {
    process.stdout.write(currentWorkerTag(document) + '\n');
  } else if (operation === 'verify-plan') {
    process.stdout.write(verifyPlan(document, imageTag, workerTag) + '\n');
  } else {
    throw new Error('Unknown AWS release guard operation');
  }
}

if (process.argv[1]?.endsWith('/aws-release-guard.mjs')) main();
