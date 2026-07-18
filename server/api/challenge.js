// OpenAI Apps domain-verification challenge.
// Served at /.well-known/openai-apps-challenge (via vercel.json rewrite).
// The verification token is provided by the OpenAI plugin editor; it is a public
// value (not a secret) whose only purpose is to prove we control this origin.
// Read from env so it can be rotated without a code change; falls back to the
// value issued for the current draft.
const CHALLENGE_TOKEN =
  process.env.OPENAI_APPS_CHALLENGE || 'ZXZvtKwuOgSizW8ZKk6Ib0IEu1P805FlFcu_yz_r8cQ';

export default async function handler(req, res) {
  res.setHeader('content-type', 'text/plain; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.status(200).send(CHALLENGE_TOKEN);
}
