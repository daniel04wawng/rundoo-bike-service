async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `Request failed (${res.status})`);
    err.details = data.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

const key = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

export const api = {
  bootstrap: () => call('GET', '/api/bootstrap'),
  jobs: () => call('GET', '/api/jobs'),
  createJob: (body) => call('POST', '/api/jobs', body),
  customers: () => call('GET', '/api/customers'),
  job: (id) => call('GET', `/api/jobs/${id}`),
  describe: (id, text) => call('POST', `/api/jobs/${id}/describe`, { text }),
  components: (id, components) => call('POST', `/api/jobs/${id}/components`, { components }),
  select: (id, selection, configuration_version) => call('POST', `/api/jobs/${id}/selection`, { selection, configuration_version }),
  labor: (id, labor) => call('POST', `/api/jobs/${id}/labor`, { labor }),
  stage: (id, stage) => call('POST', `/api/jobs/${id}/stage`, { stage }),
  inquiry: (id, requirementId) => call('POST', `/api/jobs/${id}/inquiry`, { requirementId }),
  send: (id, message) => call('POST', `/api/jobs/${id}/send`, { message, idempotency_key: key() }),
  approval: (token) => call('GET', `/api/approve/${token}`),
  respond: (token, response) => call('POST', `/api/approve/${token}`, { response }),
};

export function money(cents) {
  return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' }).replace('CA$', '$');
}
export const price = (dollars) => money(Math.round(dollars * 100));
