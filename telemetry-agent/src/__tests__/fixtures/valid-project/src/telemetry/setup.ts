import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  serviceName: 'valid-test-project',
  instrumentations: [],
});

sdk.start();
