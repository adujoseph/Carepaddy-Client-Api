import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registry } from '@docs/registry';

export function generateOpenApiSpec() {
  const generator = new OpenApiGeneratorV3(registry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      title: 'CarePaddy Client API',
      version: '0.1.0',
      description:
        'API for care home tenant registration, guardian invitations, and item requests.',
    },
    servers: [{ url: '/api/v1' }],
  });
}
