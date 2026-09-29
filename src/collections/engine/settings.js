// Default follow-up timeline and email templates (from Aloha_Invoice_Templates_With_Subject Line.docx).
// Matt can edit all of this in Collections -> Settings; saved settings override these defaults.
//
// Placeholders: [Name] [Invoice #] [Amount] [Due Date] [PM Name] [Your Name] [Customer]
//               [Days] [Invoice Table] [Tax Invoice #]
// Day = days since the invoice date (Aloha invoices are net 15, so Day 16 = first day overdue).

const T = (lines) => lines.join('\n');

export const DEFAULT_STAGES = [
  {
    key: 'gentle',
    day: 5,
    label: 'Gentle reminder',
    tone: 'info',
    subject: 'Invoice [Invoice #] – [Amount] – Reminder',
    body: T([
      'Hi [Name],',
      '',
      'Hope all is well.',
      '',
      'Sharing a quick reminder on invoice [Invoice #] for [Amount], due on [Due Date].',
      '',
      'Kindly confirm if everything is in order for payment processing.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'followup',
    day: 10,
    label: 'Follow-up',
    tone: 'info',
    subject: 'Invoice [Invoice #] – [Amount] – Follow-up',
    body: T([
      'Hi [Name],',
      '',
      'Following up on invoice [Invoice #] for [Amount], due on [Due Date].',
      '',
      'Request you to please share an update on the payment timeline.',
      'Let me know if anything is pending from our side.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'overdue',
    day: 16,
    label: 'Overdue (+ PM)',
    tone: 'warn',
    addPm: true,
    subject: 'Invoice [Invoice #] – [Amount] – Overdue',
    body: T([
      'Hi [Name],',
      '',
      'This is to inform that invoice [Invoice #] for [Amount], due on [Due Date], is now pending.',
      '',
      'Request you to please prioritize this. Looping in [PM Name] in case anything is pending from our side.',
      '',
      'Look forward to your update.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'push',
    day: 20,
    label: 'Push',
    tone: 'warn',
    addPm: true,
    subject: 'Invoice [Invoice #] – [Amount] – Pending',
    body: T([
      'Hi [Name],',
      '',
      'Following up again on invoice [Invoice #] for [Amount], which is still pending.',
      '',
      'Would request you to please confirm the payment date.',
      'Happy to connect if anything needs to be resolved quickly.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'push2',
    day: 27,
    label: 'Push (again)',
    tone: 'warn',
    addPm: true,
    subject: 'Invoice [Invoice #] – [Amount] – Pending',
    body: T([
      'Hi [Name],',
      '',
      'Following up again on invoice [Invoice #] for [Amount], which is still pending.',
      '',
      'Would request you to please confirm the payment date.',
      'Happy to connect if anything needs to be resolved quickly.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'escalate',
    day: 30,
    label: 'Escalate',
    tone: 'bad',
    addPm: true,
    addEscalation: true,
    subject: 'Invoice [Invoice #] – [Amount] – Urgent',
    body: T([
      'Hi [Name],',
      '',
      'Invoice [Invoice #] for [Amount] has been pending for some time now.',
      '',
      'Request your immediate attention to close this. Please confirm the expected timeline.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'escalate2',
    day: 35,
    label: 'Escalate more',
    tone: 'bad',
    addPm: true,
    addEscalation: true,
    subject: 'Invoice [Invoice #] – [Amount] – Action Required',
    body: T([
      'Hi [Name],',
      '',
      'This is regarding invoice [Invoice #] for [Amount], which continues to remain pending despite multiple follow-ups.',
      '',
      'We request your immediate action to clear the dues. Please confirm the payment plan at the earliest.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
  {
    key: 'stopwork',
    day: 40,
    label: 'Stop work notice',
    tone: 'bad',
    addPm: true,
    addEscalation: true,
    subject: 'Invoice [Invoice #] – [Amount] – Stop Work Notice',
    body: T([
      'Hi [Name],',
      '',
      'This is regarding invoice [Invoice #] for [Amount], which remains unpaid.',
      '',
      'Request you to please clear the dues within the next 7 days. In case of further delay, we may need to review and pause ongoing services until the invoice is fully paid.',
      '',
      'Please treat this as priority and confirm the plan.',
      '',
      'Thanks,',
      '[Your Name]',
    ]),
  },
];

export const TAX_INVOICE_TEMPLATE = {
  subject: 'Tax Invoice [Tax Invoice #] – [Customer]',
  body: T([
    'Hi [Name],',
    '',
    'Please find attached the tax invoice [Tax Invoice #] against invoice [Invoice #] for [Amount].',
    '',
    'Kindly let me know if you need anything else.',
    '',
    'Thanks,',
    '[Your Name]',
  ]),
};

export const DEFAULT_SETTINGS = {
  // Timeline counts days from the invoice date ('invoice') or from the due date ('due').
  basis: 'invoice',
  // At most one reminder email per customer within this many days.
  minGapDays: 3,
  // While a customer's promise-to-pay date is in the future, hold their reminders.
  holdOnPromise: true,
  // Invoices older than this (days) at import are set to "Do not send" until Matt reviews them.
  staleDays: 365,
  senderName: 'Matt',
  senderEmail: 'matt@alohatechnology.com',
  signature: 'Matt\nFinance & Accounts\nAloha Technology',
  // Aloha people copied from Day 30 (escalation stages). Nidhi Ma'am's email to be filled in.
  internalEscalation: [{ name: 'Nidhi', email: '' }],
  // Always copied (e.g. an accounts mailbox). Optional.
  alwaysCc: [],
  // Stage keys Matt allows to go without his click (sent by the scheduled sender). Empty = all need approval.
  autoSend: [],
  stages: DEFAULT_STAGES,
  taxInvoice: TAX_INVOICE_TEMPLATE,
};

// Saved settings on top of defaults; stages merge by key so new default fields still appear.
export function withDefaults(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  const byKey = Object.fromEntries((saved?.stages || []).map((x) => [x.key, x]));
  s.stages = (saved?.stages?.length ? saved.stages : DEFAULT_STAGES).map((x) => ({
    ...(DEFAULT_STAGES.find((d) => d.key === x.key) || {}),
    ...byKey[x.key],
    ...x,
  }));
  s.stages.sort((a, b) => a.day - b.day);
  s.taxInvoice = { ...TAX_INVOICE_TEMPLATE, ...(saved?.taxInvoice || {}) };
  return s;
}
