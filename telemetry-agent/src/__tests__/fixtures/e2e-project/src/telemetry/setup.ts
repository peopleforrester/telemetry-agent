import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  serviceName: 'e2e-test-service',
  instrumentations: [],
});
sdk.start();
