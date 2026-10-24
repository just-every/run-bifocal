import test from 'node:test';
import assert from 'node:assert/strict';
import {operatorMail} from '../src/mail.server.mjs';
const message = {deliveryId: 'synthetic-bifocal-70', from: 'sender@example.test', to: ['recipient@example.test'], subject: 'Bifocal sign-in', text: 'Synthetic sign-in message'};

test('operator mail submits through its configured Managed relay and refuses a missing relay', async t => {
 const requests = [];
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  requests.push({url, init});
  return Response.json({messageId: '<synthetic-bifocal-71@example.test>'}, {status: 202});
 });
 const env = {MAIL_PROVIDER: 'rer', MAIL_API_KEY: 'synthetic-bifocal-72', MAIL_RELAY_URL: 'https://relay.example.test/api/mail'};
 const result = await operatorMail(env).send(message);
 assert.equal(result.status, 'accepted');
 assert.equal(requests.length, 1);
 assert.equal(requests[0].url, env.MAIL_RELAY_URL);
 assert.equal(requests[0].init.headers.Authorization, `Bearer ${env.MAIL_API_KEY}`);
 assert.deepEqual(JSON.parse(requests[0].init.body), {to: 'recipient@example.test', subject: message.subject, text: message.text});
 await assert.rejects(operatorMail({...env, MAIL_RELAY_URL: undefined}).send(message), {code: 'rer_relay_url_required'});
 assert.equal(requests.length, 1);
});

test('direct provider mail works when the Managed relay binding is empty', async t => {
 const requests = [];
 t.mock.method(globalThis, 'fetch', async (url, init) => {
  requests.push({url, init});
  return Response.json({id: 'synthetic-bifocal-73'}, {status: 200});
 });
 const result = await operatorMail({MAIL_PROVIDER: 'resend', MAIL_API_KEY: 'synthetic-bifocal-74', MAIL_RELAY_URL: ''}).send(message);
 assert.equal(result.status, 'accepted');
 assert.equal(requests.length, 1);
 assert.equal(requests[0].url, 'https://api.resend.com/emails');
 assert.equal(JSON.parse(requests[0].init.body).from, message.from);
});
