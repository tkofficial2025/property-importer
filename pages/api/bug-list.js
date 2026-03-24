// GET /api/bug-list
// SentryからIssue一覧を取得

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const sentryToken = process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg   = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;

  if (!sentryToken || !sentryOrg || !sentryProject) {
    return res.status(500).json({ error: 'SENTRY_AUTH_TOKEN / SENTRY_ORG / SENTRY_PROJECT が .env.local に設定されていません' });
  }

  try {
    const url = `https://sentry.io/api/0/projects/${sentryOrg}/${sentryProject}/issues/?query=is:unresolved&limit=20&sort=date`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${sentryToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Sentry API error: ${response.status} ${err}`);
    }

    const issues = await response.json();

    // 必要な情報だけ返す
    const simplified = issues.map(issue => ({
      id:           issue.id,
      title:        issue.title,
      culprit:      issue.culprit,
      level:        issue.level,       // error / warning / info
      count:        issue.count,       // 発生回数
      userCount:    issue.userCount,   // 影響ユーザー数
      firstSeen:    issue.firstSeen,
      lastSeen:     issue.lastSeen,
      status:       issue.status,      // unresolved / resolved
      permalink:    issue.permalink,
    }));

    return res.status(200).json({ issues: simplified });
  } catch (e) {
    console.error('[BugList]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
