import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture SQS commands the backend issues.
const sent: Array<{ type: string; input: Record<string, unknown> }> = [];

class FakeSend { constructor(public input: Record<string, unknown>) {} }
class FakeReceive { constructor(public input: Record<string, unknown>) {} }
class FakeDelete { constructor(public input: Record<string, unknown>) {} }
class FakeChangeVis { constructor(public input: Record<string, unknown>) {} }

let receiveResponse: { Messages?: Array<Record<string, unknown>> } = {};

vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: class {
    async send(cmd: { input: Record<string, unknown> }) {
      const name = cmd.constructor.name;
      if (name === 'FakeSend') { sent.push({ type: 'send', input: cmd.input }); return { MessageId: 'mid-1' }; }
      if (name === 'FakeReceive') { sent.push({ type: 'receive', input: cmd.input }); return receiveResponse; }
      if (name === 'FakeDelete') { sent.push({ type: 'delete', input: cmd.input }); return {}; }
      if (name === 'FakeChangeVis') { sent.push({ type: 'changevis', input: cmd.input }); return {}; }
      return {};
    }
  },
  SendMessageCommand: FakeSend,
  ReceiveMessageCommand: FakeReceive,
  DeleteMessageCommand: FakeDelete,
  ChangeMessageVisibilityCommand: FakeChangeVis,
}));

const ENV = ['AWS_REGION', 'SQS_URL_TESCO_SCRAPE_BATCHES'] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {}; for (const k of ENV) { saved[k] = process.env[k]; }
  sent.length = 0;
  receiveResponse = {};
  process.env.AWS_REGION = 'eu-west-1';
  process.env.SQS_URL_TESCO_SCRAPE_BATCHES = 'https://sqs.eu-west-1.amazonaws.com/123/tesco';
});
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.resetModules();
});

describe('sqsSend', () => {
  it('publishes to the topic queue with clamped delay and dedup attribute', async () => {
    const { sqsSend } = await import('../sqs-backend');
    const res = await sqsSend('tesco-scrape-batches', { hello: 'world' }, { idempotencyKey: 'run:0', delaySeconds: 5000 });
    expect(res.messageId).toBe('mid-1');
    const call = sent.find((s) => s.type === 'send')!;
    expect(call.input.QueueUrl).toContain('/tesco');
    expect(call.input.DelaySeconds).toBe(900); // clamped from 5000
    expect(JSON.parse(call.input.MessageBody as string)).toEqual({ hello: 'world' });
    expect((call.input.MessageAttributes as Record<string, { StringValue: string }>).idempotencyKey.StringValue).toBe('run:0');
  });

  it('throws if the topic has no configured queue URL', async () => {
    delete process.env.SQS_URL_TESCO_SCRAPE_BATCHES;
    const { sqsSend } = await import('../sqs-backend');
    await expect(sqsSend('tesco-scrape-batches', {})).rejects.toThrow(/queue URL not configured/);
  });
});

describe('sqsPollOnce retry/ack contract', () => {
  async function registerConsumer(handler: (m: unknown, meta: { deliveryCount: number }) => Promise<void>, retry?: (e: unknown, m: { deliveryCount: number }) => { acknowledge: true } | { afterSeconds: number }) {
    vi.resetModules();
    const { registerConsumer } = await import('../registry');
    registerConsumer({ topic: 'tesco-scrape-batches', handler: handler as never, options: { visibilityTimeoutSeconds: 600, retry: retry as never } });
    return await import('../sqs-backend');
  }

  it('deletes the message on success', async () => {
    receiveResponse = { Messages: [{ MessageId: 'm1', ReceiptHandle: 'r1', Body: '{"ok":true}', Attributes: { ApproximateReceiveCount: '1' } }] };
    const { sqsPollOnce } = await registerConsumer(async () => { /* success */ });
    await sqsPollOnce('tesco-scrape-batches');
    expect(sent.some((s) => s.type === 'delete')).toBe(true);
    expect(sent.some((s) => s.type === 'changevis')).toBe(false);
  });

  it('changes visibility (redeliver) when the handler throws and retry says afterSeconds', async () => {
    receiveResponse = { Messages: [{ MessageId: 'm2', ReceiptHandle: 'r2', Body: '{}', Attributes: { ApproximateReceiveCount: '2' } }] };
    const { sqsPollOnce } = await registerConsumer(
      async () => { throw new Error('transient'); },
      (_e, meta) => ({ afterSeconds: 20 * meta.deliveryCount }),
    );
    await sqsPollOnce('tesco-scrape-batches');
    const cv = sent.find((s) => s.type === 'changevis')!;
    expect(cv.input.VisibilityTimeout).toBe(40); // 20 * deliveryCount(2)
    expect(sent.some((s) => s.type === 'delete')).toBe(false);
  });

  it('acknowledges (deletes) when retry policy gives up', async () => {
    receiveResponse = { Messages: [{ MessageId: 'm3', ReceiptHandle: 'r3', Body: '{}', Attributes: { ApproximateReceiveCount: '9' } }] };
    const { sqsPollOnce } = await registerConsumer(
      async () => { throw new Error('exhausted'); },
      () => ({ acknowledge: true }),
    );
    await sqsPollOnce('tesco-scrape-batches');
    expect(sent.some((s) => s.type === 'delete')).toBe(true);
    expect(sent.some((s) => s.type === 'changevis')).toBe(false);
  });
});
