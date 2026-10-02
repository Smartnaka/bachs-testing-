import fs from 'node:fs/promises';
import path from 'node:path';

const file = path.join(process.cwd(), 'data', 'payments.json');
let queue = Promise.resolve();

async function read() {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}
async function write(data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, file);
}
function locked(operation) {
  const result = queue.then(operation, operation);
  queue = result.catch(() => {});
  return result;
}

export function createPayment(payment) {
  return locked(async () => { const data = await read(); data[payment.reference] = payment; await write(data); return payment; });
}
export function getPayment(reference) { return locked(async () => (await read())[reference] || null); }
export function updatePayment(reference, update) {
  return locked(async () => {
    const data = await read();
    if (!data[reference]) return null;
    data[reference] = { ...data[reference], ...update, updatedAt: new Date().toISOString() };
    await write(data); return data[reference];
  });
}
