// lib/push-invoice-to-xero.js
//
// Shared logic for pushing a single Airtable "Invoices" record to Xero.
// Used by both:
//   - netlify/functions/xero-push-invoice.js (live, triggered per-invoice)
//   - netlify/functions/xero-backfill-invoices-background.js (one-time bulk backfill)
//
// Returns { skipped, xeroInvoiceId } on success, throws on failure.

const Airtable = require('airtable');
const { xeroRequest } = require('./xero-client');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const INVOICES_TABLE = 'Invoices';

async function pushInvoiceToXero(invoiceRecordId) {
  const invoiceRecord = await base(INVOICES_TABLE).find(invoiceRecordId);
  const f = invoiceRecord.fields;

  if (f['Xero Invoice ID']) {
    return { skipped: true, reason: 'already synced' };
  }

  const contactName = f['Sent To Name'] || f['Client Name'];
  const contactEmail = f['Sent To Email'] || f['Client Email'];

  if (!contactEmail) {
    throw new Error(`Invoice ${f['Invoice Number'] || invoiceRecordId} has no client/recipient email — cannot create Xero contact`);
  }

  const xeroContact = await syncContact({ name: contactName, email: contactEmail });

  let lineItems = [];
  if (f['Line Items JSON']) {
    try {
      const parsed = JSON.parse(f['Line Items JSON']);
      lineItems = parsed.map((item) => ({ desc: item.desc, amount: item.amount }));
    } catch (e) {
      console.warn(`Could not parse Line Items JSON for ${invoiceRecordId}, falling back to single line:`, e.message);
    }
  }
  if (lineItems.length === 0) {
    const amountIncVat = parseFloat(f['Amount'] || 0);
    const amountExVat = parseFloat((amountIncVat / 1.2).toFixed(2));
    lineItems = [{ desc: `Markeb Media — ${f['Booking Reference'] || f['Invoice Number']}`, amount: amountExVat }];
  }

  const isPaid = f['Status'] === 'Paid';
  const today = new Date().toISOString().split('T')[0];
  const issuedDate = f['Issued Date'] || today;

  const invoicePayload = {
    Invoices: [
      {
        Type: 'ACCREC',
        Contact: { ContactID: xeroContact.ContactID },
        Date: issuedDate,
        DueDate: issuedDate,
        InvoiceNumber: f['Invoice Number'],
        Reference: f['Booking Reference'] || '',
        LineItems: lineItems.map((item) => ({
          Description: item.desc,
          Quantity: 1,
          UnitAmount: item.amount,
          AccountCode: process.env.XERO_SALES_ACCOUNT_CODE || '200',
          TaxType: process.env.XERO_TAX_TYPE || 'OUTPUT2',
        })),
        Status: 'AUTHORISED',
      },
    ],
  };

  const result = await xeroRequest('/Invoices', {
    method: 'POST',
    body: JSON.stringify(invoicePayload),
  });

  const createdInvoice = result.Invoices[0];

  if (isPaid) {
    await xeroRequest('/Payments', {
      method: 'POST',
      body: JSON.stringify({
        Payments: [
          {
            Invoice: { InvoiceID: createdInvoice.InvoiceID },
            Account: { Code: process.env.XERO_BANK_ACCOUNT_CODE },
            Date: f['Sent Date'] || issuedDate,
            Amount: parseFloat(f['Amount'] || 0),
          },
        ],
      }),
    });
  }

  await base(INVOICES_TABLE).update(invoiceRecordId, {
    'Xero Invoice ID': createdInvoice.InvoiceID,
    'Xero Contact ID': xeroContact.ContactID,
    'Xero Synced At': new Date().toISOString(),
    ...(isPaid ? { 'Xero Payment Synced': true, 'Xero Payment Synced At': new Date().toISOString() } : {}),
  });

  return { skipped: false, xeroInvoiceId: createdInvoice.InvoiceID };
}

async function syncContact({ name, email }) {
  const searchResult = await xeroRequest(`/Contacts?where=EmailAddress="${email}"`);

  if (searchResult.Contacts && searchResult.Contacts.length) {
    return searchResult.Contacts[0];
  }

  const createResult = await xeroRequest('/Contacts', {
    method: 'POST',
    body: JSON.stringify({
      Contacts: [{ Name: name, EmailAddress: email }],
    }),
  });

  return createResult.Contacts[0];
}

module.exports = { pushInvoiceToXero };