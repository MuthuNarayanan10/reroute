import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const webhooksReceived = new client.Counter({
  name: 'reroute_webhooks_received_total',
  help: 'Webhooks received by source and topic',
  labelNames: ['source', 'topic', 'result'] as const,
  registers: [registry],
});

export const jobsProcessed = new client.Counter({
  name: 'reroute_jobs_processed_total',
  help: 'Background jobs processed',
  labelNames: ['queue', 'result'] as const,
  registers: [registry],
});

export const jobDuration = new client.Histogram({
  name: 'reroute_job_duration_seconds',
  help: 'Job processing time',
  labelNames: ['queue'] as const,
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const rerouteOutcomes = new client.Counter({
  name: 'reroute_cases_total',
  help: 'ReRoute case outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

export const prepaidOutcomes = new client.Counter({
  name: 'reroute_prepaid_conversions_total',
  help: 'COD-to-prepaid conversion outcomes',
  labelNames: ['outcome'] as const,
  registers: [registry],
});
