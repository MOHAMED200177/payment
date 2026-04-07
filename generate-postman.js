const fs = require('fs');

const now = new Date().toISOString();

const vars = [
  ['baseUrl', 'http://localhost:8000'],
  ['authToken', ''],
  ['adminEmail', 'admin@accerp.com'],
  ['adminPassword', 'Admin#2026!'],
  ['adminName', 'System Administrator'],
  ['userId', ''],
  ['customerId', ''],
  ['customerName', 'Al Noor Pharmacy'],
  ['invoiceId', ''],
  ['invoiceNumber', '1001'],
  ['paymentId', ''],
  ['returnId', ''],
  ['stockId', ''],
  ['productId', ''],
  ['productName', 'Paracetamol 500mg'],
  ['supplierId', ''],
  ['supplierName', 'Cairo Medical Supplies'],
  ['categoryId', ''],
  ['purchaseOrderId', ''],
  ['reportCustomerId', ''],
  ['reportSupplierId', ''],
];

const toBody = (obj) => JSON.stringify(obj, null, 2);

const scriptLines = (
  expectedStatus = [200],
  requiredKeys = ['status'],
  setVars = []
) => {
  const lines = [];
  lines.push(
    `pm.test(\"Status code is one of ${expectedStatus.join('/')}\", function () {`
  );
  lines.push(
    `  pm.expect([${expectedStatus.join(',')}]).to.include(pm.response.code);`
  );
  lines.push('});');
  lines.push('');
  lines.push('pm.test("Response is JSON", function () {');
  lines.push('  pm.response.to.be.json;');
  lines.push('});');
  lines.push('');
  lines.push('let jsonData = {};');
  lines.push(
    'try { jsonData = pm.response.json(); } catch (e) { jsonData = {}; }'
  );
  lines.push('');
  for (const key of requiredKeys) {
    lines.push(`pm.test(\"Response contains ${key}\", function () {`);
    lines.push(`  pm.expect(jsonData).to.have.property('${key}');`);
    lines.push('});');
    lines.push('');
  }
  for (const setVar of setVars) {
    lines.push(setVar);
    lines.push('');
  }
  return lines.join('\n');
};

const req = ({
  name,
  method,
  path,
  desc,
  auth = false,
  query = [],
  body,
  expectedStatus,
  requiredKeys,
  tests,
  headers = [],
}) => {
  const allHeaders = [...headers];
  if (auth)
    allHeaders.push({ key: 'Authorization', value: 'Bearer {{authToken}}' });
  if (body !== undefined)
    allHeaders.push({ key: 'Content-Type', value: 'application/json' });

  const url = {
    raw: `{{baseUrl}}${path}`,
    host: ['{{baseUrl}}'],
    path: path.split('/').filter(Boolean),
  };
  if (query.length) url.query = query;

  const item = {
    name,
    request: {
      method,
      header: allHeaders,
      url,
      description: desc,
    },
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: tests || scriptLines(expectedStatus, requiredKeys),
        },
      },
    ],
    response: [],
  };

  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: typeof body === 'string' ? body : toBody(body),
      options: { raw: { language: 'json' } },
    };
  }

  return item;
};

const loginScript = scriptLines(
  [200],
  ['status', 'success', 'data'],
  [
    'pm.test("Auth token is present", function () {',
    '  pm.expect(jsonData.data).to.have.property("token");',
    '  pm.expect(jsonData.data.token).to.be.a("string").and.not.empty;',
    '});',
    'if (jsonData.data && jsonData.data.token) {',
    '  pm.collectionVariables.set("authToken", jsonData.data.token);',
    '}',
    'if (jsonData.data && jsonData.data.user && jsonData.data.user._id) {',
    '  pm.collectionVariables.set("userId", jsonData.data.user._id);',
    '}',
  ]
);

const captureIdScript = (
  varName,
  path = 'data.data._id',
  expected = [200, 201],
  keys = ['status']
) => {
  const parts = path.split('.');
  return scriptLines(expected, keys, [
    `const idValue = ${parts.reduce((acc, p) => `${acc} && ${acc}.${p}`, 'jsonData')};`,
    `if (idValue) pm.collectionVariables.set('${varName}', idValue);`,
  ]);
};

const folders = [];

folders.push({
  name: 'System',
  description: 'Operational endpoints for service availability checks.',
  item: [
    req({
      name: 'Health Check',
      method: 'GET',
      path: '/health',
      desc: 'Returns API liveness and uptime metadata.',
      expectedStatus: [200],
      requiredKeys: ['status', 'uptime', 'env'],
    }),
  ],
});

folders.push({
  name: 'Auth',
  description:
    'Authentication and user management. Login auto-saves JWT into authToken collection variable.',
  item: [
    req({
      name: 'Bootstrap Register Admin',
      method: 'POST',
      path: '/auth/register',
      desc: 'Creates first ADMIN user when database has no users.',
      body: {
        name: '{{adminName}}',
        email: '{{adminEmail}}',
        password: '{{adminPassword}}',
      },
      expectedStatus: [201, 403, 400],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Login',
      method: 'POST',
      path: '/auth/login',
      desc: 'Authenticates user and returns JWT token used by protected endpoints.',
      body: {
        email: '{{adminEmail}}',
        password: '{{adminPassword}}',
      },
      tests: loginScript,
    }),
    req({
      name: 'Get My Profile',
      method: 'GET',
      path: '/auth/me',
      desc: 'Returns authenticated user profile from JWT.',
      auth: true,
      expectedStatus: [200, 401],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Create User (Admin)',
      method: 'POST',
      path: '/auth/users',
      desc: 'Creates employee or accountant user. Requires ADMIN role token.',
      auth: true,
      body: {
        name: 'Fatma Hassan',
        email: 'fatma.hassan@accerp.com',
        password: 'Emp#2026Pass',
        role: 'EMPLOYEE',
      },
      expectedStatus: [201, 400, 401, 403],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Login Invalid Credentials (Edge)',
      method: 'POST',
      path: '/auth/login',
      desc: 'Negative test for invalid username/password.',
      body: {
        email: 'wrong.user@accerp.com',
        password: 'WrongPass123!',
      },
      expectedStatus: [401],
      requiredKeys: ['status', 'message'],
    }),
    req({
      name: 'Unauthorized Profile Access (Edge)',
      method: 'GET',
      path: '/auth/me',
      desc: 'Negative test for missing/invalid token.',
      headers: [{ key: 'Authorization', value: 'Bearer invalid_token_here' }],
      expectedStatus: [401],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Customers',
  description:
    'Customer CRUD, statements, and exports. All routes require Bearer JWT.',
  item: [
    req({
      name: 'List Customers',
      method: 'GET',
      path: '/customers',
      auth: true,
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'sort', value: '-createdAt' },
      ],
      desc: 'Returns paginated customers list. Supports filtering via query parameters.',
      expectedStatus: [200],
      requiredKeys: ['status', 'results', 'data'],
    }),
    req({
      name: 'Create Customer',
      method: 'POST',
      path: '/customers',
      auth: true,
      desc: 'Creates a new customer entity.',
      body: {
        name: '{{customerName}}',
        email: 'accounts@alnoor-pharmacy.com',
        phone: '+201001112223',
        address: '12 Tahrir St, Cairo',
        balance: 0,
        outstandingBalance: 0,
        cash: 0,
      },
      tests: captureIdScript(
        'customerId',
        'data.data._id',
        [201, 400, 409],
        ['status', 'data']
      ),
    }),
    req({
      name: 'Get Customer By Name (Profile)',
      method: 'POST',
      path: '/customers/profile',
      auth: true,
      desc: 'Finds one customer by name with related invoices, returns, payments, transactions.',
      body: { name: '{{customerName}}' },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Get Customer By ID',
      method: 'GET',
      path: '/customers/{{customerId}}',
      auth: true,
      desc: 'Fetches a single customer by ObjectId.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Customer',
      method: 'PATCH',
      path: '/customers/{{customerId}}',
      auth: true,
      desc: 'Updates mutable customer fields.',
      body: {
        address: '45 Salah Salem Rd, Cairo',
        phone: '+201001112224',
      },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Customer Statement',
      method: 'POST',
      path: '/customers/statement',
      auth: true,
      desc: 'Generates customer financial statement by customer name.',
      body: { name: '{{customerName}}' },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'customer', 'totals', 'transactions'],
    }),
    req({
      name: 'Customer Statement File (Excel)',
      method: 'POST',
      path: '/customers/statement/file',
      auth: true,
      desc: 'Downloads customer statement as spreadsheet. Body requires customer name.',
      body: { name: '{{customerName}}' },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Export Invoices PDF',
      method: 'GET',
      path: '/customers/export/pdf',
      auth: true,
      desc: 'Exports invoice report in PDF format. Implementation may accept date filter body on server side.',
      expectedStatus: [200, 404],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Export Invoices Excel',
      method: 'GET',
      path: '/customers/export/excel',
      auth: true,
      desc: 'Exports invoice report in Excel format. Implementation may accept date filter body on server side.',
      expectedStatus: [200, 404],
      requiredKeys: ['status'],
    }),
    req({
      name: 'Get Customer Not Found (Edge)',
      method: 'GET',
      path: '/customers/000000000000000000000000',
      auth: true,
      desc: 'Negative test for non-existing customer id.',
      expectedStatus: [404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Categories',
  description: 'Category master data APIs.',
  item: [
    req({
      name: 'List Categories',
      method: 'GET',
      path: '/categories',
      auth: true,
      desc: 'Returns all categories with pagination/filter support.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Category',
      method: 'POST',
      path: '/categories',
      auth: true,
      desc: 'Creates a category and optional hierarchy relation.',
      body: {
        name: 'Analgesics',
        description: 'Pain relief products',
        parentCategory: null,
      },
      tests: captureIdScript(
        'categoryId',
        'data.data._id',
        [201, 400, 409],
        ['status', 'data']
      ),
    }),
    req({
      name: 'Update Category',
      method: 'PATCH',
      path: '/categories/{{categoryId}}',
      auth: true,
      desc: 'Updates category details.',
      body: {
        description: 'Pain relief and fever reducers',
      },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Category',
      method: 'DELETE',
      path: '/categories/{{categoryId}}',
      auth: true,
      desc: 'Deletes category by id.',
      expectedStatus: [204, 404],
      requiredKeys: ['status'],
    }),
  ],
});

folders.push({
  name: 'Suppliers',
  description: 'Supplier CRUD and profile management.',
  item: [
    req({
      name: 'List Suppliers',
      method: 'GET',
      path: '/supplier',
      auth: true,
      desc: 'Returns suppliers list.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Supplier',
      method: 'POST',
      path: '/supplier',
      auth: true,
      desc: 'Creates a supplier record with contact and payment terms.',
      body: {
        name: '{{supplierName}}',
        contactPerson: 'Ahmed Nasser',
        email: 'sales@cairomedical.com',
        phone: '+20225551234',
        address: {
          street: 'Industrial Zone 3',
          city: 'Giza',
          state: 'Giza',
          country: 'Egypt',
          postalCode: '12566',
        },
        taxNumber: 'EG-TAX-889913',
        paymentTerms: 'net_30',
        accountNumber: '00212234455',
        active: true,
        notes: 'Primary pharmaceutical supplier',
      },
      tests: captureIdScript(
        'supplierId',
        'data.data._id',
        [201, 400, 409],
        ['status', 'data']
      ),
    }),
    req({
      name: 'Get Supplier By ID',
      method: 'GET',
      path: '/supplier/{{supplierId}}',
      auth: true,
      desc: 'Fetches one supplier by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Supplier',
      method: 'PATCH',
      path: '/supplier/{{supplierId}}',
      auth: true,
      desc: 'Updates supplier details.',
      body: {
        notes: 'Priority deliveries every Monday',
        paymentTerms: 'net_15',
      },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Supplier',
      method: 'DELETE',
      path: '/supplier/{{supplierId}}',
      auth: true,
      desc: 'Deletes supplier by id.',
      expectedStatus: [204, 404],
      requiredKeys: ['status'],
    }),
  ],
});

folders.push({
  name: 'Products',
  description: 'Product catalog management with supplier/category validation.',
  item: [
    req({
      name: 'List Products',
      method: 'GET',
      path: '/product',
      auth: true,
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
      ],
      desc: 'Returns products with populated supplier and category.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Product',
      method: 'POST',
      path: '/product',
      auth: true,
      desc: 'Creates product by supplier/category names, validates pricing.',
      body: {
        category: 'Analgesics',
        supplier: '{{supplierName}}',
        name: '{{productName}}',
        productCode: 'PRD-PCM-500',
        costPrice: 8.5,
        sellingPrice: 12.5,
        unit: 'box',
        description: 'Paracetamol tablets 500mg',
        barcode: '6223001234567',
        taxes: 14,
        reorderLevel: 30,
      },
      tests: captureIdScript(
        'productId',
        'data._id',
        [201, 400, 404, 409],
        ['status', 'data']
      ),
    }),
    req({
      name: 'Get Product By ID',
      method: 'GET',
      path: '/product/{{productId}}',
      auth: true,
      desc: 'Returns one product with category and supplier details.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Product',
      method: 'PATCH',
      path: '/product/{{productId}}',
      auth: true,
      desc: 'Updates product fields like selling price, taxes, and description.',
      body: {
        sellingPrice: 13,
        taxes: 14,
        reorderLevel: 25,
        description: 'Updated product description for 500mg tablets',
      },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Product',
      method: 'DELETE',
      path: '/product/{{productId}}',
      auth: true,
      desc: 'Deletes product by id.',
      expectedStatus: [204, 404],
      requiredKeys: ['status'],
    }),
  ],
});

folders.push({
  name: 'Stock',
  description: 'Inventory stock quantity and expiry tracking.',
  item: [
    req({
      name: 'List Stock',
      method: 'GET',
      path: '/stock',
      auth: true,
      desc: 'Returns stock records with populated product details.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Stock',
      method: 'POST',
      path: '/stock',
      auth: true,
      desc: 'Creates initial stock entry for product by name.',
      body: {
        productName: '{{productName}}',
        quantity: 250,
        batchNumber: 'BATCH-APR-2026-01',
        expiryDate: '2027-04-30T00:00:00.000Z',
      },
      tests: captureIdScript(
        'stockId',
        'data._id',
        [201, 400, 404, 409],
        ['status', 'data']
      ),
    }),
    req({
      name: 'Get Stock By ID',
      method: 'GET',
      path: '/stock/{{stockId}}',
      auth: true,
      desc: 'Fetches one stock record by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Stock',
      method: 'PATCH',
      path: '/stock/{{stockId}}',
      auth: true,
      desc: 'Updates stock quantity or batch metadata.',
      body: {
        quantity: 220,
        batchNumber: 'BATCH-APR-2026-01A',
      },
      expectedStatus: [200, 404, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Stock',
      method: 'DELETE',
      path: '/stock/{{stockId}}',
      auth: true,
      desc: 'Deletes stock entry by id.',
      expectedStatus: [204, 404],
      requiredKeys: ['status'],
    }),
  ],
});

folders.push({
  name: 'Invoices',
  description:
    'Invoice lifecycle operations including create, update, status transition, and deletion.',
  item: [
    req({
      name: 'List Invoices',
      method: 'GET',
      path: '/invoices',
      auth: true,
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
      ],
      desc: 'Returns all invoices with pagination.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Invoice',
      method: 'POST',
      path: '/invoices/create',
      auth: true,
      desc: 'Creates invoice with customer info and product line items, updates stock and transactions.',
      body: {
        name: '{{customerName}}',
        email: 'accounts@alnoor-pharmacy.com',
        phone: '+201001112223',
        items: [
          {
            product: '{{productName}}',
            quantity: 3,
          },
        ],
        amount: 20,
        discount: 5,
      },
      tests: scriptLines(
        [201, 400, 404],
        ['status', 'data'],
        [
          'const createdInvoiceId = jsonData && jsonData.data && (jsonData.data._id || (jsonData.data.invoice && jsonData.data.invoice._id));',
          'if (createdInvoiceId) pm.collectionVariables.set("invoiceId", createdInvoiceId);',
          'const createdInvoiceNumber = jsonData && jsonData.data && (jsonData.data.invoiceNumber || (jsonData.data.invoice && jsonData.data.invoice.invoiceNumber));',
          'if (createdInvoiceNumber) pm.collectionVariables.set("invoiceNumber", String(createdInvoiceNumber));',
        ]
      ),
    }),
    req({
      name: 'Get Invoice By Number',
      method: 'POST',
      path: '/invoices/info',
      auth: true,
      desc: 'Retrieves invoice details using invoice number.',
      body: {
        invoiceNumber: '{{invoiceNumber}}',
      },
      tests: scriptLines(
        [200, 404, 400],
        ['status', 'data'],
        [
          'const invoiceObj = jsonData && jsonData.data && (jsonData.data.data || jsonData.data);',
          'if (invoiceObj && invoiceObj._id) pm.collectionVariables.set("invoiceId", invoiceObj._id);',
        ]
      ),
    }),
    req({
      name: 'Get Invoice By ID',
      method: 'GET',
      path: '/invoices/{{invoiceId}}',
      auth: true,
      desc: 'Fetches single invoice by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Invoice',
      method: 'PATCH',
      path: '/invoices/{{invoiceId}}',
      auth: true,
      desc: 'Updates invoice data and recalculates totals as needed.',
      body: {
        discount: 10,
        amount: 30,
        notes: 'Updated after customer negotiation',
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Invoice Status',
      method: 'PATCH',
      path: '/invoices/{{invoiceId}}/status',
      auth: true,
      desc: 'Transitions invoice status. For paid status, paymentAmount records payment.',
      body: {
        status: 'paid',
        paymentAmount: 10,
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Invoice',
      method: 'DELETE',
      path: '/invoices/{{invoiceId}}',
      auth: true,
      desc: 'Deletes invoice and related transactions.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Payments',
  description: 'Customer payment processing and payment history.',
  item: [
    req({
      name: 'List Payments',
      method: 'GET',
      path: '/payment',
      auth: true,
      desc: 'Returns payments list with customer/invoice references.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Add Payment',
      method: 'POST',
      path: '/payment/add',
      auth: true,
      desc: 'Creates payment for a customer with optional invoice number.',
      body: {
        name: '{{customerName}}',
        amount: 50,
        invoiceNumber: '{{invoiceNumber}}',
      },
      tests: scriptLines(
        [201, 400, 404],
        ['status', 'data'],
        [
          'const paymentObj = jsonData && jsonData.data && (jsonData.data.payment || jsonData.data);',
          'if (paymentObj && paymentObj._id) pm.collectionVariables.set("paymentId", paymentObj._id);',
        ]
      ),
    }),
    req({
      name: 'Get Payment By ID',
      method: 'GET',
      path: '/payment/{{paymentId}}',
      auth: true,
      desc: 'Fetches payment details by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Payment',
      method: 'PATCH',
      path: '/payment/{{paymentId}}',
      auth: true,
      desc: 'Updates payment attributes such as amount, method, notes.',
      body: {
        amount: 40,
        method: 'Bank Transfer',
        notes: 'Corrected transfer amount',
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Payment',
      method: 'DELETE',
      path: '/payment/{{paymentId}}',
      auth: true,
      desc: 'Deletes a payment and reverts related balances.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Returns',
  description:
    'Sales return retrieval and management endpoints. Create return route is currently not exposed in router.',
  item: [
    req({
      name: 'List Returns',
      method: 'GET',
      path: '/return',
      auth: true,
      desc: 'Returns all return records.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Get Return By ID',
      method: 'GET',
      path: '/return/{{returnId}}',
      auth: true,
      desc: 'Fetches return record by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Update Return',
      method: 'PATCH',
      path: '/return/{{returnId}}',
      auth: true,
      desc: 'Updates mutable fields on return record.',
      body: {
        reason: 'Customer changed medication',
        quantity: 1,
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Return',
      method: 'DELETE',
      path: '/return/{{returnId}}',
      auth: true,
      desc: 'Soft-deletes return and restores stock/customer balances according to business logic.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Sales Reports',
  description:
    'Business report endpoints under /sales. These routes are mounted without protect middleware in app.js.',
  item: [
    req({
      name: 'Comprehensive Financial Report',
      method: 'POST',
      path: '/sales/financial',
      desc: 'Builds financial report with revenue, refunds, net sales, and breakdowns.',
      body: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
      },
      expectedStatus: [200, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Top Products Report',
      method: 'POST',
      path: '/sales/top-products',
      desc: 'Returns top products by quantity or revenue.',
      body: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        limit: 10,
        sortBy: 'quantity',
      },
      expectedStatus: [200, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Customer Analysis Report',
      method: 'POST',
      path: '/sales/customer-analysis',
      desc: 'Returns customer purchasing and payment behavior analysis.',
      body: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
        limit: 15,
      },
      expectedStatus: [200, 400],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Sales By Category Report',
      method: 'POST',
      path: '/sales/sales-by-category',
      desc: 'Aggregates sales by product category for selected period.',
      body: {
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2026-03-31T23:59:59.999Z',
      },
      expectedStatus: [200, 400],
      requiredKeys: ['status', 'data'],
    }),
  ],
});

const reportQueryDefaults = [
  { key: 'startDate', value: '2026-01-01T00:00:00.000Z' },
  { key: 'endDate', value: '2026-03-31T23:59:59.999Z' },
];

folders.push({
  name: 'Analytics Reports',
  description: 'Advanced analytics endpoints under /reports (JWT protected).',
  item: [
    req({
      name: 'Sales Summary',
      method: 'GET',
      path: '/reports/sales',
      auth: true,
      query: [...reportQueryDefaults, { key: 'period', value: 'monthly' }],
      desc: 'Returns high-level sales summary for selected date range.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Revenue Trend',
      method: 'GET',
      path: '/reports/sales/trend',
      auth: true,
      query: [...reportQueryDefaults, { key: 'granularity', value: 'month' }],
      desc: 'Returns time-series revenue trend.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Top Products Analytics',
      method: 'GET',
      path: '/reports/sales/top-products',
      auth: true,
      query: [
        ...reportQueryDefaults,
        { key: 'limit', value: '10' },
        { key: 'sortBy', value: 'quantity' },
      ],
      desc: 'Returns top-selling products list.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Sales By Customer',
      method: 'GET',
      path: '/reports/sales/by-customer',
      auth: true,
      query: [...reportQueryDefaults, { key: 'limit', value: '10' }],
      desc: 'Returns sales contribution by customer.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Profit Per Sale',
      method: 'GET',
      path: '/reports/sales/profit',
      auth: true,
      query: [
        ...reportQueryDefaults,
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
      ],
      desc: 'Returns per-sale profitability with pagination metadata.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data', 'meta'],
    }),
    req({
      name: 'Inventory Levels',
      method: 'GET',
      path: '/reports/inventory',
      auth: true,
      query: [
        { key: 'page', value: '1' },
        { key: 'limit', value: '20' },
        { key: 'lowStockOnly', value: 'false' },
      ],
      desc: 'Returns stock levels and inventory summary.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data', 'summary', 'meta'],
    }),
    req({
      name: 'Inventory Movement',
      method: 'GET',
      path: '/reports/inventory/movement',
      auth: true,
      query: [
        ...reportQueryDefaults,
        { key: 'productId', value: '{{productId}}' },
      ],
      desc: 'Returns stock movement history for optional product.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Dead Stock',
      method: 'GET',
      path: '/reports/inventory/dead-stock',
      auth: true,
      query: [...reportQueryDefaults, { key: 'limit', value: '10' }],
      desc: 'Returns products with low/no movement.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Most Used Products',
      method: 'GET',
      path: '/reports/inventory/most-used',
      auth: true,
      query: [...reportQueryDefaults, { key: 'limit', value: '10' }],
      desc: 'Returns products with highest usage in period.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Top Customers',
      method: 'GET',
      path: '/reports/customers/top',
      auth: true,
      query: [...reportQueryDefaults, { key: 'limit', value: '10' }],
      desc: 'Returns top customers by sales contribution.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Customer Debt Report',
      method: 'GET',
      path: '/reports/customers/debt',
      auth: true,
      desc: 'Returns customer outstanding balances and summary.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data', 'summary'],
    }),
    req({
      name: 'Customer Statement Analytics',
      method: 'GET',
      path: '/reports/customers/{{reportCustomerId}}/statement',
      auth: true,
      query: reportQueryDefaults,
      desc: 'Returns one customer statement by customer id and date range.',
      expectedStatus: [200, 404],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Supplier Outstanding Balances',
      method: 'GET',
      path: '/reports/suppliers/outstanding',
      auth: true,
      desc: 'Returns supplier balances outstanding summary.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data', 'summary'],
    }),
    req({
      name: 'Supplier Statement',
      method: 'GET',
      path: '/reports/suppliers/{{reportSupplierId}}/statement',
      auth: true,
      query: reportQueryDefaults,
      desc: 'Returns one supplier statement by supplier id and date range.',
      expectedStatus: [200, 404],
      requiredKeys: ['success', 'data'],
    }),
    req({
      name: 'Financial Summary Analytics',
      method: 'GET',
      path: '/reports/financial-summary',
      auth: true,
      query: reportQueryDefaults,
      desc: 'Returns consolidated financial summary for selected period.',
      expectedStatus: [200],
      requiredKeys: ['success', 'data'],
    }),
  ],
});

folders.push({
  name: 'Purchase Orders',
  description:
    'Purchase order creation, receiving, payment, cancellation, and stats.',
  item: [
    req({
      name: 'List Purchase Orders',
      method: 'GET',
      path: '/purchase-orders',
      auth: true,
      desc: 'Returns purchase orders list.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Create Purchase Order',
      method: 'POST',
      path: '/purchase-orders',
      auth: true,
      desc: 'Creates purchase order from supplier name and item lines.',
      body: {
        supplierName: '{{supplierName}}',
        items: [
          {
            product: '{{productId}}',
            quantity: 100,
            unitCost: 7.5,
          },
        ],
        discount: 2,
        tax: 14,
        expectedDeliveryDate: '2026-05-20T00:00:00.000Z',
        notes: 'Urgent refill for Q2 demand',
        amountPaid: 200,
      },
      tests: scriptLines(
        [201, 400, 404],
        ['status', 'data'],
        [
          'const poObj = jsonData && jsonData.data;',
          'if (poObj && poObj._id) pm.collectionVariables.set("purchaseOrderId", poObj._id);',
        ]
      ),
    }),
    req({
      name: 'Purchase Order Stats',
      method: 'GET',
      path: '/purchase-orders/stats',
      auth: true,
      desc: 'Returns purchase order KPIs and aggregates.',
      expectedStatus: [200],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Get Purchase Order By ID',
      method: 'GET',
      path: '/purchase-orders/{{purchaseOrderId}}',
      auth: true,
      desc: 'Fetches one purchase order by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Receive Purchase Order Items',
      method: 'PATCH',
      path: '/purchase-orders/{{purchaseOrderId}}/receive',
      auth: true,
      desc: 'Marks items as received and updates stock quantities.',
      body: {
        items: [
          {
            product: '{{productId}}',
            receivedQuantity: 60,
          },
        ],
        notes: 'Partial receipt from supplier shipment #1',
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Add Supplier Payment',
      method: 'POST',
      path: '/purchase-orders/{{purchaseOrderId}}/payment',
      auth: true,
      desc: 'Registers payment against purchase order payable.',
      body: {
        amount: 350,
        method: 'Bank Transfer',
        notes: 'Transfer ref: BT-PO-2026-0041',
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Cancel Purchase Order',
      method: 'PATCH',
      path: '/purchase-orders/{{purchaseOrderId}}/cancel',
      auth: true,
      desc: 'Cancels a non-fully-received purchase order and reverts received stock where applicable.',
      body: {
        reason: 'Supplier failed to meet quality requirements',
      },
      expectedStatus: [200, 400, 404],
      requiredKeys: ['status', 'data'],
    }),
    req({
      name: 'Delete Purchase Order',
      method: 'DELETE',
      path: '/purchase-orders/{{purchaseOrderId}}',
      auth: true,
      desc: 'Deletes purchase order record by id.',
      expectedStatus: [200, 404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

folders.push({
  name: 'Edge Cases',
  description:
    'Negative scenarios for invalid input, unauthorized access, and not found resources.',
  item: [
    req({
      name: 'Invalid Product Input',
      method: 'POST',
      path: '/product',
      auth: true,
      desc: 'Attempts product creation with invalid negative pricing to validate input handling.',
      body: {
        category: 'Analgesics',
        supplier: '{{supplierName}}',
        name: 'Broken Product',
        productCode: 'BROKEN-001',
        costPrice: -5,
        sellingPrice: -1,
        unit: 'box',
      },
      expectedStatus: [400],
      requiredKeys: ['status', 'message'],
    }),
    req({
      name: 'Unauthorized Protected Endpoint',
      method: 'GET',
      path: '/customers',
      headers: [
        { key: 'Authorization', value: 'Bearer expired_or_invalid_token' },
      ],
      desc: 'Verifies protected endpoint rejects invalid token.',
      expectedStatus: [401],
      requiredKeys: ['status', 'message'],
    }),
    req({
      name: 'Not Found Purchase Order',
      method: 'GET',
      path: '/purchase-orders/000000000000000000000000',
      auth: true,
      desc: 'Verifies not-found handling for unknown purchase order id.',
      expectedStatus: [404],
      requiredKeys: ['status', 'message'],
    }),
  ],
});

const collection = {
  info: {
    _postman_id: 'e74f9638-e847-4f0d-9ab1-acc-erp-api-complete',
    name: 'ACC ERP Backend API - Complete',
    description: [
      'Complete API collection auto-generated from project routes/controllers.',
      '',
      'Coverage includes: Auth, Customers, Categories, Suppliers, Products, Stock, Invoices, Payments, Returns, Sales Reports, Analytics Reports, Purchase Orders, and negative edge cases.',
      '',
      'Authentication:',
      '- Run Auth > Login to capture JWT token into collection variable authToken.',
      '- Protected endpoints send Authorization: Bearer {{authToken}}.',
      '',
      `Generated at: ${now}`,
    ].join('\n'),
    schema:
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: folders.map((f) => ({
    name: f.name,
    description: f.description,
    item: f.item,
  })),
  variable: vars.map(([key, value]) => ({ key, value, type: 'string' })),
};

fs.writeFileSync(
  'ACC_ERP_Complete_Postman_Collection.json',
  JSON.stringify(collection, null, 2)
);
console.log('Collection generated: ACC_ERP_Complete_Postman_Collection.json');
