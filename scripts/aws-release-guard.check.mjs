import test from 'node:test';
import assert from 'node:assert/strict';
import { currentWorkerTag, verifyPlan } from './aws-release-guard.mjs';

const registry = '611622961299.dkr.ecr.eu-west-1.amazonaws.com/smie-prod:';
const oldTag = 'df9f0c1-prod';
const newTag = 'ceabe79-prod';
const environment = [
  { name: 'APP_ENV', value: 'production' },
  { name: 'SUPABASE_READ_ONLY', value: 'false' },
  { name: 'QUEUE_BACKEND', value: 'sqs' },
];
const def = (name, tag, extra = {}) => JSON.stringify([{
  name, image: registry + tag, environment, essential: true, ...extra,
}]);

function basePlan() {
  const variables = Object.fromEntries(Object.entries({
    aws_region: 'eu-west-1',
    name_prefix: 'smie-prod',
    create_resources: true,
    deploy_application: true,
    test_mode: false,
    enable_workers: true,
    worker_desired_count: 1,
    public_base_url: 'https://www.supermarket.ie',
    website_queue_backend: 'sqs',
    enable_outbound_email_on_aws: true,
    image_tag: newTag,
    image_tag_worker: oldTag,
    secret_arns: { SUPABASE_SERVICE_ROLE_KEY: 'arn:example' },
  }).map(([key, value]) => [key, { value }]));

  return {
    variables,
    planned_values: {
      root_module: {
        resources: [{ address: 'aws_ecs_task_definition.app[0]',
          values: { family: 'smie-prod', container_definitions: def('web', newTag) } }],
      },
    },
    resource_changes: [
      {
        mode: 'managed', address: 'aws_ecs_task_definition.app[0]',
        change: {
          actions: ['delete', 'create'],
          replace_paths: [['container_definitions']],
          before: { family: 'smie-prod', container_definitions: def('web', oldTag) },
          after: { family: 'smie-prod', container_definitions: def('web', newTag) },
        },
      },
      {
        mode: 'managed', address: 'aws_ecs_service.app[0]',
        change: {
          actions: ['update'],
          before: { name: 'smie-prod-svc', desired_count: 2, task_definition: 'old' },
          after: { name: 'smie-prod-svc', desired_count: 2, task_definition: 'new' },
        },
      },
    ],
  };
}

test('image-only production web rollout is accepted', () => {
  assert.match(verifyPlan(basePlan(), newTag, oldTag), /Image-only/);
});

test('worker tag comes from both existing task definitions', () => {
  const state = { values: { root_module: { resources: [
    { address: 'aws_ecs_task_definition.sqs_consumer[0]', values: { container_definitions: def('sqs-consumer', oldTag) } },
    { address: 'aws_ecs_task_definition.scheduled[0]', values: { container_definitions: def('scheduled', oldTag) } },
  ] } } };
  assert.equal(currentWorkerTag(state), oldTag);
  state.values.root_module.resources[1].values.container_definitions = def('scheduled', newTag);
  assert.throws(() => currentWorkerTag(state), /images differ/);
});

test('missing production tfvars guard rejects dangerous Terraform defaults', () => {
  const plan = basePlan();
  plan.variables.create_resources.value = false;
  assert.throws(() => verifyPlan(plan, newTag, oldTag), /create_resources/);
});

test('infrastructure destruction is prohibited', () => {
  const plan = basePlan();
  plan.resource_changes.push({ mode: 'managed', address: 'aws_vpc.this[0]', change: { actions: ['delete'] } });
  assert.throws(() => verifyPlan(plan, newTag, oldTag), /unexpected infrastructure change/);
});

test('worker modifications are prohibited during a web release', () => {
  const plan = basePlan();
  plan.resource_changes.push({ mode: 'managed', address: 'aws_ecs_task_definition.sqs_consumer[0]', change: { actions: ['delete', 'create'] } });
  assert.throws(() => verifyPlan(plan, newTag, oldTag), /unexpected infrastructure change/);
});

test('web runtime configuration changes are prohibited', () => {
  const plan = basePlan();
  const entry = plan.resource_changes[0];
  const changed = JSON.parse(entry.change.after.container_definitions);
  changed[0].environment[0].value = 'preview';
  entry.change.after.container_definitions = JSON.stringify(changed);
  assert.throws(() => verifyPlan(plan, newTag, oldTag), /web container changed/);
});

test('ECS service scaling or networking changes are prohibited', () => {
  const plan = basePlan();
  plan.resource_changes[1].change.after.desired_count = 0;
  assert.throws(() => verifyPlan(plan, newTag, oldTag), /ECS service attribute/);
});

test('unknown source image tags are rejected', () => {
  const plan = basePlan();
  assert.throws(() => verifyPlan(plan, 'not-a-prod-tag', oldTag), /image tag/);
});

test('already-current image with no mutations is safe', () => {
  const plan = basePlan();
  plan.resource_changes = [];
  assert.match(verifyPlan(plan, newTag, oldTag), /Already/);
});

test('AWS-refreshed container/task defaults are not treated as changes', () => {
  // Terraform refreshes the `before` from AWS, which echoes control-plane
  // defaults the config never sets. Only the image should drive the release.
  const plan = basePlan();
  const entry = plan.resource_changes[0];
  const before = JSON.parse(entry.change.before.container_definitions);
  before[0].portMappings = [{ containerPort: 3000, hostPort: 3000, protocol: 'tcp' }];
  before[0].mountPoints = [];
  before[0].systemControls = [];
  before[0].volumesFrom = [];
  entry.change.before.container_definitions = JSON.stringify(before);
  const after = JSON.parse(entry.change.after.container_definitions);
  after[0].portMappings = [{ containerPort: 3000, protocol: 'tcp' }];
  entry.change.after.container_definitions = JSON.stringify(after);
  entry.change.before.enable_fault_injection = false;
  entry.change.before.ipc_mode = '';
  entry.change.before.pid_mode = '';
  entry.change.after.enable_fault_injection = null;
  entry.change.after.ipc_mode = null;
  entry.change.after.pid_mode = null;
  assert.match(verifyPlan(plan, newTag, oldTag), /Image-only/);
});

test('a real non-empty port mapping or task attribute is still rejected', () => {
  const portPlan = basePlan();
  const portEntry = portPlan.resource_changes[0];
  const after = JSON.parse(portEntry.change.after.container_definitions);
  after[0].portMappings = [{ containerPort: 4000, protocol: 'tcp' }];
  portEntry.change.after.container_definitions = JSON.stringify(after);
  assert.throws(() => verifyPlan(portPlan, newTag, oldTag), /web container changed/);

  const attrPlan = basePlan();
  attrPlan.resource_changes[0].change.before.cpu = '512';
  attrPlan.resource_changes[0].change.after.cpu = '1024';
  assert.throws(() => verifyPlan(attrPlan, newTag, oldTag), /web task attribute changed/);
});
