// netlify/functions/xero-sync-payment.js
// Call this when a payment comes in AFTER the invoice was already pushed to Xero
// (e.g. your existing Stripe webhook handler, after it marks the Markeb invoice as paid).
//
// POST body: { invoiceRecordId: "recXXXXXXXXXXXXXX" }

const Airtable = require('airtable');
const { xeroRequest } = require('../../lib/xero-client');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INVOICES_TABLE = 'Invoices';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { invoiceRecordId } = JSON.parse(event.body || '{}');
  if (!invoiceRecordId) {
    return { statusCode: 400, body: 'Missing invoiceRecordId' };
  }

  try {
    const invoiceRecord = await base(INVOICES_TABLE).find(invoiceRecordId);
    const f = invoiceRecord.fields;

    if (!f['Xero Invoice ID']) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invoice not yet synced to Xero — push the invoice first' }),
      };
    }
    if (f['Xero Payment Synced']) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'payment already synced' }) };
    }

    await xeroRequest('/Payments', {
      method: 'POST',
      body: JSON.stringify({
        Payments: [
          {
            Invoice: { InvoiceID: f['Xero Invoice ID'] },
            Account: { Code: process.env.XERO_BANK_ACCOUNT_CODE },
            Date: new Date().toISOString().split('T')[0],
            Amount: parseFloat(f['Amount'] || 0),
          },
        ],
      }),
    });

    await base(INVOICES_TABLE).update(invoiceRecordId, {
'Xero Payment Synced': true,
'Xero Payment Synced At': new Date().toISOString(),
'Status': 'Paid',
'Paid Date': new Date().toISOString().split('T')[0],
    });

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Xero payment sync failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};