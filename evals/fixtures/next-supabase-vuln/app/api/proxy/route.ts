export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get('url');
  const r = await fetch(url!);
  return new Response(await r.text());
}
