export default function handler(_req, res) {
  if (res?.json) {
    res.status(200).json({ ok: true });
    return;
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
