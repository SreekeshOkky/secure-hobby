import OpenAI from 'openai';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { serverClient } from '@/lib/server';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ratelimit = new Ratelimit({ redis: Redis.fromEnv(), limiter: Ratelimit.slidingWindow(20, '1 h') });

export async function POST(req: Request) {
  const { data: { user } } = await serverClient().auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });
  if (!(await ratelimit.limit(user.id)).success) return new Response('Too many requests', { status: 429 });
  const { prompt } = await req.json();
  const r = await openai.chat.completions.create({ model: 'gpt-4o-mini', max_tokens: 500, messages: [{ role: 'user', content: String(prompt).slice(0, 4000) }] });
  return Response.json(r.choices[0].message);
}
