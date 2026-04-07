/**
 * OpenAPI 3 — extend as modules grow. Interactive docs at /api-docs
 */
module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'ACC ERP API',
    version: '1.0.0',
    description:
      'Customers, invoices, inventory, payments, and reports. Authenticate with Bearer JWT from POST /auth/login.',
  },
  servers: [{ url: '/' }],
  tags: [
    { name: 'Auth', description: 'Authentication' },
    { name: 'Customers', description: 'Customer master data & statements' },
    { name: 'Invoices', description: 'Sales invoices' },
    { name: 'Inventory', description: 'Products & stock' },
    { name: 'Payments', description: 'Customer payments' },
    { name: 'Reports', description: 'Analytics (sales)' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          '200': {
            description: 'Service is running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login — returns JWT',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Success with token' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Bootstrap first admin (only when no users exist)',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string' },
                  password: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Admin created' },
          '403': { description: 'Registration disabled' },
        },
      },
    },
    '/customers': {
      get: {
        tags: ['Customers'],
        security: [{ bearerAuth: [] }],
        summary: 'List customers (paginated)',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/invoices/create': {
      post: {
        tags: ['Invoices'],
        security: [{ bearerAuth: [] }],
        summary: 'Create invoice (deducts stock, updates customer)',
        responses: { '201': { description: 'Created' } },
      },
    },
  },
};
