import { NextRequest, NextResponse } from 'next/server'
import { getIronSession } from 'iron-session'
import { sessionOptions, AppSession } from '@/lib/session'
import { supabase } from '../dashboard/_lib'

/**
 * Photos / videos submitted on a single activity report — backs the
 * "click a report row on /dashboard → show just that report's media" flow.
 * Session-guarded. hitech_report_hitechphoto holds only a handful of rows per
 * report, so no pagination / RPC.
 */
export async function GET(req: NextRequest) {
  const res = NextResponse.json({})
  const session = await getIronSession<AppSession>(req, res, sessionOptions)
  if (!session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = Number(new URL(req.url).searchParams.get('id'))
  if (!Number.isFinite(id) || id <= 0) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const { data, error } = await supabase
    .from('hitech_report_hitechphoto')
    .select('file, media_type')
    .eq('report_id', id)
    .order('id', { ascending: true })

  if (error) return NextResponse.json({ error: 'Failed to load report media' }, { status: 503 })

  const items = (data ?? [])
    .filter(r => r.file && String(r.file).trim() !== '')
    .map(r => ({ file: r.file as string, media_type: (r.media_type as string) || 'image', project_name: '' }))

  return NextResponse.json({ items }, { headers: { 'Cache-Control': 'private, max-age=60' } })
}
