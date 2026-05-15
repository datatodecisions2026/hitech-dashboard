import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, AppSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  session.destroy()
  return res
}
