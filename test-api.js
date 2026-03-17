const fetch = require('node-fetch');
async function run() {
  const res = await fetch('http://localhost:8082/api/platform/pg-meta/default/query?key=table-create-with-columns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: "SELECT 1" })
  });
  console.log(res.status);
  console.log(await res.text());
}
run();
