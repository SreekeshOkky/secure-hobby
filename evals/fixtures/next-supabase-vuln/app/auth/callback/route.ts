import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const next = searchParams.get('next') ?? '/';
  // (code exchange omitted)
  return NextResponse.redirect(next);
}
