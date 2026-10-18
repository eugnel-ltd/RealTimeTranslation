const TITLE = 'Uptime: rtt.eugnel.com is failing';
const MARKER = '<!-- rtt-uptime-incident -->';

function runReference(runUrl, owner, repo) {
  if (typeof runUrl !== 'string') return '';
  try {
    const url = new URL(runUrl);
    const prefix = `/${owner}/${repo}/actions/runs/`;
    if (url.origin !== 'https://github.com' || !url.pathname.startsWith(prefix)
      || !/^\d+$/.test(url.pathname.slice(prefix.length)) || url.search || url.hash || url.username || url.password) return '';
    return `\n\nRun: ${url.href}`;
  } catch {
    return '';
  }
}

// Inject the GitHub client so the real orchestration can be proved offline.
// Missing monitor credentials must neither open an incident nor close one.
export async function manageIncident({ result, github, owner, repo, runUrl }) {
  if (result?.configured === false && result.healthy === false && result.exitCode === 2) {
    return { action: 'unconfigured', count: 0 };
  }
  if (result?.configured !== true || typeof result.healthy !== 'boolean'
    || result.exitCode !== (result.healthy ? 0 : 1)) {
    throw new Error('Invalid uptime result');
  }
  const issues = github.rest.issues;
  const open = (await github.paginate(issues.listForRepo, { owner, repo, state: 'open', per_page: 100 }))
    .filter((issue) => !issue.pull_request && issue.title === TITLE && typeof issue.body === 'string' && issue.body.includes(MARKER));
  const reference = runReference(runUrl, owner, repo);

  if (!result.healthy) {
    if (open.length) return { action: 'existing', count: open.length };
    await issues.create({
      owner, repo, title: TITLE,
      body: `${MARKER}\nRTT failed its authenticated uptime check. The homepage or /api/healthz did not pass.${reference}`,
    });
    return { action: 'opened', count: 1 };
  }
  for (const issue of open) {
    await issues.createComment({ owner, repo, issue_number: issue.number, body: `RTT recovered: both authenticated uptime checks passed.${reference}` });
    await issues.update({ owner, repo, issue_number: issue.number, state: 'closed', state_reason: 'completed' });
  }
  return { action: open.length ? 'recovered' : 'healthy', count: open.length };
}
