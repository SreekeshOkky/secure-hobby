import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { prompt } = await req.json();
  const r = await openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] });
  return Response.json(r.choices[0].message);
}
