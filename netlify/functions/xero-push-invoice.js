// netlify/functions/xero-push-invoice.js
//
// Matches the REAL Airtable "Invoices" table schema used in admin.html
// (see recordInvoiceToAirtable() and submitManualInvoice()):
//
//   Invoice Number, Booking ID, Booking Reference, Client Name, Client Email,
//   Sent To Name, Sent To Email, Amount, Status ('Paid'/'Unpaid'),
//   Issued Date, Sent Date, Billing Address, Is Manual, Line Items JSON, Notes
//
// Call this right after recordInvoiceToAirtable() succeeds (Netlify function
// call from admin.html, non-blocking), or right after submitManualInvoice()
// creates its Airtable record. Pass the Invoices table record ID.
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

    if (f['Xero Invoice ID']) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'already synced' }) };
    }

    // Billed-to contact — "Sent To" fields take priority (that's who the invoice
    // actually went to; may differ from the original booking client), falling
    // back to "Client Name"/"Client Email" for older or manual records.
    const contactName = f['Sent To Name'] || f['Client Name'];
    const contactEmail = f['Sent To Email'] || f['Client Email'];

    if (!contactEmail) {
      throw new Error('Invoice record has no client/recipient email — cannot create Xero contact');
    }

    // 1. Ensure the contact exists in Xero
    const xeroContact = await syncContact({ name: contactName, email: contactEmail });

    // 2. Build line items.
    //    Manual invoices store their lines in "Line Items JSON" (array of
    //    {desc, sub, sub2, ref, amount} — see admin.html's manual invoice /
    //    bulk invoice builders). Booking-derived invoices don't store a
    //    breakdown in Airtable, so we fall back to a single line using the
    //    invoice's total "Amount" (which is inc. VAT — Xero applies tax on
    //    top, so we back out VAT to get the ex-VAT unit amount Xero expects).
    let lineItems = [];
    if (f['Line Items JSON']) {
      try {
        const parsed = JSON.parse(f['Line Items JSON']);
        lineItems = parsed.map((item) => ({
          desc: item.desc,
          amount: item.amount, // already ex-VAT, per admin.html's manual invoice builder
        }));
      } catch (e) {
        console.warn('Could not parse Line Items JSON, falling back to single line:', e);
      }
    }
    if (lineItems.length === 0) {
      const amountIncVat = parseFloat(f['Amount'] || 0);
      const amountExVat = parseFloat((amountIncVat / 1.2).toFixed(2));
      lineItems = [{ desc: `Markeb Media — ${f['Booking Reference'] || f['Invoice Number']}`, amount: amountExVat }];
    }

    const isPaid = f['Status'] === 'Paid';
    const today = new Date().toISOString().split('T')[0];

    const invoicePayload = {
      Invoices: [
        {
          Type: 'ACCREC',
          Contact: { ContactID: xeroContact.ContactID },
          Date: f['Issued Date'] || today,
          DueDate: f['Issued Date'] || today, // your admin.html invoices are due on receipt
          InvoiceNumber: f['Invoice Number'],
          Reference: f['Booking Reference'] || '',
          LineItems: lineItems.map((item) => ({
            Description: item.desc,
            Quantity: 1,
            UnitAmount: item.amount,
            AccountCode: process.env.XERO_SALES_ACCOUNT_CODE || '200', // set to your Xero sales account code
            TaxType: process.env.XERO_TAX_TYPE || 'OUTPUT2', // UK 20% VAT on sales — confirm code in your Xero org
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

    // 3. If already marked Paid in Airtable, record the matching payment in Xero
    if (isPaid) {
      await xeroRequest('/Payments', {
        method: 'POST',
        body: JSON.stringify({
          Payments: [
            {
              Invoice: { InvoiceID: createdInvoice.InvoiceID },
              Account: { Code: process.env.XERO_BANK_ACCOUNT_CODE },
              Date: f['Sent Date'] || today,
              Amount: parseFloat(f['Amount'] || 0),
            },
          ],
        }),
      });
    }

    // 4. Store Xero IDs back on the Invoices record so we don't double-push
    await base(INVOICES_TABLE).update(invoiceRecordId, {
      'Xero Invoice ID': createdInvoice.InvoiceID,
      'Xero Contact ID': xeroContact.ContactID,
      'Xero Synced At': new Date().toISOString(),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, xeroInvoiceId: createdInvoice.InvoiceID }),
    };
  } catch (err) {
    console.error('Xero invoice push failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// Find an existing Xero contact by email, or create a new one
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