// Checks the Collections row-level security (collections.sql on top of schema.sql) in PGlite.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as
    $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.jwt() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`;

let db;
async function as(email, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [email ? JSON.stringify({ email }) : '']);
  await db.exec(`set role ${email ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const fails = (p) => p.then(() => false, () => true);

before(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const col = fs.readFileSync(new URL('./collections.sql', import.meta.url), 'utf8');
  await db.exec(col);
  await db.exec(col); // re-runnable
  await db.exec(`
    insert into app_users (email, role, pm_id, name) values
      ('matt@aloha.test', 'admin', null, 'Matt'),
      ('boss@aloha.test', 'leadership', null, 'Boss'),
      ('priya@aloha.test', 'pm', 'priya@aloha.test', 'Priya'),
      ('acc@aloha.test', 'accounts', null, 'Accounts'),
      ('acc2@aloha.test', 'accounts', null, 'Accounts 2');
    insert into col_customers (id, data) values ('acme', '{"name": "Acme Inc", "contacts": [{"email": "ap@acme.com"}]}');
    insert into col_invoices (id, data) values
      ('apte1', jsonb_build_object('number', 'APTE -1', 'customerId', 'acme', 'date', to_char(now(), 'YYYY-MM-DD'), 'amount', 3000, 'balance', 3000, 'status', 'open'));
    insert into col_payments (id, data) values ('P1', '{"amountReceived": 3000}');
  `);
});

test('admin reads and writes everything', async () => {
  await as('matt@aloha.test', async () => {
    assert.equal((await rows('select * from col_customers')).length, 1);
    await db.query(`insert into col_contracts (id, data) values ('K1', '{"title": "MSA"}')`);
    await db.query(`insert into col_audit (by, kind) values ('Matt', 'contracts')`);
    assert.equal((await rows('select * from col_contracts')).length, 1);
  });
});

test('leadership reads everything but cannot write', async () => {
  await as('boss@aloha.test', async () => {
    assert.equal((await rows('select * from col_invoices')).length, 1);
    assert.equal((await rows('select * from col_payments')).length, 1);
    assert.ok(await fails(db.query(`insert into col_customers (id, data) values ('x', '{}')`)));
    await db.query(`update col_invoices set data = '{}'`);
    assert.equal((await rows(`select data ->> 'number' n from col_invoices`))[0].n, 'APTE -1'); // update matched no rows
  });
});

test('PMs see nothing in Collections', async () => {
  await as('priya@aloha.test', async () => {
    for (const t of ['col_customers', 'col_invoices', 'col_payments', 'col_contracts', 'col_outbox', 'col_settings', 'col_tax_invoices', 'col_audit'])
      assert.equal((await rows(`select * from ${t}`)).length, 0, t);
    assert.equal((await rows('select * from col_invoice_directory()')).length, 0);
  });
});

test('accounts: directory only, no customer or payment data', async () => {
  await as('acc@aloha.test', async () => {
    assert.equal((await rows('select * from col_customers')).length, 0);
    assert.equal((await rows('select * from col_invoices')).length, 0);
    assert.equal((await rows('select * from col_payments')).length, 0);
    const dir = await rows('select * from col_invoice_directory()');
    assert.equal(dir.length, 1);
    assert.equal(dir[0].customer_name, 'Acme Inc');
    assert.deepEqual(Object.keys(dir[0]).sort(), ['amount', 'currency', 'customer_id', 'customer_name', 'date', 'id', 'number', 'paid_at', 'status']);
  });
});

test('accounts upload tax invoices; only Matt can check or send them', async () => {
  await as('acc@aloha.test', async () => {
    await db.query(`insert into col_tax_invoices (id, data) values ('T1', '{"status": "uploaded", "invoiceId": "apte1"}')`);
    assert.ok(await fails(db.query(`insert into col_tax_invoices (id, data) values ('T2', '{"status": "sent"}')`)));
    assert.ok(await fails(db.query(`update col_tax_invoices set data = '{"status": "checked"}' where id = 'T1'`)));
    await db.query(`update col_tax_invoices set data = '{"status": "uploaded", "invoiceId": "apte1", "fileName": "v2.pdf"}' where id = 'T1'`);
  });
  await as('acc2@aloha.test', async () => {
    await db.query(`update col_tax_invoices set data = '{"status": "uploaded", "fileName": "hijack.pdf"}' where id = 'T1'`);
  });
  await as('matt@aloha.test', async () => {
    const [t] = await rows(`select data, uploaded_by from col_tax_invoices where id = 'T1'`);
    assert.equal(t.data.fileName, 'v2.pdf'); // the other accounts user could not change it
    assert.equal(t.uploaded_by, 'acc@aloha.test');
    await db.query(`update col_tax_invoices set data = data || '{"status": "checked"}' where id = 'T1'`);
  });
  await as('acc@aloha.test', async () => {
    // Checked: accounts can no longer replace it.
    await db.query(`update col_tax_invoices set data = '{"status": "uploaded"}' where id = 'T1'`);
  });
  await as('boss@aloha.test', async () => {
    assert.equal((await rows(`select data ->> 'status' s from col_tax_invoices where id = 'T1'`))[0].s, 'checked');
  });
});

test('anonymous visitors see nothing', async () => {
  await as(null, async () => {
    assert.ok(await fails(db.query('select * from col_customers')));
    assert.ok(await fails(db.query('select * from col_invoice_directory()')));
  });
});
