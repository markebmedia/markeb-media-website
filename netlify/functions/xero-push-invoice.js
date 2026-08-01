// netlify/functions/xero-push-invoice.js
//
// Live trigger — called right after recordInvoiceToAirtable() or
// submitManualInvoice() saves an Invoices record. Pushes just that one
// record to Xero.
//
// POST body: { invoiceRecordId: "recXXXXXXXXXXXXXX" }

const { pushInvoiceToXero } = require('../../lib/push-invoice-to-xero');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { invoiceRecordId } = JSON.parse(event.body || '{}');
  if (!invoiceRecordId) {
    return { statusCode: 400, body: 'Missing invoiceRecordId' };
  }

  try {
    const result = await pushInvoiceToXero(invoiceRecordId);
    return { statusCode: 200, body: JSON.stringify({ success: true, ...result }) };
  } catch (err) {
    console.error('Xero invoice push failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};